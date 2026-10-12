#!/usr/bin/env node
// Analyze moving methods from one Angular service to another (or to a new service). Changes nothing.
//
//   node scripts/project-map/analyze-cli.mjs --list
//   node scripts/project-map/analyze-cli.mjs --source <service.ts> --methods a,b --target-file <other.service.ts>
//   node scripts/project-map/analyze-cli.mjs --source <service.ts> --methods a,b --target-folder <folder> --class NewNameService
//   add --json for the full plan (callers, helpers, decisions, dependency direction)
// Paths are relative to the app root (config "root", usually src/app).
import { makeContext } from './lib.mjs';
import { listServices, analyzeMethodMove } from './analyze.mjs';

const args = process.argv.slice(2);
const val = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const ctx = await makeContext();

if (args.includes('--list')) {
  for (const [file, s] of Object.entries(listServices(ctx))) {
    console.log(`${s.className}  (${file})`);
    for (const m of s.methods) console.log(`  ${m.visibility === 'public' ? ' ' : '-'} ${m.name}()  ${m.lines} lines`);
  }
  process.exit(0);
}
const source = val('--source'), methods = (val('--methods') || '').split(',').map((s) => s.trim()).filter(Boolean);
const target = val('--target-file') ? { file: val('--target-file') } : { folder: val('--target-folder'), className: val('--class') };
if (!source || !methods.length || (!target.file && target.folder === undefined)) {
  console.error('Usage: analyze-cli.mjs --source <service.ts> --methods a,b (--target-file <x.service.ts> | --target-folder <folder> --class NameService) [--json]');
  process.exit(2);
}
const r = analyzeMethodMove(ctx, { source, methods, target });
if (r.errors) { console.error('✗ ' + r.errors.join('\n✗ ')); process.exit(1); }
if (args.includes('--json')) console.log(JSON.stringify(r.plan, null, 2));
else console.log(r.plan.claudeTask);
process.exit(r.plan.summary.blockers ? 3 : 0); // 3 = there are blockers to decide first
