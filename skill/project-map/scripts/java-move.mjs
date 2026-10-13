// Move engine for Java: moves a class (with its tests) or a whole package (with its test package),
// changes the package declarations, and rewrites every import that is affected:
// - imports of moved classes (single, static, wildcard)
// - classes that used each other without an import because they were in the same package
// - fully qualified names in code
// Text that can't be rewritten safely (strings, application.yml, XML) is reported as a warning.
import fs from 'node:fs';
import path from 'node:path';
import { JavaIndex, isTestPath, toPosix, walkJava } from './java.mjs';

const SRC_ROOT_RX = /^(.*[\\/]src[\\/][^\\/]+[\\/]java)(?:[\\/](.*))?$/;
// { srcRoot, pkg } for a folder inside src/<set>/java, or null
export function packageOfDir(dir) {
  const m = SRC_ROOT_RX.exec(dir);
  if (!m) return null;
  const rest = m[2] ? m[2].split(/[\\/]/).filter(Boolean) : [];
  if (rest.some((s) => !/^[A-Za-z_$][\w$]*$/.test(s))) return { srcRoot: m[1], pkg: null, bad: rest.join('/') };
  return { srcRoot: m[1], pkg: rest.join('.') };
}
const mirrorTestRoot = (srcRoot) => srcRoot.replace(/([\\/]src[\\/])main([\\/]java)$/, '$1test$2');
const moduleOf = (srcRoot) => srcRoot.replace(/[\\/]src[\\/][^\\/]+[\\/]java$/, '');
const pkgPath = (pkg) => (pkg ? pkg.split('.').join(path.sep) : '');
const TEST_SUFFIXES = ['Test', 'Tests', 'IT', 'ITCase', 'IntegrationTest'];

function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(abs)); else out.push(abs);
  }
  return out;
}

export function mappingForMoveJava(ctx, sourceRel, targetFolderRel) {
  const { appRoot } = ctx;
  const src = path.resolve(appRoot, sourceRel);
  const target = path.resolve(appRoot, targetFolderRel || '.');
  const errors = [];
  const inApp = (p) => p === appRoot || p.startsWith(appRoot + path.sep);
  if (!inApp(src) || !fs.existsSync(src)) errors.push(`Source not found: ${sourceRel}`);
  if (!inApp(target) || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) errors.push(`Target folder not found: ${targetFolderRel}`);
  if (errors.length) return { errors, pairs: [] };
  const tp = packageOfDir(target);
  if (!tp) return { errors: ['The target folder is not inside a Java source folder (src/main/java).'], pairs: [] };
  if (tp.pkg === null) return { errors: [`"${tp.bad}" is not a valid package name.`], pairs: [] };
  const rel = (p) => toPosix(path.relative(appRoot, p));
  const pairs = [];
  const add = (from, to) => {
    if (fs.existsSync(to)) errors.push(`${toPosix(path.relative(ctx.repoRoot, to))} already exists.`);
    pairs.push({ from, to });
  };

  if (fs.statSync(src).isDirectory()) {
    if (target === src || target.startsWith(src + path.sep)) errors.push('A folder cannot be moved into itself.');
    if (path.dirname(src) === target) errors.push('The folder is already there.');
    if (!/^[A-Za-z_$][\w$]*$/.test(path.basename(src))) errors.push(`"${path.basename(src)}" is not a valid package name.`);
    const sp = packageOfDir(src);
    if (!sp || sp.pkg === null || !sp.pkg) errors.push('Only packages inside src/main/java can be moved.');
    if (errors.length) return { errors, pairs };
    const dest = path.join(target, path.basename(src));
    for (const f of listFiles(src)) add(f, path.join(dest, path.relative(src, f)));
    // the matching test package moves along
    const testSrc = path.join(mirrorTestRoot(sp.srcRoot), pkgPath(sp.pkg));
    const testDest = path.join(mirrorTestRoot(tp.srcRoot), pkgPath(tp.pkg), path.basename(src));
    if (testSrc !== src && fs.existsSync(testSrc)) for (const f of listFiles(testSrc)) add(f, path.join(testDest, path.relative(testSrc, f)));
  } else {
    if (path.dirname(src) === target) return { errors: ['The class is already in that package.'], pairs: [] };
    add(src, path.join(target, path.basename(src)));
    const sp = packageOfDir(path.dirname(src));
    if (src.endsWith('.java') && sp && sp.pkg !== null && !isTestPath(src)) {
      const stem = path.basename(src, '.java');
      const testDir = path.join(mirrorTestRoot(sp.srcRoot), pkgPath(sp.pkg));
      const testTarget = path.join(mirrorTestRoot(tp.srcRoot), pkgPath(tp.pkg));
      if (testDir !== path.dirname(src) && fs.existsSync(testDir)) {
        for (const n of fs.readdirSync(testDir)) {
          if (TEST_SUFFIXES.some((s) => n === `${stem}${s}.java`)) add(path.join(testDir, n), path.join(testTarget, n));
        }
      }
    }
  }
  void rel;
  return { errors, pairs };
}

const FQN_RX = /\b[a-z_$][\w$]*(?:\.[a-z_$][\w$]*)+\.[A-Z][\w$]*/g;
const TEXT_EXT = /\.(ya?ml|properties|xml|json|sql|kts?|gradle|conf|txt|md|factories|imports)$/;

export function planFromPairsJava(ctx, pairs) {
  const index = new JavaIndex(ctx.scanRoot);
  const map = new Map(pairs.map((p) => [p.from, p.to]));
  const warnings = [];
  const edits = [];

  // what moves: files -> packages, types -> new FQN
  const movedFile = new Map(); // oldAbs -> { newAbs, oldPkg, newPkg }
  const movedType = new Map(); // oldFqn -> { newFqn, newPkg, simple, public }
  for (const { from, to } of pairs) {
    if (!from.endsWith('.java')) continue;
    const info = index.files.get(from);
    const dest = packageOfDir(path.dirname(to));
    if (!info || !dest || dest.pkg === null) continue;
    movedFile.set(from, { newAbs: to, oldPkg: info.pkg, newPkg: dest.pkg });
    if (info.pkg === dest.pkg) continue;
    for (const t of info.types.length ? info.types : [{ name: path.basename(from, '.java'), public: true }]) {
      movedType.set(info.pkg ? `${info.pkg}.${t.name}` : t.name, { newFqn: dest.pkg ? `${dest.pkg}.${t.name}` : t.name, newPkg: dest.pkg, oldPkg: info.pkg, simple: t.name, public: t.public, file: from });
    }
    const oldMod = moduleOf(packageOfDir(path.dirname(from))?.srcRoot || ''), newMod = moduleOf(dest.srcRoot);
    if (oldMod && newMod && oldMod !== newMod) warnings.push(`${toPosix(path.relative(ctx.repoRoot, from))} moves to another module (${toPosix(path.relative(ctx.repoRoot, newMod)) || '.'}); check the module dependencies in pom.xml / build.gradle.`);
  }
  // packages that move completely (wildcard imports can follow them)
  const pkgMoves = new Map();
  for (const [pkg, set] of index.byPkg) {
    const targets = new Set([...set].map((f) => movedFile.get(f)?.newPkg ?? null));
    const only = [...targets][0];
    if (targets.size === 1 && only !== null && only !== pkg) pkgMoves.set(pkg, only);
  }
  const typeByFqn = (fqn) => { const abs = index.byFqn.get(fqn); return abs ? index.files.get(abs) : null; };
  const isPublicType = (fqn) => { const info = typeByFqn(fqn); const t = info?.types.find((x) => fqn.endsWith('.' + x.name) || fqn === x.name); return !t || t.public; };
  const newPkgOfType = (fqn, pkg) => movedType.get(fqn)?.newPkg ?? pkg;

  for (const info of index.files.values()) {
    const mf = movedFile.get(info.abs);
    const newAbs = mf ? mf.newAbs : info.abs;
    const myPkg = mf ? mf.newPkg : info.pkg;
    const src = info.src;
    const reps = [];
    const adds = new Set();
    const idents = index.idents(info);
    const ownTypes = new Set(info.typeNames);

    // 1. package declaration
    if (mf && mf.newPkg !== info.pkg) {
      if (info.pkgDecl) reps.push({ start: info.pkgDecl.start, end: info.pkgDecl.end, from: `package ${info.pkg};`, to: `package ${mf.newPkg};` });
      else reps.push({ start: 0, end: 0, from: '', to: `package ${mf.newPkg};\n\n` });
    }

    // 2. imports
    const explicitSimple = new Set();
    const wildcardPkgs = new Set();
    const removeImport = (imp, label) => {
      let end = imp.end;
      if (src[end] === '\r') end++;
      if (src[end] === '\n') end++;
      reps.push({ start: imp.start, end, from: label, to: '', display: '(removed: same package now)' });
    };
    for (const imp of info.imports) {
      const text = `import ${imp.static ? 'static ' : ''}${imp.name}${imp.wildcard ? '.*' : ''};`;
      if (imp.wildcard && !imp.static) {
        wildcardPkgs.add(imp.name);
        const np = pkgMoves.get(imp.name);
        if (np) {
          if (np === myPkg) removeImport(imp, text);
          else reps.push({ start: imp.start, end: imp.end, from: text, to: `import ${np}.*;` });
          wildcardPkgs.add(np);
          continue;
        }
        // some classes left that package: import them explicitly where used
        for (const [oldFqn, mt] of movedType) {
          if (mt.oldPkg === imp.name && idents.has(mt.simple) && mt.newPkg !== myPkg) adds.add(mt.newFqn);
        }
        continue;
      }
      // single-type or static import: longest moved prefix
      const parts = imp.name.split('.');
      let rewritten = null;
      for (let k = parts.length; k > 0; k--) {
        const pre = parts.slice(0, k).join('.');
        const mt = movedType.get(pre);
        if (mt) { rewritten = { name: [mt.newFqn, ...parts.slice(k)].join('.'), rest: parts.length - k, mt }; break; }
      }
      if (!imp.static) explicitSimple.add(parts.at(-1));
      if (rewritten) {
        if (!imp.static && !imp.wildcard && rewritten.rest === 0 && rewritten.mt.newPkg === myPkg) removeImport(imp, text);
        else reps.push({ start: imp.start, end: imp.end, from: text, to: `import ${imp.static ? 'static ' : ''}${rewritten.name}${imp.wildcard ? '.*' : ''};` });
        continue;
      }
      // a class this file imports is now in the same package as the file (the file moved next to it)
      if (mf && !imp.static && !imp.wildcard && parts.length > 1 && parts.slice(0, -1).join('.') === myPkg && index.byFqn.has(imp.name)) removeImport(imp, text);
    }

    // 3. classes used without an import because they were in the same package
    for (const other of index.byPkg.get(info.pkg) || []) {
      if (other === info.abs) continue;
      const oi = index.files.get(other);
      for (const n of oi.typeNames) {
        if (!idents.has(n) || ownTypes.has(n) || explicitSimple.has(n)) continue;
        const fqn = info.pkg ? `${info.pkg}.${n}` : n;
        const np = newPkgOfType(fqn, info.pkg);
        if (np === myPkg) continue;
        if (wildcardPkgs.has(np)) continue;
        const newFqn = np ? `${np}.${n}` : n;
        adds.add(newFqn);
        if (!isPublicType(fqn)) warnings.push(`${n} is package-private; ${path.basename(newAbs, '.java')} can no longer use it from ${myPkg}. Make ${n} public or move both together.`);
      }
    }
    // the moved file lands in a package that has a class with the same name as one it imports: leave a note
    if (mf) {
      for (const f of index.byPkg.get(myPkg) || []) for (const n of index.files.get(f).typeNames) {
        if (explicitSimple.has(n) && !ownTypes.has(n) && ![...info.imports].some((i) => i.name === `${myPkg}.${n}`)) {
          warnings.push(`${path.basename(newAbs)} imports a ${n} from another package, and ${myPkg} has its own ${n}: check which one is meant.`);
        }
      }
    }
    // package-private classes that moved away but are still used here
    for (const fq of adds) {
      const old = [...movedType.entries()].find(([, v]) => v.newFqn === fq);
      if (old && !old[1].public) warnings.push(`${old[1].simple} is package-private and moves to ${old[1].newPkg}; ${path.basename(newAbs, '.java')} (${myPkg}) uses it. Make it public or move both together.`);
    }

    // 4. fully qualified names in code
    for (const x of info.masked.slice(info.headerEnd).matchAll(FQN_RX)) {
      const start = info.headerEnd + x.index;
      const parts = x[0].split('.');
      for (let k = parts.length; k > 0; k--) {
        const mt = movedType.get(parts.slice(0, k).join('.'));
        if (mt) { const to = [mt.newFqn, ...parts.slice(k)].join('.'); reps.push({ start, end: start + x[0].length, from: x[0], to }); break; }
      }
    }

    // insert new imports after the last import (or after the package line)
    for (const fq of [...adds]) if (info.imports.some((i) => !i.static && i.name === fq)) adds.delete(fq);
    if (adds.size) {
      // keep the import block sorted where it was: before the first import that sorts after the new one
      const plain = info.imports.filter((i) => !i.static);
      for (const fq of [...adds].sort()) {
        const line = `import ${fq};`;
        const before = plain.find((i) => i.name > fq);
        if (before) reps.push({ start: before.start, end: before.start, from: '', to: line + '\n', label: [line] });
        else if (info.imports.length) { const at = info.imports.at(-1).end; reps.push({ start: at, end: at, from: '', to: '\n' + line, label: [line] }); }
        else if (info.pkgDecl) reps.push({ start: info.pkgDecl.end, end: info.pkgDecl.end, from: '', to: '\n\n' + line, label: [line] });
        else reps.push({ start: 0, end: 0, from: '', to: line + '\n\n', label: [line] });
      }
    }

    if (reps.length) {
      reps.sort((a, b) => b.start - a.start || b.end - a.end || (a.to < b.to ? 1 : -1));
      let out = src;
      for (const r of reps) out = out.slice(0, r.start) + r.to + out.slice(r.end);
      const changes = [];
      for (const r of reps.slice().reverse()) {
        if (r.label) for (const l of r.label) changes.push({ from: '(added)', to: l });
        else changes.push({ from: r.from, to: r.display ?? r.to.trim() });
      }
      edits.push({ oldFile: info.abs, newFile: newAbs, content: out, changes });
    }
  }

  // Spring finds beans and entities by package: warn when a class leaves the application's package
  const apps = [...index.files.values()].filter((i) => !i.test && i.types.some((t) => t.annotations.some((a) => a.name === 'SpringBootApplication')));
  for (const [, mt] of movedType) {
    const info = index.files.get(mt.file);
    if (!info || info.test) continue;
    const t = info.types.find((x) => x.name === mt.simple);
    const bean = t && t.annotations.some((a) => /^(Service|Component|Repository|Controller|RestController|Configuration|Entity|ControllerAdvice|RestControllerAdvice)$/.test(a.name));
    const repoIface = t && t.kind === 'interface' && t.extends.some((x) => /Repository$/.test(x));
    if (!(bean || repoIface)) continue;
    for (const app of apps) {
      if (app.pkg && !(mt.newPkg === app.pkg || mt.newPkg.startsWith(app.pkg + '.')) && (mt.oldPkg === app.pkg || mt.oldPkg.startsWith(app.pkg + '.'))) {
        warnings.push(`${mt.simple} moves outside ${app.pkg} (the package of ${app.typeNames[0]}): Spring won't find it by component/entity scan unless you configure that.`);
      }
    }
  }

  // text references that are not rewritten: strings in Java code, application.yml, XML, …
  const oldNames = [...movedType.keys()];
  const oldPkgs = [...pkgMoves.keys()];
  if (oldNames.length || oldPkgs.length) {
    const names = [...oldNames, ...oldPkgs].sort((a, b) => b.length - a.length)
      .map((n) => ({ n, rx: new RegExp(`(^|[^\\w.$])${n.replace(/\./g, '\\.')}(?![\\w$])`) }));
    const lookFor = (line) => names.find((x) => x.rx.test(line))?.n;
    const report = (file, text) => {
      text.split('\n').forEach((l, i) => {
        const hit = lookFor(l);
        if (hit) warnings.push(`${toPosix(path.relative(ctx.repoRoot, file))}:${i + 1} mentions ${hit} as text (not rewritten): ${l.trim().slice(0, 120)}`);
      });
    };
    for (const info of index.files.values()) {
      // only string literals: compare the source with its masked copy
      const strings = [];
      for (let i = 0; i < info.src.length; i++) if (info.src[i] !== info.masked[i] && info.src[i - 1] === '"' && info.masked[i - 1] === '"') {
        const end = info.src.indexOf('"', i);
        strings.push({ i, s: info.src.slice(i, end) });
      }
      for (const { i, s } of strings) {
        const hit = lookFor(s);
        if (hit) {
          const line = info.src.slice(0, i).split('\n').length;
          warnings.push(`${toPosix(path.relative(ctx.repoRoot, info.abs))}:${line} has "${s.slice(0, 80)}" in a string (not rewritten).`);
        }
      }
    }
    for (const f of walkText(ctx.scanRoot)) {
      try { if (fs.statSync(f).size < 1_000_000) report(f, fs.readFileSync(f, 'utf8')); } catch { /* unreadable */ }
    }
  }
  // resources next to a moved package (MyBatis XML, templates) stay where they are
  for (const { from } of pairs) {
    const sp = packageOfDir(path.dirname(from));
    if (!sp?.pkg) continue;
    const res = path.join(sp.srcRoot.replace(/java$/, 'resources'), pkgPath(sp.pkg));
    if (fs.existsSync(res) && !warnings.some((w) => w.includes(toPosix(path.relative(ctx.repoRoot, res))))) {
      warnings.push(`${toPosix(path.relative(ctx.repoRoot, res))} has resources for this package; move them yourself if they belong to the moved classes.`);
    }
  }
  return { pairs, edits, warnings: [...new Set(warnings)] };
}

function walkText(dir, acc = [], inSrc = false) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!inSrc && ['target', 'build', 'out', 'bin', 'docs', 'scripts'].includes(e.name)) continue;
      walkText(abs, acc, inSrc || e.name === 'src');
    } else if (TEXT_EXT.test(e.name) && !e.name.endsWith('.java') && e.name !== 'project-map.json') acc.push(abs);
  }
  return acc;
}
void walkJava;
