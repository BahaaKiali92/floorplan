#!/usr/bin/env node
// With vs without the project map: runs the same tasks with headless Claude Code (`claude -p`) in two clean copies of
// your repository and compares the results. Zero dependencies (Node 18+), needs git and the Claude Code CLI.
//
//   node experiments/run.mjs --repo <path-to-your-repo> --tasks experiments/tasks.example.json [options]
//
// The repository must already have project-map set up and committed (scripts/project-map, project-map.config.mjs,
// the main map, the CLAUDE.md section). The "without" copy removes all of that; the "with" copy keeps it.
// Nothing is committed and your working copy is not touched: every run happens in a temporary git worktree.
//
// Options:
//   --runs <n>          runs per task and condition (default 1; use 3 for numbers you want to quote)
//   --ref <commit>      start from this commit (default HEAD)
//   --verify "<cmd>"    a command run after each task, e.g. "npx tsc --noEmit -p tsconfig.app.json"
//                       (node_modules of the repo is linked into each copy)
//   --max-turns <n>     per run (default 40)
//   --model <name>      passed to claude
//   --only with|without run one condition only
//   --out <dir>         results folder (default experiments/results/<date-time>)
//   --keep              keep the worktrees for inspection
//   --dry-run           don't call Claude (checks the setup and the evaluation)
//
// Output: <out>/results.json and <out>/results.md (table per task: turns, cost, time, new rule issues, files created,
// verify result), plus each run's diff.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const repo = path.resolve(val('--repo', '.'));
const tasksFile = val('--tasks');
const runs = Number(val('--runs', 1));
const ref = val('--ref', 'HEAD');
const verify = val('--verify');
const maxTurns = val('--max-turns', '40');
const model = val('--model');
const only = val('--only');
const keep = args.includes('--keep');
const dry = args.includes('--dry-run');
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const out = path.resolve(val('--out', path.join('experiments', 'results', stamp)));
if (!tasksFile) { console.error('Usage: node experiments/run.mjs --repo <repo> --tasks <tasks.json> [--runs 3] [--verify "<cmd>"]'); process.exit(2); }
const tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
const git = (cwd, a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ---------- checks ----------
const base = git(repo, ['rev-parse', ref]);
if (!fs.existsSync(path.join(repo, 'scripts/project-map/generate-map.mjs'))) {
  console.error('✗ scripts/project-map/ not found in the repository. Set up project-map and commit it first.'); process.exit(1);
}
if (!dry) { try { execFileSync('claude', ['--version'], { stdio: 'ignore' }); } catch { console.error('✗ The Claude Code CLI (claude) is not on PATH.'); process.exit(1); } }
fs.mkdirSync(out, { recursive: true });
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-experiment-'));
const toolsCopy = path.join(tmpRoot, '_tools');
fs.cpSync(path.join(repo, 'scripts/project-map'), toolsCopy, { recursive: true });
const configText = fs.existsSync(path.join(repo, 'project-map.config.mjs')) ? fs.readFileSync(path.join(repo, 'project-map.config.mjs'), 'utf8') : '';

// ---------- conditions ----------
function stripProjectMap(dir) {
  // the "without" copy: no tools, no config, no maps, no CLAUDE.md section, no hooks
  const cfg = path.join(dir, 'project-map.config.mjs');
  let outputs = ['docs/PROJECT_MAP.md', 'docs/project-map.json', 'docs/project-map-areas'];
  try { outputs = execFileSync(process.execPath, [path.join(dir, 'scripts/project-map/generate-map.mjs'), '--outputs'], { cwd: dir, encoding: 'utf8' }).trim().split(' '); } catch { /* defaults */ }
  for (const p of ['scripts/project-map', 'project-map.config.mjs', '.project-map', ...outputs]) fs.rmSync(path.join(dir, p), { recursive: true, force: true });
  void cfg;
  const cm = path.join(dir, 'CLAUDE.md');
  if (fs.existsSync(cm)) {
    let t = fs.readFileSync(cm, 'utf8');
    t = t.replace(/<!-- project-map:start[\s\S]*?<!-- project-map:end -->\r?\n?/, '').replace(/(^|\n)## Project structure\n[\s\S]*?(?=\n## |\n# |$)/, '$1');
    if (t.trim()) fs.writeFileSync(cm, t); else fs.rmSync(cm);
  }
  const st = path.join(dir, '.claude/settings.json');
  if (fs.existsSync(st)) {
    const s = JSON.parse(fs.readFileSync(st, 'utf8'));
    for (const ev of Object.keys(s.hooks || {})) {
      s.hooks[ev] = s.hooks[ev].map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !(h.command || '').includes('project-map')) })).filter((g) => g.hooks.length);
      if (!s.hooks[ev].length) delete s.hooks[ev];
    }
    fs.writeFileSync(st, JSON.stringify(s, null, 2) + '\n');
  }
  // commit the stripped state locally so the evaluation compares only Claude's changes
  git(dir, ['add', '-A']);
  try { git(dir, ['-c', 'user.name=experiment', '-c', 'user.email=experiment@example.com', 'commit', '-qm', 'experiment: without project-map']); } catch { /* nothing to strip */ }
}

function prepare(cond, taskId, run) {
  const dir = path.join(tmpRoot, `${cond}-${taskId}-${run}`);
  git(repo, ['worktree', 'add', '--detach', '-q', dir, base]);
  const nm = path.join(repo, 'node_modules');
  if (fs.existsSync(nm)) try { fs.symlinkSync(nm, path.join(dir, 'node_modules'), 'junction'); } catch { /* verify may fail without it */ }
  if (cond === 'without') stripProjectMap(dir);
  return dir;
}

// ---------- evaluation ----------
function evaluate(dir, cond) {
  // same tools and rules for both conditions, comparing with the starting commit
  if (cond === 'without') {
    fs.cpSync(toolsCopy, path.join(dir, '.pm-eval-tools'), { recursive: true });
    if (configText) fs.writeFileSync(path.join(dir, '.pm-eval-config.mjs'), configText);
  }
  const tool = cond === 'without' ? path.join(dir, '.pm-eval-tools', 'generate-map.mjs') : path.join(dir, 'scripts/project-map/generate-map.mjs');
  const cfg = cond === 'without' ? ['--config', path.join(dir, '.pm-eval-config.mjs')] : [];
  // committed starting point = the "main" the check compares with
  const head = git(dir, ['rev-parse', 'HEAD']);
  const r = spawnSync(process.execPath, [tool, '--check', '--base', head, ...cfg], { cwd: dir, encoding: 'utf8', env: { ...process.env, PROJECT_MAP_NO_CACHE: '1' } });
  const outText = (r.stdout || '') + (r.stderr || '');
  // the check also writes the branch report: errors and warnings separately
  let newIssues = [], warnings = [], fixed = [];
  try {
    const b = JSON.parse(fs.readFileSync(path.join(dir, '.project-map', 'branch.json'), 'utf8'));
    const fmt = (v) => `${v.file} ${v.detail} (${v.rule})`;
    newIssues = b.newIssues.filter((v) => v.severity !== 'warn').map(fmt);
    warnings = b.newIssues.filter((v) => v.severity === 'warn').map(fmt);
    fixed = b.fixedIssues.map(fmt);
  } catch {
    newIssues = [...outText.matchAll(/✗ new: (.+)/g)].map((m) => m[1].trim());
    fixed = [...outText.matchAll(/✓ fixed: (.+)/g)].map((m) => m[1].trim());
  }
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((l) => !/\.pm-eval|\.project-map\/|node_modules/.test(l));
  const created = status.filter((l) => l.startsWith('??') || l.startsWith('A ')).map((l) => l.slice(3));
  const changed = status.filter((l) => !l.startsWith('??') && !l.startsWith('A ')).map((l) => l.slice(3));
  let verifyOk = null, verifyOut = '';
  if (verify) {
    const v = spawnSync(verify, { cwd: dir, shell: true, encoding: 'utf8' });
    verifyOk = v.status === 0; verifyOut = ((v.stdout || '') + (v.stderr || '')).slice(-2000);
  }
  const diff = spawnSync('git', ['diff', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout || '';
  return { newIssues, warnings, fixed, created, changed, verifyOk, verifyOut, diff };
}

// ---------- run ----------
const PROMPT_SUFFIX = "\n\nWork directly in this repository. Don't ask questions; make reasonable choices yourself. Don't commit.";
const results = [];
const conditions = only ? [only] : ['without', 'with'];
for (const task of tasks) {
  for (let run = 1; run <= runs; run++) {
    for (const cond of conditions) {
      const dir = prepare(cond, task.id, run);
      process.stdout.write(`${task.id} · run ${run} · ${cond} … `);
      let meta = { num_turns: 0, total_cost_usd: 0, duration_ms: 0, is_error: false };
      if (!dry) {
        const cargs = ['-p', task.prompt + PROMPT_SUFFIX, '--output-format', 'json', '--max-turns', maxTurns,
          '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash,Read,Edit,Write,Glob,Grep'];
        if (model) cargs.push('--model', model);
        const r = spawnSync('claude', cargs, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 30 * 60 * 1000 });
        try { meta = JSON.parse(r.stdout); } catch { meta = { ...meta, is_error: true, result: (r.stdout || r.stderr || '').slice(0, 500) }; }
      }
      const ev = evaluate(dir, cond);
      const id = `${task.id}-${run}-${cond}`;
      fs.writeFileSync(path.join(out, `${id}.diff`), ev.diff);
      results.push({ task: task.id, run, cond, turns: meta.num_turns, cost: meta.total_cost_usd, ms: meta.duration_ms, error: !!meta.is_error,
        newIssues: ev.newIssues, warnings: ev.warnings, fixed: ev.fixed, created: ev.created, changed: ev.changed, verifyOk: ev.verifyOk, summary: (meta.result || '').slice(0, 600) });
      console.log(`${meta.num_turns} turns · $${(meta.total_cost_usd || 0).toFixed(2)} · ${ev.newIssues.length} new issues (+${ev.warnings.length} warnings) · ${ev.created.length} files created${verify ? ` · verify ${ev.verifyOk ? 'ok' : 'FAILED'}` : ''}`);
      if (!keep) { try { git(repo, ['worktree', 'remove', '--force', dir]); } catch { fs.rmSync(dir, { recursive: true, force: true }); } }
    }
  }
}
if (!keep) { fs.rmSync(tmpRoot, { recursive: true, force: true }); try { git(repo, ['worktree', 'prune']); } catch { /* ok */ } }

// ---------- report ----------
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ repo, base, runs, verify, results }, null, 2));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const L = [`# With vs without the project map`, '', `Repository: \`${path.basename(repo)}\` at \`${base.slice(0, 8)}\` · ${runs} run(s) per task and condition${verify ? ` · verify: \`${verify}\`` : ''}${dry ? ' · DRY RUN' : ''}`, ''];
L.push('| Task | Condition | Turns | Cost | Time | New rule issues | New warnings | Fixed | Files created | Verify |', '|---|---|---|---|---|---|---|---|---|---|');
for (const task of tasks) for (const cond of conditions) {
  const rs = results.filter((r) => r.task === task.id && r.cond === cond);
  L.push(`| ${task.id} | ${cond} | ${avg(rs.map((r) => r.turns)).toFixed(1)} | $${avg(rs.map((r) => r.cost || 0)).toFixed(2)} | ${(avg(rs.map((r) => r.ms || 0)) / 1000).toFixed(0)} s | ${avg(rs.map((r) => r.newIssues.length)).toFixed(1)} | ${avg(rs.map((r) => r.warnings.length)).toFixed(1)} | ${avg(rs.map((r) => r.fixed.length)).toFixed(1)} | ${avg(rs.map((r) => r.created.length)).toFixed(1)} | ${verify ? `${rs.filter((r) => r.verifyOk).length}/${rs.length}` : '-'} |`);
}
L.push('', '## Totals', '', '| Condition | Turns | Cost | New rule issues | Verify ok |', '|---|---|---|---|---|');
for (const cond of conditions) {
  const rs = results.filter((r) => r.cond === cond);
  L.push(`| ${cond} | ${rs.reduce((a, r) => a + r.turns, 0)} | $${rs.reduce((a, r) => a + (r.cost || 0), 0).toFixed(2)} | ${rs.reduce((a, r) => a + r.newIssues.length, 0)} | ${verify ? `${rs.filter((r) => r.verifyOk).length}/${rs.length}` : '-'} |`);
}
L.push('', '## Files created and new issues per run', '');
for (const r of results) {
  L.push(`### ${r.task} · run ${r.run} · ${r.cond}`, '', `Created: ${r.created.map((f) => `\`${f}\``).join(', ') || '(none)'}`, `Changed: ${r.changed.map((f) => `\`${f}\``).join(', ') || '(none)'}`);
  if (r.newIssues.length) L.push('New rule issues:', ...r.newIssues.map((x) => `- ${x}`));
  if (r.warnings.length) L.push('New warnings:', ...r.warnings.map((x) => `- ${x}`));
  if (r.fixed.length) L.push('Fixed:', ...r.fixed.map((x) => `- ${x}`));
  L.push('');
}
fs.writeFileSync(path.join(out, 'results.md'), L.join('\n') + '\n');
console.log(`\n✓ ${path.relative(process.cwd(), path.join(out, 'results.md'))}`);
