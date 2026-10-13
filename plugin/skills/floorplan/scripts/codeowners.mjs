#!/usr/bin/env node
// CODEOWNERS from the `owner` values in floorplan.config.mjs (folders: { 'features/orders': { owner: '@acme/orders' } }).
//   node scripts/floorplan/codeowners.mjs            preview (prints the section, changes nothing)
//   node scripts/floorplan/codeowners.mjs --write    writes/updates the marked section in CODEOWNERS
//   options: --file <path> (default: .github/CODEOWNERS, or an existing CODEOWNERS / docs/CODEOWNERS), --config <file>
// Only the section between the floorplan markers is touched; hand-written lines stay. Later lines win in CODEOWNERS,
// so the section goes at the end and more specific folders come after general ones.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, toPosix, defaultConfigPath } from './lib.mjs';

const args = process.argv.slice(2);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const config = await loadConfig(val('--config') || defaultConfigPath());
const root = toPosix(path.relative(process.cwd(), path.resolve(config.root))).replace(/^\.$/, '');
const BEGIN = '# >>> floorplan (generated from floorplan.config.mjs; edit owners there) >>>';
const END = '# <<< floorplan <<<';

const entries = Object.entries(config.folders || {}).filter(([, a]) => a && a.owner);
if (!entries.length) { console.log('No folder in floorplan.config.mjs has an owner. Add e.g. folders: { \'features/orders\': { owner: \'@acme/orders\' } }.'); process.exit(0); }
const valid = (o) => /^@[\w.-]+(\/[\w.-]+)?$/.test(o) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o);
const lines = [], warnings = [];
// general folders first, specific ones after (later lines win)
entries.sort((a, b) => a[0].split('/').length - b[0].split('/').length || a[0].localeCompare(b[0]));
for (const [folder, a] of entries) {
  const owners = (Array.isArray(a.owner) ? a.owner : String(a.owner).split(/[\s,]+/)).filter(Boolean);
  const bad = owners.filter((o) => !valid(o));
  if (bad.length) warnings.push(`${folder}: "${bad.join(', ')}" is not a GitHub/GitLab @user, @org/team or e-mail; written as a comment`);
  const pattern = `/${root ? root + '/' : ''}${folder}/`.replace(/\/\*\*\//g, '/**/');
  if (owners.every((o) => !valid(o))) lines.push(`# ${pattern} ${owners.join(' ')}`);
  else lines.push(`${pattern} ${owners.filter(valid).join(' ')}`);
}
const section = [BEGIN, ...lines, END].join('\n');
const file = val('--file') || ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'].find((f) => fs.existsSync(f)) || '.github/CODEOWNERS';
for (const w of warnings) console.warn(`! ${w}`);
if (!args.includes('--write')) {
  console.log(`Preview for ${file} (run with --write to save):\n\n${section}`);
  process.exit(0);
}
const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const eol = old.includes('\r\n') ? '\r\n' : '\n';
const rx = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const body = section.split('\n').join(eol);
const next = rx.test(old) ? old.replace(rx, body) : `${old}${old && !old.endsWith('\n') ? eol : ''}${old ? eol : ''}${body}${eol}`;
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
fs.writeFileSync(file, next);
console.log(`✓ ${file}: ${lines.length} folder owner line(s)`);
