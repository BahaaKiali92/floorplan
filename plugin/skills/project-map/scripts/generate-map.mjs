#!/usr/bin/env node
// Angular project map generator. Zero dependencies (Node 18+).
//
// Scans the Angular app folder, classifies files (components, services, routes, ...),
// resolves imports (relative + tsconfig path aliases), merges your annotations and rules
// from project-map.config.mjs.
//
// Two layers:
//   docs/PROJECT_MAP.md + docs/project-map.json   MAIN map, committed, written only by CI on main (--main)
//   .project-map/                                  LOCAL, never committed (it ignores itself):
//       PROJECT_MAP.md, project-map.json           map of your working tree (used by the graph)
//       BRANCH_CHANGES.md, branch.json             what this branch changed compared with main
//
// Usage:
//   node scripts/project-map/generate-map.mjs            # local map + branch report      (npm run map)
//   node scripts/project-map/generate-map.mjs --main     # write the main map in docs/     (npm run map:main, CI on main)
//   node scripts/project-map/generate-map.mjs --check    # fail only on rule issues NEW compared with main (npm run map:check)
//   node scripts/project-map/generate-map.mjs --check --strict   # fail on every rule issue
//   node scripts/project-map/generate-map.mjs --session  # Claude Code SessionStart hook: short branch summary on stdout
//   options: --base <branch> (default: config baseBranch or "main"), --quiet, --config <file>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

// ---------- CLI ----------
const args = process.argv.slice(2);
const argVal = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const SESSION = args.includes('--session');
const MODE = args.includes('--json-stdout') ? 'json' : args.includes('--main') ? 'main'
  : args.includes('--check') ? 'check' : SESSION ? 'session' : 'local';
const QUIET = args.includes('--quiet');
const CHECK = MODE === 'check';
// The SessionStart hook may start in another folder; run from the project.
if (SESSION && process.env.CLAUDE_PROJECT_DIR && fs.existsSync(process.env.CLAUDE_PROJECT_DIR)) process.chdir(process.env.CLAUDE_PROJECT_DIR);
if (SESSION) {
  // A hook must never break the session: any error ends silently.
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
}
const configArg = args.indexOf('--config');
const configPath = path.resolve(configArg >= 0 ? args[configArg + 1] : 'project-map.config.mjs');

const defaults = {
  root: 'src/app',
  tsconfig: 'tsconfig.json',
  output: { markdown: 'docs/PROJECT_MAP.md', json: 'docs/project-map.json', local: '.project-map' },
  maxFilesPerFolder: 8,
  units: ['features/*'],
  ignore: ['**/*.spec.ts', '**/environments/**'],
  folders: {},
  rules: [],
  baseBranch: 'main',
  compactAbove: 400,   // above this many files, the Structure section is summarized (keeps the map small for Claude)
  compactDepth: 3,     // folder levels shown in compact mode (reduced automatically to stay under compactMaxLines)
  compactMaxLines: 250,
  compactWideFolder: 30, // in compact mode, a folder with more subfolders lists their names on one line
};
const userConfig = fs.existsSync(configPath)
  ? (await import(pathToFileURL(configPath).href)).default
  : {};
const config = { ...defaults, ...userConfig, output: { ...defaults.output, ...(userConfig.output || {}) } };

const ROOT = path.resolve(config.root);
if (!fs.existsSync(ROOT)) {
  if (SESSION) process.exit(0);
  console.error(`Root folder not found: ${config.root}`);
  process.exit(1);
}
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

// ---------- glob patterns ----------
// '**' = any depth, '*' = one path segment (captured, used for allowSame).
const globCache = new Map();
function globToRegex(pattern) {
  if (globCache.has(pattern)) return globCache.get(pattern);
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i++;
      if (pattern[i + 1] === '/') { re = re.slice(0, -2) + '(?:.*/)?'; i++; }
    } else if (c === '*') re += '([^/]+)';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  // A folder pattern also matches everything inside the folder.
  const rx = new RegExp(`^${re}(?:/.*)?$`);
  globCache.set(pattern, rx);
  return rx;
}
const asList = (x) => (Array.isArray(x) ? x : x ? [x] : []);
function matchAny(patterns, p) {
  for (const pat of asList(patterns)) {
    const m = globToRegex(pat).exec(p);
    if (m) return { pattern: pat, captures: m.slice(1) };
  }
  return null;
}

// ---------- tsconfig path aliases ----------
function stripJsonComments(text) {
  let out = '', inStr = false, q = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n; i++; }
      else if (c === q) inStr = false;
    } else if (c === '"' || c === "'") { inStr = true; q = c; out += c; }
    else if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; }
    else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
function loadAliases() {
  const aliases = [];
  const file = path.resolve(config.tsconfig);
  if (!fs.existsSync(file)) return aliases;
  try {
    const ts = JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8')));
    const co = ts.compilerOptions || {};
    const baseUrl = path.resolve(path.dirname(file), co.baseUrl || '.');
    for (const [key, targets] of Object.entries(co.paths || {})) {
      aliases.push({
        prefix: key.replace(/\*$/, ''),
        wildcard: key.endsWith('*'),
        targets: targets.map((t) => path.resolve(baseUrl, t.replace(/\*$/, ''))),
      });
    }
  } catch (e) {
    if (!SESSION && MODE !== 'json') console.warn(`Could not read ${config.tsconfig} path aliases: ${e.message}`);
  }
  return aliases.sort((a, b) => b.prefix.length - a.prefix.length);
}
const aliases = loadAliases();

// ---------- scan files ----------
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, acc);
    else if (e.name.endsWith('.ts')) acc.push(abs);
  }
  return acc;
}

const KINDS = [
  ['component', /\.component\.ts$/],
  ['service', /\.service\.ts$/],
  ['routes', /(\.routes\.ts|-routing\.module\.ts)$/],
  ['module', /\.module\.ts$/],
  ['guard', /\.guard\.ts$/],
  ['interceptor', /\.interceptor\.ts$/],
  ['resolver', /\.resolver\.ts$/],
  ['pipe', /\.pipe\.ts$/],
  ['directive', /\.directive\.ts$/],
  ['store', /\.(store|state|reducer|effects|actions|selectors|facade)\.ts$/],
  ['model', /\.(model|interface|types|enum|dto)\.ts$/],
  ['config', /\.config\.ts$/],
];
const kindOf = (name) => (KINDS.find(([, rx]) => rx.test(name)) || ['other'])[0];
const shortName = (name) => name.replace(/(-routing)?\.[a-z]+\.ts$/, '').replace(/\.ts$/, '');

function stripTsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}
function parseImports(src) {
  const specs = new Set();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const rx of patterns) for (const m of src.matchAll(rx)) specs.add(m[1]);
  return [...specs];
}
function tryFile(base) {
  for (const cand of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}
function resolveImport(fromAbs, spec) {
  if (spec.startsWith('.')) return { file: tryFile(path.resolve(path.dirname(fromAbs), spec)) };
  for (const a of aliases) {
    const hit = a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix;
    if (!hit) continue;
    const rest = a.wildcard ? spec.slice(a.prefix.length) : '';
    for (const t of a.targets) {
      const f = tryFile(path.join(t, rest));
      if (f) return { file: f };
    }
  }
  const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  return { external: pkg };
}

const allTs = walk(ROOT);
const files = [];
const externals = new Map();
for (const abs of allTs) {
  const p = rel(abs);
  if (matchAny(config.ignore, p)) continue;
  const src = stripTsComments(fs.readFileSync(abs, 'utf8'));
  const name = path.basename(abs);
  const entry = { path: p, kind: kindOf(name), name: shortName(name), imports: [] };
  const sel = /selector\s*:\s*['"`]([^'"`]+)['"`]/.exec(src);
  if (sel && ['component', 'directive'].includes(entry.kind)) entry.selector = sel[1];
  const pipe = /@Pipe\(\s*\{[^}]*name\s*:\s*['"]([^'"]+)['"]/.exec(src);
  if (pipe) entry.selector = pipe[1];
  for (const spec of parseImports(src)) {
    const r = resolveImport(abs, spec);
    if (r.file) {
      const target = rel(r.file);
      if (!target.startsWith('..')) entry.imports.push(target);
    } else if (r.external) {
      externals.set(r.external, (externals.get(r.external) || 0) + 1);
    }
  }
  entry.imports.sort();
  entry._src = src;
  files.push(entry);
}
files.sort((a, b) => a.path.localeCompare(b.path));
const testCount = allTs.filter((f) => f.endsWith('.spec.ts')).length;

// ---------- routes ----------
const routes = [];
for (const f of files.filter((x) => x.kind === 'routes' || /routes?\.ts$/.test(x.path))) {
  const rx = /path\s*:\s*['"]([^'"]*)['"]([\s\S]*?)(?=path\s*:|$)/g;
  for (const m of f._src.matchAll(rx)) {
    const body = m[2];
    const lazy = /(loadChildren|loadComponent)\s*:\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/.exec(body);
    const eager = /component\s*:\s*([A-Za-z0-9_]+)/.exec(body);
    const redirect = /redirectTo\s*:\s*['"]([^'"]*)['"]/.exec(body);
    let target = null;
    if (lazy) {
      const r = resolveImport(path.join(ROOT, f.path), lazy[2]);
      target = `${lazy[1] === 'loadChildren' ? 'lazy routes' : 'lazy component'}: ${r.file ? rel(r.file) : lazy[2]}`;
    } else if (eager) target = `component: ${eager[1]}`;
    else if (redirect) target = `redirect -> /${redirect[1]}`;
    if (target) routes.push({ file: f.path, path: m[1] === '' ? '(empty)' : m[1], target });
  }
}

// ---------- areas (units) and their dependencies ----------
function unitOf(p) {
  const m = matchAny(config.units, p);
  if (m) {
    // Rebuild the matched prefix, e.g. 'features/*' + ['orders'] -> 'features/orders'
    let i = 0;
    return m.pattern.replace(/\*\*?/g, () => m.captures[i++] ?? '*').replace(/\/\*\*$/, '');
  }
  return p.includes('/') ? p.split('/')[0] : '(root)';
}
const unitDeps = new Map();
for (const f of files) {
  const u = unitOf(f.path);
  if (!unitDeps.has(u)) unitDeps.set(u, new Set());
  for (const t of f.imports) {
    const tu = unitOf(t);
    if (tu !== u) unitDeps.get(u).add(tu);
  }
}

// ---------- rules ----------
const violations = [];
for (const rule of config.rules) {
  const severity = rule.severity || 'error';
  if (rule.type === 'noImport') {
    for (const f of files) {
      const from = matchAny(rule.from, f.path);
      if (!from) continue;
      for (const t of f.imports) {
        const to = matchAny(rule.to, t);
        if (!to) continue;
        if (rule.allowSame && from.captures.length && from.captures[0] === to.captures[0]) continue;
        if (rule.except && matchAny(rule.except, t)) continue;
        violations.push({ rule: rule.name, severity, file: f.path, detail: `imports ${t}`, message: rule.message });
      }
    }
  } else if (rule.type === 'placement') {
    for (const f of files) {
      if (!matchAny(rule.files, f.path)) continue;
      if (rule.kinds && !rule.kinds.includes(f.kind)) continue;
      if (!matchAny(rule.allowedIn, f.path)) {
        violations.push({ rule: rule.name, severity, file: f.path, detail: `must be in ${asList(rule.allowedIn).join(' or ')}`, message: rule.message });
      }
    }
  }
}

// ---------- folder tree ----------
function annotationFor(folder) {
  if (config.folders[folder]) return config.folders[folder];
  // Fall back to wildcard annotations like 'features/*'
  for (const [pat, ann] of Object.entries(config.folders)) {
    if (!pat.includes('*')) continue;
    const rx = globToRegex(pat);
    if (rx.test(folder) && folder.split('/').length === pat.split('/').length) return ann;
  }
  return null;
}
const tree = { name: '', folders: new Map(), files: [] };
for (const f of files) {
  const parts = f.path.split('/');
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    if (!node.folders.has(part)) node.folders.set(part, { name: part, folders: new Map(), files: [] });
    node = node.folders.get(part);
  }
  node.files.push(f);
}
const PLURAL = { component: 'components', service: 'services', routes: 'routes', module: 'modules', guard: 'guards',
  interceptor: 'interceptors', resolver: 'resolvers', pipe: 'pipes', directive: 'directives', store: 'state',
  model: 'models', config: 'config', other: 'other' };
const SINGULAR = { component: 'component', service: 'service', routes: 'routes file', module: 'module', guard: 'guard',
  interceptor: 'interceptor', resolver: 'resolver', pipe: 'pipe', directive: 'directive', store: 'state file',
  model: 'model', config: 'config', other: 'other' };
function summarize(fs_) {
  if (!fs_.length) return '';
  const byKind = new Map();
  for (const f of fs_) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f.selector && f.kind !== 'pipe' ? `${f.name} <${f.selector}>` : f.name);
  }
  if (fs_.length > config.maxFilesPerFolder) {
    return [...byKind].map(([k, v]) => `${v.length} ${v.length === 1 ? SINGULAR[k] : PLURAL[k]}`).join(', ');
  }
  return [...byKind].map(([k, v]) => `${PLURAL[k]}: ${v.join(', ')}`).join('; ');
}
const COMPACT = files.length > config.compactAbove;
const allFilesIn = (node) => [...node.files, ...[...node.folders.values()].flatMap(allFilesIn)];
function countsOnly(fs_) {
  const byKind = new Map();
  for (const f of fs_) byKind.set(f.kind, (byKind.get(f.kind) || 0) + 1);
  return [...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${n === 1 ? SINGULAR[k] : PLURAL[k]}`).join(', ');
}
const treeLines = [];
function render(node, prefix, depth) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const child of folders) {
    const full = prefix ? `${prefix}/${child.name}` : child.name;
    const ann = annotationFor(full);
    let line = `${'  '.repeat(depth)}- ${child.name}/`;
    if (ann?.purpose) line += ` — ${ann.purpose}`;
    if (ann?.owner) line += ` (owner: ${ann.owner})`;
    const wide = COMPACT && child.folders.size > config.compactWideFolder;
    const cut = COMPACT && child.folders.size && (wide || depth >= config.compactDepth - 1);
    const s = COMPACT ? countsOnly(cut ? allFilesIn(child) : child.files) : summarize(child.files);
    if (s) line += ` · ${s}`;
    if (wide) {
      const names = [...child.folders.keys()].sort();
      line += ` · ${names.length} subfolders: ${names.slice(0, 60).join(', ')}${names.length > 60 ? `, … (+${names.length - 60})` : ''}`;
    } else if (cut) line += ` · ${child.folders.size} subfolder${child.folders.size === 1 ? '' : 's'}`;
    treeLines.push(line);
    if (!cut) render(child, full, depth + 1);
  }
}
if (tree.files.length) treeLines.push(`- ./ · ${COMPACT ? countsOnly(tree.files) : summarize(tree.files)}`);
render(tree, '', 0);
// Compact mode: reduce the depth until the structure fits (big apps with hundreds of features).
let shownDepth = config.compactDepth;
while (COMPACT && treeLines.length > config.compactMaxLines && config.compactDepth > 1) {
  config.compactDepth -= 1; shownDepth = config.compactDepth;
  treeLines.length = 0;
  if (tree.files.length) treeLines.push(`- ./ · ${countsOnly(tree.files)}`);
  render(tree, '', 0);
}

// ---------- markdown ----------
const count = (k) => files.filter((f) => f.kind === k).length;
const totals = ['component', 'service', 'routes', 'guard', 'interceptor', 'pipe', 'directive', 'store', 'model']
  .map((k) => [k, count(k)]).filter(([, n]) => n).map(([k, n]) => `${n} ${n === 1 ? SINGULAR[k] : PLURAL[k]}`).join(' · ');
const errors = violations.filter((v) => v.severity === 'error');

const md = [];
md.push('# Project map');
md.push('');
md.push('> Generated by `scripts/project-map/generate-map.mjs`. Do not edit by hand.');
md.push('> To change folder purposes or rules, edit `project-map.config.mjs` and regenerate.');
md.push('');
md.push(`Root: \`${config.root}\` · ${files.length} source files · ${testCount} spec files`);
md.push(totals ? `Contains: ${totals}` : '');
md.push('');
md.push('## Structure');
md.push('');
if (COMPACT) {
  md.push(`> Compact view (${files.length} files): counts per folder, ${shownDepth} level${shownDepth === 1 ? '' : 's'} deep.`);
  md.push('> Full detail: the .json next to this file, or the graph (`npm run map:ui`).');
  md.push('');
}
md.push(...treeLines);
md.push('');
if (routes.length) {
  md.push('## Routes');
  md.push('');
  md.push('| Path | Target | Defined in |');
  md.push('|---|---|---|');
  const shownRoutes = COMPACT ? routes.slice(0, 60) : routes;
  for (const r of shownRoutes) md.push(`| ${r.path} | ${r.target} | ${r.file} |`);
  if (shownRoutes.length < routes.length) md.push(`\n…and ${routes.length - shownRoutes.length} more routes (see the .json).`);
  md.push('');
}
md.push('## Dependencies between areas');
md.push('');
const depLines = [...unitDeps].sort((a, b) => a[0].localeCompare(b[0])).map(([u, deps]) => `- ${u} → ${deps.size ? [...deps].sort().join(', ') : '(none)'}`);
if (COMPACT && depLines.length > 80) {
  // Most interesting first: areas with the most dependencies.
  const top = [...unitDeps].sort((a, b) => b[1].size - a[1].size).slice(0, 80).map(([u]) => u);
  md.push(...depLines.filter((l) => top.some((u) => l.startsWith(`- ${u} →`))));
  md.push(`- …and ${depLines.length - 80} more areas (see the .json).`);
} else md.push(...depLines);
md.push('');
if (config.rules.length) {
  md.push('## Rules');
  md.push('');
  for (const r of config.rules) md.push(`- **${r.name}** (${r.severity || 'error'}): ${r.message || ''}`);
  md.push('');
}
md.push(`## Violations (${violations.length})`);
md.push('');
if (!violations.length) md.push('None.');
const shownViolations = COMPACT ? violations.slice(0, 100) : violations;
for (const v of shownViolations) md.push(`- ${v.severity === 'error' ? '✗' : '!'} \`${v.file}\` ${v.detail} — ${v.rule}`);
if (shownViolations.length < violations.length) md.push(`- …and ${violations.length - shownViolations.length} more (see the .json).`);
md.push('');
const topExternals = [...externals].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k]) => k);
if (topExternals.length) {
  md.push('## Main libraries');
  md.push('');
  md.push(topExternals.join(', '));
  md.push('');
}
const markdown = md.join('\n');

const data = {
  root: config.root,
  files: files.map(({ _src, ...f }) => f),
  routes,
  areas: Object.fromEntries([...unitDeps].map(([u, d]) => [u, [...d].sort()])),
  folders: config.folders,
  rules: config.rules,
  violations,
};
const json = JSON.stringify(data, null, 2) + '\n';
const fmt = (v) => `  ${v.severity === 'error' ? '✗' : '!'} ${v.file} ${v.detail}\n    ${v.rule}: ${v.message || ''}`;
const log = (...a) => { if (!QUIET && !SESSION) console.log(...a); };

// ---------- internal: map of another tree, used for the merge-base ----------
if (MODE === 'json') { fs.writeFileSync(argVal('--json-out'), json); process.exit(0); } // a file, not stdout: large output would be cut off by an early exit

// ---------- main map (CI on main, or first setup) ----------
if (MODE === 'main') {
  const mdOut = path.resolve(config.output.markdown), jsonOut = path.resolve(config.output.json);
  fs.mkdirSync(path.dirname(mdOut), { recursive: true });
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(mdOut, markdown);
  fs.writeFileSync(jsonOut, json);
  log(`✓ Wrote the main map: ${config.output.markdown} and ${config.output.json}`);
  log(`  ${files.length} files · ${routes.length} routes · ${unitDeps.size} areas · ${violations.length} violations`);
  if (violations.length && !QUIET) console.log(violations.map(fmt).join('\n'));
  process.exit(0);
}

// ---------- local map + branch report ----------
const LOCAL = path.resolve(config.output.local);
fs.mkdirSync(LOCAL, { recursive: true });
fs.writeFileSync(path.join(LOCAL, '.gitignore'), '# Generated by project-map. Local only, never committed.\n*\n');
fs.writeFileSync(path.join(LOCAL, 'PROJECT_MAP.md'), markdown.replace('# Project map', '# Project map (local working tree)'));
fs.writeFileSync(path.join(LOCAL, 'project-map.json'), json);

const posix = (p) => p.split(path.sep).join('/');
function git(a, opts = {}) {
  try {
    return execFileSync('git', a, { encoding: opts.encoding ?? 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1 << 30, input: opts.input, cwd: opts.cwd });
  } catch { return null; }
}
const gitText = (a) => { const r = git(a); return r === null ? null : r.trim(); };
const repoRoot = gitText(['rev-parse', '--show-toplevel']);

function baseFromMergeBase(mb) {
  // Generate the map of the merge-base tree with the CURRENT config, so only code changes count. Cached per merge-base.
  const cfgText = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const key = crypto.createHash('sha1').update(mb + '\0' + cfgText).digest('hex');
  const cacheFile = path.join(LOCAL, 'base-cache.json');
  try { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c.key === key) return c.data; } catch { /* rebuild */ }
  const projRel = posix(path.relative(repoRoot, process.cwd()));
  const inProj = (p) => (projRel ? `${projRel}/${p}` : p);
  const tsconfigs = (gitText(['-C', repoRoot, 'ls-tree', '--name-only', mb, projRel ? `${projRel}/` : '.']) || '')
    .split('\n').filter((f) => /(^|\/)tsconfig[^/]*\.json$/.test(f));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'project-map-base-'));
  try {
    const tar = git(['-C', repoRoot, 'archive', '--format=tar', mb, '--', inProj(posix(config.root)), ...tsconfigs], { encoding: 'buffer' });
    let baseData = { files: [], routes: [], areas: {}, violations: [] };
    if (tar && tar.length) {
      execFileSync('tar', ['-x', '-C', tmp], { input: tar, stdio: ['pipe', 'ignore', 'ignore'] });
      const cwdTmp = path.join(tmp, projRel);
      fs.mkdirSync(cwdTmp, { recursive: true });
      const cfgCopy = path.join(cwdTmp, path.basename(configPath));
      if (cfgText) fs.writeFileSync(cfgCopy, cfgText);
      const outFile = path.join(tmp, 'base-map.json');
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--json-stdout', '--json-out', outFile, '--config', cfgCopy],
        { cwd: cwdTmp, stdio: ['ignore', 'ignore', 'ignore'] });
      baseData = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    }
    fs.writeFileSync(cacheFile, JSON.stringify({ key, data: baseData }));
    return baseData;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function branchReport() {
  const r = { available: false, branch: null, base: null, mergeBase: null, ahead: 0, source: 'none', note: '',
    added: [], deleted: [], moved: [], modified: [], foldersAdded: [], foldersRemoved: [],
    areaAdded: [], areaRemoved: [], newIssues: [], fixedIssues: [], existingIssues: 0 };
  let base = null, renames = new Map(), haveGitChanges = false;
  const baseName = argVal('--base') || config.baseBranch || 'main';
  if (repoRoot) {
    r.branch = gitText(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
    const baseRef = [`origin/${baseName}`, baseName].find((ref) => gitText(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]));
    const mb = baseRef && gitText(['merge-base', 'HEAD', baseRef]);
    if (mb) {
      r.base = baseRef; r.mergeBase = mb.slice(0, 8);
      r.ahead = Number(gitText(['rev-list', '--count', `${mb}..${baseRef}`]) || 0);
      try { base = baseFromMergeBase(mb); r.source = 'merge-base'; } catch (e) { if (process.env.PROJECT_MAP_DEBUG) console.error('base map failed:', e.message); base = null; }
      // File-level changes from git (committed and uncommitted), including renames.
      const rootRepoRel = posix(path.relative(repoRoot, ROOT));
      const toRoot = (p) => (p && p.startsWith(rootRepoRel + '/') ? p.slice(rootRepoRel.length + 1) : null);
      const ns = git(['-C', repoRoot, 'diff', '--name-status', '-M', mb, '--', rootRepoRel]);
      const untracked = git(['-C', repoRoot, 'ls-files', '--others', '--exclude-standard', '--', rootRepoRel]);
      if (ns !== null) {
        haveGitChanges = true;
        for (const line of ns.split('\n').filter(Boolean)) {
          const [st, a, b] = line.split('\t');
          if (st.startsWith('R')) { const f = toRoot(a), t = toRoot(b); if (f && t) { r.moved.push({ from: f, to: t }); renames.set(f, t); } }
          else if (st === 'A') { const f = toRoot(a); if (f) r.added.push(f); }
          else if (st === 'D') { const f = toRoot(a); if (f) r.deleted.push(f); }
          else if (st === 'M') { const f = toRoot(a); if (f) r.modified.push(f); }
        }
        for (const f of (untracked || '').split('\n').filter(Boolean)) { const p = toRoot(f); if (p) r.added.push(p); }
      }
    } else if (!baseRef) r.note = `Branch "${baseName}" not found (fetch it, or set baseBranch in the config).`;
  } else r.note = 'Not a git repository.';
  if (!base) {
    // Fallback: the committed main map (e.g. shallow CI clone without history).
    const mainJson = path.resolve(config.output.json);
    if (fs.existsSync(mainJson)) { base = JSON.parse(fs.readFileSync(mainJson, 'utf8')); r.source = 'docs'; }
  }
  if (!base) return r;
  r.available = true;
  // File lists without git: compare the two maps.
  if (!haveGitChanges) {
    const a = new Set(base.files.map((f) => f.path)), b = new Set(data.files.map((f) => f.path));
    r.added = [...b].filter((x) => !a.has(x)); r.deleted = [...a].filter((x) => !b.has(x));
  }
  // Folders
  const folderSet = (fs_) => { const s = new Set(); for (const f of fs_) { const p = f.path.split('/'); for (let i = 1; i < p.length; i++) s.add(p.slice(0, i).join('/')); } return s; };
  const fa = folderSet(base.files), fb = folderSet(data.files);
  r.foldersAdded = [...fb].filter((x) => !fa.has(x)).sort();
  r.foldersRemoved = [...fa].filter((x) => !fb.has(x)).sort();
  // Area dependencies
  const edges = (areas) => new Set(Object.entries(areas || {}).flatMap(([u, ds]) => ds.map((d) => `${u} → ${d}`)));
  const ea = edges(base.areas), eb = edges(data.areas);
  r.areaAdded = [...eb].filter((x) => !ea.has(x)).sort();
  r.areaRemoved = [...ea].filter((x) => !eb.has(x)).sort();
  // Rule issues: base paths are mapped through renames, so a moved file keeps its existing issue.
  const mapPath = (p) => renames.get(p) ?? p;
  const keyOf = (v, mapped) => `${v.rule}|${mapped ? mapPath(v.file) : v.file}|${mapped && v.detail.startsWith('imports ') ? 'imports ' + mapPath(v.detail.slice(8)) : v.detail}`;
  const baseKeys = new Set(base.violations.map((v) => keyOf(v, true)));
  const localKeys = new Set(violations.map((v) => keyOf(v, false)));
  r.newIssues = violations.filter((v) => !baseKeys.has(keyOf(v, false)));
  r.fixedIssues = base.violations.filter((v) => !localKeys.has(keyOf(v, true)));
  r.existingIssues = violations.length - r.newIssues.length;
  for (const k of ['added', 'deleted', 'modified']) r[k] = [...new Set(r[k])].sort();
  return r;
}

let report;
try { report = branchReport(); } catch (e) { report = { available: false, note: `Branch report failed: ${e.message}` }; }

// Group moves of companions/folders: "a/x.ts, a/x.html -> b/..." becomes one line per folder move.
function groupMoves(moved) {
  const groups = new Map();
  for (const m of moved) {
    const k = `${path.posix.dirname(m.from)}\0${path.posix.dirname(m.to)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  return [...groups.values()].map((g) => g.length === 1 ? `${g[0].from} → ${g[0].to}`
    : `${path.posix.dirname(g[0].from)}/ → ${path.posix.dirname(g[0].to)}/ (${g.length} files: ${g.map((m) => path.posix.basename(m.to)).join(', ')})`);
}

function branchMarkdown(r) {
  const L = ['# Branch changes', '', '> Generated by `scripts/project-map/generate-map.mjs`. Local only, never committed.', ''];
  if (!r.available) { L.push(`No comparison with main available. ${r.note || ''}`); return L.join('\n') + '\n'; }
  const against = r.source === 'merge-base'
    ? `\`${r.base}\` at the branch point \`${r.mergeBase}\`${r.ahead ? ` (${r.base} has ${r.ahead} newer commit${r.ahead === 1 ? '' : 's'}; merge or rebase to get them)` : ''}`
    : 'the committed main map (docs/project-map.json)';
  L.push(`Branch \`${r.branch || 'HEAD'}\` compared with ${against}. Includes uncommitted changes.`, '');
  L.push(`Summary: ${r.added.length} added · ${r.moved.length} moved · ${r.deleted.length} deleted · ${r.modified.length} modified · rule issues: ${r.newIssues.length} new, ${r.fixedIssues.length} fixed, ${r.existingIssues} existing`, '');
  const list = (title, items, fmtItem = (x) => `- ${x}`, max = 40) => {
    if (!items.length) return;
    L.push(`## ${title} (${items.length})`, '', ...items.slice(0, max).map(fmtItem));
    if (items.length > max) L.push(`- …and ${items.length - max} more`);
    L.push('');
  };
  list('New rule issues (fail map:check)', r.newIssues, (v) => `- ${v.severity === 'error' ? '✗' : '!'} \`${v.file}\` ${v.detail} — ${v.rule}`);
  list('Fixed rule issues', r.fixedIssues, (v) => `- ✓ \`${v.file}\` ${v.detail} — ${v.rule}`);
  list('Added files', r.added);
  list('Moved', groupMoves(r.moved));
  list('Deleted files', r.deleted);
  list('Modified files', r.modified);
  list('New folders', r.foldersAdded);
  list('Removed folders', r.foldersRemoved);
  list('New dependencies between areas', r.areaAdded);
  list('Removed dependencies between areas', r.areaRemoved);
  if (!r.added.length && !r.moved.length && !r.deleted.length && !r.modified.length && !r.newIssues.length && !r.fixedIssues.length) L.push('No changes compared with main.', '');
  return L.join('\n');
}
fs.writeFileSync(path.join(LOCAL, 'BRANCH_CHANGES.md'), branchMarkdown(report));
fs.writeFileSync(path.join(LOCAL, 'branch.json'), JSON.stringify(report, null, 2) + '\n');

// ---------- outputs per mode ----------
if (SESSION) {
  // Short, factual context for Claude at session start (stdout of a SessionStart hook is added to the context).
  const r = report;
  const out = ['Project map: branch report generated at session start.'];
  if (!r.available) out.push(`No comparison with ${config.baseBranch} available. ${r.note || ''}`.trim());
  else {
    out.push(`Branch ${r.branch} compared with ${r.source === 'merge-base' ? `${r.base} at branch point ${r.mergeBase}` : 'the committed main map'}${r.ahead ? `; ${r.base} has ${r.ahead} newer commit(s) not merged into this branch` : ''}.`);
    out.push(`Changes on this branch: ${r.added.length} files added, ${r.moved.length} moved, ${r.deleted.length} deleted, ${r.modified.length} modified.`);
    const g = groupMoves(r.moved);
    if (g.length) out.push('Moved: ' + g.slice(0, 8).join('; ') + (g.length > 8 ? '; ...' : ''));
    if (r.added.length) out.push('Added: ' + r.added.slice(0, 12).join(', ') + (r.added.length > 12 ? ', ...' : ''));
    out.push(`Rule issues introduced by this branch: ${r.newIssues.length}; fixed: ${r.fixedIssues.length}; existing on main: ${r.existingIssues}.`);
    for (const v of r.newIssues.slice(0, 10)) out.push(`- ${v.file} ${v.detail} (${v.rule})`);
  }
  out.push('Main structure: docs/PROJECT_MAP.md. Branch details: .project-map/BRANCH_CHANGES.md. Current working-tree map: .project-map/PROJECT_MAP.md.');
  process.stdout.write(out.join('\n').slice(0, 3500) + '\n');
  process.exit(0);
}

if (CHECK) {
  const strict = args.includes('--strict');
  const r = report;
  const failing = strict || !r.available ? violations.filter((v) => v.severity === 'error')
    : r.newIssues.filter((v) => v.severity === 'error');
  const against = r.available ? (r.source === 'merge-base' ? `${r.base} (branch point ${r.mergeBase})` : 'docs/project-map.json') : 'nothing (no main map found)';
  console.log(`Rule check against ${against}${strict ? ', strict' : ''}: ${files.length} files.`);
  if (!r.available) console.log(`  Note: ${r.note || 'no base map'}. All rule issues count. In CI, check out with full history (fetch-depth: 0).`);
  for (const v of r.newIssues || []) console.log(`  ✗ new: ${v.file} ${v.detail}\n      ${v.rule}: ${v.message || ''}`);
  for (const v of r.fixedIssues || []) console.log(`  ✓ fixed: ${v.file} ${v.detail} (${v.rule})`);
  if (r.available && r.existingIssues && !strict) console.log(`  · ${r.existingIssues} existing issue(s) on main, not blocking.`);
  if (strict) for (const v of failing) console.log(`  ✗ ${v.file} ${v.detail}\n      ${v.rule}: ${v.message || ''}`);
  if (failing.length) {
    console.error(`✗ ${failing.length} ${strict ? '' : 'new '}rule issue${failing.length === 1 ? '' : 's'}${strict ? '' : ' introduced by this branch'}.`);
    process.exit(1);
  }
  console.log(`✓ No new rule issues.${r.fixedIssues?.length ? ` ${r.fixedIssues.length} fixed. 👍` : ''}`);
  process.exit(0);
}

// MODE === 'local'
if (!QUIET) {
  console.log(`✓ Local map: ${path.relative(process.cwd(), LOCAL)}/PROJECT_MAP.md  (${files.length} files · ${routes.length} routes · ${violations.length} rule issues)`);
  if (report.available) {
    console.log(`✓ Branch report: ${path.relative(process.cwd(), LOCAL)}/BRANCH_CHANGES.md  (${report.branch} vs ${report.source === 'merge-base' ? report.base : 'main map'})`);
    console.log(`  ${report.added.length} added · ${report.moved.length} moved · ${report.deleted.length} deleted · ${report.modified.length} modified · issues: ${report.newIssues.length} new, ${report.fixedIssues.length} fixed, ${report.existingIssues} existing`);
    for (const v of report.newIssues) console.log(fmt(v));
  } else console.log(`  No branch comparison: ${report.note || 'no main map yet'}. The main map is created with: npm run map:main`);
}
