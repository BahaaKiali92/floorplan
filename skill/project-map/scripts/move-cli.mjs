#!/usr/bin/env node
// Move a file (with its .html/.scss/.spec companions) or a folder, and rewrite every import.
// Same engine as the bubble graph. Paths are relative to the app root (config "root", usually src/app).
//
//   node scripts/project-map/move-cli.mjs <source> <target-folder>            # dry run: prints the plan
//   node scripts/project-map/move-cli.mjs <source> <target-folder> --apply    # moves files, rewrites imports, regenerates the map
//   add --json for machine-readable output
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeContext } from './lib.mjs';
import { planMove, applyPlan, summarize } from './move.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [source, target] = args.filter((a) => !a.startsWith('--'));
if (!source || target === undefined) {
  console.error('Usage: move-cli.mjs <source> <target-folder> [--apply] [--json]   (paths relative to the app root; "." = app root)');
  process.exit(2);
}
const ctx = await makeContext();
const r = planMove(ctx, source, target === '.' ? '' : target);
if (r.errors) { console.error('✗ ' + r.errors.join('\n✗ ')); process.exit(1); }
const summary = flags.has('--apply') ? applyPlan(ctx, r.plan) : summarize(ctx, r.plan);
if (flags.has('--apply')) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  execFileSync(process.execPath, [path.join(here, 'generate-map.mjs')], { stdio: 'inherit' });
}
if (flags.has('--json')) { console.log(JSON.stringify(summary, null, 2)); process.exit(0); }
console.log(`${flags.has('--apply') ? 'Moved' : 'Would move'} ${summary.moves.length} file(s):`);
for (const m of summary.moves) console.log(`  ${m.from}\n    → ${m.to}`);
console.log(`${flags.has('--apply') ? 'Rewrote' : 'Would rewrite'} ${summary.importCount} import(s):`);
for (const e of summary.edits) for (const c of e.changes) console.log(`  ${e.file}: ${c.from} → ${c.to}`);
for (const w of summary.warnings) console.log(`! ${w}`);
if (!flags.has('--apply')) console.log('\nDry run. Add --apply to make the change.');
