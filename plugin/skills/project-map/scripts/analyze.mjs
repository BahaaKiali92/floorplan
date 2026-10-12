// Method-level analysis for Angular services, using the project's own TypeScript compiler.
// - listServices(): every @Injectable class with its methods, fields and injected dependencies
// - analyzeMethodMove(): what happens if some methods move to another (or a new) service:
//   callers, helpers and state that move along, shared members that need a decision,
//   dependencies the target needs, and whether the move creates a circular dependency.
// Nothing here edits code.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { toPosix, walk } from './lib.mjs';

// ---------- TypeScript from the project ----------
let tsCache = null;
export function loadTypeScript(repoRoot) {
  if (tsCache) return tsCache;
  const candidates = [path.join(repoRoot, 'package.json'), process.env.TS_PATH && path.join(process.env.TS_PATH, 'package.json')].filter(Boolean);
  for (const c of candidates) {
    try { tsCache = createRequire(c)('typescript'); return tsCache; } catch { /* try next */ }
  }
  throw new Error('TypeScript not found. Run npm install in the project (Angular projects include typescript).');
}

// ---------- language service with incremental file versions ----------
let lsState = null;
function languageService(ctx) {
  const ts = loadTypeScript(ctx.repoRoot);
  const rootFiles = walk(ctx.scanRoot).filter((f) => f.endsWith('.ts'));
  if (!lsState) {
    const cfgPath = path.resolve(ctx.config.tsconfig || 'tsconfig.json');
    let options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, experimentalDecorators: true };
    if (fs.existsSync(cfgPath)) {
      const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(raw.config || {}, ts.sys, path.dirname(cfgPath));
      options = { ...parsed.options, noEmit: true };
    }
    lsState = { ts, options, files: rootFiles };
    const host = {
      getScriptFileNames: () => lsState.files,
      getScriptVersion: (f) => { try { return String(fs.statSync(f).mtimeMs); } catch { return '0'; } },
      getScriptSnapshot: (f) => (fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined),
      getCurrentDirectory: () => ctx.repoRoot,
      getCompilationSettings: () => lsState.options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };
    lsState.service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }
  lsState.files = rootFiles;
  return lsState;
}

// ---------- reading service classes ----------
function decoratorsOf(ts, node) {
  return (ts.getDecorators ? ts.getDecorators(node) : node.decorators) || [];
}
function isInjectable(ts, cls) {
  return decoratorsOf(ts, cls).some((d) => ts.isCallExpression(d.expression) && d.expression.expression.getText() === 'Injectable');
}
function visibility(ts, member) {
  if (member.name && ts.isPrivateIdentifier(member.name)) return 'private';
  const mods = (ts.getModifiers ? ts.getModifiers(member) : member.modifiers) || [];
  if (mods.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'private';
  if (mods.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected';
  return 'public';
}
const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

function usesOf(ts, node) {
  const used = new Set();
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword) used.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  if (node) visit(node);
  return used;
}

export function readClass(ts, sf, cls) {
  const members = [];
  for (const m of cls.members) {
    if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters) {
        const mods = (ts.getModifiers ? ts.getModifiers(p) : p.modifiers) || [];
        if (!mods.length) continue; // only parameter properties become fields
        members.push({ name: p.name.getText(), kind: 'dependency', token: p.type ? p.type.getText() : '?', visibility: visibility(ts, p),
          line: lineOf(sf, p.getStart()), uses: [], node: p });
      }
      continue;
    }
    if (!m.name) continue;
    const name = m.name.text ?? m.name.getText();
    const base = { name, visibility: visibility(ts, m), line: lineOf(sf, m.getStart()), endLine: lineOf(sf, m.getEnd()), node: m };
    if (ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
      members.push({ ...base, kind: 'method', signature: m.getText().split('{')[0].trim().replace(/\s+/g, ' '), uses: [...usesOf(ts, m.body)] });
    } else if (ts.isPropertyDeclaration(m)) {
      const init = m.initializer;
      if (init && ts.isCallExpression(init) && init.expression.getText() === 'inject') {
        members.push({ ...base, kind: 'dependency', token: init.arguments[0] ? init.arguments[0].getText() : '?', uses: [] });
      } else if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        members.push({ ...base, kind: 'method', signature: `${name} = ${init.getText().split('=>')[0].trim()} =>`, uses: [...usesOf(ts, init)] });
      } else {
        members.push({ ...base, kind: 'state', init: init ? init.getText().slice(0, 60) : '', uses: [...usesOf(ts, init)] });
      }
    }
  }
  return { name: cls.name ? cls.name.text : '(anonymous)', start: cls.getStart(), end: cls.getEnd(), members };
}

function findServiceClass(ts, file) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let found = null;
  ts.forEachChild(sf, (n) => {
    if (!found && ts.isClassDeclaration(n) && isInjectable(ts, n)) found = n;
  });
  return found ? { sf, cls: found, info: readClass(ts, sf, found) } : null;
}

// Lightweight listing for the graph: every injectable class and its methods (no type checking).
export function listServices(ctx) {
  const ts = loadTypeScript(ctx.repoRoot);
  const out = {};
  for (const file of walk(ctx.appRoot).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.d.ts'))) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('Injectable')) continue;
    const svc = findServiceClass(ts, file);
    if (!svc) continue;
    out[toPosix(path.relative(ctx.appRoot, file))] = {
      className: svc.info.name,
      methods: svc.info.members.filter((m) => m.kind === 'method').map((m) => ({
        name: m.name, visibility: m.visibility, line: m.line, lines: m.endLine - m.line + 1, signature: m.signature,
      })),
      fields: svc.info.members.filter((m) => m.kind !== 'method').map((m) => ({ name: m.name, kind: m.kind, token: m.token, visibility: m.visibility })),
    };
  }
  return out;
}

// ---------- callers ----------
function referencesTo(ctx, file, member, classRange) {
  const { service, ts } = languageService(ctx);
  const pos = member.node.name.getStart();
  const refs = service.findReferences(file, pos) || [];
  const external = [], internal = [];
  for (const r of refs) {
    for (const ref of r.references) {
      if (ref.isDefinition) continue;
      const sf = service.getProgram().getSourceFile(ref.fileName);
      const line = sf ? lineOf(sf, ref.textSpan.start) : 0;
      const text = sf ? sf.text.split('\n')[line - 1].trim() : '';
      const same = path.resolve(ref.fileName) === path.resolve(file) && ref.textSpan.start >= classRange.start && ref.textSpan.start <= classRange.end;
      if (same) internal.push({ line });
      else external.push({ file: toPosix(path.relative(ctx.repoRoot, ref.fileName)), line, text });
    }
  }
  void ts;
  return { external, internal };
}

function textMentions(ctx, names, ext, makeRx) {
  const hits = {};
  for (const f of walk(ctx.scanRoot).filter((x) => x.endsWith(ext))) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      for (const n of names) {
        if (makeRx(n).test(l)) (hits[n] ||= []).push({ file: toPosix(path.relative(ctx.repoRoot, f)), line: i + 1, text: l.trim().slice(0, 140) });
      }
    });
  }
  return hits;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');

// ---------- the move analysis ----------
// req: { source: 'features/orders/data-access/orders.service.ts', methods: ['exportCsv', ...],
//        target: { file: 'core/...service.ts' } | { folder: 'features/orders/data-access', className: 'OrderExportService' } }
export function analyzeMethodMove(ctx, req) {
  const ts = loadTypeScript(ctx.repoRoot);
  const srcFile = path.resolve(ctx.appRoot, req.source);
  if (!fs.existsSync(srcFile)) return { errors: [`Service not found: ${req.source}`] };
  const S = findServiceClass(ts, srcFile);
  if (!S) return { errors: [`No @Injectable class in ${req.source}`] };
  const members = new Map(S.info.members.map((m) => [m.name, m]));
  const methods = (req.methods || []).filter((n) => members.get(n)?.kind === 'method');
  const errors = [];
  if (!methods.length) errors.push('Select at least one method.');

  // target
  let target;
  if (req.target?.file) {
    const tFile = path.resolve(ctx.appRoot, req.target.file);
    if (path.resolve(tFile) === path.resolve(srcFile)) errors.push('Source and target are the same service.');
    const T = fs.existsSync(tFile) ? findServiceClass(ts, tFile) : null;
    if (!T) errors.push(`No @Injectable class in ${req.target.file}`);
    else target = { file: toPosix(path.relative(ctx.repoRoot, tFile)), className: T.info.name, isNew: false, info: T.info };
  } else if (req.target?.folder) {
    const className = (req.target.className || '').trim();
    if (!/^[A-Z][A-Za-z0-9]*Service$/.test(className)) errors.push('New service name must be PascalCase and end with "Service", e.g. OrderExportService.');
    const fileName = className.replace(/Service$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() + '.service.ts';
    const tFile = path.resolve(ctx.appRoot, req.target.folder, fileName);
    if (fs.existsSync(tFile)) errors.push(`${toPosix(path.relative(ctx.repoRoot, tFile))} already exists. Drop on that service instead.`);
    target = { file: toPosix(path.relative(ctx.repoRoot, tFile)), className, isNew: true, info: { members: [] } };
  } else errors.push('Choose a target service or folder.');
  if (errors.length) return { errors };

  // who uses whom inside the source class
  const usersOf = new Map(); // member -> set of members that use it
  for (const m of S.info.members) for (const u of m.uses) {
    if (!members.has(u)) continue;
    if (!usersOf.has(u)) usersOf.set(u, new Set());
    usersOf.get(u).add(m.name);
  }
  const classRange = { start: S.info.start, end: S.info.end };
  const refCache = new Map();
  const refs = (m) => {
    if (!refCache.has(m.name)) refCache.set(m.name, referencesTo(ctx, srcFile, m, classRange));
    return refCache.get(m.name);
  };

  // methods that move along: helpers used only by the moving set and not called from outside
  const moving = new Set(methods);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...moving]) for (const u of members.get(name).uses) {
      const m = members.get(u);
      if (!m || m.kind !== 'method' || moving.has(u)) continue;
      const users = [...(usersOf.get(u) || [])];
      if (users.every((x) => moving.has(x)) && refs(m).external.length === 0) { moving.add(u); changed = true; }
    }
  }
  const helpers = [...moving].filter((n) => !methods.includes(n));
  const remaining = S.info.members.filter((m) => m.kind === 'method' && !moving.has(m.name)).map((m) => m.name);

  const decisions = [];
  const sharedHelpers = new Set();
  for (const name of moving) for (const u of members.get(name).uses) {
    const m = members.get(u);
    if (!m || m.kind !== 'method' || moving.has(u) || sharedHelpers.has(u)) continue;
    sharedHelpers.add(u);
    const usedByRemaining = [...(usersOf.get(u) || [])].filter((x) => !moving.has(x));
    decisions.push({
      kind: 'shared-helper', severity: 'decide', member: u,
      usedByMoving: [...(usersOf.get(u) || [])].filter((x) => moving.has(x)), usedByRemaining,
      externalCallers: refs(m).external.length,
      message: `${u}() is also used by ${usedByRemaining.join(', ') || 'code outside this service'}.`,
      options: ['Keep it in the source and call it from the target (target then depends on source)', 'Copy it into the target', 'Move it into a small shared utility'],
    });
  }

  // fields: dependencies and state
  const dependencies = [], stateMoves = [];
  const fieldsUsed = new Set([...moving].flatMap((n) => members.get(n).uses).filter((u) => members.get(u) && members.get(u).kind !== 'method'));
  for (const f of fieldsUsed) {
    const m = members.get(f);
    const usedByRemaining = [...(usersOf.get(f) || [])].filter((x) => !moving.has(x) && members.get(x)?.kind === 'method');
    if (m.kind === 'dependency') {
      const inTarget = (target.info.members || []).some((t) => t.kind === 'dependency' && t.token === m.token);
      dependencies.push({ field: f, token: m.token, alreadyInTarget: inTarget, stillUsedInSource: usedByRemaining.length > 0 });
    } else if (usedByRemaining.length) {
      decisions.push({
        kind: 'shared-state', severity: 'blocker', member: f, init: m.init,
        usedByMoving: [...(usersOf.get(f) || [])].filter((x) => moving.has(x)), usedByRemaining,
        message: `State "${f}" is read or written by moving methods and by ${usedByRemaining.join(', ')}. Splitting it can change behavior.`,
        options: ['Keep the state in the source and expose it (e.g. a readonly signal) to the target', 'Move the state and make the source read it from the target', 'Don\'t move these methods yet'],
      });
    } else stateMoves.push({ field: f, init: m.init });
  }

  // name clashes in the target
  for (const n of moving) if ((target.info.members || []).some((t) => t.name === n)) {
    decisions.push({ kind: 'name-clash', severity: 'blocker', member: n, message: `${target.className} already has a member called ${n}.`, options: ['Rename one of them first'] });
  }

  // callers
  const methodReports = [];
  for (const n of methods) {
    const r = refs(members.get(n));
    const internalBy = [...(usersOf.get(n) || [])].filter((x) => !moving.has(x));
    methodReports.push({ name: n, visibility: members.get(n).visibility, signature: members.get(n).signature,
      line: members.get(n).line, callers: r.external, internalCallers: internalBy });
  }
  const templateHits = textMentions(ctx, methods, '.html', (n) => new RegExp(`\\.${esc(n)}\\s*\\(`));
  const specHits = textMentions(ctx, methods, '.spec.ts', (n) => new RegExp(`['"\`]${esc(n)}['"\`]`));
  for (const m of methodReports) { m.templateUses = templateHits[m.name] || []; m.specMentions = specHits[m.name] || []; }
  for (const d of decisions) if (d.kind === 'shared-helper' && members.get(d.member).visibility === 'private' && d.externalCallers) d.severity = 'blocker';

  // dependency direction between the two services
  const sourceNeedsTarget = methodReports.some((m) => m.internalCallers.length);
  const targetNeedsSource = decisions.some((d) => d.kind === 'shared-helper' || d.kind === 'shared-state');
  const targetAlreadyInjectsSource = (target.info.members || []).some((t) => t.kind === 'dependency' && t.token === S.info.name);
  const sourceAlreadyInjectsTarget = S.info.members.some((t) => t.kind === 'dependency' && t.token === target.className);
  const direction = {
    sourceNeedsTarget: sourceNeedsTarget || sourceAlreadyInjectsTarget,
    sourceWhy: sourceNeedsTarget ? `${methodReports.filter((m) => m.internalCallers.length).map((m) => `${m.name} is called by ${m.internalCallers.join(', ')}`).join('; ')}` : (sourceAlreadyInjectsTarget ? 'already injects it' : ''),
    targetNeedsSource: targetNeedsSource || targetAlreadyInjectsSource,
    targetWhy: targetNeedsSource ? 'moving methods use members that stay in the source (see decisions)' : (targetAlreadyInjectsSource ? 'already injects it' : ''),
  };
  direction.cycle = direction.sourceNeedsTarget && direction.targetNeedsSource;
  if (direction.cycle) decisions.push({ kind: 'cycle', severity: 'blocker', member: '', message: `${S.info.name} and ${target.className} would depend on each other (circular dependency).`, options: ['Resolve the shared members first so only one direction remains'] });

  const plan = {
    source: { file: toPosix(path.relative(ctx.repoRoot, srcFile)), className: S.info.name },
    target: { file: target.file, className: target.className, isNew: target.isNew },
    methods: methodReports,
    movesAlong: { helpers: helpers.map((h) => ({ name: h, signature: members.get(h).signature })), state: stateMoves },
    dependencies,
    decisions,
    direction,
    remainingInSource: remaining,
  };
  plan.summary = {
    methods: methods.length,
    helpers: helpers.length,
    callerFiles: new Set(methodReports.flatMap((m) => [...m.callers, ...m.templateUses].map((c) => c.file))).size,
    callSites: methodReports.reduce((n, m) => n + m.callers.length + m.templateUses.length, 0),
    specFiles: new Set(methodReports.flatMap((m) => m.specMentions.map((c) => c.file))).size,
    blockers: decisions.filter((d) => d.severity === 'blocker').length,
    decide: decisions.filter((d) => d.severity === 'decide').length,
  };
  plan.claudeTask = claudeTask(plan);
  return { plan };
}

function claudeTask(p) {
  const L = [];
  L.push(`Move methods from ${p.source.className} to ${p.target.isNew ? 'a new service ' : ''}${p.target.className}.`);
  L.push('');
  L.push(`Source: ${p.source.file}`);
  L.push(`Target: ${p.target.file}${p.target.isNew ? ' (create it, @Injectable({ providedIn: \'root\' }), same style as the source)' : ''}`);
  L.push('');
  L.push('Methods to move:');
  for (const m of p.methods) L.push(`- ${m.signature || m.name}`);
  if (p.movesAlong.helpers.length) { L.push('', 'Private helpers that move along (only used by the methods above):'); for (const h of p.movesAlong.helpers) L.push(`- ${h.name}`); }
  if (p.movesAlong.state.length) { L.push('', 'State that moves along (only used by the methods above):'); for (const s of p.movesAlong.state) L.push(`- ${s.field}`); }
  if (p.dependencies.length) {
    L.push('', 'Dependencies the target needs:');
    for (const d of p.dependencies) L.push(`- ${d.token}${d.alreadyInTarget ? ' (already injected in target)' : ' (inject it)'}${d.stillUsedInSource ? '' : `; remove ${d.field} from the source if nothing else uses it`}`);
  }
  const callers = p.methods.flatMap((m) => m.callers.map((c) => `- ${c.file}:${c.line}  ${m.name}`));
  const tpl = p.methods.flatMap((m) => m.templateUses.map((c) => `- ${c.file}:${c.line}  ${m.name} (template)`));
  if (callers.length || tpl.length) {
    L.push('', `Update every caller to use ${p.target.className} (inject it where needed):`);
    L.push(...callers, ...tpl);
  }
  const internal = p.methods.filter((m) => m.internalCallers.length);
  if (internal.length) { L.push('', `${p.source.className} itself calls moved methods; inject ${p.target.className} there:`); for (const m of internal) L.push(`- ${m.name} is called by ${m.internalCallers.join(', ')}`); }
  const specs = [...new Set(p.methods.flatMap((m) => m.specMentions.map((c) => c.file)))];
  if (specs.length) { L.push('', 'Update test mocks/spies that mention these methods:'); for (const s of specs) L.push(`- ${s}`); }
  if (p.decisions.length) {
    L.push('', 'STOP and ask me before deciding these:');
    for (const d of p.decisions) L.push(`- [${d.severity}] ${d.message}${d.options ? ` Options: ${d.options.join(' | ')}` : ''}`);
  }
  L.push('', 'Rules:');
  L.push('- Do not change what the methods do. Only move them and rewire injection.');
  L.push('- Work on a new branch. Run the type check and the unit tests for the affected files, and fix failures.');
  L.push('- Then run npm run map and npm run map:check.');
  L.push('- Finish with a short summary of the changed files.');
  return L.join('\n');
}

export function resetAnalysisCache() { lsState = null; }
