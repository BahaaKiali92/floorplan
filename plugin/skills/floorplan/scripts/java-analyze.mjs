// Method-level analysis for Spring beans (Java). Zero dependencies, no JDK or build needed.
// Same result shape as analyze.mjs (Angular), so the graph shows it the same way.
// - listServicesJava(): @Service / @Component / controllers / listeners with methods, injected dependencies and state
// - analyzeMethodMoveJava(): callers (through injected fields, constructor parameters, static calls, method references,
//   Mockito when/verify), helpers and state that move along, shared members, Spring proxy annotations
//   (@Transactional, @Cacheable, @Async, …), interface methods, and circular dependencies.
// Nothing here edits code.
import fs from 'node:fs';
import path from 'node:path';
import { JavaIndex, parseJava, usesIn, kindOfType, stereotypesOf, lineIndex, toPosix, isTestPath, walkJava } from './java.mjs';
import { packageOfDir } from './java-move.mjs';

const BEAN_KINDS = new Set(['service', 'component', 'controller', 'listener']);
const PROXY_ANN = new Set(['Transactional', 'Cacheable', 'CacheEvict', 'CachePut', 'Caching', 'Async', 'Retryable', 'PreAuthorize',
  'PostAuthorize', 'Secured', 'RolesAllowed', 'Timed', 'Observed', 'Validated']);
const INJECT_ANN = new Set(['Autowired', 'Inject', 'Resource', 'Value', 'Qualifier']);

// ---------- reading a bean class ----------
export function readJavaClass(file, stereo) {
  const src = fs.readFileSync(file, 'utf8');
  const p = parseJava(src, { members: true });
  const primary = path.basename(file, '.java');
  const t = p.types.find((x) => x.name === primary) || p.types[0];
  if (!t) return null;
  const line = lineIndex(src);
  const fields = (t.members || []).filter((m) => m.kind === 'field');
  const methodsRaw = (t.members || []).filter((m) => m.kind === 'method');
  const ctors = (t.members || []).filter((m) => m.kind === 'constructor');
  const ctorParamTypes = new Set(ctors.flatMap((c) => c.params.map((x) => x.type.replace(/<.*$/, '').trim())));
  const own = { className: t.name, fields: new Set(fields.map((f) => f.name)), methods: new Set(methodsRaw.map((m) => m.name)) };
  const members = [];
  for (const f of fields) {
    const ann = f.annotations.map((a) => a.name);
    let kind = 'state';
    if (f.static && f.final) kind = 'constant';
    else if (ann.some((a) => INJECT_ANN.has(a))) kind = 'dependency';
    else if (f.final && !f.hasInit) kind = 'dependency';
    else if (!f.hasInit && ctorParamTypes.has(f.type.replace(/<.*$/, '').trim())) kind = 'dependency';
    const value = f.annotations.find((a) => a.name === 'Value');
    members.push({ name: f.name, kind, token: value ? `@Value(${value.args}) ${f.type}` : f.type, visibility: f.visibility,
      init: f.init, line: line(f.start), uses: [], annotations: ann, static: f.static });
  }
  // overloads are one member (moved together)
  const byName = new Map();
  for (const m of methodsRaw) {
    const u = m.bodyStart ? usesIn(p.masked, m.bodyStart + 1, m.bodyEnd, own) : { fields: new Set(), methods: new Set() };
    const prev = byName.get(m.name);
    const rank = { public: 3, protected: 2, package: 1, private: 0 };
    if (!prev) {
      byName.set(m.name, { name: m.name, kind: 'method', visibility: m.visibility, signature: m.signature, line: line(m.start),
        endLine: line(m.end || m.start), lines: line(m.end || m.start) - line(m.start) + 1, overloads: 1, static: m.static,
        uses: new Set([...u.fields, ...u.methods].filter((x) => x !== m.name)), annotations: new Set(m.annotations.map((a) => a.name)), abstract: !!m.abstract });
    } else {
      prev.overloads++;
      prev.lines += line(m.end || m.start) - line(m.start) + 1;
      if (rank[m.visibility] > rank[prev.visibility]) prev.visibility = m.visibility;
      for (const x of [...u.fields, ...u.methods]) if (x !== m.name) prev.uses.add(x);
      for (const a of m.annotations) prev.annotations.add(a.name);
    }
  }
  for (const m of byName.values()) {
    if (m.overloads > 1) m.signature += ` (+${m.overloads - 1} overload${m.overloads > 2 ? 's' : ''})`;
    members.push({ ...m, uses: [...m.uses], annotations: [...m.annotations] });
  }
  return { name: t.name, pkg: p.pkg, type: t, kind: kindOfType(t, p.masked, stereo), members,
    classAnnotations: t.annotations.map((a) => a.name), classMapping: t.annotations.find((a) => a.name === 'RequestMapping')?.args || '',
    implements: t.implements, start: t.bodyStart, end: t.bodyEnd };
}

export function listServicesJava(ctx) {
  const out = {};
  const files = walkJava(ctx.appRoot).filter((f) => !isTestPath(f));
  const srcs = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
  const stereo = stereotypesOf([...srcs].filter(([, s]) => s.includes('@interface')).map(([, s]) => parseJava(s)));
  const custom = [...stereo.keys()].join('|');
  const beanRx = new RegExp(`@(Service|Component|RestController|Controller${custom ? '|' + custom : ''})\\b|class\\s+\\w+(Service|ServiceImpl|Listener|Consumer)\\b`);
  for (const file of files) {
    const src = srcs.get(file);
    if (!beanRx.test(src)) continue;
    let c;
    try { c = readJavaClass(file, stereo); } catch { continue; }
    if (!c || c.type.kind !== 'class' || !BEAN_KINDS.has(c.kind)) continue;
    out[toPosix(path.relative(ctx.appRoot, file))] = {
      className: c.name,
      methods: c.members.filter((m) => m.kind === 'method').map((m) => ({ name: m.name, visibility: m.visibility, line: m.line, lines: m.lines, signature: m.signature })),
      fields: c.members.filter((m) => m.kind !== 'method').map((m) => ({ name: m.name, kind: m.kind === 'constant' ? 'state' : m.kind, token: m.token, visibility: m.visibility })),
    };
  }
  return out;
}

// ---------- callers ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function findCallers(ctx, index, S, srcFile, methodNames) {
  const typeNames = [S.name, ...S.implements];
  const res = Object.fromEntries(methodNames.map((n) => [n, { callers: [], tests: [], viaInterface: [] }]));
  const methodsRx = methodNames.map(esc).join('|');
  for (const info of index.files.values()) {
    if (info.abs === srcFile) continue;
    const idents = index.idents(info);
    if (!typeNames.some((n) => idents.has(n))) continue;
    const m = info.masked;
    const vars = new Map(); // var -> type name
    const varRx = new RegExp(`\\b(${typeNames.map(esc).join('|')})\\b(?:\\s*<[^;{}()]*?>)?\\s+([a-z_$][\\w$]*)\\s*(?=[;=,)])`, 'g');
    for (const x of m.matchAll(varRx)) vars.set(x[2], x[1]);
    const line = lineIndex(info.src);
    const lines = info.src.split('\n');
    const hit = (pos, name, via) => {
      const ln = line(pos);
      const rec = { file: toPosix(path.relative(ctx.repoRoot, info.abs)), line: ln, text: (lines[ln - 1] || '').trim().slice(0, 140) };
      const r = res[name];
      if (info.test) r.tests.push(rec); else r.callers.push(rec);
      if (via && via !== S.name) r.viaInterface.push({ ...rec, type: via });
    };
    const seen = new Set();
    const add = (pos, name, via) => { const k = `${pos}:${name}`; if (!seen.has(k)) { seen.add(k); hit(pos, name, via); } };
    if (vars.size) {
      const vRx = [...vars.keys()].map(esc).join('|');
      for (const x of m.matchAll(new RegExp(`\\b(${vRx})\\s*(?:\\.|::)\\s*(${methodsRx})\\b(?=\\s*\\(|)`, 'g'))) add(x.index, x[2], vars.get(x[1]));
      for (const x of m.matchAll(new RegExp(`\\(\\s*(${vRx})\\s*(?:,[^()]*(?:\\([^()]*\\)[^()]*)*)?\\)\\s*\\.\\s*(${methodsRx})\\s*\\(`, 'g'))) add(x.index, x[2], vars.get(x[1]));
    }
    for (const x of m.matchAll(new RegExp(`\\b${esc(S.name)}\\s*(?:\\.|::)\\s*(${methodsRx})\\b`, 'g'))) add(x.index, x[1], S.name);
  }
  return res;
}

// ---------- the move analysis ----------
export function analyzeMethodMoveJava(ctx, req) {
  const srcFile = path.resolve(ctx.appRoot, req.source || '');
  if (!fs.existsSync(srcFile)) return { errors: [`Class not found: ${req.source}`] };
  const S = readJavaClass(srcFile);
  if (!S) return { errors: [`No class in ${req.source}`] };
  const members = new Map(S.members.map((m) => [m.name, m]));
  const methods = (req.methods || []).filter((n) => members.get(n)?.kind === 'method');
  const errors = [];
  if (!methods.length) errors.push('Select at least one method.');

  let target;
  if (req.target?.file) {
    const tFile = path.resolve(ctx.appRoot, req.target.file);
    if (tFile === srcFile) errors.push('Source and target are the same class.');
    const T = fs.existsSync(tFile) ? readJavaClass(tFile) : null;
    if (!T) errors.push(`No class in ${req.target.file}`);
    else target = { file: toPosix(path.relative(ctx.repoRoot, tFile)), className: T.name, isNew: false, info: T, pkg: T.pkg };
  } else if (req.target?.folder !== undefined) {
    const className = (req.target.className || '').trim();
    if (!/^[A-Z][A-Za-z0-9]*$/.test(className)) errors.push('The new class name must be PascalCase, e.g. OrderExportService.');
    const dir = path.resolve(ctx.appRoot, req.target.folder || '.');
    const pk = packageOfDir(dir);
    if (!pk || pk.pkg === null) errors.push('The target folder is not a Java package (inside src/main/java).');
    const tFile = path.join(dir, `${className}.java`);
    if (fs.existsSync(tFile)) errors.push(`${toPosix(path.relative(ctx.repoRoot, tFile))} already exists. Drop on that class instead.`);
    target = { file: toPosix(path.relative(ctx.repoRoot, tFile)), className, isNew: true, info: { members: [], classAnnotations: [], implements: [] }, pkg: pk?.pkg };
  } else errors.push('Choose a target class or folder.');
  if (errors.length) return { errors };

  // who uses whom inside the source class
  const usersOf = new Map();
  for (const m of S.members) for (const u of m.uses) {
    if (!members.has(u)) continue;
    if (!usersOf.has(u)) usersOf.set(u, new Set());
    usersOf.get(u).add(m.name);
  }
  const index = new JavaIndex(ctx.scanRoot);
  const allMethodNames = S.members.filter((m) => m.kind === 'method').map((m) => m.name);
  const callers = findCallers(ctx, index, S, srcFile, allMethodNames);
  const external = (n) => [...(callers[n]?.callers || []), ...(callers[n]?.tests || [])];

  // helpers that move along: only used by the moving set and not called from outside
  const moving = new Set(methods);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...moving]) for (const u of members.get(name).uses) {
      const m = members.get(u);
      if (!m || m.kind !== 'method' || moving.has(u)) continue;
      const users = [...(usersOf.get(u) || [])];
      if (users.every((x) => moving.has(x)) && external(u).length === 0) { moving.add(u); changed = true; }
    }
  }
  const helpers = [...moving].filter((n) => !methods.includes(n));
  const remaining = S.members.filter((m) => m.kind === 'method' && !moving.has(m.name)).map((m) => m.name);
  const remainingUsers = (name) => [...(usersOf.get(name) || [])].filter((x) => !moving.has(x) && members.get(x)?.kind === 'method');

  const decisions = [];
  const sharedHelpers = new Set();
  for (const name of moving) for (const u of members.get(name).uses) {
    const m = members.get(u);
    if (!m || m.kind !== 'method' || moving.has(u) || sharedHelpers.has(u)) continue;
    sharedHelpers.add(u);
    const usedByRemaining = remainingUsers(u);
    decisions.push({
      kind: 'shared-helper', severity: m.visibility === 'private' && external(u).length ? 'blocker' : 'decide', member: u,
      usedByMoving: [...(usersOf.get(u) || [])].filter((x) => moving.has(x)), usedByRemaining, externalCallers: external(u).length,
      message: `${u}() is also used by ${usedByRemaining.join(', ') || 'code outside this class'}.`,
      options: [`Keep it in ${S.name} and call it from ${target.className} (${target.className} then depends on ${S.name})`, `Copy it into ${target.className}`, 'Move it into a small shared helper class'],
    });
  }

  // fields: dependencies, state, constants
  const dependencies = [], stateMoves = [];
  const fieldsUsed = new Set([...moving].flatMap((n) => members.get(n).uses).filter((u) => members.get(u) && members.get(u).kind !== 'method'));
  for (const f of fieldsUsed) {
    const m = members.get(f);
    const usedByRemaining = remainingUsers(f);
    if (m.kind === 'dependency') {
      const inTarget = (target.info.members || []).some((t) => t.kind === 'dependency' && t.token === m.token);
      dependencies.push({ field: f, token: m.token, alreadyInTarget: inTarget, stillUsedInSource: usedByRemaining.length > 0 });
    } else if (m.kind === 'constant') {
      if (usedByRemaining.length) decisions.push({ kind: 'shared-constant', severity: 'decide', member: f, usedByMoving: [], usedByRemaining,
        message: `Constant ${f} is used by moving methods and by ${usedByRemaining.join(', ')}.`, options: [`Copy it into ${target.className}`, `Make it accessible and use ${S.name}.${f}`, 'Move it to a shared constants class'] });
      else stateMoves.push({ field: f, init: m.init });
    } else if (usedByRemaining.length) {
      decisions.push({
        kind: 'shared-state', severity: 'blocker', member: f, init: m.init,
        usedByMoving: [...(usersOf.get(f) || [])].filter((x) => moving.has(x)), usedByRemaining,
        message: `State "${f}" is read or written by moving methods and by ${usedByRemaining.join(', ')}. Splitting it can change behavior (beans are singletons: the value is shared by all requests).`,
        options: [`Keep the state in ${S.name} and expose it to ${target.className}`, `Move the state and make ${S.name} read it from ${target.className}`, 'Don\'t move these methods yet'],
      });
    } else stateMoves.push({ field: f, init: m.init });
  }

  // name clashes
  for (const n of moving) if ((target.info.members || []).some((t) => t.name === n)) {
    decisions.push({ kind: 'name-clash', severity: 'blocker', member: n, message: `${target.className} already has a member called ${n}.`, options: ['Rename one of them first'] });
  }

  // interface methods: callers through the interface keep calling the source
  const ifaceMethods = new Map(); // iface -> Set(method names)
  for (const iname of S.implements) {
    const abs = [...index.files.values()].find((i) => i.types.some((t) => t.name === iname && t.kind === 'interface'))?.abs;
    if (!abs) continue;
    const it = parseJava(fs.readFileSync(abs, 'utf8'), { members: true }).types.find((t) => t.name === iname);
    ifaceMethods.set(iname, new Set((it?.members || []).filter((m) => m.kind === 'method').map((m) => m.name)));
  }
  for (const n of methods) {
    const ifs = [...ifaceMethods].filter(([, set]) => set.has(n)).map(([i]) => i);
    const override = members.get(n).annotations.includes('Override');
    if (ifs.length || override) {
      decisions.push({ kind: 'interface-method', severity: 'decide', member: n,
        message: `${n}() ${ifs.length ? `is declared in ${ifs.join(', ')}` : 'overrides a method of a parent type'}, which ${S.name} implements. Callers that use ${ifs[0] || 'that type'} still reach ${S.name}.`,
        options: [`Keep ${n}() in ${S.name} as a one-line delegate to ${target.className}`, `Move the declaration to an interface that ${target.className} implements and update those callers`] });
    }
  }

  // Spring proxies: annotations whose behavior depends on calls going through the bean proxy
  const classProxy = S.classAnnotations.filter((a) => PROXY_ANN.has(a));
  const targetProxy = new Set(target.info.classAnnotations || []);
  for (const a of classProxy) if (!targetProxy.has(a)) {
    decisions.push({ kind: 'class-annotation', severity: 'decide', member: '', message: `${S.name} is annotated @${a} at class level; ${target.className} ${target.isNew ? 'will not be' : 'is not'}. The moved methods lose that behavior.`,
      options: [`Add @${a} to ${target.className}`, `Add @${a} to the moved methods only`, 'Not needed for these methods'] });
  }
  const methodReports = [];
  for (const n of methods) {
    const m = members.get(n);
    const internalBy = remainingUsers(n);
    const proxyAnn = m.annotations.filter((a) => PROXY_ANN.has(a));
    if (proxyAnn.length && internalBy.length) {
      decisions.push({ kind: 'proxy-self-call', severity: 'decide', member: n,
        message: `${n}() has @${proxyAnn.join(', @')} and is called by ${internalBy.join(', ')} inside ${S.name}. Today those internal calls skip the Spring proxy, so the annotation does not apply to them; after the move they go through the proxy and it does (e.g. a new transaction).`,
        options: ['Fine, that is the intended behavior', 'Keep the old behavior: remove the annotation or adjust the callers'] });
    }
    if (m.annotations.some((a) => /Mapping$/.test(a)) && (target.isNew || (target.info.classMapping || '') !== S.classMapping)) {
      decisions.push({ kind: 'endpoint', severity: 'decide', member: n,
        message: `${n}() is an HTTP endpoint. ${target.className} has ${target.info.classMapping ? `@RequestMapping(${target.info.classMapping})` : 'no class-level @RequestMapping'}, ${S.name} has ${S.classMapping ? `@RequestMapping(${S.classMapping})` : 'none'}: the URL changes unless you adjust it.`,
        options: ['Keep the URL: adjust the mapping on the method', 'Change the URL (tell the API clients)'] });
    }
    const c = callers[n] || { callers: [], tests: [], viaInterface: [] };
    methodReports.push({ name: n, visibility: m.visibility, signature: m.signature, line: m.line,
      callers: c.callers, internalCallers: internalBy, templateUses: [], specMentions: c.tests, viaInterface: c.viaInterface, annotations: m.annotations });
  }

  // dependency direction
  const sourceNeedsTarget = methodReports.some((m) => m.internalCallers.length);
  const targetNeedsSource = decisions.some((d) => d.kind === 'shared-helper' || d.kind === 'shared-state');
  const targetAlreadyInjectsSource = (target.info.members || []).some((t) => t.kind === 'dependency' && t.token.replace(/<.*$/, '') === S.name);
  const sourceAlreadyInjectsTarget = S.members.some((t) => t.kind === 'dependency' && t.token.replace(/<.*$/, '') === target.className);
  const direction = {
    sourceNeedsTarget: sourceNeedsTarget || sourceAlreadyInjectsTarget,
    sourceWhy: sourceNeedsTarget ? methodReports.filter((m) => m.internalCallers.length).map((m) => `${m.name} is called by ${m.internalCallers.join(', ')}`).join('; ') : (sourceAlreadyInjectsTarget ? 'already injects it' : ''),
    targetNeedsSource: targetNeedsSource || targetAlreadyInjectsSource,
    targetWhy: targetNeedsSource ? 'moving methods use members that stay in the source (see decisions)' : (targetAlreadyInjectsSource ? 'already injects it' : ''),
  };
  direction.cycle = direction.sourceNeedsTarget && direction.targetNeedsSource;
  if (direction.cycle) decisions.push({ kind: 'cycle', severity: 'blocker', member: '', message: `${S.name} and ${target.className} would depend on each other. Spring fails at startup with constructor injection cycles.`, options: ['Resolve the shared members first so only one direction remains'] });

  const plan = {
    framework: 'spring',
    source: { file: toPosix(path.relative(ctx.repoRoot, srcFile)), className: S.name, pkg: S.pkg },
    target: { file: target.file, className: target.className, isNew: target.isNew, pkg: target.pkg },
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
    callerFiles: new Set(methodReports.flatMap((m) => m.callers.map((c) => c.file))).size,
    callSites: methodReports.reduce((n, m) => n + m.callers.length, 0),
    specFiles: new Set(methodReports.flatMap((m) => m.specMentions.map((c) => c.file))).size,
    blockers: decisions.filter((d) => d.severity === 'blocker').length,
    decide: decisions.filter((d) => d.severity === 'decide').length,
  };
  plan.claudeTask = claudeTaskJava(plan);
  return { plan };
}

function claudeTaskJava(p) {
  const L = [];
  L.push(`Move methods from ${p.source.className} to ${p.target.isNew ? 'a new class ' : ''}${p.target.className} (Spring Boot, Java).`);
  L.push('');
  L.push(`Source: ${p.source.file}`);
  L.push(`Target: ${p.target.file}${p.target.isNew ? ` (create it in package ${p.target.pkg}: @Service, constructor injection, same style as the source)` : ''}`);
  L.push('');
  L.push('Methods to move (all overloads):');
  for (const m of p.methods) L.push(`- ${m.signature || m.name}${m.annotations?.length ? `  [@${m.annotations.join(', @')}]` : ''}`);
  if (p.movesAlong.helpers.length) { L.push('', 'Private helpers that move along (only used by the methods above):'); for (const h of p.movesAlong.helpers) L.push(`- ${h.name}`); }
  if (p.movesAlong.state.length) { L.push('', 'Fields that move along (only used by the methods above):'); for (const s of p.movesAlong.state) L.push(`- ${s.field}`); }
  if (p.dependencies.length) {
    L.push('', 'Dependencies the target needs:');
    for (const d of p.dependencies) L.push(`- ${d.token}${d.alreadyInTarget ? ' (already injected in target)' : ' (add it to the constructor)'}${d.stillUsedInSource ? '' : `; remove ${d.field} from ${p.source.className} if nothing else uses it`}`);
  }
  const callers = p.methods.flatMap((m) => m.callers.map((c) => `- ${c.file}:${c.line}  ${m.name}`));
  if (callers.length) { L.push('', `Update every caller to use ${p.target.className} (inject it where needed):`); L.push(...callers); }
  const internal = p.methods.filter((m) => m.internalCallers.length);
  if (internal.length) { L.push('', `${p.source.className} itself calls moved methods; inject ${p.target.className} there:`); for (const m of internal) L.push(`- ${m.name} is called by ${m.internalCallers.join(', ')}`); }
  const tests = [...new Set(p.methods.flatMap((m) => m.specMentions.map((c) => c.file)))];
  if (tests.length) { L.push('', 'Update tests that call or mock these methods (Mockito when/verify, @MockBean):'); for (const s of tests) L.push(`- ${s}`); }
  if (p.decisions.length) {
    L.push('', 'STOP and ask me before deciding these:');
    for (const d of p.decisions) L.push(`- [${d.severity}] ${d.message}${d.options ? ` Options: ${d.options.join(' | ')}` : ''}`);
  }
  L.push('', 'Rules:');
  L.push('- Do not change what the methods do. Only move them and rewire injection.');
  L.push('- Work on a new branch. Compile and run the tests of the affected classes (Maven: ./mvnw -q test -Dtest=..., Gradle: ./gradlew test --tests ...), and fix failures.');
  L.push('- Then run node scripts/floorplan/generate-map.mjs and node scripts/floorplan/generate-map.mjs --check.');
  L.push('- Finish with a short summary of the changed files.');
  return L.join('\n');
}
