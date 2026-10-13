#!/usr/bin/env node
// Installs the automatic refresh of the local map and branch report.
//
//   node scripts/project-map/install-hooks.mjs            # both
//   node scripts/project-map/install-hooks.mjs --claude   # only the Claude Code SessionStart hook
//   node scripts/project-map/install-hooks.mjs --git      # only the git hooks
//   node scripts/project-map/install-hooks.mjs --remove   # remove both
//
// Claude Code: adds hooks to .claude/settings.json (commit it to share with the team).
//   SessionStart: at every session start (and after /clear or compaction) it refreshes .project-map/ and gives Claude
//   a short summary of what the current branch changed compared with main.
//   PostToolUse (Write/Edit): when Claude writes a file that breaks a structure rule (new compared with main), Claude
//   is told right away, with the fix. Skip it with --no-edit-check.
// Git: post-checkout, post-merge and post-rewrite refresh .project-map/ after switching branches,
//   pulling, merging or rebasing. Local to this clone (git hooks are never committed).
// Running it twice changes nothing. Existing hooks and settings are kept.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const REMOVE = args.includes('--remove');
const doClaude = !args.includes('--git') || args.includes('--claude');
const doGit = !args.includes('--claude') || args.includes('--git');
const MARK_START = '# >>> project-map >>>';
const MARK_END = '# <<< project-map <<<';
const git = (a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const posix = (p) => p.split(path.sep).join('/');

// ---------- Claude Code ----------
if (doClaude) {
  const file = path.resolve('.claude/settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { console.error(`✗ ${file} is not valid JSON; fix it first, then run this again.`); process.exit(1); }
  }
  const projRel = posix(path.relative(git(['rev-parse', '--show-toplevel']) || process.cwd(), process.cwd()));
  const script = `"$CLAUDE_PROJECT_DIR/${projRel ? projRel + '/' : ''}scripts/project-map/generate-map.mjs"`;
  const ours = (h) => (h.command || '').includes('project-map/generate-map.mjs');
  settings.hooks ||= {};
  const strip = (event) => (settings.hooks[event] || []).map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !ours(h)) }))
    .filter((g) => g.hooks.length);
  // SessionStart: branch summary for Claude at every session start
  const start = strip('SessionStart');
  if (!REMOVE) start.push({ hooks: [{ type: 'command', command: `node ${script} --session`, timeout: 60 }] });
  if (start.length) settings.hooks.SessionStart = start; else delete settings.hooks.SessionStart;
  // PostToolUse: after Claude writes or edits a file, tell it right away if that file breaks a structure rule
  const post = strip('PostToolUse');
  if (!REMOVE && !args.includes('--no-edit-check')) post.push({ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: `node ${script} --hook`, timeout: 30 }] });
  if (post.length) settings.hooks.PostToolUse = post; else delete settings.hooks.PostToolUse;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  console.log(REMOVE ? `✓ Removed the SessionStart hook from ${path.relative(process.cwd(), file)}`
    : `✓ Claude Code: SessionStart hook${args.includes('--no-edit-check') ? '' : ' and edit check (PostToolUse)'} in ${path.relative(process.cwd(), file)} (commit it to share with the team)`);
}

// ---------- git hooks ----------
if (doGit) {
  const top = git(['rev-parse', '--show-toplevel']);
  if (!top) { console.log('· Not a git repository: git hooks skipped.'); process.exit(0); }
  const hooksPath = git(['config', '--get', 'core.hooksPath']);
  const projRel = posix(path.relative(top, process.cwd()));
  const line = `node "${projRel ? projRel + '/' : ''}scripts/project-map/generate-map.mjs" --quiet >/dev/null 2>&1 || true`;
  const block = `${MARK_START}\n# Refresh the local project map and branch report (.project-map/, not committed)\n${line}\n${MARK_END}\n`;
  if (hooksPath && !REMOVE) {
    console.log(`· core.hooksPath is set to "${hooksPath}" (e.g. husky). Add this line to its post-checkout and post-merge hooks:\n  ${line}`);
    process.exit(0);
  }
  const dir = path.resolve(process.cwd(), git(['rev-parse', '--git-path', 'hooks']) || path.join(top, '.git/hooks'));
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['post-checkout', 'post-merge', 'post-rewrite']) {
    const f = path.join(dir, name);
    let content = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    const rx = new RegExp(`${MARK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g');
    content = content.replace(rx, '');
    if (!REMOVE) {
      if (!content.trim()) content = '#!/bin/sh\n';
      if (!content.endsWith('\n')) content += '\n';
      content += block;
    }
    if (REMOVE && content.trim() === '#!/bin/sh') fs.rmSync(f, { force: true });
    else if (content.trim()) { fs.writeFileSync(f, content); fs.chmodSync(f, 0o755); }
  }
  console.log(REMOVE ? '✓ Removed the git hooks.' : `✓ Git: post-checkout, post-merge, post-rewrite in ${path.relative(process.cwd(), dir) || dir}`);
}
