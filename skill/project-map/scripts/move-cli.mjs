#!/usr/bin/env node
// Move a file (Angular: with its .html/.scss/.spec companions; Java: with its tests) or a folder/package, and rewrite every import.
// Same engine as the bubble graph. Paths are relative to the map root (config "root": Angular usually src/app, Spring the base package folder).
//
//   node scripts/project-map/move-cli.mjs <source> <target-folder>            # dry run: prints the plan
//   node scripts/project-map/move-cli.mjs <source> <target-folder> --apply    # moves files, rewrites imports, regenerates the map
//   node scripts/project-map/move-cli.mjs <file> --fix [--apply]                 # move a misplaced file to the suggested folder
//   --create: the target folder may not exist yet; add --json for machine-readable output
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeContext } from './lib.mjs';
import { planMove, applyPlan, summarize } from './move.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
let [source, target] = args.filter((a) => !a.startsWith('--'));
const ctx = await makeContext();
let create = flags.has('--create');
if (flags.has('--fix')) {
  // --fix <file>: move a misplaced file to the folder the map suggests for it
  const fs = await import('node:fs');
  const local = path.resolve(ctx.config.output.local || '.project-map', 'project-map.json');
  execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'generate-map.mjs'), '--quiet']); // fresh suggestions
  const map = JSON.parse(fs.readFileSync(local, 'utf8'));
  const v = map.violations.find((x) => x.file === source && x.fix);
  if (!v) { console.error(`✗ No suggested fix for ${source}. Run the map first; only placement issues have one.`); process.exit(1); }
  target = v.fix.target; create = create || !!v.fix.create;
  console.log(`Fix for ${v.rule}: move to ${target}/${v.fix.create ? ' (new folder)' : ''}`);
}
if (!source || target === undefined) {
  console.error('Usage: move-cli.mjs <source> <target-folder> [--apply] [--create] [--json]   (paths relative to the app root; "." = app root)\n       move-cli.mjs <file> --fix [--apply]   (move a misplaced file where the map suggests)');
  process.exit(2);
}
const r = planMove(ctx, source, target === '.' ? '' : target, { create });
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
