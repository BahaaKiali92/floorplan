// Shared helpers for the move engine and the map server. Zero dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const toPosix = (p) => p.split(path.sep).join('/');

export function detectFramework(dir = process.cwd()) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has('angular.json')) return 'angular';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if ({ ...pkg.dependencies, ...pkg.devDependencies }['@angular/core']) return 'angular';
  } catch { /* no package.json */ }
  if (['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some(has)) return 'spring';
  return 'angular';
}

// presets: ['spring-layered'] (presets/ next to this file) or a path relative to the config. A preset gives defaults,
// rules and folder purposes; the project's config wins (same rule name replaces the preset's rule; severity 'off' drops it).
export async function applyPresets(user, configPath) {
  const list = Array.isArray(user.presets) ? user.presets : user.presets ? [user.presets] : user.preset ? [user.preset] : [];
  // where each rule comes from, for reports ("from preset spring-layered", "from floorplan.config.mjs")
  const own = { ...user, rules: (user.rules || []).map((r) => ({ _origin: path.basename(configPath), ...r })) };
  if (!list.length) return own;
  const parts = [];
  for (const name of list) {
    const file = name.includes('/') || name.endsWith('.mjs') ? path.resolve(path.dirname(path.resolve(configPath)), name)
      : fileURLToPath(new URL(`./presets/${name}.mjs`, import.meta.url));
    if (!fs.existsSync(file)) throw new Error(`Preset not found: ${name} (${file})`);
    const p = (await import(pathToFileURL(file).href)).default;
    parts.push({ ...p, rules: (p.rules || []).map((r) => ({ _origin: `preset ${path.basename(name, '.mjs')}`, ...r })) });
  }
  const merged = {};
  for (const c of [...parts, own]) {
    const { rules, folders, ...rest } = c;
    Object.assign(merged, rest);
    merged.folders = { ...(merged.folders || {}), ...(folders || {}) };
    const byName = new Map((merged.rules || []).map((r) => [r.name, r]));
    for (const r of rules || []) byName.set(r.name, r);
    merged.rules = [...byName.values()];
  }
  merged.rules = merged.rules.filter((r) => r.severity !== 'off');
  return merged;
}

// The config file: floorplan.config.mjs, or project-map.config.mjs in repositories set up before the rename (<= 0.9).
export function defaultConfigPath(dir = process.cwd()) {
  for (const f of ['floorplan.config.mjs', 'project-map.config.mjs']) if (fs.existsSync(path.join(dir, f))) return f;
  return 'floorplan.config.mjs';
}

const legacyOutput = (configAbs) => (path.basename(configAbs) === 'project-map.config.mjs'
  ? { markdown: 'docs/PROJECT_MAP.md', json: 'docs/project-map.json', local: '.project-map' }
  : { markdown: 'docs/FLOORPLAN.md', json: 'docs/floorplan.json', local: '.floorplan' });

export async function loadConfig(configPath = defaultConfigPath()) {
  const abs = path.resolve(configPath);
  const user = await applyPresets(fs.existsSync(abs) ? (await import(pathToFileURL(abs).href + `?t=${Date.now()}`)).default : {}, abs);
  const framework = user.framework || detectFramework();
  const config = {
    framework,
    root: framework === 'spring' ? 'src/main/java' : 'src/app',
    tsconfig: 'tsconfig.json',
    folders: {},
    rules: [],
    output: legacyOutput(abs),
    ...user,
  };
  config.framework = framework;
  config.output = { ...legacyOutput(abs), ...(user.output || {}) };
  // Files outside the app root can use app files, so they are scanned too:
  // Angular: main.ts, test setup (the parent of root). Java: the whole project (tests, other modules).
  config.scanRoot = user.scanRoot || (framework === 'spring' ? '.' : path.dirname(config.root));
  return config;
}

// '**' = any depth, '*' = one segment. A folder pattern also matches everything inside it.
export function globToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*'; i++;
      if (pattern[i + 1] === '/') { re = re.slice(0, -2) + '(?:.*/)?'; i++; }
    } else if (c === '*') re += '([^/]+)';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}(?:/.*)?$`);
}

export function folderInfo(config, folder) {
  if (config.folders[folder]) return config.folders[folder];
  for (const [pat, ann] of Object.entries(config.folders)) {
    if (!pat.includes('*')) continue;
    if (globToRegex(pat).test(folder) && folder.split('/').length === pat.split('/').length) return ann;
  }
  return null;
}

function stripJsonComments(text) {
  let out = '', inStr = false, q = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n; i++; } else if (c === q) inStr = false;
    } else if (c === '"' || c === "'") { inStr = true; q = c; out += c; }
    else if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; }
    else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function loadAliases(tsconfigPath) {
  const file = path.resolve(tsconfigPath);
  if (!fs.existsSync(file)) return [];
  const ts = JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8')));
  const co = ts.compilerOptions || {};
  const baseUrl = path.resolve(path.dirname(file), co.baseUrl || '.');
  return Object.entries(co.paths || {})
    .map(([key, targets]) => ({
      key,
      prefix: key.replace(/\*$/, ''),
      wildcard: key.endsWith('*'),
      targets: targets.map((t) => path.resolve(baseUrl, t.replace(/\*$/, ''))),
    }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

export function tryFile(base) {
  for (const cand of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

// Returns { file, kind: 'relative' | 'alias', alias } for project files, null for packages.
export function resolveSpec(fromAbs, spec, aliases) {
  if (spec.startsWith('.')) {
    const f = tryFile(path.resolve(path.dirname(fromAbs), spec));
    return f ? { file: f, kind: 'relative' } : null;
  }
  for (const a of aliases) {
    const hit = a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix;
    if (!hit) continue;
    const rest = a.wildcard ? spec.slice(a.prefix.length) : '';
    for (const t of a.targets) {
      const f = tryFile(path.join(t, rest));
      if (f) return { file: f, kind: 'alias', alias: a };
    }
  }
  return null;
}

export function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, acc);
    else acc.push(abs);
  }
  return acc;
}

// One context object for the server and the command-line tools.
export async function makeContext(configPath = defaultConfigPath()) {
  const config = await loadConfig(configPath);
  return {
    config,
    framework: config.framework,
    repoRoot: process.cwd(),
    appRoot: path.resolve(config.root),
    scanRoot: path.resolve(config.scanRoot),
    aliases: config.framework === 'spring' ? [] : loadAliases(config.tsconfig),
    preferAliases: config.preferAliases !== false,
  };
}
