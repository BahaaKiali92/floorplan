// Import-boundary rules the team already has in ESLint, read as a rule source so Floorplan doesn't define them twice:
// - eslint-plugin-boundaries: boundaries/element-types (with the boundaries/elements settings)
// - import/no-restricted-paths (also import-x/): zones of target / from / except
// - no-restricted-imports (also @typescript-eslint/): paths and patterns (gitignore-style, group, regex)
// Only these rule options and settings are kept from the ESLint config, as plain JSON, so the branch-point map can be
// checked with the same rules (see FLOORPLAN_ESLINT_JSON in generate-map.mjs) without loading ESLint plugins there.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const posix = (p) => p.split(path.sep).join('/');
// JSON with comments and trailing commas (.eslintrc); comment marks inside strings ("**/x/**") stay
export function jsonText(t) {
  let out = '', q = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i], n = t[i + 1];
    if (q) { out += c; if (c === '\\') { out += n; i++; } else if (c === q) q = null; continue; }
    if (c === '"') { q = c; out += c; }
    else if (c === '/' && n === '/') { while (i < t.length && t[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && n === '*') { const e = t.indexOf('*/', i + 2); i = e < 0 ? t.length : e + 1; }
    else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
const asList = (x) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
const RULE_KEYS = {
  'boundaries/element-types': 'boundaries',
  'import/no-restricted-paths': 'no-restricted-paths',
  'import-x/no-restricted-paths': 'no-restricted-paths',
  'no-restricted-imports': 'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports': 'no-restricted-imports',
};
const UNSUPPORTED = ['boundaries/dependencies', 'boundaries/entry-point', 'boundaries/external', 'boundaries/no-private'];

// ---------- globs (minimatch-like: **, *, ?, {a,b}); '*' and '**' are captured in order ----------
export function globSource(glob) {
  let g = glob.replace(/^\.\//, ''), re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i++;
      if (g[i + 1] === '/') { re += '((?:[^/]*/)*?)'; i++; } else re += '(.*)';
    } else if (c === '*') re += '([^/]*)';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end < 0) { re += '\\{'; continue; }
      re += '(?:' + g.slice(i + 1, end).split(',').map((x) => globSource(x)).join('|') + ')';
      i = end;
    } else re += c.replace(/[.+^${}()|[\]\\/]/g, '\\$&');
  }
  return re;
}
const isGlob = (p) => /[*?{]/.test(p);
const fullGlob = (glob) => new RegExp(`^${globSource(glob)}$`);
// ESLint config "files": relative to the config's folder; eslintrc patterns without a slash match the file name
function filesMatch(patterns, rel, eslintrc) {
  return asList(patterns).flat().some((p) => {
    if (typeof p !== 'string') return false;
    if (eslintrc && !p.includes('/')) return fullGlob(p).test(rel.split('/').pop());
    return fullGlob(p).test(rel) || (!p.includes('/') && fullGlob(p).test(rel.split('/').pop()));
  });
}

// ---------- loading the config ----------
function severityOf(v) {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === 2 || s === 'error') return 'error';
  if (s === 1 || s === 'warn') return 'warn';
  return null;
}
// keep only what Floorplan reads: the boundary rules (severity + options) and the boundaries/* settings
function pick(entry, base, eslintrc) {
  const rules = {};
  for (const [k, v] of Object.entries(entry.rules || {})) {
    if (RULE_KEYS[k] || UNSUPPORTED.includes(k)) rules[k] = { severity: severityOf(v), options: Array.isArray(v) ? v.slice(1) : [] };
  }
  const settings = {};
  for (const [k, v] of Object.entries(entry.settings || {})) if (k.startsWith('boundaries/')) settings[k] = v;
  const files = entry.files ? asList(entry.files).flat().filter((x) => typeof x === 'string') : null;
  const ignores = entry.ignores ? asList(entry.ignores).filter((x) => typeof x === 'string') : null;
  if (!Object.keys(rules).length && !Object.keys(settings).length && !(ignores && !files && !Object.keys(entry).some((k) => !['ignores', 'name'].includes(k)))) return null;
  return JSON.parse(JSON.stringify({ base, eslintrc, files, ignores, rules, settings }));
}

export async function loadEslintEntries(cwd, stopAt) {
  // the nearest ESLint config: the project folder, then its parents up to the repository root
  let dir = path.resolve(cwd);
  const stop = stopAt ? path.resolve(stopAt) : null;
  for (;;) {
    for (const name of ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs', 'eslint.config.ts']) {
      const f = path.join(dir, name);
      if (!fs.existsSync(f)) continue;
      if (name.endsWith('.ts')) return { file: f, entries: [], note: `${name} (TypeScript) is not read; boundary rules there are not checked by Floorplan.` };
      try {
        const mod = await import(pathToFileURL(f).href);
        const cfg = await (mod.default ?? mod);
        const entries = [];
        for (const e of [].concat(cfg).flat(Infinity)) if (e && typeof e === 'object') { const p = pick(e, posix(path.relative(cwd, dir)), false); if (p) entries.push(p); }
        return { file: f, entries, note: '' };
      } catch (e) { return { file: f, entries: [], note: `could not load ${name} (${String(e.message).split('\n')[0]}); install the dependencies (npm install) so Floorplan can read its boundary rules.` }; }
    }
    for (const name of ['.eslintrc.json', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs']) {
      const f = path.join(dir, name);
      if (!fs.existsSync(f)) continue;
      let c;
      try {
        c = name.endsWith('js') ? createRequire(f)(f) : JSON.parse(jsonText(fs.readFileSync(f, 'utf8')));
      } catch (e) { return { file: f, entries: [], note: `could not read ${name} (${String(e.message).split('\n')[0]}).` }; }
      const base = posix(path.relative(cwd, dir));
      const entries = [];
      const top = pick({ rules: c.rules, settings: c.settings, ignores: c.ignorePatterns }, base, true);
      if (top) entries.push({ ...top, ignores: null, globalIgnores: asList(c.ignorePatterns) });
      for (const o of c.overrides || []) { const p = pick({ files: o.files, rules: o.rules, settings: o.settings }, base, true); if (p) { if (o.excludedFiles) p.excluded = asList(o.excludedFiles); entries.push(p); } }
      return { file: f, entries, note: '' };
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.eslintConfig) {
        const c = pkg.eslintConfig, base = posix(path.relative(cwd, dir));
        const entries = [];
        const top = pick({ rules: c.rules, settings: c.settings }, base, true);
        if (top) entries.push(top);
        for (const o of c.overrides || []) { const p = pick({ files: o.files, rules: o.rules, settings: o.settings }, base, true); if (p) entries.push(p); }
        return { file: path.join(dir, 'package.json'), entries, note: '' };
      }
    } catch { /* no package.json */ }
    const parent = path.dirname(dir);
    if (parent === dir || (stop && dir === stop) || fs.existsSync(path.join(dir, '.git'))) return { file: null, entries: [], note: '' };
    dir = parent;
  }
}

// the rules and settings that apply to one file (relative to the project folder), like ESLint merges them
function effective(entries, rel) {
  const rules = {}, settings = {};
  for (const e of entries) {
    const local = e.base ? (rel.startsWith(e.base + '/') ? rel.slice(e.base.length + 1) : null) : rel;
    if (local === null) continue;
    if (e.globalIgnores && filesMatch(e.globalIgnores, local, true)) return { rules: {}, settings: {} };
    if (!e.files && e.ignores && !Object.keys(e.rules).length && !Object.keys(e.settings).length) { if (filesMatch(e.ignores, local, false)) return { rules: {}, settings: {} }; continue; }
    if (e.files && !filesMatch(e.files, local, e.eslintrc)) continue;
    if (e.ignores && filesMatch(e.ignores, local, e.eslintrc)) continue;
    if (e.excluded && filesMatch(e.excluded, local, true)) continue;
    Object.assign(rules, e.rules);
    Object.assign(settings, e.settings);
  }
  return { rules, settings };
}

// ---------- no-restricted-imports ----------
// gitignore-style list: a pattern with a slash (not at the end) is anchored, otherwise it matches at any level;
// a matching folder covers what is inside it; '!' re-allows; the last matching pattern wins
function gitignoreMatch(patterns, spec, caseSensitive) {
  const parts = spec.split('/');
  const candidates = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  let hit = false;
  for (const raw of patterns) {
    if (typeof raw !== 'string' || !raw.trim() || raw.startsWith('#')) continue;
    const neg = raw.startsWith('!');
    let p = (neg ? raw.slice(1) : raw).replace(/\/$/, '');
    const anchored = p.replace(/^\//, '').includes('/') || p.startsWith('/');
    p = p.replace(/^\//, '');
    const rx = new RegExp(`^${anchored ? '' : '(?:.*/)?'}${globSource(p)}$`, caseSensitive ? '' : 'i');
    if (candidates.some((c) => rx.test(c))) hit = !neg;
  }
  return hit;
}
function restrictedImport(options, spec, typeOnly) {
  const paths = [], patterns = [];
  for (const o of options) {
    if (typeof o === 'string') paths.push({ name: o });
    else if (o && (o.paths || o.patterns)) { paths.push(...asList(o.paths).map((x) => (typeof x === 'string' ? { name: x } : x))); patterns.push(...asList(o.patterns)); }
    else if (o && o.name) paths.push(o);
  }
  for (const p of paths) {
    if (p.name !== spec || (p.importNames && p.importNames.length) || (typeOnly && p.allowTypeImports)) continue;
    return { message: p.message || `'${spec}' import is restricted from being used.` };
  }
  const strings = patterns.filter((x) => typeof x === 'string');
  if (strings.length && !typeOnly && gitignoreMatch(strings, spec, false)) return { message: `'${spec}' import is restricted from being used by a pattern.` };
  for (const g of patterns.filter((x) => x && typeof x === 'object')) {
    if ((g.importNames && g.importNames.length) || (g.importNamePattern) || (typeOnly && g.allowTypeImports)) continue;
    let hit = false;
    if (g.group) hit = gitignoreMatch(asList(g.group), spec, !!g.caseSensitive);
    else if (g.regex) { try { hit = new RegExp(g.regex, g.caseSensitive ? 'u' : 'iu').test(spec); } catch { hit = false; } }
    if (hit) return { message: g.message || `'${spec}' import is restricted from being used by a pattern.` };
  }
  return null;
}

// ---------- import/no-restricted-paths ----------
function inZonePath(p, rel) { return isGlob(p) ? fullGlob(p).test(rel) : rel === p || rel.startsWith(p.replace(/\/$/, '') + '/'); }
function restrictedPath(options, fromRel, toRel, cwd) {
  const o = options[0] || {};
  const basePath = o.basePath ? posix(path.relative(cwd, path.resolve(cwd, o.basePath))) : '';
  const norm = (p) => posix(path.normalize(basePath ? `${basePath}/${p}` : p)).replace(/^\.\//, '').replace(/^\.$/, '');
  for (const z of asList(o.zones)) {
    const targets = asList(z.target).map(norm), froms = asList(z.from).map(norm);
    if (!targets.some((t) => inZonePath(t, fromRel))) continue;
    const from = froms.find((f) => inZonePath(f, toRel));
    if (!from) continue;
    const excepts = asList(z.except).map((e) => (isGlob(from) ? e : posix(path.normalize(`${from}/${e}`))));
    if (excepts.some((e) => inZonePath(e, toRel))) continue;
    return { message: z.message || `Unexpected path "${toRel}" imported in restricted zone.` };
  }
  return null;
}

// ---------- eslint-plugin-boundaries ----------
// element of a file: the first element (settings order) whose pattern matches; folder mode = the nearest parent folder
// that matches (the pattern is matched from the right of the path), file mode = the file, full = the whole path
function elementOf(elements, rel) {
  const parts = rel.split('/');
  const dirs = parts.slice(0, -1).map((_, i) => parts.slice(0, parts.length - 1 - i).join('/')); // nearest first
  for (const el of elements) {
    for (const pat of asList(el.pattern)) {
      if (typeof pat !== 'string') continue;
      const mode = el.mode || 'folder';
      const src = globSource(pat.replace(/\/$/, ''));
      const tries = mode === 'file' ? [rel] : mode === 'full' ? [rel, ...dirs] : dirs;
      const rx = new RegExp(mode === 'full' ? `^${src}$` : `^(?:.*?/)??${src}$`);
      for (const t of tries) {
        const m = rx.exec(t);
        if (!m) continue;
        const captured = {};
        asList(el.capture).forEach((k, i) => { if (m[i + 1] !== undefined) captured[k] = m[i + 1].replace(/\/$/, ''); });
        return { type: el.type, path: t, captured };
      }
    }
  }
  return null;
}
// micromatch-style: glob or plain value, '!' in front negates
const valueMatch = (pat, value) => {
  if (pat.startsWith('!')) return !valueMatch(pat.slice(1), value);
  return isGlob(pat) ? fullGlob(pat).test(value) : pat === value;
};
const typeMatch = valueMatch;
function fill(tpl, from, target) {
  return String(tpl).replace(/\$\{(?:(from|target|file|dependency)\.)?([\w-]+)\}/g, (_, who, key) => {
    const el = who === 'target' || who === 'dependency' ? target : from;
    if (key === 'type') return el.type;
    return el.captured[key] ?? '';
  });
}
function selectorList(sel) {
  if (sel === undefined || sel === null) return [];
  if (Array.isArray(sel) && sel.length === 2 && typeof sel[0] === 'string' && sel[1] && typeof sel[1] === 'object' && !Array.isArray(sel[1])) return [sel];
  return asList(sel);
}
function selects(sel, el, from, target) {
  return selectorList(sel).some((s) => {
    if (typeof s === 'string') return typeMatch(s, el.type);
    if (Array.isArray(s) && typeof s[0] === 'string') {
      if (!typeMatch(s[0], el.type)) return false;
      return Object.entries(s[1] || {}).every(([k, v]) => asList(v).some((x) => valueMatch(fill(x, from, target), el.captured[k] ?? '')));
    }
    return false;
  });
}
function boundariesVerdict(options, settings, fromRel, toRel, typeOnly) {
  const elements = asList(settings['boundaries/elements']);
  if (!elements.length) return null;
  const from = elementOf(elements, fromRel), target = elementOf(elements, toRel);
  if (!from || !target || (from.type === target.type && from.path === target.path)) return null;
  const o = options[0] || {};
  let allowed = (o.default || 'allow') !== 'disallow', message = o.message, matched = false;
  for (const r of asList(o.rules)) {
    if (!selects(r.from, from, from, target)) continue;
    if (r.importKind && r.importKind !== '*' && r.importKind !== (typeOnly ? 'type' : 'value')) continue;
    if (r.disallow && selects(r.disallow, target, from, target)) { allowed = false; message = r.message || o.message; matched = true; }
    else if (r.allow && selects(r.allow, target, from, target)) { allowed = true; matched = true; }
  }
  if (allowed) return null;
  const text = message ? fill(message, from, target)
    : `No rule allows the dependency from ${from.type}${from.path ? ` (${from.path})` : ''} to ${target.type}${target.path ? ` (${target.path})` : ''}${matched ? '' : ' (default: disallow)'}.`;
  return { message: text, from, target };
}

// ---------- checking ----------
const LABEL = { boundaries: 'eslint-plugin-boundaries', 'no-restricted-paths': 'import/no-restricted-paths', 'no-restricted-imports': 'no-restricted-imports' };
export function eslintViolations({ ROOT, cwd, files, loaded }) {
  const entries = loaded.entries || [];
  const used = new Map(); // floorplan rule name -> { label, severity }
  for (const e of entries) for (const [k, v] of Object.entries(e.rules)) if (RULE_KEYS[k] && v.severity) used.set(`eslint:${RULE_KEYS[k]}`, { label: k, kind: RULE_KEYS[k] });
  const unsupported = [...new Set(entries.flatMap((e) => Object.entries(e.rules).filter(([k, v]) => UNSUPPORTED.includes(k) && v.severity).map(([k]) => k)))];
  if (!used.size) return { active: false, violations: [], unsupported, rules: [] };
  const toCwd = (p) => posix(path.relative(cwd, path.join(ROOT, p)));
  const violations = [];
  const counts = new Map();
  for (const f of files) {
    const fromRel = toCwd(f.path);
    const { rules, settings } = effective(entries, fromRel);
    const active = Object.entries(rules).filter(([k, v]) => RULE_KEYS[k] && v.severity);
    if (!active.length) continue;
    const specs = [...(f._specOf || new Map())].map(([target, spec]) => ({ spec, target, typeOnly: !!(f._typeOnly && f._typeOnly.has(target)), dynamic: !!(f._dyn && f._dyn.has(target)) }))
      .concat([...new Set(f._ext || [])].map((spec) => ({ spec, target: null, typeOnly: false })));
    for (const [key, v] of active) {
      const kind = RULE_KEYS[key];
      for (const s of specs) {
        let hit = null;
        if (kind === 'no-restricted-imports') hit = s.dynamic ? null : restrictedImport(v.options, s.spec, s.typeOnly); // ESLint's rule skips import()
        else if (s.target && kind === 'no-restricted-paths') hit = restrictedPath(v.options, fromRel, toCwd(s.target), cwd);
        else if (s.target && kind === 'boundaries') hit = boundariesVerdict(v.options, settings, fromRel, toCwd(s.target), s.typeOnly);
        if (!hit) continue;
        const name = `eslint:${kind}`;
        counts.set(name, (counts.get(name) || 0) + 1);
        violations.push({ rule: name, severity: v.severity, file: f.path, detail: `imports ${s.target || s.spec}`, message: hit.message, eslintRule: key,
          ...(hit.from ? { note: `${hit.from.type} → ${hit.target.type}` } : {}) });
      }
    }
  }
  // rules that decide by the resolved file path cover the boundaries between areas. no-restricted-imports doesn't:
  // it matches the import text, so a relative import (../../customers/…) passes a '**/features/customers/**' pattern.
  const covers = [...used.values()].some((u) => u.kind === 'boundaries' || u.kind === 'no-restricted-paths');
  return { active: true, violations, unsupported, covers, file: loaded.file ? posix(path.relative(cwd, loaded.file)) || path.basename(loaded.file) : null,
    rules: [...used].map(([name, u]) => ({ name, eslintRule: u.label, label: LABEL[u.kind], issues: counts.get(name) || 0 })) };
}
