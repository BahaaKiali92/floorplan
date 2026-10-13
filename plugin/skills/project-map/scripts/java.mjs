// Java / Spring Boot support. Zero dependencies (Node 18+), no JDK needed.
// - maskJava(): comments and string contents replaced by spaces (same length, so offsets stay valid)
// - parseJava(): package, imports, top-level types with annotations, members (fields, methods, constructors)
// - JavaIndex: every .java file of the project, fully qualified names, packages, dependencies
// - scanSpring(): the map data for generate-map.mjs (files, kinds, dependencies, HTTP endpoints, libraries)
import fs from 'node:fs';
import path from 'node:path';

export const toPosix = (p) => p.split(path.sep).join('/');

// ---------- walking ----------
const BUILD_DIRS = new Set(['target', 'build', 'out', 'bin', 'node_modules', 'generated', 'generated-sources']);
// Build output folders are skipped, but only outside src/ (a package may be called "out", e.g. adapter/out).
export function walkJava(dir, acc = [], inSrc = false) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!inSrc && BUILD_DIRS.has(e.name)) continue;
      walkJava(abs, acc, inSrc || e.name === 'src');
    } else if (e.name.endsWith('.java')) acc.push(abs);
  }
  return acc;
}
export const isTestPath = (p) => /(^|[\\/])src[\\/](test|it|integrationTest|testFixtures)[\\/]/.test(p);

// ---------- masking ----------
export function maskJava(src) {
  const parts = [];
  let last = 0;
  const blank = (a, b) => { if (b <= a) return; parts.push(src.slice(last, a), src.slice(a, b).replace(/[^\n]/g, ' ')); last = b; };
  const n = src.length;
  for (let i = 0; i < n;) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; }
    else if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; }
    else if (c === '"' && src.startsWith('"""', i)) {
      let j = i + 3;
      while (j < n && !(src.startsWith('"""', j) && src[j - 1] !== '\\')) j++;
      blank(i + 3, Math.min(j, n)); i = Math.min(j + 3, n);
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      blank(i + 1, Math.min(j, n)); i = j + 1;
    } else i++;
  }
  parts.push(src.slice(last));
  return parts.join('');
}

export function matchClose(m, i, open = '{', close = '}') {
  let depth = 0;
  for (let j = i; j < m.length; j++) {
    if (m[j] === open) depth++;
    else if (m[j] === close && --depth === 0) return j;
  }
  return m.length - 1;
}

// Annotations (with their arguments) replaced by spaces, so the rest can be parsed. Returns the names and spans too.
export function blankAnnotations(text, offset = 0) {
  const found = [];
  let out = text;
  const rx = /@\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)/g;
  let m;
  while ((m = rx.exec(text))) {
    if (m[1] === 'interface') continue;
    let end = m.index + m[0].length;
    let k = end;
    while (k < text.length && /\s/.test(text[k])) k++;
    let argsStart = -1, argsEnd = -1;
    if (text[k] === '(') { argsStart = k; argsEnd = matchClose(text, k, '(', ')'); end = argsEnd + 1; }
    found.push({ name: m[1].replace(/\s+/g, '').split('.').pop(), start: offset + m.index, end: offset + end,
      argsStart: argsStart < 0 ? -1 : offset + argsStart + 1, argsEnd: argsEnd < 0 ? -1 : offset + argsEnd });
    out = out.slice(0, m.index) + ' '.repeat(end - m.index) + out.slice(end);
    rx.lastIndex = end;
  }
  return { text: out, annotations: found };
}

const MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'final', 'abstract', 'synchronized', 'native',
  'transient', 'volatile', 'strictfp', 'default', 'sealed', 'non-sealed']);

function splitTopLevel(s, sep = ',') {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
const stripGenerics = (t) => { let s = t; let prev; do { prev = s; s = s.replace(/<[^<>]*>/g, ''); } while (s !== prev); return s; };
export const simpleType = (t) => stripGenerics(t || '').replace(/\[\s*\]|\.\.\.|\s+/g, '').split('.').pop();

// ---------- parsing ----------
export function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
}

export function parseJava(src, { members = false } = {}) {
  const m = maskJava(src);
  const pkgM = /(^|[;\s}])package\s+([\w$]+(?:\s*\.\s*[\w$]+)*)\s*;/.exec(m);
  const pkg = pkgM ? pkgM[2].replace(/\s+/g, '') : '';
  const pkgDecl = pkgM ? { start: pkgM.index + pkgM[1].length, end: pkgM.index + pkgM[0].length } : null;
  const imports = [];
  for (const x of m.matchAll(/(^|[;\s}])import\s+(static\s+)?([\w$]+(?:\s*\.\s*[\w$]+)*)(\s*\.\s*\*)?\s*;/g)) {
    imports.push({ name: x[3].replace(/\s+/g, ''), static: !!x[2], wildcard: !!x[4], start: x.index + x[1].length, end: x.index + x[0].length });
  }
  const headerEnd = imports.length ? imports.at(-1).end : pkgDecl ? pkgDecl.end : 0;

  // top-level types: depth 0
  const types = [];
  let depth = 0, paren = 0, boundary = headerEnd;
  const rx = /(@\s*interface|\b(?:class|interface|enum|record))\s+([A-Za-z_$][\w$]*)/y;
  for (let i = headerEnd; i < m.length; i++) {
    const c = m[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (paren > 0) continue; // braces inside annotation arguments
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) boundary = i + 1; }
    else if (c === ';' && depth === 0) boundary = i + 1;
    if (depth !== 0 || paren !== 0) continue;
    if (c !== '@' && !/[a-z]/.test(c)) continue;
    rx.lastIndex = i;
    const t = rx.exec(m);
    if (!t) continue;
    const kind = t[1].startsWith('@') ? 'annotation' : t[1];
    const name = t[2];
    const open = m.indexOf('{', t.index + t[0].length);
    if (open < 0) break;
    const close = matchClose(m, open);
    const head = blankAnnotations(m.slice(boundary, t.index), boundary);
    const mods = new Set(head.text.split(/\s+/).filter((w) => MODIFIERS.has(w)));
    const tail = m.slice(t.index + t[0].length, open);
    const ext = /\bextends\s+([\s\S]+?)(?=\bimplements\b|\bpermits\b|$)/.exec(tail);
    const imp = /\bimplements\s+([\s\S]+?)(?=\bpermits\b|$)/.exec(tail);
    const type = {
      name, kind, public: mods.has('public'), modifiers: [...mods],
      annotations: head.annotations.map((a) => ({ name: a.name, args: a.argsStart >= 0 ? src.slice(a.argsStart, a.argsEnd) : '' })),
      extends: ext ? splitTopLevel(ext[1]).map(simpleType).filter(Boolean) : [],
      implements: imp ? splitTopLevel(imp[1]).map(simpleType).filter(Boolean) : [],
      declStart: head.annotations.length ? head.annotations[0].start : t.index, nameStart: t.index + t[0].length - name.length,
      bodyStart: open, bodyEnd: close,
    };
    if (members) type.members = parseMembers(m, src, type);
    types.push(type);
    i = close; depth = 0; boundary = close + 1;
  }
  return { pkg, pkgDecl, imports, types, masked: m, headerEnd };
}

function parseMembers(m, src, type) {
  const members = [];
  let s = type.bodyStart + 1;
  const e = type.bodyEnd;
  if (type.kind === 'enum') {
    // skip the constants section (up to the first ';' at this level)
    let d = 0, p = 0, found = -1;
    for (let i = s; i < e; i++) {
      const c = m[i];
      if (c === '{') d++; else if (c === '}') d--; else if (c === '(') p++; else if (c === ')') p--;
      else if (c === ';' && d === 0 && p === 0) { found = i; break; }
    }
    if (found < 0) return members;
    s = found + 1;
  }
  let segStart = s, paren = 0;
  for (let i = s; i < e; i++) {
    const c = m[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '{') {
      const close = matchClose(m, i);
      if (paren > 0) { i = close; continue; }
      const head = blankAnnotations(m.slice(segStart, i), segStart);
      const clean = head.text;
      const noGen = stripGenerics(clean);
      if (/=/.test(noGen.split('(')[0]) || (/=/.test(noGen) && !/\)\s*(throws[\s\S]*)?$/.test(noGen.trim()))) { i = close; continue; } // field initializer with a block
      if (/\b(class|interface|enum|record)\s+[A-Za-z_$]/.test(clean) || /@\s*interface/.test(m.slice(segStart, i))) {
        members.push({ kind: 'type', name: (/\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/.exec(clean) || [])[1] || '?', start: segStart, end: close + 1 });
      } else if (clean.includes('(')) {
        const mm = methodFrom(clean, segStart, head, src, type.name);
        if (mm) { mm.bodyStart = i; mm.bodyEnd = close; mm.end = close + 1; members.push(mm); }
      }
      i = close; segStart = i + 1;
    } else if (c === ';' && paren === 0) {
      const head = blankAnnotations(m.slice(segStart, i), segStart);
      const clean = head.text;
      if (clean.trim()) {
        const eq = splitTopLevel(clean, '=');
        if (clean.includes('(') && eq.length === 1) {
          const mm = methodFrom(clean, segStart, head, src, type.name);
          if (mm) { mm.abstract = true; mm.end = i + 1; members.push(mm); }
        } else {
          for (const f of fieldsFrom(clean, segStart, head, src, i)) members.push(f);
        }
      }
      segStart = i + 1;
    }
  }
  return members;
}

function annList(head, src) {
  return head.annotations.map((a) => ({ name: a.name, args: a.argsStart >= 0 ? src.slice(a.argsStart, a.argsEnd) : '' }));
}
function visibilityOf(mods) {
  return mods.has('private') ? 'private' : mods.has('protected') ? 'protected' : mods.has('public') ? 'public' : 'package';
}

function methodFrom(clean, offset, head, src, className) {
  const open = clean.indexOf('(');
  const close = matchClose(clean, open, '(', ')');
  const before = clean.slice(0, open).trim();
  const nm = /([A-Za-z_$][\w$]*)$/.exec(before);
  if (!nm) return null;
  const name = nm[1];
  const words = before.slice(0, before.length - name.length).trim();
  const mods = new Set(words.split(/\s+/).filter((w) => MODIFIERS.has(w)));
  let returnType = words.split(/\s+/).filter((w) => !MODIFIERS.has(w)).join(' ').replace(/^<[^>]*>\s*/, '').trim();
  const params = splitTopLevel(clean.slice(open + 1, close)).map((p) => {
    const t = p.replace(/\bfinal\b/g, '').trim().replace(/\s+/g, ' ');
    const pm = /([A-Za-z_$][\w$]*)\s*(\[\s*\])*$/.exec(t);
    return pm ? { name: pm[1], type: t.slice(0, pm.index).trim() } : null;
  }).filter(Boolean);
  const isCtor = name === className && !returnType;
  const startPos = head.annotations.length ? head.annotations[0].start : offset + (clean.length - clean.trimStart().length);
  return {
    kind: isCtor ? 'constructor' : 'method', name, visibility: visibilityOf(mods), static: mods.has('static'),
    returnType, params, annotations: annList(head, src),
    signature: `${[...mods].filter((x) => x !== 'default').join(' ')}${mods.size ? ' ' : ''}${returnType ? returnType + ' ' : ''}${name}(${params.map((p) => `${p.type} ${p.name}`).join(', ')})`.replace(/\s+/g, ' ').trim(),
    start: startPos, nameStart: offset + nm.index,
  };
}

function fieldsFrom(clean, offset, head, src, endPos) {
  const parts = splitTopLevel(clean, '=');
  const left = parts[0];
  const initRaw = parts.length > 1 ? src.slice(offset + clean.indexOf('=', left.length) + 1, endPos).trim() : '';
  const decls = splitTopLevel(left);
  const first = decls[0].trim().split(/\s+/);
  const mods = new Set(first.filter((w) => MODIFIERS.has(w)));
  const rest = first.filter((w) => !MODIFIERS.has(w)).join(' ');
  const nm = /([A-Za-z_$][\w$]*)\s*(\[\s*\])*$/.exec(rest);
  if (!nm) return [];
  const type = rest.slice(0, nm.index).trim();
  if (!type) return [];
  const names = [nm[1], ...decls.slice(1).map((d) => (/^\s*([A-Za-z_$][\w$]*)/.exec(d) || [])[1]).filter(Boolean)];
  const startPos = head.annotations.length ? head.annotations[0].start : offset + (clean.length - clean.trimStart().length);
  return names.map((name) => ({
    kind: 'field', name, type, visibility: visibilityOf(mods), static: mods.has('static'), final: mods.has('final'),
    hasInit: parts.length > 1, init: initRaw.replace(/\s+/g, ' ').slice(0, 60), annotations: annList(head, src),
    start: startPos, end: endPos + 1, nameStart: offset + left.lastIndexOf(name),
  }));
}

// Identifiers used in a code range (masked text), excluding member access on other objects (x.foo).
const JAVA_KEYWORDS = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record yield true false null').split(' '));
export function usesIn(masked, start, end, own) {
  // own: { fields: Set, methods: Set, className }
  const body = masked.slice(start, end);
  const locals = new Set();
  for (const x of body.matchAll(/(?:^|[;{}(,]|\bfinal)\s*(?:[A-Z][\w$.]*|int|long|double|float|boolean|char|byte|short|var)(?:\s*<[^;{}()]*?>)?(?:\s*\[\s*\])*\s+([a-z_$][\w$]*)\s*(?=[=;:,)])/g)) locals.add(x[1]);
  for (const x of body.matchAll(/([a-z_$][\w$]*)\s*->/g)) locals.add(x[1]);
  for (const x of body.matchAll(/\(([^()]*)\)\s*->/g)) for (const p of x[1].split(',')) { const w = p.trim().split(/\s+/).pop(); if (w) locals.add(w); }
  const fields = new Set(), methods = new Set();
  const rx = /(\bthis\s*\.\s*|\b[A-Z][\w$]*\s*\.\s*|(?<![\w$.]))([A-Za-z_$][\w$]*)(\s*\()?/g;
  let m;
  while ((m = rx.exec(body))) {
    const qual = m[1].replace(/\s+/g, '');
    const name = m[2];
    if (JAVA_KEYWORDS.has(name)) continue;
    const isThis = qual === 'this.';
    const isOwnStatic = qual && qual !== 'this.' && qual.slice(0, -1) === own.className;
    if (qual && !isThis && !isOwnStatic) continue;
    if (m[3]) { if (own.methods.has(name)) methods.add(name); }
    else if (own.fields.has(name) && (isThis || isOwnStatic || !locals.has(name))) fields.add(name);
  }
  for (const x of body.matchAll(/\b(?:this|[A-Z][\w$]*)\s*::\s*([a-z_$][\w$]*)/g)) if (own.methods.has(x[1])) methods.add(x[1]);
  return { fields, methods };
}

// ---------- kinds ----------
const LISTENER_ANN = /@(KafkaListener|RabbitListener|JmsListener|SqsListener|ServiceBusListener|StreamListener|KafkaHandler|RabbitHandler)\b/;
// Project annotations that are themselves Spring stereotypes (e.g. @UseCase annotated with @Component)
const STEREOTYPES = ['Service', 'Component', 'Repository', 'Controller', 'RestController', 'Configuration'];
export function stereotypesOf(infos) {
  const map = new Map();
  for (const info of infos) for (const t of info.types) {
    if (t.kind !== 'annotation') continue;
    const base = t.annotations.map((a) => a.name).find((a) => STEREOTYPES.includes(a));
    if (base) map.set(t.name, base);
  }
  return map;
}
export function kindOfType(t, masked, stereo = new Map()) {
  if (t.kind === 'annotation') return 'annotation';
  const ann = new Set(t.annotations.map((a) => stereo.get(a.name) || a.name));
  const has = (...xs) => xs.some((x) => ann.has(x));
  if (has('SpringBootApplication')) return 'application';
  if (has('RestController', 'Controller', 'ControllerAdvice', 'RestControllerAdvice')) return 'controller';
  if (has('Path') && t.kind === 'class') return 'controller'; // JAX-RS resource (Jersey, RESTEasy)
  if (has('Repository') || (t.kind === 'interface' && t.extends.some((x) => /Repository$/.test(x))) || /Repository(Impl)?$/.test(t.name)) return 'repository';
  if (has('Entity', 'Embeddable', 'MappedSuperclass', 'Document')) return 'entity';
  if (has('Configuration', 'ConfigurationProperties', 'AutoConfiguration', 'EnableWebSecurity')) return 'config';
  if (has('Mapper') || /Mapper(Impl)?$/.test(t.name)) return 'mapper';
  if (has('Service')) return 'service';
  if (LISTENER_ANN.test(masked) || /(Listener|Consumer)$/.test(t.name)) return 'listener';
  if (has('Component')) return 'component';
  if (/Exception$|Error$/.test(t.name) || t.extends.some((x) => /Exception$|Throwable$|Error$/.test(x))) return 'exception';
  if (/(Dto|DTO|Request|Response|Command|Payload|Event|View|Form|Resource)$/.test(t.name)) return 'dto';
  if (/Service(Impl)?$/.test(t.name) && t.kind === 'class') return 'service';
  if (t.kind === 'enum' || t.kind === 'record') return 'model';
  if (t.kind === 'interface') return 'interface';
  return 'other';
}
export const SPRING_PLURAL = { application: 'application', controller: 'controllers', service: 'services', repository: 'repositories',
  entity: 'entities', dto: 'DTOs', mapper: 'mappers', config: 'config', component: 'components', listener: 'listeners',
  exception: 'exceptions', model: 'models', interface: 'interfaces', annotation: 'annotations', other: 'other' };
export const SPRING_SINGULAR = { application: 'application', controller: 'controller', service: 'service', repository: 'repository',
  entity: 'entity', dto: 'DTO', mapper: 'mapper', config: 'config', component: 'component', listener: 'listener',
  exception: 'exception', model: 'model', interface: 'interface', annotation: 'annotation', other: 'other' };
export const SPRING_TOTALS = ['controller', 'service', 'repository', 'entity', 'dto', 'mapper', 'listener', 'config', 'component'];

// ---------- project index ----------
// Every .java file under scanRoot (main and test), with FQNs, packages and identifier sets.
const FQN_RX = /\b[a-z_$][\w$]*(?:\.[a-z_$][\w$]*)+\.[A-Z][\w$]*/g;
const ENDPOINT_HINT = /@(RestController|Controller|Path|KafkaListener|RabbitListener|JmsListener|SqsListener|ServiceBusListener|Scheduled)\b/;
// Facts for the Spring rules (cached): size, field injection, proxy annotations on methods Spring's proxy can't intercept
const ANN_ARGS = String.raw`(?:\s*\((?:[^()]|\([^()]*\))*\))?`;
const FIELD_INJECT_RX = new RegExp(String.raw`@(Autowired|Inject|Resource)\b${ANN_ARGS}\s+((?:@[\w.]+${ANN_ARGS}\s+)*)((?:(?:private|protected|public|static|final|transient|volatile)\s+)*)[\w$.<>\[\], ?]+?\s+([A-Za-z_$][\w$]*)\s*(?:;|=)`, 'g');
const PROXY_RX = new RegExp(String.raw`@(Transactional|Async|Cacheable|CachePut|CacheEvict|Retryable)\b${ANN_ARGS}\s+((?:@[\w.]+${ANN_ARGS}\s+)*)((?:(?:public|protected|private|static|final|synchronized|abstract|default)\s+)*)(?:<[^>]*>\s*)?[\w$.<>\[\], ?]+?\s+([A-Za-z_$][\w$]*)\s*\(`, 'g');
export function springFacts(src, masked) {
  const f = { lines: src.split('\n').length };
  const inject = [...masked.matchAll(FIELD_INJECT_RX)].map((m) => m[4]);
  if (inject.length) f.fieldInjection = inject;
  const proxy = [];
  for (const m of masked.matchAll(PROXY_RX)) {
    const mod = (m[3].match(/\b(private|final|static)\b/) || [])[1];
    if (mod) proxy.push({ annotation: m[1], method: m[4], modifier: mod });
  }
  if (proxy.length) f.proxyIssues = proxy;
  return f;
}

export class JavaIndex {
  // options.cache (cache.mjs): "lite" index for the map, built from cached facts without keeping the sources.
  // Without a cache, every file keeps its source (moves and the method analysis need it).
  constructor(scanRoot, options = {}) {
    this.scanRoot = scanRoot;
    this.cache = options.cache || null;
    this.files = new Map(); // abs -> info
    this.byFqn = new Map(); // fqn -> abs
    this.byPkg = new Map(); // pkg -> Set(abs)
    for (const abs of walkJava(scanRoot)) this.add(abs);
  }
  add(abs, srcOverride) {
    let info = srcOverride === undefined && this.cache ? this.cache.get(abs) : undefined;
    if (info) info = { ...info, abs };
    else {
      const src = srcOverride ?? fs.readFileSync(abs, 'utf8');
      const p = parseJava(src);
      info = { abs, src, pkg: p.pkg, pkgDecl: p.pkgDecl, imports: p.imports, types: p.types, masked: p.masked, headerEnd: p.headerEnd, test: isTestPath(abs) };
      const body = p.masked.slice(p.headerEnd);
      info.identList = [...new Set(body.match(/\b[A-Z][\w$]*/g) || [])];
      info.fqns = [...new Set(body.match(FQN_RX) || [])];
      info.listener = LISTENER_ANN.test(p.masked);
      const primaryName = path.basename(abs, '.java');
      const t = p.types.find((x) => x.name === primaryName) || p.types[0];
      info.endpoints = t && ENDPOINT_HINT.test(p.masked) ? endpointsOf(info, t, '') : [];
      Object.assign(info, springFacts(src, p.masked));
      if (this.cache && srcOverride === undefined) {
        const { src: _s, masked: _m, abs: _a, ...facts } = info;
        this.cache.set(abs, facts);
      }
    }
    const primary = path.basename(abs, '.java');
    info.typeNames = info.types.length ? info.types.map((t) => t.name) : [primary];
    const p = { pkg: info.pkg };
    this.files.set(abs, info);
    for (const n of info.typeNames) this.byFqn.set(p.pkg ? `${p.pkg}.${n}` : n, abs);
    if (!this.byPkg.has(p.pkg)) this.byPkg.set(p.pkg, new Set());
    this.byPkg.get(p.pkg).add(abs);
    return info;
  }
  // identifiers (capitalized words) used outside package/import lines
  idents(info) {
    if (!info._idents) info._idents = new Set(info.identList || (info.masked.slice(info.headerEnd).match(/\b[A-Z][\w$]*/g) || []));
    return info._idents;
  }
  // resolve a dotted name to a project file: exact type, nested type, or static member
  resolve(name) {
    const parts = name.split('.');
    for (let k = parts.length; k > 0; k--) {
      const f = this.byFqn.get(parts.slice(0, k).join('.'));
      if (f) return { file: f, fqn: parts.slice(0, k).join('.') };
    }
    return null;
  }
  // project files this file depends on
  depsOf(info) {
    const out = new Set(), externals = [];
    const idents = this.idents(info);
    for (const imp of info.imports) {
      if (imp.wildcard && !imp.static) {
        const set = this.byPkg.get(imp.name);
        if (set) { for (const f of set) if (f !== info.abs && this.files.get(f).typeNames.some((n) => idents.has(n))) out.add(f); continue; }
        const r = this.resolve(imp.name); // static-like wildcard on a type: import a.b.C.*
        if (r) { out.add(r.file); continue; }
        externals.push(imp.name);
        continue;
      }
      const r = this.resolve(imp.name);
      if (r) out.add(r.file); else externals.push(imp.name);
    }
    for (const f of this.byPkg.get(info.pkg) || []) {
      if (f !== info.abs && this.files.get(f).typeNames.some((n) => idents.has(n))) out.add(f);
    }
    // fully qualified names in code
    for (const x of info.fqns || (info.masked.slice(info.headerEnd).match(FQN_RX) || [])) {
      const r = this.byFqn.get(x);
      if (r && r !== info.abs) out.add(r);
    }
    out.delete(info.abs);
    return { files: [...out], externals };
  }
  // where a package lives on disk: the source root (…/src/main/java) of a file, plus the package path
  static sourceRootOf(abs, pkg) {
    const dir = path.dirname(abs);
    const pkgPath = pkg ? pkg.split('.').join(path.sep) : '';
    return pkgPath && dir.endsWith(path.sep + pkgPath) ? dir.slice(0, dir.length - pkgPath.length - 1) : (pkgPath ? null : dir);
  }
}

export function libraryOf(name) {
  const s = name.split('.');
  if (['java', 'javax', 'jdk', 'sun', 'com.sun'].includes(s[0])) return null;
  if (s[0] === 'javax' && s[1] !== 'annotation') return null;
  if (s.length <= 2) return s[0];
  const reverseDomain = ['org', 'com', 'io', 'net', 'de', 'ch', 'nl', 'fr', 'uk', 'edu', 'me', 'dev', 'app', 'info', 'eu', 'at'];
  if (!reverseDomain.includes(s[0])) return s.slice(0, 2).join('.');
  return s.slice(0, s.length >= 4 ? 3 : 2).join('.');
}

// ---------- endpoints ----------
function stringsIn(args) { return [...(args || '').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]); }
function mappingPaths(args) {
  if (!args || !args.trim()) return [''];
  const named = /\b(?:value|path)\s*=\s*(\{[^}]*\}|"(?:[^"\\]|\\.)*")/.exec(args);
  if (named) return stringsIn(named[1]);
  if (/^\s*[{"]/.test(args)) { const first = /^\s*(\{[^}]*\}|"(?:[^"\\]|\\.)*")/.exec(args); return first ? stringsIn(first[1]) : ['']; }
  return [''];
}
const joinPath = (a, b) => ('/' + [a, b].map((x) => x.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')).replace(/\/+/g, '/');

export function endpointsOf(info, type, relPath) {
  const out = [];
  const classMap = type.annotations.find((a) => a.name === 'RequestMapping');
  const bases = classMap ? mappingPaths(classMap.args) : [''];
  const classPath = type.annotations.find((a) => a.name === 'Path');
  const jaxBases = classPath ? [stringsIn(classPath.args)[0] ?? ''] : [''];
  const typeInfo = parseJava(info.src, { members: true }).types.find((t) => t.name === type.name);
  for (const mem of (typeInfo?.members || []).filter((x) => x.kind === 'method')) {
    for (const a of mem.annotations) {
      const verbM = /^(Get|Post|Put|Delete|Patch|Request)Mapping$/.exec(a.name);
      if (verbM) {
        let verb = verbM[1].toUpperCase();
        if (verb === 'REQUEST') { const mm = /RequestMethod\.(\w+)/.exec(a.args); verb = mm ? mm[1] : 'ANY'; }
        for (const b of bases) for (const p of mappingPaths(a.args)) out.push({ file: relPath, path: `${verb} ${joinPath(b, p)}`, target: `${type.name}.${mem.name}()` });
      }
      const jax = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/.exec(a.name);
      if (jax) {
        const sub = mem.annotations.find((x) => x.name === 'Path');
        for (const b of jaxBases) out.push({ file: relPath, path: `${jax[1]} ${joinPath(b, sub ? (stringsIn(sub.args)[0] ?? '') : '')}`, target: `${type.name}.${mem.name}()` });
      }
      const lis = /^(KafkaListener|RabbitListener|JmsListener|SqsListener|ServiceBusListener)$/.exec(a.name);
      if (lis) {
        const dest = /\b(?:topics|queues|destination|value|topicPattern)\s*=\s*(\{[^}]*\}|"(?:[^"\\]|\\.)*")/.exec(a.args);
        const names = dest ? stringsIn(dest[1]) : stringsIn(a.args).slice(0, 1);
        out.push({ file: relPath, path: `${lis[1].replace('Listener', '').toUpperCase()} ${names.join(', ') || '?'}`, target: `${type.name}.${mem.name}()` });
      }
      if (a.name === 'Scheduled') out.push({ file: relPath, path: `SCHEDULED ${stringsIn(a.args).join(' ') || a.args.replace(/\s+/g, ' ').trim()}`, target: `${type.name}.${mem.name}()` });
    }
  }
  return out;
}

// ---------- the map ----------
// Returns the same shape generate-map.mjs builds for Angular.
export function scanSpring({ ROOT, scanRoot, config, matchAny, cache }) {
  const rel = (abs) => toPosix(path.relative(ROOT, abs));
  const index = new JavaIndex(scanRoot, { cache });
  const inRoot = (abs) => abs.startsWith(ROOT + path.sep);
  // tests live in src/test/java with the same packages; count those that mirror the root
  const sep = path.sep;
  const testRoot = ROOT.includes(`${sep}src${sep}main${sep}`) ? ROOT.replace(`${sep}src${sep}main${sep}`, `${sep}src${sep}test${sep}`) : ROOT;
  const inTests = (abs) => abs.startsWith(testRoot + sep) || abs.startsWith(ROOT + sep);
  const files = [];
  const externals = new Map();
  const routes = [];
  let testCount = 0;
  const stereo = stereotypesOf([...index.files.values()].filter((i) => !i.test));
  for (const info of index.files.values()) {
    if (info.test) { if (inTests(info.abs) && /(Test|Tests|IT|ITCase)\.java$/.test(info.abs)) testCount++; continue; }
    if (!inRoot(info.abs)) continue;
    const p = rel(info.abs);
    if (matchAny(config.ignore, p)) continue;
    const primaryName = path.basename(info.abs, '.java');
    const t = info.types.find((x) => x.name === primaryName) || info.types[0];
    const entry = { path: p, kind: t ? kindOfType(t, info.listener ? '@KafkaListener' : '', stereo) : 'other', name: primaryName, imports: [] };
    if (info.pkg) entry.package = info.pkg;
    if (t && t.annotations.length) entry.annotations = t.annotations.map((a) => a.name);
    const deps = index.depsOf(info);
    for (const f of deps.files) if (inRoot(f) && !index.files.get(f).test) entry.imports.push(rel(f));
    for (const e of deps.externals) { const lib = libraryOf(e); if (lib) externals.set(lib, (externals.get(lib) || 0) + 1); }
    // in memory only (not in the JSON): facts for the rules
    entry.lines = info.lines;
    entry._ext = deps.externals;
    if (info.fieldInjection) entry._fieldInjection = info.fieldInjection;
    if (info.proxyIssues) entry._proxyIssues = info.proxyIssues;
    entry.imports.sort();
    for (const e of info.endpoints || []) routes.push({ ...e, file: p });
    files.push(entry);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  // test classes (FooTest, FooTests, FooIT) left in the old package after class Foo moved to another one.
  // (A test of a class that is gone entirely would not compile; tests not named after a class are not checked.)
  const pkgsOf = new Map();
  for (const i of index.files.values()) if (!i.test) for (const n of i.typeNames) { if (!pkgsOf.has(n)) pkgsOf.set(n, new Set()); pkgsOf.get(n).add(i.pkg); }
  const orphanTests = [];
  for (const info of index.files.values()) {
    if (!info.test || !inTests(info.abs)) continue;
    const m = /^(\w+?)(Test|Tests|IT|ITCase)\.java$/.exec(path.basename(info.abs));
    const where = m && pkgsOf.get(m[1]);
    if (where && !where.has(info.pkg) && where.size === 1) orphanTests.push({ test: toPosix(path.relative(scanRoot, info.abs)), subject: m[1], movedTo: [...where][0] });
  }
  return { files, externals, routes, testCount, orphanTests };
}
