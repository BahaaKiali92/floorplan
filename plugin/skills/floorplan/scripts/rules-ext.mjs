// Rules the team already has in other tools, read as extra rule sources (no need to repeat them in floorplan):
// - Nx: @nx/enforce-module-boundaries (depConstraints) with the tags from project.json files
// - ArchUnit (Java): noClasses()/classes() package rules and layeredArchitecture() in test sources
// Each returns { active, note, violations: [{ rule, severity, file, detail, message }] } with file paths relative to ROOT.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const toPosix = (p) => p.split(path.sep).join('/');
function walkFiles(dir, test, acc = [], depth = 0) {
  if (depth > 12 || !fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'dist', 'target', 'build', 'out', 'tmp', 'coverage'].includes(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(abs, test, acc, depth + 1);
    else if (test(e.name)) acc.push(abs);
  }
  return acc;
}
import { jsonText as stripJson } from './eslint-rules.mjs'; // comments and trailing commas; '/**/' inside strings stays

// ---------- Nx ----------
function tagMatches(pattern, tag) {
  if (pattern === '*') return true;
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const i = pattern.lastIndexOf('/');
    try { return new RegExp(pattern.slice(1, i), pattern.slice(i + 1)).test(tag); } catch { return false; }
  }
  if (pattern.includes('*')) return new RegExp('^' + pattern.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(tag);
  return pattern === tag;
}

async function nxConstraints(cwd) {
  const found = [];
  const fromRules = (rules) => {
    const r = rules && (rules['@nx/enforce-module-boundaries'] || rules['@nrwl/nx/enforce-module-boundaries']);
    if (!r) return;
    const opts = Array.isArray(r) ? r[1] : null;
    if (opts && Array.isArray(opts.depConstraints)) found.push(...opts.depConstraints);
  };
  for (const name of ['.eslintrc.json', '.eslintrc']) {
    const f = path.join(cwd, name);
    if (!fs.existsSync(f)) continue;
    try {
      const c = JSON.parse(stripJson(fs.readFileSync(f, 'utf8')));
      fromRules(c.rules);
      for (const o of c.overrides || []) fromRules(o.rules);
    } catch { /* not JSON */ }
  }
  if (!found.length) {
    for (const name of ['eslint.config.mjs', 'eslint.config.js', 'eslint.config.cjs']) {
      const f = path.join(cwd, name);
      if (!fs.existsSync(f)) continue;
      try {
        const mod = await import(pathToFileURL(f).href);
        const cfg = await (mod.default ?? mod);
        for (const entry of [].concat(cfg).flat(Infinity)) if (entry && entry.rules) fromRules(entry.rules);
      } catch (e) { return { constraints: [], note: `could not load ${name} (${e.message.split('\n')[0]}); install the workspace dependencies` }; }
      break;
    }
  }
  return { constraints: found, note: '' };
}

export async function nxViolations({ ROOT, cwd, files, mode }) {
  if (mode === false || !fs.existsSync(path.join(cwd, 'nx.json'))) return { active: false, violations: [] };
  const projects = [];
  for (const pj of walkFiles(cwd, (n) => n === 'project.json')) {
    try {
      const j = JSON.parse(stripJson(fs.readFileSync(pj, 'utf8')));
      const dir = path.dirname(pj);
      projects.push({ name: j.name || path.basename(dir), root: dir, src: j.sourceRoot ? path.resolve(cwd, j.sourceRoot) : dir, tags: j.tags || [] });
    } catch { /* skip */ }
  }
  if (!projects.length) return { active: false, note: 'nx.json found, but no project.json files.', violations: [] };
  projects.sort((a, b) => b.root.length - a.root.length);
  const projectOf = (abs) => projects.find((p) => abs === p.root || abs.startsWith(p.root + path.sep));
  const { constraints, note } = await nxConstraints(cwd);
  if (!constraints.length) return { active: false, note: note || 'nx.json found, but no @nx/enforce-module-boundaries depConstraints in the ESLint config.', violations: [] };
  const violations = [];
  for (const f of files) {
    const from = projectOf(path.join(ROOT, f.path));
    if (!from) continue;
    for (const t of f.imports) {
      const to = projectOf(path.join(ROOT, t));
      if (!to || to === from) continue;
      for (const c of constraints) {
        const applies = c.sourceTag ? from.tags.some((tag) => tagMatches(c.sourceTag, tag))
          : Array.isArray(c.allSourceTags) ? c.allSourceTags.every((st) => from.tags.some((tag) => tagMatches(st, tag))) : false;
        if (!applies) continue;
        const only = c.onlyDependOnLibsWithTags, not = c.notDependOnLibsWithTags;
        let bad = null;
        if (Array.isArray(only) && !to.tags.some((tag) => only.some((o) => tagMatches(o, tag)))) bad = `may only depend on ${only.join(', ')}`;
        if (!bad && Array.isArray(not) && to.tags.some((tag) => not.some((o) => tagMatches(o, tag)))) bad = `must not depend on ${not.join(', ')}`;
        if (bad) {
          violations.push({ rule: 'nx:module-boundaries', severity: 'error', file: f.path,
            detail: `imports ${t} (${from.name} [${from.tags.join(', ')}] → ${to.name} [${to.tags.join(', ')}]: ${c.sourceTag || c.allSourceTags.join('+')} ${bad})`,
            message: 'Nx: depConstraints of @nx/enforce-module-boundaries do not allow this dependency.' });
          break;
        }
      }
    }
  }
  return { active: true, note: '', violations, projects: projects.length, constraints: constraints.length };
}

// ---------- ArchUnit ----------
// ArchUnit package patterns: '..' = any number of packages, '*' = any part of a name
export function archPkgRegex(pattern) {
  let p = pattern.replace(/[+?^${}()|[\]\\]/g, '\\$&');
  p = p.replace(/\*/g, '[\\w$]*');
  const parts = p.split('..');
  let out = '';
  parts.forEach((part, i) => {
    const seg = part.replace(/\./g, '\\.');
    if (i === 0) out += part === '' ? '(?:.*\\.)?' : seg;
    else if (i === parts.length - 1) out += part === '' ? '(?:\\..*)?' : `\\.(?:.*\\.)?${seg}`;
    else out += `\\.(?:.*\\.)?${seg}`;
  });
  out = out.replace(/\(\?:\.\*\\\.\)\?\\\.\(\?:\.\*\\\.\)\?/g, '(?:.*\\.)?');
  return new RegExp(`^${out}$`);
}
const strArgs = (s) => [...(s || '').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
const stripJavaComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"])\/\/.*$/gm, '$1');

export function parseArchUnit(src) {
  const rules = [];
  const code = stripJavaComments(src);
  // name: the field or method the rule belongs to
  const nameAt = (pos) => {
    const before = code.slice(0, pos);
    const m = [...before.matchAll(/\b(?:ArchRule|void)\s+([A-Za-z_$][\w$]*)\s*[=(]/g)].pop();
    return m ? m[1] : 'rule';
  };
  // noClasses().that().resideIn(Any)Package(A).should().dependOnClassesThat()/accessClassesThat().resideIn(Any)Package(B)
  const rxNo = /\bnoClasses\s*\(\s*\)\s*\.\s*that\s*\(\s*\)\s*\.\s*resideIn(?:Any|A)Package\s*\(([^)]*)\)[\s\S]*?\.\s*should\s*\(\s*\)\s*\.\s*(?:dependOnClassesThat|accessClassesThat)\s*\(\s*\)\s*\.\s*resideIn(?:Any|A)Package\s*\(([^)]*)\)/g;
  for (const m of code.matchAll(rxNo)) rules.push({ type: 'no', name: nameAt(m.index), from: strArgs(m[1]), to: strArgs(m[2]) });
  // classes().that().resideIn(Any)Package(A).should().onlyDependOnClassesThat()/onlyAccessClassesThat().resideIn(Any)Package(B)
  const rxOnly = /\bclasses\s*\(\s*\)\s*\.\s*that\s*\(\s*\)\s*\.\s*resideIn(?:Any|A)Package\s*\(([^)]*)\)[\s\S]*?\.\s*should\s*\(\s*\)\s*\.\s*(?:onlyDependOnClassesThat|onlyAccessClassesThat)\s*\(\s*\)\s*\.\s*resideIn(?:Any|A)Package\s*\(([^)]*)\)/g;
  for (const m of code.matchAll(rxOnly)) rules.push({ type: 'only', name: nameAt(m.index), from: strArgs(m[1]), to: strArgs(m[2]) });
  // layeredArchitecture(): .layer("X").definedBy("..x..") … .whereLayer("X").mayNotBeAccessedByAnyLayer() / mayOnlyBeAccessedByLayers("A", …)
  for (const m of code.matchAll(/\blayeredArchitecture\s*\(\s*\)([\s\S]*?);/g)) {
    const body = m[1];
    const layers = new Map();
    for (const l of body.matchAll(/\.\s*(?:optionalLayer|layer)\s*\(\s*"([^"]+)"\s*\)\s*\.\s*definedBy\s*\(([^)]*)\)/g)) layers.set(l[1], strArgs(l[2]));
    for (const w of body.matchAll(/\.\s*whereLayer\s*\(\s*"([^"]+)"\s*\)\s*\.\s*(mayNotBeAccessedByAnyLayer|mayOnlyBeAccessedByLayers|mayNotAccessAnyLayer|mayOnlyAccessLayers)\s*\(([^)]*)\)/g)) {
      rules.push({ type: 'layer', name: nameAt(m.index), layers, layer: w[1], how: w[2], others: strArgs(w[3]) });
    }
  }
  return rules;
}

export function archUnitViolations({ files, scanRoot, mode, walkJava }) {
  if (mode === false) return { active: false, violations: [] };
  const sources = walkJava(scanRoot).filter((f) => /[\\/]src[\\/][^\\/]+[\\/]java[\\/]/.test(f) && /[\\/]src[\\/](test|it|integrationTest)[\\/]/.test(f));
  const rules = [];
  for (const f of sources) {
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes('com.tngtech.archunit')) continue;
    for (const r of parseArchUnit(src)) rules.push({ ...r, source: toPosix(path.relative(scanRoot, f)) });
  }
  if (!rules.length) return { active: false, violations: [] };
  const pkgOf = new Map(files.map((f) => [f.path, f.package || '']));
  const any = (pats, pkg) => pats.some((p) => archPkgRegex(p).test(pkg));
  const violations = [];
  for (const f of files) {
    const pkg = f.package || '';
    for (const t of f.imports) {
      const tp = pkgOf.get(t);
      if (tp === undefined || tp === pkg) continue;
      for (const r of rules) {
        let bad = false;
        if (r.type === 'no') bad = any(r.from, pkg) && any(r.to, tp);
        else if (r.type === 'only') bad = any(r.from, pkg) && !any(r.to, tp) && !any(r.from, tp);
        else if (r.type === 'layer') {
          const layerOf = (p) => [...r.layers].find(([, pats]) => any(pats, p))?.[0];
          const lf = layerOf(pkg), lt = layerOf(tp);
          if (!lf || !lt || lf === lt) continue;
          if (r.how === 'mayNotBeAccessedByAnyLayer') bad = lt === r.layer;
          else if (r.how === 'mayOnlyBeAccessedByLayers') bad = lt === r.layer && !r.others.includes(lf);
          else if (r.how === 'mayNotAccessAnyLayer') bad = lf === r.layer;
          else if (r.how === 'mayOnlyAccessLayers') bad = lf === r.layer && !r.others.includes(lt);
        }
        if (bad) {
          violations.push({ rule: `archunit:${r.name}`, severity: 'error', file: f.path, detail: `imports ${t}`,
            message: `ArchUnit rule ${r.name} (${r.source}) does not allow this dependency.` });
          break;
        }
      }
    }
  }
  return { active: true, violations, rules: rules.length };
}
