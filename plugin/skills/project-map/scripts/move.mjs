// Move engine: moves a file (with its .html/.scss/.spec companions) or a whole folder,
// and rewrites every import that points to the moved files or out of them.
// Handles relative imports, tsconfig path aliases, lazy import(), templateUrl/styleUrl(s).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { toPosix, resolveSpec, walk } from './lib.mjs';

// ---------- building the file mapping ----------

export function mappingForMove(ctx, sourceRel, targetFolderRel) {
  const { appRoot } = ctx;
  const src = path.resolve(appRoot, sourceRel);
  const target = path.resolve(appRoot, targetFolderRel || '.');
  const errors = [];
  const inApp = (p) => p === appRoot || p.startsWith(appRoot + path.sep);
  if (!inApp(src) || !fs.existsSync(src)) errors.push(`Source not found: ${sourceRel}`);
  if (!inApp(target) || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) errors.push(`Target folder not found: ${targetFolderRel}`);
  if (errors.length) return { errors, pairs: [] };

  const pairs = [];
  if (fs.statSync(src).isDirectory()) {
    if (target === src || target.startsWith(src + path.sep)) errors.push('A folder cannot be moved into itself.');
    if (path.dirname(src) === target) errors.push('The folder is already there.');
    const dest = path.join(target, path.basename(src));
    if (fs.existsSync(dest)) errors.push(`${toPosix(path.relative(appRoot, dest))} already exists.`);
    for (const f of walk(src)) pairs.push({ from: f, to: path.join(dest, path.relative(src, f)) });
  } else {
    if (path.dirname(src) === target) return { errors: ['The file is already in that folder.'], pairs: [] };
    const stem = path.basename(src).replace(/\.ts$/, '');
    const companions = fs.readdirSync(path.dirname(src))
      .filter((n) => n === path.basename(src) || n.startsWith(stem + '.'))
      .map((n) => path.join(path.dirname(src), n))
      .filter((p) => fs.statSync(p).isFile());
    for (const f of companions) {
      const to = path.join(target, path.basename(f));
      if (fs.existsSync(to)) errors.push(`${toPosix(path.relative(appRoot, to))} already exists.`);
      pairs.push({ from: f, to });
    }
  }
  return { errors, pairs };
}

// ---------- computing the import edits ----------

const IMPORT_RX = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\2/g;
const URL_RX = /(\b(?:templateUrl|styleUrl)\s*:\s*)(['"])([^'"\n]+)\2/g;
const URLS_RX = /\bstyleUrls\s*:\s*\[([^\]]*)\]/g;

function specFor(ctx, newFrom, oldTarget, newTarget, original, resolved) {
  const viaIndex = path.basename(oldTarget) === 'index.ts' && !/index(\.ts)?$/.test(original);
  const targetPath = viaIndex ? path.dirname(newTarget) : newTarget.replace(/\.ts$/, '');
  if (resolved.kind === 'alias') {
    const candidates = [resolved.alias, ...ctx.aliases.filter((a) => a !== resolved.alias)];
    for (const a of candidates) {
      for (const t of a.targets) {
        if (a.wildcard && (targetPath === t || targetPath.startsWith(t.endsWith(path.sep) ? t : t + path.sep))) {
          return a.prefix + toPosix(path.relative(t, targetPath));
        }
        if (!a.wildcard && targetPath === t.replace(/\.ts$/, '')) return a.key;
      }
    }
  }
  // Crossing into an aliased folder from outside it? Use the alias (@shared/..., @core/...).
  if (ctx.preferAliases !== false) {
    const under = (p, dir) => p === dir || p.startsWith(dir + path.sep);
    for (const a of ctx.aliases) {
      if (!a.wildcard) continue;
      for (const t of a.targets) {
        const dir = t.replace(/[\\/]$/, '');
        if (under(targetPath, dir) && !under(newFrom, dir) && dir.startsWith(ctx.appRoot)) {
          return a.prefix + toPosix(path.relative(dir, targetPath));
        }
      }
    }
  }
  let rel = toPosix(path.relative(path.dirname(newFrom), targetPath));
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function relUrl(newFrom, newTarget) {
  let rel = toPosix(path.relative(path.dirname(newFrom), newTarget));
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

export function planFromPairs(ctx, pairs) {
  const map = new Map(pairs.map((p) => [p.from, p.to]));
  const edits = [];
  const warnings = [];
  const files = walk(ctx.scanRoot).filter((f) => f.endsWith('.ts'));

  for (const oldFile of files) {
    const newFile = map.get(oldFile) || oldFile;
    const moved = newFile !== oldFile;
    const content = fs.readFileSync(oldFile, 'utf8');
    const reps = [];

    for (const m of content.matchAll(IMPORT_RX)) {
      const spec = m[3];
      const r = resolveSpec(oldFile, spec, ctx.aliases);
      if (!r) continue;
      const newTarget = map.get(r.file) || r.file;
      if (!moved && newTarget === r.file) continue;
      const next = specFor(ctx, newFile, r.file, newTarget, spec, r);
      if (next !== spec) reps.push({ start: m.index + m[1].length + 1, end: m.index + m[1].length + 1 + spec.length, from: spec, to: next });
    }

    const fixUrl = (spec, start) => {
      if (!spec.startsWith('.')) return;
      const oldTarget = path.resolve(path.dirname(oldFile), spec);
      const newTarget = map.get(oldTarget) || oldTarget;
      if (!moved && newTarget === oldTarget) return;
      const next = relUrl(newFile, newTarget);
      if (next !== spec) reps.push({ start, end: start + spec.length, from: spec, to: next });
    };
    for (const m of content.matchAll(URL_RX)) fixUrl(m[3], m.index + m[1].length + 1);
    for (const m of content.matchAll(URLS_RX)) {
      const inner = m[1];
      const innerStart = m.index + m[0].indexOf('[') + 1;
      for (const s of inner.matchAll(/(['"])([^'"\n]+)\1/g)) fixUrl(s[2], innerStart + s.index + 1);
    }

    if (reps.length) {
      reps.sort((a, b) => b.start - a.start);
      let out = content;
      for (const r of reps) out = out.slice(0, r.start) + r.to + out.slice(r.end);
      edits.push({ oldFile, newFile, content: out, changes: reps.reverse().map(({ from, to }) => ({ from, to })) });
    }
  }

  // Stylesheets with relative @use/@import are not rewritten; tell the user.
  for (const { from } of pairs) {
    if (/\.(scss|sass|css|less)$/.test(from)) {
      const css = fs.readFileSync(from, 'utf8');
      if (/@(use|import|forward)\s+['"]\.\.?\//.test(css)) {
        warnings.push(`${toPosix(path.relative(ctx.repoRoot, from))} has relative @use/@import paths; check them after the move.`);
      }
    }
  }
  return { pairs, edits, warnings };
}

// ---------- public API ----------

const relRepo = (ctx, p) => toPosix(path.relative(ctx.repoRoot, p));

export function summarize(ctx, plan) {
  return {
    moves: plan.pairs.map((p) => ({ from: relRepo(ctx, p.from), to: relRepo(ctx, p.to) })),
    edits: plan.edits.map((e) => ({ file: relRepo(ctx, e.newFile), changes: e.changes })),
    importCount: plan.edits.reduce((n, e) => n + e.changes.length, 0),
    warnings: plan.warnings,
  };
}

export function planMove(ctx, sourceRel, targetFolderRel) {
  const { errors, pairs } = mappingForMove(ctx, sourceRel, targetFolderRel);
  if (errors.length) return { errors };
  return { plan: planFromPairs(ctx, pairs) };
}

function isGitTracked(ctx, file) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', file], { cwd: ctx.repoRoot, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export function applyPlan(ctx, plan) {
  // 1) move files (git mv keeps history when the file is tracked)
  for (const { from, to } of plan.pairs) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (isGitTracked(ctx, from)) execFileSync('git', ['mv', from, to], { cwd: ctx.repoRoot, stdio: 'ignore' });
    else fs.renameSync(from, to);
  }
  // 2) write rewritten imports at the files' new locations
  for (const e of plan.edits) fs.writeFileSync(e.newFile, e.content);
  // 3) remove folders left empty
  const dirs = [...new Set(plan.pairs.map((p) => path.dirname(p.from)))].sort((a, b) => b.length - a.length);
  for (let dir of dirs) {
    while (dir.startsWith(ctx.appRoot + path.sep) && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }
  return summarize(ctx, plan);
}

export function planUndo(ctx, pairs) {
  const reversed = pairs.map((p) => ({ from: p.to, to: p.from }));
  const missing = reversed.filter((p) => !fs.existsSync(p.from)).map((p) => relRepo(ctx, p.from));
  const taken = reversed.filter((p) => fs.existsSync(p.to)).map((p) => relRepo(ctx, p.to));
  const errors = [];
  if (missing.length) errors.push(`Cannot undo, files changed since: ${missing.join(', ')}`);
  if (taken.length) errors.push(`Cannot undo, target already exists: ${taken.join(', ')}`);
  if (errors.length) return { errors };
  return { plan: planFromPairs(ctx, reversed) };
}
