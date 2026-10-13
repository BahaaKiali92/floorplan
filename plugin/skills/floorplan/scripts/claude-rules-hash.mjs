#!/usr/bin/env node
// Fingerprints of CLAUDE.md files for floorplan.claude-rules.json ("sources"), computed exactly like generate-map.mjs
// does when it checks whether CLAUDE.md changed since the rules were derived. Floorplan's own generated section is left
// out, so regenerating it doesn't count as a change.
//   node scripts/floorplan/claude-rules-hash.mjs CLAUDE.md .claude/rules/angular.md
// prints: { "CLAUDE.md": "1a2b3c4d5e6f", ... }
import fs from 'node:fs';
import crypto from 'node:crypto';

export function claudeMdHash(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    .replace(/<!-- (?:floorplan|project-map):start[\s\S]*?<!-- (?:floorplan|project-map):end -->/, '');
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('claude-rules-hash.mjs')) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node scripts/floorplan/claude-rules-hash.mjs <CLAUDE.md> [...]'); process.exit(1); }
  const out = {};
  for (const f of files) { try { out[f] = claudeMdHash(f); } catch (e) { console.error(`${f}: ${e.message}`); process.exit(1); } }
  console.log(JSON.stringify(out, null, 2));
}
