#!/usr/bin/env node
// Floorplan generator for Angular and Spring Boot (Java). Zero dependencies (Node 18+).
//
// Scans the app folder, classifies files (components, services, routes / controllers, services, repositories, ...),
// resolves imports (TypeScript: relative + tsconfig path aliases; Java: imports, same-package use, qualified names),
// merges your annotations and rules from floorplan.config.mjs. The framework comes from `framework` in the config
// ('angular' or 'spring'), or is detected (angular.json / pom.xml / build.gradle).
//
// Two layers:
//   docs/FLOORPLAN.md + docs/floorplan.json   MAIN map, committed, written only by CI on main (--main)
//   .floorplan/                                  LOCAL, never committed (it ignores itself):
//       FLOORPLAN.md, floorplan.json           map of your working tree (used by the graph)
//       BRANCH_CHANGES.md, branch.json             what this branch changed compared with main
//
// Usage:
//   node scripts/floorplan/generate-map.mjs            # local map + branch report      (npm run map in Angular projects)
//   node scripts/floorplan/generate-map.mjs --main     # write the main map in docs/     (npm run map:main, CI on main)
//   node scripts/floorplan/generate-map.mjs --check    # fail only on rule issues NEW compared with main (npm run map:check)
//   node scripts/floorplan/generate-map.mjs --check --strict   # fail on every rule issue
//   node scripts/floorplan/generate-map.mjs --check --pr-comment pr.md   # also write a pull-request comment (CI)
//   node scripts/floorplan/generate-map.mjs --hook     # Claude Code PostToolUse hook (stdin: hook input)
//   node scripts/floorplan/generate-map.mjs --session  # Claude Code SessionStart hook: short branch summary on stdout
//   options: --base <branch> (default: config baseBranch or "main"), --quiet, --config <file>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// ---------- CLI ----------
const args = process.argv.slice(2);
const argVal = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const SESSION = args.includes('--session');
// --hook: Claude Code PostToolUse hook. Reads the hook input on stdin; if the written file breaks a rule (new compared
// with main), prints a short note for Claude. Never fails, never writes the local maps.
const HOOK = args.includes('--hook');
let HOOK_FILE = null;
if (HOOK) {
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    HOOK_FILE = input.tool_input?.file_path || input.tool_input?.path || null;
    if (input.cwd && fs.existsSync(input.cwd) && !process.env.CLAUDE_PROJECT_DIR) process.chdir(input.cwd);
  } catch { process.exit(0); }
  if (!HOOK_FILE || !/\.(ts|java)$/.test(HOOK_FILE) || /\.(spec|test)\.ts$|\.d\.ts$/.test(HOOK_FILE)) process.exit(0);
}
const MODE = args.includes('--json-stdout') ? 'json' : args.includes('--main') ? 'main'
  : args.includes('--check') ? 'check' : SESSION ? 'session' : HOOK ? 'hook' : 'local';
const QUIET = args.includes('--quiet') || HOOK;
const CHECK = MODE === 'check';
// The SessionStart hook may start in another folder; run from the project.
if ((SESSION || HOOK) && process.env.CLAUDE_PROJECT_DIR && fs.existsSync(process.env.CLAUDE_PROJECT_DIR)) process.chdir(process.env.CLAUDE_PROJECT_DIR);
if (SESSION) {
  // A hook must never break the session: any error ends silently.
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
}
const TOOL_VERSION = (() => { try { return fs.readFileSync(new URL('./VERSION', import.meta.url), 'utf8').trim(); } catch { return '?'; } })();
const configArg = args.indexOf('--config');
const configPath = path.resolve(configArg >= 0 ? args[configArg + 1] : ['floorplan.config.mjs', 'project-map.config.mjs'].find((f) => fs.existsSync(f)) || 'floorplan.config.mjs');

const userConfig = fs.existsSync(configPath)
  ? (await import(pathToFileURL(configPath).href)).default
  : {};
function detectFramework() {
  const has = (f) => fs.existsSync(path.resolve(f));
  if (has('angular.json')) return 'angular';
  try { const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); if ({ ...pkg.dependencies, ...pkg.devDependencies }['@angular/core']) return 'angular'; } catch { /* no package.json */ }
  if (['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some(has)) return 'spring';
  return 'angular';
}
const FRAMEWORK = argVal('--framework') || userConfig.framework || detectFramework();
const SPRING = FRAMEWORK === 'spring';
const defaults = {
  root: SPRING ? 'src/main/java' : 'src/app',
  tsconfig: 'tsconfig.json',
  // repositories set up before the rename (project-map.config.mjs) keep their paths
  output: path.basename(configPath) === 'project-map.config.mjs'
    ? { markdown: 'docs/PROJECT_MAP.md', json: 'docs/project-map.json', local: '.project-map' }
    : { markdown: 'docs/FLOORPLAN.md', json: 'docs/floorplan.json', local: '.floorplan' },
  maxFilesPerFolder: 8,
  units: SPRING ? [] : ['features/*'],
  ignore: SPRING ? ['**/package-info.java', '**/module-info.java'] : ['**/*.spec.ts', '**/environments/**'],
  folders: {},
  rules: [],
  baseBranch: 'main',
  ci: true,            // false: no CI job regenerates the main map; someone runs --main on main after merges
  sheriff: 'auto',     // Angular: use the project's Sheriff (sheriff.config.ts) as an extra rule source; true / false / 'auto'
  compactAbove: 400,   // above this many files, the Structure section is summarized (keeps the map small for Claude)
  compactDepth: 3,     // folder levels shown in compact mode (reduced automatically to stay under compactMaxLines)
  compactMaxLines: 250,
  compactWideFolder: 30, // in compact mode, a folder with more subfolders lists their names on one line
  split: 'auto',       // big repos: an overview map plus one detail file per area ('auto' above splitAbove files, true, false)
  splitAbove: 1500,
};
// presets (see lib.mjs applyPresets): defaults, rules and folder purposes the project's config builds on
let merged;
try { merged = await (await import('./lib.mjs')).applyPresets(userConfig, configPath); }
catch (e) { if (SESSION || HOOK) process.exit(0); console.error(e.message); process.exit(1); }
const config = { ...defaults, ...merged, framework: FRAMEWORK, output: { ...defaults.output, ...(merged.output || {}) } };

// ---------- rules from the project's CLAUDE.md (floorplan.claude-rules.json, written by /floorplan rules) ----------
// CLAUDE.md is the source of truth: its rules are added as warnings, and a built-in / preset / config rule it
// contradicts ("replaces") is switched off. The file is generated by Claude from CLAUDE.md and committed, so CI and the
// hooks check the same rules without Claude. When a CLAUDE.md changes, the map says the rules need a refresh.
const CLAUDE_RULES = { file: config.claudeRules || 'floorplan.claude-rules.json', active: false, rules: [], replaced: [], confirmed: new Map(), notCheckable: [], stale: [], missing: false };
{
  const abs = path.resolve(CLAUDE_RULES.file);
  // the text of a CLAUDE.md file without Floorplan's own generated section (so regenerating it doesn't count as a change)
  const { claudeMdHash: hashOf } = await import('./claude-rules-hash.mjs');
  const claudeMdHash = (f) => { try { return hashOf(f); } catch { return null; } };
  const candidates = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'].filter((f) => fs.existsSync(f));
  try { for (const e of fs.readdirSync('.claude/rules')) if (e.endsWith('.md')) candidates.push(`.claude/rules/${e}`); } catch { /* none */ }
  if (fs.existsSync(abs)) {
    try {
      const j = JSON.parse(fs.readFileSync(abs, 'utf8'));
      CLAUDE_RULES.active = true;
      CLAUDE_RULES.notCheckable = j.notCheckable || [];
      // warnings by default (CLAUDE.md guides, the team's CI rules block); claudeMdSeverity: 'error' makes them errors
      const severity = config.claudeMdSeverity === 'error' ? 'error' : 'warn';
      for (const r of j.rules || []) {
        if (!r || !r.name || !r.type) continue;
        const src = r.source || {};
        CLAUDE_RULES.rules.push({ ...r, severity,
          name: r.name.startsWith('claude-md:') ? r.name : `claude-md:${r.name}`, _origin: `${src.file || 'CLAUDE.md'}${src.line ? `:${src.line}` : ''}`, _quote: src.text });
        for (const n of r.confirms || []) CLAUDE_RULES.confirmed.set(n, `${src.file || 'CLAUDE.md'}${src.line ? `:${src.line}` : ''}`);
        for (const n of r.replaces || []) CLAUDE_RULES.replaced.push({ rule: n, by: `${src.file || 'CLAUDE.md'}${src.line ? `:${src.line}` : ''}`, text: src.text });
      }
      const sources = j.sources || {};
      for (const [f, h] of Object.entries(sources)) { const now = claudeMdHash(f); if (now !== h) CLAUDE_RULES.stale.push(now === null ? `${f} (deleted)` : f); }
      for (const f of candidates) if (!(f in sources)) CLAUDE_RULES.stale.push(`${f} (new)`);
    } catch (e) { if (!SESSION && !HOOK) console.warn(`! ${CLAUDE_RULES.file} could not be read: ${e.message}`); }
  } else if (candidates.length) CLAUDE_RULES.missing = true;
  const replacedNames = new Set(CLAUDE_RULES.replaced.map((x) => x.rule));
  config.rules = [...config.rules.filter((r) => !replacedNames.has(r.name)), ...CLAUDE_RULES.rules];
}

// CI templates ask for the map paths, so they work with any output folder
const AREAS_DIR = path.join(path.dirname(config.output.markdown), 'floorplan-areas');
if (args.includes('--outputs')) {
  const extra = fs.existsSync(path.resolve(AREAS_DIR)) || config.split === true ? ` ${AREAS_DIR.split(path.sep).join('/')}` : '';
  console.log(`${config.output.markdown} ${config.output.json}${extra}`);
  process.exit(0);
}
const ROOT = path.resolve(config.root);
if (HOOK && !fs.existsSync(path.resolve(configPath))) process.exit(0); // not a mapped project
if (HOOK && !path.resolve(HOOK_FILE).startsWith(ROOT + path.sep)) process.exit(0);
if (!fs.existsSync(ROOT)) {
  if (SESSION || HOOK) process.exit(0);
  console.error(`Root folder not found: ${config.root}`);
  process.exit(1);
}
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
// Per-file parse cache in the local folder (not for the temporary map of the branch point)
const CACHE = MODE === 'json' || process.env.FLOORPLAN_NO_CACHE ? null
  : (await import('./cache.mjs')).openCache(path.resolve(config.output.local || '.floorplan'), FRAMEWORK, TOOL_VERSION);

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
// "util/" vs "utils/": point at folder names that almost match an allowed folder
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function nearMiss(filePath, allowed) {
  const wanted = new Set(asList(allowed).flatMap((p) => p.split('/')).filter((s) => s && !s.includes('*')));
  for (const seg of filePath.split('/').slice(0, -1)) {
    if (wanted.has(seg)) continue;
    const close = [...wanted].find((w) => editDistance(seg.toLowerCase(), w.toLowerCase()) <= (w.length > 5 ? 2 : 1));
    if (close) return ` (folder "${seg}/": did you mean "${close}/"?)`;
  }
  return '';
}
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
// Workspace packages (npm/yarn/pnpm workspaces, as modern Nx uses instead of tsconfig paths):
// '@scope/lib' and '@scope/lib/sub' resolve to the package's files through its "exports" (or main / src/index.ts).
function loadWorkspaces() {
  const out = new Map();
  let patterns = [];
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages || [];
  } catch { /* none */ }
  try {
    const y = fs.readFileSync('pnpm-workspace.yaml', 'utf8');
    for (const m of y.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)) patterns.push(m[1]);
  } catch { /* none */ }
  const expand = (pattern) => {
    let dirs = ['.'];
    for (const seg of pattern.replace(/\/$/, '').split('/')) {
      if (seg === '**') continue; // keep it simple: '**' behaves like nothing
      const next = [];
      for (const d of dirs) {
        if (!seg.includes('*')) { if (fs.existsSync(path.join(d, seg))) next.push(path.join(d, seg)); continue; }
        const rx = new RegExp(`^${seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
        try { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.') && rx.test(e.name)) next.push(path.join(d, e.name)); } catch { /* unreadable */ }
      }
      dirs = next;
    }
    return dirs;
  };
  const pick = (v) => (typeof v === 'string' ? v : v && typeof v === 'object'
    ? pick(Object.entries(v).find(([k]) => !['require', 'node'].includes(k) && (k.includes('source') || k === 'types' || k === 'import' || k === 'default'))?.[1] ?? Object.values(v)[0]) : null);
  for (const pat of patterns.filter((x) => !x.startsWith('!'))) {
    for (const dir of expand(pat)) {
      let pj; try { pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
      if (!pj.name) continue;
      const entries = new Map();
      if (typeof pj.exports === 'string') entries.set('.', pj.exports);
      else if (pj.exports && typeof pj.exports === 'object') {
        const keys = Object.keys(pj.exports);
        if (keys.length && keys.every((k) => !k.startsWith('.'))) entries.set('.', pick(pj.exports));
        else for (const k of keys) { const v = pick(pj.exports[k]); if (v) entries.set(k, v); }
      }
      if (!entries.has('.')) entries.set('.', pj.types || pj.typings || pj.main || 'src/index.ts');
      out.set(pj.name, { dir: path.resolve(dir), entries });
    }
  }
  return out;
}
const workspaces = SPRING ? new Map() : loadWorkspaces();

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
const kindBySuffix = (name) => (KINDS.find(([, rx]) => rx.test(name)) || ['other'])[0];
// Angular 20+ style guide: files are named without type suffix (user-profile.ts). Then the code decides.
const CONTENT_KINDS = [
  ['component', /@Component\s*\(/],
  ['directive', /@Directive\s*\(/],
  ['pipe', /@Pipe\s*\(/],
  ['module', /@NgModule\s*\(/],
  ['guard', /:\s*(CanActivateFn|CanActivateChildFn|CanMatchFn|CanDeactivateFn)\b|implements\s+[^{]*\b(CanActivate|CanMatch|CanDeactivate)\b/],
  ['interceptor', /:\s*HttpInterceptorFn\b|implements\s+[^{]*\bHttpInterceptor\b/],
  ['resolver', /:\s*ResolveFn\b|implements\s+[^{]*\bResolve\s*</],
  ['routes', /:\s*Routes\s*=/],
  ['store', /\b(signalStore|createReducer|createEffect|createFeature|createActionGroup|createSelector)\s*\(/],
  ['service', /@Injectable\s*\(/],
  ['config', /:\s*ApplicationConfig\s*=/],
];
const kindOf = (name, src = '') => {
  const k = kindBySuffix(name);
  if (k !== 'other' || !src) return k;
  return (CONTENT_KINDS.find(([, rx]) => rx.test(src)) || ['other'])[0];
};
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
let KNOWN_TS = null; // all .ts files under the root: resolving imports without touching the disk
const fsFileCache = new Map();
function isFile(p) {
  if (KNOWN_TS && KNOWN_TS.has(p)) return true;
  if (KNOWN_TS && p.startsWith(ROOT + path.sep) && p.endsWith('.ts')) return false;
  if (!fsFileCache.has(p)) fsFileCache.set(p, fs.existsSync(p) && fs.statSync(p).isFile());
  return fsFileCache.get(p);
}
function tryFile(base) {
  for (const cand of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (isFile(cand)) return cand;
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
  const ws = workspaces.get(pkg);
  if (ws) {
    const sub = '.' + spec.slice(pkg.length);
    const entry = ws.entries.get(sub);
    const f = entry ? tryFile(path.resolve(ws.dir, entry).replace(/\.js$/, '')) : tryFile(path.join(ws.dir, sub)) || tryFile(path.join(ws.dir, 'src', sub));
    if (f) return { file: f };
  }
  return { external: pkg };
}

// What each import brings in, to tell imports used only as types (erased at build time) from real dependencies:
// typeSpecs: `import type`, or every name marked `type`; names: imported names per spec (null = default/namespace);
// typeExports: interfaces and type aliases this file exports; reexports: `export * from` / `export { A } from`.
function importDetails(src) {
  const typeSpecs = [], names = {}, reexports = [], dyn = new Set(), stat = new Set();
  for (const m of src.matchAll(/(^|[;\n}])\s*import\s+(type\s+)?([^'"`;]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[4], clause = m[3].trim();
    stat.add(spec);
    const braces = /\{([^}]*)\}/.exec(clause);
    const outside = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    const parts = braces ? braces[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
    const allTyped = parts.length && parts.every((x) => /^type\s/.test(x));
    if (m[2] || (allTyped && !outside)) { typeSpecs.push(spec); continue; }
    if (outside) { names[spec] = null; continue; } // default or namespace import: assume a value
    const list = parts.filter((x) => !/^type\s/.test(x)).map((x) => x.split(/\s+as\s+/)[0].trim());
    names[spec] = [...(names[spec] || []), ...list];
  }
  for (const m of src.matchAll(/import\s*['"]([^'"]+)['"]/g)) { stat.add(m[1]); names[m[1]] = null; } // side-effect import
  for (const m of src.matchAll(/export\s+(type\s+)?(\*(?:\s+as\s+\w+)?|\{([^}]*)\})\s*from\s*['"]([^'"]+)['"]/g)) {
    stat.add(m[4]);
    const list = m[3] ? m[3].split(',').map((x) => x.trim()).filter(Boolean) : null;
    reexports.push({ spec: m[4], type: !!m[2], names: list && list.map((x) => ({ name: x.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim(), as: x.replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim(), type: /^type\s/.test(x) })) });
  }
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) dyn.add(m[1]);
  const typeExports = [...src.matchAll(/export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  return { typeSpecs, names, reexports, typeExports, dynSpecs: [...dyn].filter((d) => !stat.has(d)) };
}

// Facts of one file that don't depend on other files (cached per file; see cache.mjs)
function angularFacts(name, src) {
  const f = { kind: kindOf(name, src), specs: parseImports(src), lines: src.split('\n').length, ...importDetails(src) };
  const decl = (src.match(/@(Component|Directive|Pipe|Injectable|NgModule)\s*\(/g) || []).length;
  if (decl > 1) f.declarations = decl;
  const pin = /providedIn\s*:\s*['"](\w+)['"]/.exec(src);
  if (pin) f.providedIn = pin[1];
  const sel = /selector\s*:\s*['"`]([^'"`]+)['"`]/.exec(src);
  if (sel && ['component', 'directive'].includes(f.kind)) f.selector = sel[1];
  const pipe = /@Pipe\(\s*\{[^}]*name\s*:\s*['"]([^'"]+)['"]/.exec(src);
  if (pipe) f.selector = pipe[1];
  if (f.kind === 'component' || f.kind === 'directive') {
    const prov = /providers\s*:\s*\[([\s\S]*?)\]/.exec(src);
    if (prov) {
      const names = new Set(prov[1].match(/\b[A-Z][\w$]*\b/g) || []);
      f.providerSpecs = [];
      for (const m of src.matchAll(/import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        const imported = m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean);
        if (imported.some((n) => names.has(n))) f.providerSpecs.push(m[2]);
      }
    }
  }
  if (f.kind === 'routes' || /routes?\.ts$/.test(name)) {
    f.routes = [];
    for (const m of src.matchAll(/path\s*:\s*['"]([^'"]*)['"]([\s\S]*?)(?=path\s*:|$)/g)) {
      const body = m[2];
      const lazy = /(loadChildren|loadComponent)\s*:\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/.exec(body);
      const eager = /component\s*:\s*([A-Za-z0-9_]+)/.exec(body);
      const redirect = /redirectTo\s*:\s*['"]([^'"]*)['"]/.exec(body);
      f.routes.push({ path: m[1], lazy: lazy ? [lazy[1], lazy[2]] : null, eager: eager ? eager[1] : null, redirect: redirect ? redirect[1] : null });
    }
  }
  return f;
}

function scanAngular() {
const allTs = walk(ROOT);
KNOWN_TS = new Set(allTs);
const files = [];
const externals = new Map();
const facts = new Map();
for (const abs of allTs) {
  const p = rel(abs);
  if (matchAny(config.ignore, p)) continue;
  const name = path.basename(abs);
  let f = CACHE && CACHE.get(abs);
  if (!f) { const raw = fs.readFileSync(abs, 'utf8'); f = angularFacts(name, stripTsComments(raw)); f.lines = raw.split('\n').length; if (CACHE) CACHE.set(abs, f); }
  facts.set(p, f);
  const entry = { path: p, kind: f.kind, name: shortName(name), imports: [], lines: f.lines };
  for (const k of ['declarations', 'providedIn', 'selector']) if (f[k] !== undefined) entry[k] = f[k];
  // in memory only (keys starting with _ are not written to the JSON): facts for the rules
  entry._ext = []; entry._rel = []; entry._specOf = new Map(); entry._dyn = new Set();
  for (const spec of f.specs) {
    const r = resolveImport(abs, spec);
    if (r.file) {
      const target = rel(r.file);
      if (target.startsWith('..')) continue;
      entry.imports.push(target);
      entry._specOf.set(target, spec);
      if (spec.startsWith('.')) entry._rel.push({ spec, target });
      if ((f.dynSpecs || []).includes(spec)) entry._dyn.add(target);
    } else if (r.external) {
      externals.set(r.external, (externals.get(r.external) || 0) + 1);
      entry._ext.push(spec);
    }
  }
  entry.imports = [...new Set(entry.imports)].sort();
  files.push(entry);
}
// Imports used only as types: `import type`, or every imported name is an interface / type alias of the target
// (followed through barrel files). They vanish at build time, so rules can ignore or downgrade them (typeImports).
{
  const memo = new Map();
  const typeExportsOf = (p, seen = new Set()) => {
    if (memo.has(p)) return memo.get(p);
    if (seen.has(p)) return new Set();
    seen.add(p);
    const fa = facts.get(p);
    const out = new Set(fa?.typeExports || []);
    for (const re of fa?.reexports || []) {
      const r = resolveImport(path.join(ROOT, p), re.spec);
      const t = r.file && rel(r.file);
      const inner = t && facts.has(t) ? typeExportsOf(t, seen) : new Set();
      if (!re.names) { for (const n of inner) out.add(n); continue; }
      for (const n of re.names) if (re.type || n.type || inner.has(n.name)) out.add(n.as);
    }
    memo.set(p, out);
    return out;
  };
  for (const entry of files) {
    const fa = facts.get(entry.path);
    entry._typeOnly = new Set();
    for (const [target, spec] of entry._specOf) {
      if (entry._dyn.has(target)) continue;
      if ((fa.typeSpecs || []).includes(spec) && !(spec in (fa.names || {}))) { entry._typeOnly.add(target); continue; }
      const ns = (fa.names || {})[spec];
      if (ns && ns.length && ns.every((n) => typeExportsOf(target).has(n))) entry._typeOnly.add(target);
    }
  }
}
files.sort((a, b) => a.path.localeCompare(b.path));
const specFiles = allTs.filter((f) => f.endsWith('.spec.ts'));
const testCount = specFiles.length;
// specs whose file under test is gone (left behind by a move or delete)
const orphanTests = specFiles.filter((f) => !KNOWN_TS.has(f.replace(/\.spec\.ts$/, '.ts'))).map((f) => ({ test: rel(f), subject: path.basename(f).replace(/\.spec\.ts$/, '.ts') }));
// Services provided by a component (providers: [X]) are component-scoped: they belong next to that component.
const byPathA = new Map(files.map((f) => [f.path, f]));
for (const f of files) {
  for (const spec of facts.get(f.path).providerSpecs || []) {
    const r = resolveImport(path.join(ROOT, f.path), spec);
    const target = r.file && byPathA.get(rel(r.file));
    if (target) target.scopedTo = f.path;
  }
}

// ---------- routes ----------
const routes = [];
for (const f of files) {
  for (const r0 of facts.get(f.path).routes || []) {
    let target = null;
    if (r0.lazy) {
      const r = resolveImport(path.join(ROOT, f.path), r0.lazy[1]);
      target = `${r0.lazy[0] === 'loadChildren' ? 'lazy routes' : 'lazy component'}: ${r.file ? rel(r.file) : r0.lazy[1]}`;
    } else if (r0.eager) target = `component: ${r0.eager}`;
    else if (r0.redirect !== null) target = `redirect -> /${r0.redirect}`;
    if (target) routes.push({ file: f.path, path: r0.path === '' ? '(empty)' : r0.path, target });
  }
}
return { files, externals, routes, testCount, orphanTests };
}

let scan, PLURAL, SINGULAR, TOTAL_KINDS;
if (SPRING) {
  const J = await import('./java.mjs');
  scan = J.scanSpring({ ROOT, scanRoot: path.resolve(config.scanRoot || '.'), config, matchAny, cache: CACHE });
  PLURAL = J.SPRING_PLURAL; SINGULAR = J.SPRING_SINGULAR; TOTAL_KINDS = J.SPRING_TOTALS;
} else {
  scan = scanAngular();
  PLURAL = { component: 'components', service: 'services', routes: 'routes', module: 'modules', guard: 'guards',
    interceptor: 'interceptors', resolver: 'resolvers', pipe: 'pipes', directive: 'directives', store: 'state',
    model: 'models', config: 'config', other: 'other' };
  SINGULAR = { component: 'component', service: 'service', routes: 'routes file', module: 'module', guard: 'guard',
    interceptor: 'interceptor', resolver: 'resolver', pipe: 'pipe', directive: 'directive', store: 'state file',
    model: 'model', config: 'config', other: 'other' };
  TOTAL_KINDS = ['component', 'service', 'routes', 'guard', 'interceptor', 'pipe', 'directive', 'store', 'model'];
}
const { files, externals, routes, testCount, orphanTests = [] } = scan;
if (CACHE) CACHE.save();
const fileByPath = new Map(files.map((f) => [f.path, f]));

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
// Presets (scripts/floorplan/presets/<name>.mjs) add rules, folder purposes and units in front of the project's own.
const TODAY = new Date().toISOString().slice(0, 10);
// Imports used only as types: 'error' (count like any import, default), 'warn' (report as warning), 'ignore'.
// noCycles ignores them unless the rule says otherwise (a type-only cycle has no runtime effect).
const typeMode = (rule) => rule.typeImports ?? (rule.type === 'noCycles' ? 'ignore' : config.typeImports ?? 'error');
const prefixOf = (m) => { let i = 0; return m.pattern.replace(/\*\*?/g, () => m.captures[i++] ?? '*').replace(/\/\*\*$/, ''); };
const dirOf = (p) => path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p);
// external package patterns: 'rxjs/internal/**', '@ngrx/store', 'org.springframework.jdbc' (prefix), 'java.sql.*'
function pkgMatch(spec, pat) {
  if (pat.includes('*')) return globToRegex(pat.replace(/\./g, '/')).test(spec.replace(/\./g, '/'));
  return spec === pat || spec.startsWith(pat + '/') || spec.startsWith(pat + '.');
}
// strongly connected components (Tarjan), for cycles
function sccs(nodes, edgesOf) {
  let index = 0; const idx = new Map(), low = new Map(), stack = [], on = new Set(), out = [];
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    for (const w of edgesOf(v)) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) { const c = []; let w; do { w = stack.pop(); on.delete(w); c.push(w); } while (w !== v); out.push(c); }
  };
  for (const v of nodes) if (!idx.has(v)) visit(v);
  return out;
}
function shortestPath(from, to, edgesOf, allowed) {
  const prev = new Map([[from, null]]); const q = [from];
  while (q.length) {
    const v = q.shift();
    if (v === to) { const p = []; for (let x = to; x !== null; x = prev.get(x)) p.unshift(x); return p; }
    for (const w of edgesOf(v)) if (allowed.has(w) && !prev.has(w)) { prev.set(w, v); q.push(w); }
  }
  return null;
}

// comments replaced by spaces (newlines kept, so line numbers stay right); strings are kept
function blankComments(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') { out += '  '; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; } if (src[i] === '\n' && q !== '`') break; out += src[i]; i++; }
      if (i < n) { out += src[i]; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function runRules(files, opts = {}) {
  const exists = opts.exists || ((p) => fs.existsSync(path.join(ROOT, p)));
  const fileByPath = new Map(files.map((f) => [f.path, f]));
  const importedBy = new Map();
  for (const f of files) for (const t of f.imports) { if (!importedBy.has(t)) importedBy.set(t, []); importedBy.get(t).push(f.path); }
  const out = [];
  const add = (rule, v) => out.push({ rule: rule.name, severity: rule.severity || 'error', message: rule.message, ...v });
  const texts = new Map();
  const textOf = (p) => {
    if (!texts.has(p)) {
      let t = null;
      try { t = blankComments(fs.readFileSync(path.join(ROOT, opts.realPath ? opts.realPath(p) : p), 'utf8')); } catch { /* moved in a simulation, or unreadable */ }
      texts.set(p, t);
    }
    return texts.get(p);
  };
  // an import edge under a rule: null = skip it (type-only and ignored), else extra fields for the violation
  const edge = (rule, f, t) => {
    if (!f._typeOnly || !f._typeOnly.has(t)) return {};
    const m = typeMode(rule);
    return m === 'ignore' ? null : m === 'warn' ? { typeOnly: true, severity: 'warn' } : { typeOnly: true };
  };
  const inScope = (rule, f) => matchAny(rule.files || rule.from || '**', f.path) && (!rule.kinds || rule.kinds.includes(f.kind))
    && (!rule.fromKinds || rule.fromKinds.includes(f.kind)) && !(rule.exceptFrom && matchAny(rule.exceptFrom, f.path));
  const folders = new Set();
  for (const f of files) { const p = f.path.split('/'); for (let i = 1; i < p.length; i++) folders.add(p.slice(0, i).join('/')); }
  const foldersMatching = (patterns) => [...folders].filter((d) => asList(patterns).some((pat) => globToRegex(pat).test(d) && d.split('/').length === pat.split('/').length)).sort();

  for (const rule of config.rules) {
    if (rule.type === 'noImport') {
      for (const f of files) {
        const from = matchAny(rule.from || '**', f.path);
        if (!from) continue;
        if (rule.fromKinds && !rule.fromKinds.includes(f.kind)) continue;
        if (rule.exceptFrom && matchAny(rule.exceptFrom, f.path)) continue;
        for (const t of f.imports) {
          const to = matchAny(rule.to || '**', t);
          if (!to) continue;
          if (rule.toKinds && !rule.toKinds.includes(fileByPath.get(t)?.kind)) continue;
          if (rule.allowSame && from.captures.length && from.captures[0] === to.captures[0]) continue;
          if (rule.except && matchAny(rule.except, t)) continue;
          const e = edge(rule, f, t); if (!e) continue;
          add(rule, { file: f.path, detail: `imports ${t}`, ...e });
        }
      }
    } else if (rule.type === 'placement') {
      for (const f of files) {
        if (!matchAny(rule.files || '**', f.path)) continue;
        if (rule.kinds && !rule.kinds.includes(f.kind)) continue;
        if (rule.except && matchAny(rule.except, f.path)) continue;
        // a service provided by a component in the same folder is component-scoped: it belongs there
        if (rule.allowComponentScoped !== false && f.scopedTo && path.posix.dirname(f.scopedTo) === path.posix.dirname(f.path)) continue;
        if (!matchAny(rule.allowedIn, f.path)) add(rule, { file: f.path, detail: `must be in ${asList(rule.allowedIn).join(' or ')}${nearMiss(f.path, rule.allowedIn)}` });
      }
    } else if (rule.type === 'naming') {
      const rx = rule.pattern ? new RegExp(rule.pattern) : { kebab: /^[a-z0-9]+(-[a-z0-9]+)*$/, camel: /^[a-z][a-zA-Z0-9]*$/, pascal: /^[A-Z][a-zA-Z0-9]*$/ }[rule.case || 'kebab'];
      for (const f of files) {
        if (!matchAny(rule.files || '**', f.path) || (rule.kinds && !rule.kinds.includes(f.kind))) continue;
        const name = path.posix.basename(f.path);
        const base = rule.pattern ? name : name.split('.')[0];
        if (!rx.test(base)) add(rule, { file: f.path, detail: rule.pattern ? `file name "${name}" does not match ${rule.pattern}` : `file name "${base}" is not ${rule.case || 'kebab'}-case` });
      }
    } else if (rule.type === 'companion') {
      // e.g. every component and service has a .spec.ts next to it
      const suffix = rule.companion || '.spec.ts';
      for (const f of files) {
        if (!matchAny(rule.files || '**', f.path) || (rule.kinds && !rule.kinds.includes(f.kind))) continue;
        const want = f.path.replace(/\.ts$/, '') + suffix;
        if (!exists(want)) add(rule, { file: f.path, detail: `has no ${path.posix.basename(want)} next to it` });
      }
    } else if (rule.type === 'oneDeclaration') {
      for (const f of files) {
        if (!matchAny(rule.files || '**', f.path) || !f.declarations) continue;
        add(rule, { file: f.path, detail: `declares ${f.declarations} Angular classes` });
      }
    } else if (rule.type === 'publicApi') {
      // modules (e.g. features/*) may only be imported through their index.ts from outside
      const entryName = rule.entry || 'index.ts';
      const moduleOf = (p) => { const m = matchAny(rule.modules, p); return m ? prefixOf(m) : null; };
      for (const f of files) {
        const own = moduleOf(f.path);
        for (const t of f.imports) {
          const mod = moduleOf(t);
          if (!mod || mod === own || t === `${mod}/${entryName}`) continue;
          if (!exists(`${mod}/${entryName}`)) continue; // no public API file: nothing to enforce
          if (rule.except && matchAny(rule.except, t)) continue;
          const e = edge(rule, f, t); if (!e) continue;
          out.push({ rule: rule.name, severity: rule.severity || 'error', file: f.path, detail: `imports ${t}`, message: rule.message || `Import ${mod} through ${mod}/${entryName}.`, ...e });
        }
      }
    } else if (rule.type === 'layers') {
      // layers: top to bottom. A layer may use itself and the layers below it, never one above it.
      const layers = rule.layers.map(asList);
      const layerOf = (p) => layers.findIndex((globs) => globs.some((g) => matchAny(g, p)));
      for (const f of files) {
        const lf = layerOf(f.path);
        if (lf < 0 || (rule.except && matchAny(rule.except, f.path))) continue;
        for (const t of f.imports) {
          const lt = layerOf(t);
          if (lt < 0 || lt >= lf) continue;
          const e = edge(rule, f, t); if (!e) continue;
          out.push({ rule: rule.name, severity: rule.severity || 'error', file: f.path, detail: `imports ${t}`,
            message: rule.message || `Layer ${layers[lf].join(' + ')} must not use the higher layer ${layers[lt].join(' + ')}.`, ...e });
        }
      }
    } else if (rule.type === 'noCycles') {
      // level 'area' (default): areas that depend on each other in a circle; 'file': import cycles between files
      const level = rule.level || 'area';
      const nodeOf = level === 'file' ? (p) => p : unitOf;
      const scope = files.filter((f) => matchAny(rule.files || '**', f.path));
      const g = new Map(); const via = new Map(); // node -> Set(node); "a\0b" -> [[file, target], ...]
      for (const f of scope) {
        const a = nodeOf(f.path);
        if (!g.has(a)) g.set(a, new Set());
        for (const t of f.imports) {
          if (!fileByPath.has(t) || !matchAny(rule.files || '**', t) || (f._dyn && f._dyn.has(t))) continue;
          const b = nodeOf(t);
          if (a === b || !edge(rule, f, t)) continue;
          g.get(a).add(b);
          const k = `${a}\0${b}`; if (!via.has(k)) via.set(k, []); via.get(k).push([f.path, t]);
        }
      }
      // Report only the imports to cut: repeatedly drop the weakest edge (fewest imports) of each cycle until none is
      // left (a small feedback arc set). Those are usually the misplaced ones.
      const cut = [];
      const edgesOf = (v) => g.get(v) || [];
      for (let guard = 0; guard < 500; guard++) {
        const comps = sccs([...g.keys()].sort(), edgesOf).filter((c) => c.length > 1);
        if (!comps.length) break;
        for (const comp of comps) {
          const inComp = new Set(comp);
          let weakest = null;
          for (const a of comp) for (const b of edgesOf(a)) if (inComp.has(b)) {
            // fewest imports, minus imports the other way round: an edge against the dominant direction goes first
            const n = via.get(`${a}\0${b}`).length - (via.get(`${b}\0${a}`) || []).length;
            if (!weakest || n < weakest.n || (n === weakest.n && `${a}\0${b}` < `${weakest.a}\0${weakest.b}`)) weakest = { a, b, n };
          }
          const back = shortestPath(weakest.b, weakest.a, edgesOf, inComp);
          cut.push({ ...weakest, cycle: [weakest.a, ...(back || [weakest.b, weakest.a])] });
          g.get(weakest.a).delete(weakest.b);
        }
      }
      for (const c of cut) {
        const pairs = via.get(`${c.a}\0${c.b}`);
        for (const [file, t] of level === 'file' ? pairs.slice(0, 1) : pairs) {
          out.push({ rule: rule.name, severity: rule.severity || 'error', file, detail: `imports ${t}`, note: `cycle: ${c.cycle.join(' → ')}`,
            message: rule.message || (level === 'file' ? 'Files import each other in a circle; move the shared part into its own file.' : 'Areas depend on each other in a circle. This is the weakest link of the cycle: move it, or invert the dependency.') });
        }
      }
    } else if (rule.type === 'noPackage') {
      // packages (npm packages, deep imports, Java packages) a part of the code must not use
      for (const f of files) {
        if (!inScope(rule, f) || (rule.except && matchAny(rule.except, f.path))) continue;
        for (const spec of new Set(f._ext || [])) {
          const pat = asList(rule.packages).find((p) => pkgMatch(spec, p));
          if (pat && !asList(rule.allowPackages).some((p) => pkgMatch(spec, p))) add(rule, { file: f.path, detail: `uses ${spec}`, ...(rule.message ? {} : { message: `${pat} is not allowed here.` }) });
        }
      }
    } else if (rule.type === 'maxSize') {
      for (const f of files) {
        if (!inScope(rule, f) || (rule.except && matchAny(rule.except, f.path))) continue;
        if (rule.maxLines && f.lines > rule.maxLines) add(rule, { file: f.path, detail: `is longer than ${rule.maxLines} lines`, note: `${f.lines} lines` });
      }
      if (rule.maxFiles) {
        const per = new Map();
        for (const f of files) if (inScope(rule, f)) per.set(dirOf(f.path), (per.get(dirOf(f.path)) || 0) + 1);
        for (const [d, n] of per) if (n > rule.maxFiles && !(rule.except && matchAny(rule.except, d))) add(rule, { file: d || '.', detail: `holds more than ${rule.maxFiles} files`, note: `${n} files` });
      }
    } else if (rule.type === 'maxFanIn') {
      for (const f of files) {
        if (!inScope(rule, f) || (rule.except && matchAny(rule.except, f.path))) continue;
        const n = (importedBy.get(f.path) || []).length;
        if (n > (rule.max ?? 30)) add(rule, { file: f.path, detail: `is imported by more than ${rule.max ?? 30} files`, note: `${n} files` });
      }
    } else if (rule.type === 'lazyBoundary') {
      // a lazily loaded folder (loadChildren / loadComponent) must not be imported eagerly from outside
      // what is lazy: the whole area (units) of a lazily loaded file, or only the file itself outside the areas
      // (app.routes lazy-loading core/auth/login.component must not make all of core/auth lazy)
      const lazy = new Set(), lazyFiles = new Set();
      for (const f of files) for (const t of f._dyn || []) {
        if (matchAny(config.units, t) && unitOf(t) !== unitOf(f.path)) lazy.add(unitOf(t));
        else if (!matchAny(config.units, t)) lazyFiles.add(t);
      }
      for (const f of files) {
        for (const t of f.imports) {
          if (f._dyn && f._dyn.has(t)) continue;
          const d = [...lazy].find((x) => t.startsWith(x + '/') && !f.path.startsWith(x + '/')) || (lazyFiles.has(t) ? t : null);
          if (!d || (rule.except && matchAny(rule.except, t))) continue;
          if (f._typeOnly && f._typeOnly.has(t)) continue; // types are erased: no bundle effect
          add(rule, { file: f.path, detail: `imports ${t}`, ...(rule.message ? {} : { message: `${d}${d.endsWith('.ts') ? '' : '/'} is lazy loaded; this import puts it into the eager bundle.` }) });
        }
      }
    } else if (rule.type === 'orphanTests') {
      for (const o of orphanTests) if (matchAny(rule.files || '**', o.test)) add(rule, o.movedTo
        ? { file: o.test, detail: `tests ${o.subject}, which is in package ${o.movedTo} now`, ...(rule.message ? {} : { message: 'Move the test next to its class (same package), or rename it.' }) }
        : { file: o.test, detail: `tests ${o.subject}, which no longer exists` });
    } else if (rule.type === 'purpose' || rule.type === 'owners') {
      const key = rule.type === 'purpose' ? 'purpose' : 'owner';
      for (const d of foldersMatching(rule.folders || config.units || [])) {
        if (rule.except && matchAny(rule.except, d)) continue;
        if (!annotationFor(d)?.[key]) add(rule, { file: d, detail: `has no ${key} in floorplan.config.mjs (folders)` });
      }
    } else if (rule.type === 'unused') {
      const exceptKinds = rule.exceptKinds || (SPRING ? ['controller', 'listener', 'config', 'application'] : ['routes', 'config', 'module']);
      const entries = rule.entries || ['main.ts', '**/main.ts', '**/app.config.ts', '**/app.routes.ts', '**/app.component.ts', '**/app.ts', '**/index.ts', '**/public-api.ts', '**/*Application.java'];
      for (const f of files) {
        if (!matchAny(rule.files || '**', f.path) || exceptKinds.includes(f.kind) || matchAny(entries, f.path)) continue;
        if (rule.except && matchAny(rule.except, f.path)) continue;
        if (SPRING && f.annotations?.length) continue; // beans and entities are wired by Spring, not imported
        if (!(importedBy.get(f.path) || []).length) add(rule, { file: f.path, detail: 'is not imported anywhere' });
      }
    } else if (rule.type === 'singleFileFolders') {
      const exceptKinds = rule.exceptKinds || (SPRING ? [] : ['component']);
      const per = new Map();
      for (const f of files) { const d = dirOf(f.path); if (!per.has(d)) per.set(d, []); per.get(d).push(f); }
      const hasSub = (d) => [...folders].some((x) => x.startsWith(d + '/'));
      for (const [d, fs_] of per) {
        if (!d || fs_.length !== 1 || hasSub(d) || exceptKinds.includes(fs_[0].kind)) continue;
        if (!matchAny(rule.files || '**', fs_[0].path) || (rule.except && matchAny(rule.except, d))) continue;
        add(rule, { file: fs_[0].path, detail: `is alone in ${d}/`, fixTo: dirOf(d) });
      }
    } else if (rule.type === 'relativeImports') {
      // relative imports that climb too far or cross into another area: use the path alias instead
      const maxUp = rule.maxUp ?? 2;
      for (const f of files) {
        if (!matchAny(rule.files || '**', f.path)) continue;
        for (const r of f._rel || []) {
          const ups = (r.spec.match(/\.\.\//g) || []).length;
          // across areas only matters when the project has path aliases to use instead
          const across = rule.acrossAreas !== false && aliases.length > 0 && unitOf(f.path) !== '(root)' && unitOf(r.target) !== unitOf(f.path);
          if (ups > maxUp || across) add(rule, { file: f.path, detail: `imports ${r.target}`, note: `relative path ${r.spec}`,
            ...(rule.message ? {} : { message: across ? 'Import other areas through a path alias (tsconfig paths), not a relative path.' : `Relative import climbs more than ${maxUp} folders; use a path alias.` }) });
        }
      }
    } else if (rule.type === 'routed') {
      // every feature folder is reachable from a route (lazy import, or imported by a routes file)
      const routed = new Set();
      for (const f of files) for (const t of f.imports) if ((f._dyn && f._dyn.has(t)) || f.kind === 'routes') routed.add(t);
      for (const f of files) if (f.kind === 'routes' && (importedBy.get(f.path) || []).length) routed.add(f.path);
      for (const d of foldersMatching(rule.folders || 'features/*')) {
        if (rule.except && matchAny(rule.except, d)) continue;
        if (![...routed].some((t) => t.startsWith(d + '/'))) add(rule, { file: d, detail: 'is not reachable from any route' });
      }
    } else if (rule.type === 'pattern' || rule.type === 'requirePattern') {
      // text rules, typical for CLAUDE.md ("never use any", "components use OnPush"): a regular expression per file.
      // Comments are ignored. pattern: report files that contain it; requirePattern: files that don't.
      let rx;
      try { rx = new RegExp(rule.pattern, (rule.flags || '').replace(/g/g, '') + 'g'); } catch (e) { out.push({ rule: rule.name, severity: 'warn', file: '.', detail: `has an invalid pattern: ${e.message}`, message: rule.message }); continue; }
      for (const f of files) {
        if (!matchAny(rule.files || '**', f.path) || (rule.kinds && !rule.kinds.includes(f.kind)) || (rule.except && matchAny(rule.except, f.path))) continue;
        const text = textOf(f.path);
        if (text === null) continue;
        rx.lastIndex = 0;
        const lines = [];
        for (const m of text.matchAll(rx)) { lines.push(text.slice(0, m.index).split('\n').length); if (lines.length > 50) break; if (!m[0].length) break; }
        const what = rule.what || `/${rule.pattern}/`;
        if (rule.type === 'pattern' && lines.length) add(rule, { file: f.path, detail: `contains ${what}`, line: lines[0], note: lines.length > 1 ? (new Set(lines).size === 1 ? `${lines.length}× on line ${lines[0]}` : `${lines.length}×, lines ${[...new Set(lines)].slice(0, 6).join(', ')}${new Set(lines).size > 6 ? ', …' : ''}`) : undefined });
        if (rule.type === 'requirePattern' && !lines.length) add(rule, { file: f.path, detail: `does not contain ${what}` });
      }
    } else if (rule.type === 'fieldInjection') {
      for (const f of files) for (const n of f._fieldInjection || []) if (inScope(rule, f)) add(rule, { file: f.path, detail: `injects ${n} through a field`, ...(rule.message ? {} : { message: 'Use constructor injection (final field + constructor): testable without Spring and never null.' }) });
    } else if (rule.type === 'proxyAnnotations') {
      for (const f of files) for (const p of f._proxyIssues || []) if (inScope(rule, f)) add(rule, { file: f.path, detail: `@${p.annotation} on ${p.modifier} method ${p.method}()`, ...(rule.message ? {} : { message: `Spring's proxy cannot intercept ${p.modifier} methods, so @${p.annotation} is silently ignored there. Make the method public (and not final/static).` }) });
    }
  }
  // per-rule extras: warn until a date, then error; why + docs link shown in reports, the hook and the graph
  for (const v of out) {
    const rule = config.rules.find((r) => r.name === v.rule);
    if (!rule) continue;
    if (rule.errorFrom && TODAY < rule.errorFrom && v.severity === 'error') { v.severity = 'warn'; v.errorFrom = rule.errorFrom; }
    if (rule.why) v.why = rule.why;
    if (rule.docs) v.docs = rule.docs;
  }
  return out;
}
let violations = runRules(files);

// ---------- rules from other tools: Nx module boundaries, ArchUnit ----------
const EXT = { nx: { active: false }, arch: { active: false } };
{
  const X = await import('./rules-ext.mjs');
  try {
    if (!SPRING) EXT.nx = await X.nxViolations({ ROOT, cwd: process.cwd(), files, mode: config.nx });
    else EXT.arch = X.archUnitViolations({ files, scanRoot: path.resolve(config.scanRoot || '.'), mode: config.archunit, walkJava: (await import('./java.mjs')).walkJava });
  } catch (e) { if (!QUIET && !SESSION) console.warn(`! Reading Nx/ArchUnit rules failed: ${e.message}`); }
  for (const r of [EXT.nx, EXT.arch]) if (r.active) violations.push(...r.violations);
  if (EXT.nx.note && !QUIET && !SESSION && MODE !== 'json') console.warn(`! ${EXT.nx.note}`);
}

// ---------- fix suggestions for placement issues ----------
// The best allowed folder for a misplaced file: an existing folder that holds most of what the file uses and what uses
// it, near the file. Shown in reports, the hook, and as a "Fix" button in the graph (move-cli --fix).
{
  const importedBy = new Map();
  for (const f of files) for (const t of f.imports) { if (!importedBy.has(t)) importedBy.set(t, []); importedBy.get(t).push(f.path); }
  const dirExists = (d) => { try { return fs.statSync(path.join(ROOT, d)).isDirectory(); } catch { return false; } };
  const candidatesFor = (filePath, patterns) => {
    const segs = filePath.split('/').slice(0, -1);
    const out = new Set();
    for (const pat of asList(patterns)) {
      const ps = pat.split('/');
      if (pat.startsWith('**/')) {
        // nearest existing folder with that name, from the file's folder upwards
        const rest = ps.slice(1).join('/');
        for (let i = segs.length; i >= 0; i--) { const c = [...segs.slice(0, i), rest].join('/'); if (dirExists(c)) { out.add(c); break; } }
        if (!segs.length || ![...out].some((c) => c.endsWith(rest))) out.add([...segs, rest].join('/'));
        continue;
      }
      if (ps.includes('**')) continue;
      if (ps.every((x) => x !== '*')) { out.add(pat); continue; }
      // fill '*' from the file's own path (features/*/data-access → features/customers/data-access)
      const filled = ps.map((x, i) => (x === '*' ? segs[i] : x));
      if (filled.every(Boolean) && ps.every((x, i) => x === '*' || x === segs[i] || i > 0)) out.add(filled.join('/'));
      // and every existing folder that fits the pattern
      const rx = globToRegex(pat);
      for (const d of new Set(files.map((f) => f.path.split('/').slice(0, ps.length).join('/')))) if (d.split('/').length === ps.length && rx.test(d) && dirExists(d)) out.add(d);
    }
    return [...out];
  };
  for (const v of violations) {
    if ('fixTo' in v) { if (v.fixTo) v.fix = { target: v.fixTo, create: false }; delete v.fixTo; continue; }
    const rule = config.rules.find((r) => r.name === v.rule);
    if (!rule || rule.type !== 'placement' || !asList(rule.allowedIn).length) continue;
    const f = fileByPath.get(v.file);
    const related = [...(f?.imports || []), ...(importedBy.get(v.file) || [])];
    let best = null;
    for (const c of candidatesFor(v.file, rule.allowedIn)) {
      if (!matchAny(rule.allowedIn, `${c}/${path.posix.basename(v.file)}`)) continue;
      const inside = related.filter((r) => r === c || r.startsWith(c + '/')).length;
      const common = (() => { const a = v.file.split('/'), b = c.split('/'); let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; })();
      const score = (dirExists(c) ? 1000 : 0) + inside * 10 + common;
      if (!best || score > best.score) best = { target: c, exists: dirExists(c), score };
    }
    if (best) v.fix = { target: best.target, create: !best.exists };
  }
}

// ---------- Sheriff (Angular): the project's own module rules as an extra source ----------
const SHERIFF = { active: false, note: '' };
if (!SPRING && config.sheriff !== false && !HOOK) {
  const cfgFile = ['sheriff.config.ts', 'sheriff.config.js', 'sheriff.config.mjs'].map((f) => path.resolve(f)).find((f) => fs.existsSync(f));
  if (cfgFile || config.sheriff === true) {
    let bin = null;
    try { bin = path.join(path.dirname(createRequire(path.resolve('package.json')).resolve('@softarc/sheriff-core/package.json')), 'src', 'bin', 'main.js'); } catch { /* not installed */ }
    if (process.env.SHERIFF_BIN) bin = process.env.SHERIFF_BIN;
    if (!cfgFile) SHERIFF.note = 'sheriff: true, but no sheriff.config.ts found.';
    else if (!bin || !fs.existsSync(bin)) SHERIFF.note = 'sheriff.config.ts found, but @softarc/sheriff-core is not installed (npm install).';
    else {
      const cfgSrc = fs.readFileSync(cfgFile, 'utf8');
      const entry = typeof config.sheriff === 'object' && config.sheriff.entry ? config.sheriff.entry
        : /entryFile|entryPoints/.test(cfgSrc) ? null : ['src/main.ts'].find((f) => fs.existsSync(f));
      let out = '';
      try { out = execFileSync(process.execPath, [bin, 'verify', ...(entry ? [entry] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }); }
      catch (e) { out = (e.stdout || '') + ''; if (!/Verification Report/.test(out)) SHERIFF.note = `Sheriff failed: ${(e.stderr || e.message || '').toString().split('\n')[0]}`; }
      out = out.replace(/\u001b\[[0-9;]*m/g, '');
      if (/Verification Report/.test(out)) {
        SHERIFF.active = true;
        let file = null, section = null;
        for (const line of out.split('\n')) {
          const fm = /^\|-- (.+)$/.exec(line.trimEnd());
          if (fm) { file = fm[1].trim(); section = null; continue; }
          if (/^\|   \|-- Encapsulation Violations/.test(line)) { section = 'enc'; continue; }
          if (/^\|   \|-- Dependency Rule Violations/.test(line)) { section = 'dep'; continue; }
          const im = /^\|   \|   \|-- (.+)$/.exec(line.trimEnd());
          if (im && file && section) {
            const abs = path.resolve(file);
            if (!abs.startsWith(ROOT + path.sep)) continue;
            const p = rel(abs);
            if (section === 'enc') violations.push({ rule: 'sheriff:encapsulation', severity: 'error', file: p, detail: `deep import ${im[1].trim()}`, message: 'Sheriff: import another module only through its public API (index.ts).' });
            else violations.push({ rule: 'sheriff:dependency-rule', severity: 'error', file: p, detail: im[1].trim(), message: 'Sheriff: depRules in sheriff.config.ts do not allow this dependency.' });
          }
        }
      }
    }
    if (SHERIFF.note && !QUIET && !SESSION && MODE !== 'json') console.warn(`! ${SHERIFF.note}`);
  }
}

// ---------- what each issue says: exact place, where the rule comes from, how to fix it ----------
const ROOT_REL = (() => { const r = path.relative(process.cwd(), ROOT).split(path.sep).join('/'); return r && !r.startsWith('..') ? `${r}/` : ''; })();
const ruleByName = new Map(config.rules.map((r) => [r.name, r]));
const rawLines = new Map();
const linesOf = (p) => { if (!rawLines.has(p)) { try { rawLines.set(p, fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n')); } catch { rawLines.set(p, null); } } return rawLines.get(p); };
function importLine(file, target) {
  const lines = linesOf(file);
  if (!lines) return undefined;
  const f = fileByPath.get(file);
  if (SPRING) {
    const cls = path.posix.basename(target, '.java');
    const i = lines.findIndex((l) => new RegExp(`^\\s*import\\s+(static\\s+)?[\\w.]*\\b${cls}\\b`).test(l));
    if (i >= 0) return i + 1;
    const j = lines.findIndex((l, k) => k > 0 && !/^\s*(package|import)\b/.test(l) && new RegExp(`\\b${cls}\\b`).test(l));
    return j >= 0 ? j + 1 : undefined;
  }
  const spec = f?._specOf?.get(target);
  if (!spec) return undefined;
  const i = lines.findIndex((l) => l.includes(`'${spec}'`) || l.includes(`"${spec}"`) || l.includes(`\`${spec}\``));
  return i >= 0 ? i + 1 : undefined;
}
function aliasFor(target) {
  const abs = path.join(ROOT, target);
  for (const a of aliases) for (const t of a.targets) {
    if (a.wildcard && abs.startsWith(t)) return a.prefix + abs.slice(t.length).split(path.sep).join('/').replace(/^\//, '').replace(/\.ts$/, '').replace(/\/index$/, '');
    if (!a.wildcard && abs.replace(/\.ts$/, '') === t.replace(/\.ts$/, '')) return a.prefix;
  }
  return null;
}
const kebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
const moveCmd = (file, target, create) => `node scripts/floorplan/move-cli.mjs ${file} ${target}${create ? ' --create' : ''}`;
function howToFix(v, rule) {
  if (rule?.howToFix) return rule.howToFix;
  const t = v.detail.startsWith('imports ') ? v.detail.slice(8) : null;
  const type = rule?.type;
  if (v.typeOnly && t) return `It imports only types (interfaces). Move the shared types to a place both may use (e.g. a shared models folder or the other area's public API), or set typeImports: 'ignore' in the config if type imports are fine here.`;
  switch (type) {
    case 'noImport': return `Remove the import of ${t}${v.line ? ` (line ${v.line})` : ''}. If both places need that code, move it to a folder both may use; \`node scripts/floorplan/generate-map.mjs --plan-extract ${v.rule}\` shows which files to move and what that fixes.`;
    case 'publicApi': { const mod = (v.message || '').match(/through (\S+)\.$/)?.[1]; return `Import it through the module's public API${mod ? ` (${mod})` : ''}; if what you need isn't exported there, export it from that file.`; }
    case 'layers': return `A lower layer must not use a higher one. Move the code you need from ${t} down into a lower layer (or a shared place), or pass it in from above (input, callback, interface) instead of importing it.`;
    case 'noCycles': return `This import closes a dependency circle (${(v.note || '').replace(/^cycle: /, '')}). Cut it: move the code ${v.file} needs from ${t} into a place both may use, or turn the dependency around (the other side passes it in).`;
    case 'lazyBoundary': return `Don't import ${t} directly from outside its lazy area: load it through the router (loadComponent / loadChildren), or move the part you need into shared code.`;
    case 'placement': return v.fix ? `Move it (imports are rewritten, git history kept): \`${moveCmd(v.file, v.fix.target, v.fix.create)}\` (dry run), then add --apply.` : `Move it into one of: ${asList(rule.allowedIn).join(', ')} (\`node scripts/floorplan/move-cli.mjs <file> <folder>\`).`;
    case 'naming': { const base = path.posix.basename(v.file); return `Rename it, e.g. to ${kebab(base.split('.')[0])}${base.slice(base.indexOf('.'))} (with move-cli to the same folder under the new name, or your IDE's rename so imports follow).`; }
    case 'companion': return `Create ${(v.detail.match(/has no (\S+)/) || [])[1] || 'the companion file'} next to it.`;
    case 'oneDeclaration': return 'Split the file: one component, directive, pipe or service per file, each named after its class.';
    case 'noPackage': return `Stop using ${v.detail.replace(/^uses /, '')} here${v.line ? ` (line ${v.line})` : ''}: use what the rule's message names instead, or move this code to a part of the app where the package is allowed.`;
    case 'maxSize': return v.detail.includes('files') ? 'Split the folder into subfolders by topic.' : 'Split the file: move independent parts (helpers, sub-components, mappers) into their own files next to it.';
    case 'maxFanIn': return 'Very many files depend on this one, so every change to it touches all of them. Split it into smaller, focused files (or a barrel that re-exports them) so importers depend only on what they use.';
    case 'orphanTests': return /no longer exists/.test(v.detail) ? 'Delete the test, or restore / rename the file it tested.' : 'Move the test into the same package as its class (keeps package-private access and the usual layout).';
    case 'purpose': return `Add a purpose in the config: folders: { '${v.file}': { purpose: 'what belongs here' } }.`;
    case 'owners': return `Add an owner in the config: folders: { '${v.file}': { owner: '@org/team' } } (then node scripts/floorplan/codeowners.mjs --write).`;
    case 'unused': return 'Nothing imports it. Delete it if it is dead code (check templates, routes and reflection first), or list it under the rule\'s entries if something loads it another way.';
    case 'singleFileFolders': return v.fix ? `Move it up: \`${moveCmd(v.file, v.fix.target, false)}\` (dry run), then --apply.` : 'Move it into the parent folder.';
    case 'relativeImports': { const al = t && aliasFor(t); return al ? `Import it as '${al}' instead of ${(v.note || '').replace(/^relative path /, '')}.` : 'Use a path alias (tsconfig paths) instead of the long relative path; add one if the project has none.'; }
    case 'routed': return `Add a route that loads it (loadChildren / loadComponent), or remove the folder if it is unused.`;
    case 'fieldInjection': return 'Make the field private final, remove @Autowired and add it as a constructor parameter (or use Lombok @RequiredArgsConstructor).';
    case 'proxyAnnotations': return `Make the method public and not final or static, and call it through the bean (another bean, or self-injection), not via this, or the annotation still does nothing.`;
    case 'pattern': return `Change ${v.line ? `line ${v.line}` : 'the matching code'}${v.note ? ` (${v.note})` : ''} so it no longer contains ${v.detail.replace(/^contains /, '')}.`;
    case 'requirePattern': return `Add ${v.detail.replace(/^does not contain /, '')} to the file.`;
    default:
      if (v.rule.startsWith('sheriff:')) return 'Import through the other module\'s index.ts, or allow the dependency in sheriff.config.ts (depRules) if it is intended.';
      if (v.rule.startsWith('nx:')) return 'Remove the import, or allow the tags in depConstraints (@nx/enforce-module-boundaries) if it is intended.';
      if (v.rule.startsWith('archunit:')) return 'Remove the dependency, or change the ArchUnit test if it is intended.';
      return '';
  }
}
for (const v of violations) {
  const rule = ruleByName.get(v.rule);
  if (v.line === undefined && v.detail.startsWith('imports ')) v.line = importLine(v.file, v.detail.slice(8));
  if (v.line === undefined) delete v.line;
  v.source = rule?._origin || (v.rule.startsWith('sheriff:') ? 'sheriff.config.ts' : v.rule.startsWith('nx:') ? 'Nx depConstraints' : v.rule.startsWith('archunit:') ? 'ArchUnit tests' : 'floorplan');
  if (rule?._quote) v.quote = rule._quote;
  const h = howToFix(v, rule);
  if (h) v.howToFix = h;
}
// how an issue's place is shown: path from the repository folder, with the line
const where = (v) => `${ROOT_REL}${v.file}${v.line ? `:${v.line}` : ''}`;
const fromText = (v) => `from ${v.source}${v.quote ? ` "${v.quote.length > 90 ? v.quote.slice(0, 87) + '…' : v.quote}"` : ''}`;

// ---------- accepted exceptions ----------
// accepted: [{ rule, file, detail?, reason }]: documented exceptions. They stay visible but never count or fail.
const acceptedViolations = [];
const acceptedUnused = [];
{
  const list = asList(config.accepted);
  const used = new Set();
  violations = violations.filter((v) => {
    const i = list.findIndex((a) => (!a.rule || a.rule === v.rule) && a.file && (a.file === v.file || matchAny(a.file, v.file)) && (!a.detail || v.detail.includes(a.detail)));
    if (i < 0) return true;
    used.add(i);
    acceptedViolations.push({ ...v, accepted: list[i].reason || '(no reason given)' });
    return false;
  });
  list.forEach((a, i) => { if (!used.has(i)) acceptedUnused.push(a); });
  if (acceptedUnused.length && !QUIET && !SESSION && MODE !== 'json') {
    for (const a of acceptedUnused) console.warn(`! accepted entry matches nothing anymore (fixed? remove it): ${a.rule || '*'} ${a.file}${a.detail ? ` "${a.detail}"` : ''}`);
  }
}

// ---------- extraction planner (--plan-extract <rule> [--to <folder>]) ----------
// For the import issues of one rule (e.g. features importing each other): which files to move to a shared folder,
// with everything they pull along from their area, and what that does to all rules. Changes nothing.
if (args.includes('--plan-extract')) {
  const ruleName = argVal('--plan-extract');
  const issues = violations.filter((v) => v.rule === ruleName && v.detail.startsWith('imports '));
  if (!issues.length) { console.log(`No import issues for rule "${ruleName}". Rules with import issues: ${[...new Set(violations.filter((v) => v.detail.startsWith('imports ')).map((v) => v.rule))].join(', ') || 'none'}`); process.exit(0); }
  const dirs = new Set(files.map((f) => path.posix.dirname(f.path)));
  const to = argVal('--to') || ['shared', 'core', 'common'].find((d) => [...dirs].some((x) => x === d || x.startsWith(d + '/'))) || 'shared';
  const areaRoot = (p) => { const u = unitOf(p); return u === '(root)' ? '' : u; };
  // closure: the target and what it imports from its own area (otherwise the moved file would import back into it)
  const closure = (t) => {
    const out = new Set([t]); const q = [t]; const a = unitOf(t);
    while (q.length) for (const i of fileByPath.get(q.shift())?.imports || []) if (unitOf(i) === a && !out.has(i) && !(fileByPath.get(i)?._typeOnly?.has?.(i))) { out.add(i); q.push(i); }
    return out;
  };
  // clusters of targets whose closures overlap
  const clusters = [];
  for (const t of [...new Set(issues.map((v) => v.detail.slice(8)))].sort()) {
    const c = closure(t);
    const hit = clusters.filter((k) => [...c].some((x) => k.files.has(x)));
    const merged = { targets: new Set([t]), files: c };
    for (const k of hit) { k.targets.forEach((x) => merged.targets.add(x)); k.files.forEach((x) => merged.files.add(x)); clusters.splice(clusters.indexOf(k), 1); }
    clusters.push(merged);
  }
  const keyV = (v, m = (x) => x) => `${v.rule}|${m(v.file)}|${v.detail.startsWith('imports ') ? 'imports ' + m(v.detail.slice(8)) : v.detail}`;
  const simulate = (moves) => {
    const m = (p) => moves.get(p) ?? p;
    const back = new Map([...moves].map(([a, b]) => [b, a]));
    const sim = files.map((f) => ({ ...f, path: m(f.path), imports: f.imports.map(m), _typeOnly: new Set([...(f._typeOnly || [])].map(m)), _dyn: new Set([...(f._dyn || [])].map(m)), _rel: (f._rel || []).map((r) => ({ ...r, target: m(r.target) })) }));
    const after = runRules(sim, { exists: (p) => fs.existsSync(path.join(ROOT, back.get(p) ?? p)), realPath: (p) => back.get(p) ?? p });
    const before = new Set(violations.map((v) => keyV(v, m))), aft = new Set(after.map((v) => keyV(v)));
    return { fixed: violations.filter((v) => !aft.has(keyV(v, m))), added: after.filter((v) => !before.has(keyV(v))) };
  };
  const all = new Map();
  const plans = clusters.map((k) => {
    const moves = new Map([...k.files].map((p) => { const ar = areaRoot(p); return [p, `${to}/${ar ? p.slice(ar.length + 1) : p}`]; }));
    moves.forEach((v, kk) => all.set(kk, v));
    // commands: whole folders where every file moves, else single files
    const cmds = new Set();
    for (const p of [...k.files].sort()) {
      let d = path.posix.dirname(p); const ar = areaRoot(p);
      let pick = null;
      while (d && d !== '.' && d !== ar && d.length > ar.length) {
        const inside = files.filter((f) => f.path.startsWith(d + '/'));
        const destDir = `${to}/${ar ? d.slice(ar.length + 1) : d}`;
        if (inside.every((f) => k.files.has(f.path)) && !fs.existsSync(path.join(ROOT, destDir))) pick = d; else break;
        d = path.posix.dirname(d);
      }
      const src = pick || p;
      const newPath = pick ? `${to}/${ar ? pick.slice(ar.length + 1) : pick}` : moves.get(p);
      cmds.add(`node scripts/floorplan/move-cli.mjs ${src} ${path.posix.dirname(newPath)} --create`);
    }
    return { ...k, moves, cmds: [...cmds], ...simulate(moves) };
  });
  const total = simulate(all);
  console.log(`Extraction plan for "${ruleName}": ${issues.length} issue(s), target folder ${to}/ (change with --to). Nothing is changed.\n`);
  plans.sort((a, b) => (b.fixed.length - b.added.length) - (a.fixed.length - a.added.length)).forEach((pl, i) => {
    console.log(`${i + 1}. Move ${pl.files.size} file(s) → fixes ${pl.fixed.length} issue(s), adds ${pl.added.length}`);
    for (const p of [...pl.files].sort()) console.log(`     ${p} → ${pl.moves.get(p)}${pl.targets.has(p) ? '' : '   (pulled along)'}`);
    for (const v of pl.added) console.log(`     ! adds: ${v.file} ${vText(v)} (${v.rule})`);
    console.log('   Commands (dry run first, then add --apply):');
    for (const c of pl.cmds) console.log(`     ${c}`);
    console.log('');
  });
  console.log(`All together: move ${all.size} file(s) → fixes ${total.fixed.length} issue(s), adds ${total.added.length}.`);
  process.exit(0);
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
  for (let child of folders) {
    let full = prefix ? `${prefix}/${child.name}` : child.name;
    let label = child.name;
    // a folder with only one subfolder and no files is shown as one line: src/main/java/com/acme/
    while (!child.files.length && child.folders.size === 1 && !annotationFor(full)) {
      child = [...child.folders.values()][0];
      full += `/${child.name}`; label += `/${child.name}`;
    }
    const ann = annotationFor(full);
    let line = `${'  '.repeat(depth)}- ${label}/`;
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

// how a violation reads in reports: detail plus what the rule engine knows about it
function vText(v) {
  return `${v.detail}${v.typeOnly ? ' (types only)' : ''}${v.note ? ` (${v.note})` : ''}${v.errorFrom ? ` (warning until ${v.errorFrom}, then an error)` : ''}`;
}
const whyLines = (v, indent) => `${v.why ? `\n${indent}why: ${v.why}` : ''}${v.docs ? `\n${indent}docs: ${v.docs}` : ''}`;

// ---------- markdown ----------
const count = (k) => files.filter((f) => f.kind === k).length;
const totals = TOTAL_KINDS
  .map((k) => [k, count(k)]).filter(([, n]) => n).map(([k, n]) => `${n} ${n === 1 ? SINGULAR[k] : PLURAL[k]}`).join(' · ');
const errors = violations.filter((v) => v.severity === 'error');

const md = [];
md.push('# Floorplan');
md.push('');
md.push(`> Generated by \`scripts/floorplan/generate-map.mjs\` (floorplan ${TOOL_VERSION}). Do not edit by hand.`);
md.push('> To change folder purposes or rules, edit `floorplan.config.mjs` and regenerate.');
md.push('');
md.push(`Root: \`${config.root}\` · ${SPRING ? 'Spring Boot (Java)' : 'Angular'} · ${files.length} source files · ${testCount} ${SPRING ? 'test' : 'spec'} files`);
const claudeRulesNote = CLAUDE_RULES.stale.length
  ? `CLAUDE.md changed since the Floorplan rules were derived from it (${CLAUDE_RULES.stale.join(', ')}): run /floorplan rules to update ${CLAUDE_RULES.file}.`
  : CLAUDE_RULES.missing ? `The rules written in CLAUDE.md are not checked yet: run /floorplan rules once to turn them into checks (${CLAUDE_RULES.file}).` : '';
if (claudeRulesNote) md.push('', `> ${claudeRulesNote}`);
md.push(totals ? `Contains: ${totals}` : '');
md.push('');
// Split view (big repositories): the overview lists areas; each area has its own detail file.
const SPLIT = config.split === true || (config.split !== false && files.length > (config.splitAbove ?? 1500));
const areaSlug = (u) => (u === '(root)' ? '_root' : u.replace(/[\\/]+/g, '--').replace(/[^\w.-]/g, '_'));
const filesByArea = new Map();
for (const f of files) { const u = unitOf(f.path); if (!filesByArea.has(u)) filesByArea.set(u, []); filesByArea.get(u).push(f); }
const usedBy = new Map();
for (const [u, deps] of unitDeps) for (const d of deps) { if (!usedBy.has(d)) usedBy.set(d, new Set()); usedBy.get(d).add(u); }
const kindCounts = (fs_) => countsOnly(fs_).split(', ').slice(0, 4).join(', ');
if (SPLIT) {
  md.push('## Areas');
  md.push('');
  md.push(`> Split view (${files.length} files). This file is the overview. Before working in an area, read its detail file`);
  md.push(`> (\`<this folder>/floorplan-areas/<area>.md\`, local working tree: \`${config.output.local}/areas/<area>.md\`): folders, files, routes and issues of that area.`);
  md.push('');
  md.push('| Area | Purpose | Files | Mostly | Uses | Issues | Details |');
  md.push('|---|---|---|---|---|---|---|');
  for (const u of [...filesByArea.keys()].sort()) {
    const fs_ = filesByArea.get(u);
    const ann = annotationFor(u);
    const deps = [...(unitDeps.get(u) || [])].sort();
    const iss = violations.filter((v) => unitOf(v.file) === u).length;
    md.push(`| ${u} | ${ann?.purpose || ''} | ${fs_.length} | ${kindCounts(fs_)} | ${deps.slice(0, 6).join(', ')}${deps.length > 6 ? ` +${deps.length - 6}` : ''} | ${iss || ''} | floorplan-areas/${areaSlug(u)}.md |`);
  }
  md.push('');
} else {
md.push('## Structure');
md.push('');
if (COMPACT) {
  md.push(`> Compact view (${files.length} files): counts per folder, ${shownDepth} level${shownDepth === 1 ? '' : 's'} deep.`);
  md.push(`> Full detail: the .json next to this file, or the graph (${SPRING ? '`node scripts/floorplan/server.mjs`' : '`npm run map:ui`'}).`);
  md.push('');
}
md.push(...treeLines);
md.push('');
}
if (routes.length && !SPLIT) {
  md.push(SPRING ? '## HTTP endpoints and listeners' : '## Routes');
  md.push('');
  md.push(SPRING ? '| Endpoint | Handler | Defined in |' : '| Path | Target | Defined in |');
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
if (config.rules.length || SHERIFF.active || EXT.nx.active || EXT.arch.active) {
  md.push('## Rules');
  md.push('');
  for (const r of config.rules) md.push(`- **${r.name}** (${r.severity || 'error'}${r._origin ? `, from ${r._origin}` : ''}${CLAUDE_RULES.confirmed.has(r.name) ? `, confirmed by ${CLAUDE_RULES.confirmed.get(r.name)}` : ''}${r.errorFrom ? `, error from ${r.errorFrom}` : ''}${config.budget?.[r.name] !== undefined ? `, budget ${config.budget[r.name]}` : ''}): ${r.message || ''}${r.why ? ` Why: ${r.why}` : ''}${r.docs ? ` ([docs](${r.docs}))` : ''}`);
  for (const x of CLAUDE_RULES.replaced) md.push(`- ~~${x.rule}~~ switched off: ${x.by} says otherwise${x.text ? ` ("${x.text}")` : ''}. CLAUDE.md wins.`);
  if (CLAUDE_RULES.notCheckable.length) md.push(`- ${CLAUDE_RULES.notCheckable.length} CLAUDE.md rule(s) can't be checked automatically (listed in ${CLAUDE_RULES.file}); Claude follows them from CLAUDE.md.`);
  if (config.typeImports && config.typeImports !== 'error') md.push(`- Imports used only as types: ${config.typeImports === 'ignore' ? 'ignored' : 'reported as warnings'} by the import rules.`);
  if (SHERIFF.active) md.push('- **sheriff:encapsulation**, **sheriff:dependency-rule** (error): module rules from `sheriff.config.ts`, checked by Sheriff.');
  if (EXT.nx.active) md.push(`- **nx:module-boundaries** (error): \`depConstraints\` of \`@nx/enforce-module-boundaries\` (${EXT.nx.constraints} constraints, ${EXT.nx.projects} projects).`);
  if (EXT.arch.active) md.push(`- **archunit:…** (error): ${EXT.arch.rules} package rule(s) from ArchUnit tests.`);
  md.push('');
}
md.push(`## Violations (${violations.length})`);
md.push('');
if (!violations.length) md.push('None.');
const shownViolations = SPLIT ? violations.slice(0, 50) : COMPACT ? violations.slice(0, 100) : violations;
for (const v of shownViolations) md.push(`- ${v.severity === 'error' ? '✗' : '!'} \`${v.file}${v.line ? `:${v.line}` : ''}\` ${vText(v)} — ${v.rule} (${fromText(v)})${v.howToFix ? `\n  Fix: ${v.howToFix}` : ''}`);
if (shownViolations.length < violations.length) md.push(`- …and ${violations.length - shownViolations.length} more (see the .json).`);
md.push('');
if (acceptedViolations.length) {
  md.push(`## Accepted exceptions (${acceptedViolations.length})`, '', '> Listed under `accepted` in floorplan.config.mjs: known, documented, not counted.', '');
  for (const v of acceptedViolations.slice(0, 50)) md.push(`- \`${v.file}\` ${vText(v)} — ${v.rule}: ${v.accepted}`);
  if (acceptedViolations.length > 50) md.push(`- …and ${acceptedViolations.length - 50} more (see the .json).`);
  md.push('');
}
const topExternals = [...externals].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k]) => k);
if (topExternals.length) {
  md.push('## Main libraries');
  md.push('');
  md.push(topExternals.join(', '));
  md.push('');
}
const markdown = md.join('\n');

// one detail file per area (split view)
function areaMarkdown(u) {
  const fs_ = filesByArea.get(u) || [];
  const ann = annotationFor(u);
  const L = [`# Area ${u}`, '', `> Part of the project map (${TOOL_VERSION}). Generated; do not edit.`, ''];
  if (ann?.purpose) L.push(`Purpose: ${ann.purpose}${ann.owner ? ` (owner: ${ann.owner})` : ''}`, '');
  L.push(`${fs_.length} files · ${countsOnly(fs_)}`);
  L.push(`Uses: ${[...(unitDeps.get(u) || [])].sort().join(', ') || '(nothing)'}`);
  L.push(`Used by: ${[...(usedBy.get(u) || [])].sort().join(', ') || '(nothing)'}`, '');
  L.push('## Structure', '');
  const sub = { name: '', folders: new Map(), files: [] };
  for (const f of fs_) {
    let node = sub;
    for (const part of f.path.split('/').slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { name: part, folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push(f);
  }
  const walkSub = (node, prefix, depth) => {
    for (let child of [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      let full = prefix ? `${prefix}/${child.name}` : child.name, label = child.name;
      while (!child.files.length && child.folders.size === 1) { child = [...child.folders.values()][0]; full += `/${child.name}`; label += `/${child.name}`; }
      const a = annotationFor(full);
      const sm = summarize(child.files);
      L.push(`${'  '.repeat(depth)}- ${label}/${a?.purpose ? ` — ${a.purpose}` : ''}${sm ? ` · ${sm}` : ''}`);
      walkSub(child, full, depth + 1);
    }
  };
  if (sub.files.length) L.push(`- ./ · ${summarize(sub.files)}`);
  walkSub(sub, '', 0);
  L.push('');
  const rs = routes.filter((r) => unitOf(r.file) === u);
  if (rs.length) {
    L.push(SPRING ? '## HTTP endpoints and listeners' : '## Routes', '', SPRING ? '| Endpoint | Handler | Defined in |' : '| Path | Target | Defined in |', '|---|---|---|');
    for (const r of rs) L.push(`| ${r.path} | ${r.target} | ${r.file} |`);
    L.push('');
  }
  const vs = violations.filter((v) => unitOf(v.file) === u);
  L.push(`## Rule issues (${vs.length})`, '');
  if (!vs.length) L.push('None.');
  for (const v of vs) L.push(`- ${v.severity === 'error' ? '✗' : '!'} \`${v.file}${v.line ? `:${v.line}` : ''}\` ${vText(v)} — ${v.rule} (${fromText(v)})${v.howToFix ? `\n  Fix: ${v.howToFix}` : ''}`);
  return L.join('\n') + '\n';
}
function writeAreas(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  if (!SPLIT) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const u of filesByArea.keys()) fs.writeFileSync(path.join(dir, `${areaSlug(u)}.md`), areaMarkdown(u));
}

const data = {
  root: config.root,
  framework: FRAMEWORK,
  files: files.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('_')))),
  routes,
  areas: Object.fromEntries([...unitDeps].map(([u, d]) => [u, [...d].sort()])),
  folders: config.folders,
  rules: config.rules,
  sheriff: SHERIFF.active,
  version: TOOL_VERSION,
  violations,
  accepted: acceptedViolations,
};
const json = JSON.stringify(data, null, 2) + '\n';
const fixLine = (v) => (v.fix ? `\n    fix: node scripts/floorplan/move-cli.mjs ${v.file} ${v.fix.target}${v.fix.create ? ' --create' : ''}` : '');
const fmt = (v) => `  ${v.severity === 'error' ? '✗' : '!'} ${where(v)} ${vText(v)}\n    rule: ${v.rule} (${v.severity === 'error' ? 'error' : 'warning'}, ${fromText(v)})${v.message ? `\n    what: ${v.message}` : ''}${whyLines(v, '    ')}${v.howToFix ? `\n    fix: ${v.howToFix}` : fixLine(v)}`;
const log = (...a) => { if (!QUIET && !SESSION) console.log(...a); };
// console: at most 3 issues per rule, then a count (the map and the graph list them all)
function grouped(vs, per = 3) {
  const byRule = new Map();
  for (const v of vs) { if (!byRule.has(v.rule)) byRule.set(v.rule, []); byRule.get(v.rule).push(v); }
  const out = [];
  for (const [rule, list] of byRule) {
    out.push(...list.slice(0, per).map(fmt));
    if (list.length > per) out.push(`  … ${list.length - per} more ${rule} issue${list.length - per === 1 ? '' : 's'} (all in ${config.output.markdown} and the graph)`);
  }
  return out;
}

// ---------- internal: map of another tree, used for the merge-base ----------
if (MODE === 'json') { fs.writeFileSync(argVal('--json-out'), json); process.exit(0); } // a file, not stdout: large output would be cut off by an early exit

// ---------- main map (CI on main, or first setup) ----------
if (MODE === 'main') {
  const mdOut = path.resolve(config.output.markdown), jsonOut = path.resolve(config.output.json);
  fs.mkdirSync(path.dirname(mdOut), { recursive: true });
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(mdOut, markdown);
  fs.writeFileSync(jsonOut, json);
  writeAreas(path.resolve(AREAS_DIR));
  log(`✓ Wrote the main map: ${config.output.markdown} and ${config.output.json}`);
  if (claudeRulesNote && !QUIET) console.warn(`! ${claudeRulesNote}`);
  log(`  ${files.length} files · ${routes.length} ${SPRING ? 'endpoints' : 'routes'} · ${unitDeps.size} areas · ${violations.length} violations`);
  if (violations.length && !QUIET) console.log(grouped(violations).join('\n'));
  const g = (a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  if (g(['rev-parse', '--is-inside-work-tree']) === 'true') {
    // a main map that git ignores never reaches teammates or Claude in other clones
    for (const out of [config.output.markdown, config.output.json]) {
      if (g(['check-ignore', '-q', '--no-index', out]) !== null) {
        console.warn(`! ${out} is ignored by git (.gitignore), so it is never committed. Set output.markdown / output.json in floorplan.config.mjs to a tracked folder (e.g. 'floorplan/FLOORPLAN.md') and update the @reference in CLAUDE.md (node scripts/floorplan/claude-md.mjs).`);
      }
    }
    const branch = g(['rev-parse', '--abbrev-ref', 'HEAD']);
    const base = config.baseBranch || 'main';
    if (branch && branch !== base && branch !== 'HEAD' && !process.env.CI && !process.env.TF_BUILD) console.warn(`! You are on "${branch}". The main map describes ${base}: generate it on ${base}${config.ci === false ? ' after merging' : ' (CI does this)'}; on a branch use the local map (no --main).`);
  }
  process.exit(0);
}

// ---------- local map + branch report ----------
const LOCAL = path.resolve(config.output.local);
fs.mkdirSync(LOCAL, { recursive: true });
fs.writeFileSync(path.join(LOCAL, '.gitignore'), '# Generated by floorplan. Local only, never committed.\n*\n');
if (!HOOK) {
  fs.writeFileSync(path.join(LOCAL, 'FLOORPLAN.md'), markdown.replace('# Floorplan', '# Floorplan (local working tree)'));
  fs.writeFileSync(path.join(LOCAL, 'floorplan.json'), json);
  writeAreas(path.join(LOCAL, 'areas'));
}

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'floorplan-base-'));
  try {
    const sheriffFiles = SHERIFF.active ? ['sheriff.config.ts', 'sheriff.config.js', 'sheriff.config.mjs', 'package.json']
      .filter((f) => gitText(['-C', repoRoot, 'cat-file', '-e', `${mb}:${inProj(f)}`]) !== null).map(inProj) : [];
    const scanPart = SHERIFF.active ? posix(path.relative(process.cwd(), path.resolve(config.scanRoot || path.dirname(config.root)))) || '.' : posix(config.root);
    const tar = git(['-C', repoRoot, 'archive', '--format=tar', mb, '--', inProj(scanPart), ...tsconfigs, ...sheriffFiles], { encoding: 'buffer' });
    let baseData = { files: [], routes: [], areas: {}, violations: [] };
    if (tar && tar.length) {
      execFileSync('tar', ['-x', '-C', tmp], { input: tar, stdio: ['pipe', 'ignore', 'ignore'] });
      const cwdTmp = path.join(tmp, projRel);
      fs.mkdirSync(cwdTmp, { recursive: true });
      const cfgCopy = path.join(cwdTmp, path.basename(configPath));
      if (cfgText) fs.writeFileSync(cfgCopy, cfgText);
      // Sheriff and TypeScript come from the project's node_modules
      if (SHERIFF.active && fs.existsSync(path.resolve('node_modules')) && !fs.existsSync(path.join(cwdTmp, 'node_modules'))) {
        try { fs.symlinkSync(path.resolve('node_modules'), path.join(cwdTmp, 'node_modules'), 'junction'); } catch { /* without it Sheriff is skipped in the base map */ }
      }
      const outFile = path.join(tmp, 'base-map.json');
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--json-stdout', '--json-out', outFile, '--config', cfgCopy, '--framework', FRAMEWORK],
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
      try { base = baseFromMergeBase(mb); r.source = 'merge-base'; } catch (e) { if (process.env.FLOORPLAN_DEBUG) console.error('base map failed:', e.message); base = null; }
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
  r.baseCounts = {};
  for (const v of base.violations) r.baseCounts[v.rule] = (r.baseCounts[v.rule] || 0) + 1;
  for (const k of ['added', 'deleted', 'modified']) r[k] = [...new Set(r[k])].sort();
  affected(r);
  return r;
}

// Who depends on the changed files, and the command that runs just the related tests
function affected(r) {
  const changed = [...new Set([...r.added, ...r.modified, ...r.moved.map((m) => m.to)])].filter((p) => fileByPath.has(p));
  const changedSet = new Set(changed);
  const importedByMap = new Map();
  for (const f of files) for (const t of f.imports) { if (!importedByMap.has(t)) importedByMap.set(t, new Set()); importedByMap.get(t).add(f.path); }
  const dependents = new Map(); // dependent -> changed files it uses
  for (const c of changed) for (const d of importedByMap.get(c) || []) if (!changedSet.has(d)) { if (!dependents.has(d)) dependents.set(d, []); dependents.get(d).push(c); }
  r.dependents = [...dependents].sort((a, b) => a[0].localeCompare(b[0])).map(([file, uses]) => ({ file, uses }));
  const related = [...changed, ...dependents.keys()];
  const rootRel = posix(path.relative(process.cwd(), ROOT)) || '.';
  if (!related.length) { r.testCommand = null; return; }
  if (SPRING) {
    const tests = [];
    for (const p of related) {
      const abs = path.join(ROOT, p);
      const testDir = path.dirname(abs).replace(`${path.sep}src${path.sep}main${path.sep}`, `${path.sep}src${path.sep}test${path.sep}`);
      for (const suf of ['Test', 'Tests', 'IT']) if (fs.existsSync(path.join(testDir, path.basename(p, '.java') + suf + '.java'))) tests.push(path.basename(p, '.java') + suf);
    }
    r.relatedTests = [...new Set(tests)].sort();
    const gradle = ['build.gradle', 'build.gradle.kts'].some((f) => fs.existsSync(f));
    r.testCommand = !r.relatedTests.length ? null : gradle ? `./gradlew test ${r.relatedTests.map((t) => `--tests '*.${t}'`).join(' ')}`
      : `mvn test -Dtest=${r.relatedTests.join(',')} -Dsurefire.failIfNoSpecifiedTests=false`;
  } else {
    let deps = {};
    try { const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); deps = { ...pkg.dependencies, ...pkg.devDependencies }; } catch { /* none */ }
    const paths = related.map((p) => `${rootRel}/${p}`.replace(/^\.\//, ''));
    if (deps.vitest) r.testCommand = `npx vitest run --related ${paths.join(' ')}`;
    else if (deps.jest || deps['jest-preset-angular']) r.testCommand = `npx jest --findRelatedTests ${paths.join(' ')}`;
    else {
      const specs = paths.map((p) => p.replace(/\.ts$/, '.spec.ts')).filter((p) => fs.existsSync(p));
      r.testCommand = specs.length ? `npx ng test --watch=false ${specs.map((x) => `--include ${x}`).join(' ')}` : null;
    }
  }
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
  const L = ['# Branch changes', '', '> Generated by `scripts/floorplan/generate-map.mjs`. Local only, never committed.', ''];
  if (!r.available) { L.push(`No comparison with main available. ${r.note || ''}`); return L.join('\n') + '\n'; }
  const against = r.source === 'merge-base'
    ? `\`${r.base}\` at the branch point \`${r.mergeBase}\`${r.ahead ? ` (${r.base} has ${r.ahead} newer commit${r.ahead === 1 ? '' : 's'}; merge or rebase to get them)` : ''}`
    : `the committed main map (${config.output.json})`;
  L.push(`Branch \`${r.branch || 'HEAD'}\` compared with ${against}. Includes uncommitted changes.`, '');
  L.push(`Summary: ${r.added.length} added · ${r.moved.length} moved · ${r.deleted.length} deleted · ${r.modified.length} modified · rule issues: ${r.newIssues.length} new, ${r.fixedIssues.length} fixed, ${r.existingIssues} existing`, '');
  const list = (title, items, fmtItem = (x) => `- ${x}`, max = 40) => {
    if (!items.length) return;
    L.push(`## ${title} (${items.length})`, '', ...items.slice(0, max).map(fmtItem));
    if (items.length > max) L.push(`- …and ${items.length - max} more`);
    L.push('');
  };
  list('New rule issues (errors fail map:check)', r.newIssues, (v) => `- ${v.severity === 'error' ? '✗' : '!'} \`${v.file}${v.line ? `:${v.line}` : ''}\` ${vText(v)} — ${v.rule} (${fromText(v)})${v.howToFix ? `\n  Fix: ${v.howToFix}` : ''}`);
  list('Fixed rule issues', r.fixedIssues, (v) => `- ✓ \`${v.file}\` ${vText(v)} — ${v.rule}`);
  list('Added files', r.added);
  list('Moved', groupMoves(r.moved));
  list('Deleted files', r.deleted);
  list('Modified files', r.modified);
  list('New folders', r.foldersAdded);
  list('Removed folders', r.foldersRemoved);
  list('New dependencies between areas', r.areaAdded);
  list('Removed dependencies between areas', r.areaRemoved);
  list('Files that use the changed files (check them)', r.dependents || [], (d) => `- ${d.file} (uses ${d.uses.slice(0, 3).join(', ')}${d.uses.length > 3 ? ', …' : ''})`);
  if (r.testCommand) L.push('## Related tests', '', 'Run the tests of the changed files and the files that use them:', '', '```', r.testCommand, '```', '');
  if (!r.added.length && !r.moved.length && !r.deleted.length && !r.modified.length && !r.newIssues.length && !r.fixedIssues.length) L.push('No changes compared with main.', '');
  return L.join('\n');
}
if (HOOK) {
  const me = rel(path.resolve(HOOK_FILE));
  const mine = (report.available ? report.newIssues : violations).filter((v) => v.file === me);
  if (!mine.length) process.exit(0);
  const lines = [`floorplan: ${me} breaks ${mine.length === 1 ? 'a project rule' : `${mine.length} project rules`}${report.available ? ' (new on this branch)' : ''}:`];
  for (const v of mine) {
    lines.push(`- ${where(v)}: ${vText(v)} (${v.rule}${v.severity === 'warn' ? ', warning' : ''}; ${fromText(v)})${v.message ? `: ${v.message}` : ''}${v.why ? ` Why: ${v.why}` : ''}`);
    if (v.howToFix) lines.push(`  How to fix: ${v.howToFix}`);
  }
  lines.push(mine.some((v) => v.severity !== 'warn')
    ? 'Fix this now (move the file with move-cli.mjs or change the code) unless the user asked for it this way; the rule check fails otherwise.'
    : mine.some((v) => v.rule.startsWith('claude-md:'))
      ? 'These come from the project\'s CLAUDE.md, so the team expects them: fix them now unless the user asked for this, and mention any you leave.'
      : 'Warnings only: fix them if it is easy, otherwise mention them in your summary.');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: lines.join('\n') } }) + '\n');
  process.exit(0);
}
fs.writeFileSync(path.join(LOCAL, 'BRANCH_CHANGES.md'), branchMarkdown(report));
fs.writeFileSync(path.join(LOCAL, 'branch.json'), JSON.stringify(report, null, 2) + '\n');

// ---------- outputs per mode ----------
if (SESSION) {
  // Short, factual context for Claude at session start (stdout of a SessionStart hook is added to the context).
  const r = report;
  const out = ['Floorplan: branch report generated at session start.'];
  if (!r.available) out.push(`No comparison with ${config.baseBranch} available. ${r.note || ''}`.trim());
  else {
    out.push(`Branch ${r.branch} compared with ${r.source === 'merge-base' ? `${r.base} at branch point ${r.mergeBase}` : 'the committed main map'}${r.ahead ? `; ${r.base} has ${r.ahead} newer commit(s) not merged into this branch` : ''}.`);
    out.push(`Changes on this branch: ${r.added.length} files added, ${r.moved.length} moved, ${r.deleted.length} deleted, ${r.modified.length} modified.`);
    const g = groupMoves(r.moved);
    if (g.length) out.push('Moved: ' + g.slice(0, 8).join('; ') + (g.length > 8 ? '; ...' : ''));
    if (r.added.length) out.push('Added: ' + r.added.slice(0, 12).join(', ') + (r.added.length > 12 ? ', ...' : ''));
    out.push(`Rule issues introduced by this branch: ${r.newIssues.length}; fixed: ${r.fixedIssues.length}; existing on main: ${r.existingIssues}.`);
    for (const v of r.newIssues.slice(0, 10)) out.push(`- ${where(v)} ${vText(v)} (${v.rule}, ${fromText(v)})`);
    if (r.dependents?.length) out.push(`${r.dependents.length} unchanged file(s) use the changed files (list in BRANCH_CHANGES.md).`);
    if (r.testCommand && r.testCommand.length < 600) out.push(`Related tests: ${r.testCommand}`);
  }
  if (claudeRulesNote) out.push(claudeRulesNote);
  const loc = config.output.local || '.floorplan';
  out.push(`Main structure: ${config.output.markdown}. Branch details: ${loc}/BRANCH_CHANGES.md. Current working-tree map: ${loc}/FLOORPLAN.md.`);
  process.stdout.write(out.join('\n').slice(0, 3500) + '\n');
  process.exit(0);
}

// Pull-request comment: what this branch changes in the structure (CI posts it; see templates/ci)
function prComment(r, failing) {
  const L = ['<!-- floorplan -->', '### Floorplan: structure changes in this branch', ''];
  if (!r.available) { L.push(`No comparison with ${config.baseBranch} available (${r.note || 'no main map'}).`); return L.join('\n') + '\n'; }
  const bits = [`${r.added.length} added`, `${r.moved.length} moved`, `${r.deleted.length} deleted`, `${r.modified.length} modified`];
  L.push(`${bits.join(' · ')} · rule issues: **${r.newIssues.length} new**, ${r.fixedIssues.length} fixed, ${r.existingIssues} existing on ${config.baseBranch}`, '');
  const list = (title, items, max = 15) => {
    if (!items.length) return;
    L.push(`**${title}**`, '', ...items.slice(0, max));
    if (items.length > max) L.push(`- …and ${items.length - max} more`);
    L.push('');
  };
  list(failing ? 'New rule issues (the check fails)' : 'New rule issues', r.newIssues.map((v) => `- ${v.severity === 'error' ? '❌' : '⚠️'} \`${where(v)}\` ${vText(v)} (${v.rule}, ${fromText(v)})${v.howToFix ? `<br>**Fix:** ${v.howToFix}` : ''}`));
  list('Fixed rule issues', r.fixedIssues.map((v) => `- ✅ \`${v.file}\` ${vText(v)} (${v.rule})`));
  list('Moved', groupMoves(r.moved).map((x) => `- ${x}`));
  list('New folders', r.foldersAdded.map((x) => `- \`${x}/\``));
  list('New dependencies between areas', r.areaAdded.map((x) => `- ${x}`));
  list('Removed dependencies between areas', r.areaRemoved.map((x) => `- ${x}`));
  if (!r.moved.length && !r.foldersAdded.length && !r.areaAdded.length && !r.areaRemoved.length && !r.newIssues.length && !r.fixedIssues.length) L.push('No structural changes: no moves, no new folders or dependencies between areas, no rule changes.', '');
  L.push(`<sub>floorplan ${TOOL_VERSION} · compared with ${r.source === 'merge-base' ? `${r.base} at ${r.mergeBase}` : 'the committed main map'}</sub>`);
  return L.join('\n') + '\n';
}

if (CHECK) {
  const strict = args.includes('--strict');
  const r = report;
  if (argVal('--pr-comment')) {
    const failingNow = (strict || !r.available ? violations : r.newIssues || []).filter((v) => v.severity === 'error' && config.budget?.[v.rule] === undefined).length > 0;
    fs.writeFileSync(argVal('--pr-comment'), prComment(r, failingNow));
  }
  // budgets: { rule: n } allow up to n issues of a rule; the allowance only goes down (count on main, if lower)
  const budgets = config.budget || {};
  const countNow = {};
  for (const v of violations) countNow[v.rule] = (countNow[v.rule] || 0) + 1;
  const overBudget = [], budgetNotes = [];
  for (const [rule, b] of Object.entries(budgets)) {
    const onMain = r.available && r.baseCounts ? r.baseCounts[rule] ?? 0 : Infinity;
    const allowed = Math.min(b, onMain);
    const n = countNow[rule] || 0;
    if (n > allowed) overBudget.push(`${rule}: ${n} issues, allowed ${allowed}${allowed < b ? ` (main has ${onMain}; the budget only goes down)` : ''}`);
    else if (n < b) budgetNotes.push(`${rule}: ${n} issues, budget ${b}. Lower the budget in floorplan.config.mjs to ${n}.`);
  }
  const failing = (strict || !r.available ? violations : r.newIssues)
    .filter((v) => v.severity === 'error' && budgets[v.rule] === undefined);
  const against = r.available ? (r.source === 'merge-base' ? `${r.base} (branch point ${r.mergeBase})` : config.output.json) : 'nothing (no main map found)';
  console.log(`Rule check against ${against}${strict ? ', strict' : ''}: ${files.length} files.`);
  if (!r.available) console.log(`  Note: ${r.note || 'no base map'}. All rule issues count. In CI, check out with full history (fetch-depth: 0).`);
  for (const v of r.newIssues || []) console.log(`  ${v.severity === 'error' ? '✗' : '!'} new: ${fmt(v).trimStart().replace(/^[✗!] /, '').replace(/\n    /g, '\n      ')}`);
  for (const v of r.fixedIssues || []) console.log(`  ✓ fixed: ${v.file} ${vText(v)} (${v.rule})`);
  if (r.available && r.existingIssues && !strict) console.log(`  · ${r.existingIssues} existing issue(s) on main, not blocking.`);
  if (strict) for (const v of failing) console.log(fmt(v));
  for (const b of budgetNotes) console.log(`  ↓ budget ${b}`);
  for (const b of overBudget) console.log(`  ✗ over budget: ${b}`);
  if (failing.length || overBudget.length) {
    if (failing.length) console.error(`✗ ${failing.length} ${strict ? '' : 'new '}rule issue${failing.length === 1 ? '' : 's'}${strict ? '' : ' introduced by this branch'}.`);
    if (overBudget.length) console.error(`✗ ${overBudget.length} rule${overBudget.length === 1 ? '' : 's'} over budget.`);
    process.exit(1);
  }
  console.log(`✓ No new rule issues.${r.fixedIssues?.length ? ` ${r.fixedIssues.length} fixed. 👍` : ''}`);
  process.exit(0);
}

// MODE === 'local'
if (!QUIET) {
  console.log(`✓ Local map: ${path.relative(process.cwd(), LOCAL)}/FLOORPLAN.md  (${files.length} files · ${routes.length} ${SPRING ? 'endpoints' : 'routes'} · ${violations.length} rule issues)`);
  if (claudeRulesNote) console.log(`! ${claudeRulesNote}`);
  if (report.available) {
    console.log(`✓ Branch report: ${path.relative(process.cwd(), LOCAL)}/BRANCH_CHANGES.md  (${report.branch} vs ${report.source === 'merge-base' ? report.base : 'main map'})`);
    console.log(`  ${report.added.length} added · ${report.moved.length} moved · ${report.deleted.length} deleted · ${report.modified.length} modified · issues: ${report.newIssues.length} new, ${report.fixedIssues.length} fixed, ${report.existingIssues} existing`);
    for (const line of grouped(report.newIssues)) console.log(line);
  } else console.log(`  No branch comparison: ${report.note || 'no main map yet'}. The main map is created with: ${SPRING ? 'node scripts/floorplan/generate-map.mjs --main' : 'npm run map:main'}`);
}
