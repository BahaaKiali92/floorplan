// Shared helpers for the move engine and the map server. Zero dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const toPosix = (p) => p.split(path.sep).join('/');

export async function loadConfig(configPath = 'project-map.config.mjs') {
  const abs = path.resolve(configPath);
  const user = fs.existsSync(abs) ? (await import(pathToFileURL(abs).href + `?t=${Date.now()}`)).default : {};
  const config = {
    root: 'src/app',
    tsconfig: 'tsconfig.json',
    folders: {},
    rules: [],
    output: { markdown: 'docs/PROJECT_MAP.md', json: 'docs/project-map.json', local: '.project-map' },
    ...user,
  };
  config.output = { markdown: 'docs/PROJECT_MAP.md', json: 'docs/project-map.json', local: '.project-map', ...(user.output || {}) };
  // Files outside the app root (main.ts, test setup) can import app files, so they are scanned too.
  config.scanRoot = user.scanRoot || path.dirname(config.root);
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
export async function makeContext(configPath = 'project-map.config.mjs') {
  const config = await loadConfig(configPath);
  return {
    config,
    repoRoot: process.cwd(),
    appRoot: path.resolve(config.root),
    scanRoot: path.resolve(config.scanRoot),
    aliases: loadAliases(config.tsconfig),
    preferAliases: config.preferAliases !== false,
  };
}
