#!/usr/bin/env node
// Local server for the interactive project map. Zero dependencies.
// Run from the repo root:  node scripts/project-map/server.mjs [--port 4321] [--config project-map.config.mjs]
// Then open http://localhost:4321
//
// It only listens on 127.0.0.1. Every file move is previewed first, and can be undone.
// Other websites in the same browser can't use it: requests must come with Host localhost/127.0.0.1:<port>
// (blocks DNS rebinding), a same-origin Origin header, and a random token that only the page served here knows (CSRF).
// Method moves are preview-only: the analysis produces a task for Claude, no code is changed.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeContext, folderInfo, toPosix } from './lib.mjs';
import { planMove, applyPlan, planUndo, summarize } from './move.mjs';
import { listServices, analyzeMethodMove } from './analyze.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const PORT = Number(opt('--port', 4321));
const CONFIG = opt('--config', 'project-map.config.mjs');

const repoRoot = process.cwd();
const ctx = await makeContext(CONFIG);
const config = ctx.config;
const history = []; // [{ label, pairs }]
const TOKEN = crypto.randomBytes(24).toString('hex'); // new on every start; embedded in the page, required by the API
const allowedHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));

function regenerate() {
  // Local map of the working tree + branch report (never touches the committed main map in docs/).
  execFileSync(process.execPath, [path.join(here, 'generate-map.mjs'), '--config', CONFIG, '--quiet'], { cwd: repoRoot, stdio: 'pipe' });
  const local = path.resolve(config.output.local);
  const data = JSON.parse(fs.readFileSync(path.join(local, 'project-map.json'), 'utf8'));
  try { data.branch = JSON.parse(fs.readFileSync(path.join(local, 'branch.json'), 'utf8')); } catch { data.branch = null; }
  // Folder purposes for every folder that exists (wildcards resolved).
  const folders = new Set();
  for (const f of data.files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  // Also include folders that only contain non-TS files or are empty.
  (function walkDirs(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      folders.add(toPosix(path.relative(ctx.appRoot, abs)));
      walkDirs(abs);
    }
  })(ctx.appRoot);
  data.folderInfo = {};
  for (const f of folders) {
    const info = folderInfo(config, f);
    data.folderInfo[f] = info || null;
  }
  data.history = history.map((h) => h.label);
  // Methods of every @Injectable class, so services can be opened in the graph.
  try { data.services = listServices(ctx); }
  catch (e) { data.services = {}; data.servicesError = e.message; }
  return data;
}

function d3Path() {
  // Bundled copy first (works offline / behind proxies), then the project's own d3.
  const candidates = [process.env.D3_PATH, path.join(here, 'd3.min.js'), path.resolve('node_modules/d3/dist/d3.min.js')].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

const server = http.createServer(async (req, res) => {
  try {
    // DNS rebinding: a foreign domain resolving to 127.0.0.1 still sends its own Host header
    if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) return send(res, 403, { errors: ['Forbidden host'] });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      // CSRF: other sites can send requests but can't read the page, so they never have the token
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return send(res, 403, { errors: ['Forbidden origin'] });
      const tok = req.headers['x-project-map-token'] || '';
      if (tok.length !== TOKEN.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(TOKEN))) {
        return send(res, 403, { errors: ['Missing or wrong token: reload the page (the server was restarted).'] });
      }
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const page = fs.readFileSync(path.join(here, 'ui.html'), 'utf8').replace('</head>', `<meta name="pm-token" content="${TOKEN}">\n</head>`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'" });
      return res.end(page);
    }
    if (req.method === 'GET' && url.pathname === '/vendor/d3.min.js') {
      const local = d3Path();
      if (local) return send(res, 200, fs.readFileSync(local), 'text/javascript');
      res.writeHead(302, { location: 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js' });
      return res.end();
    }
    const font = /^\/vendor\/fonts\/([\w-]+\.woff2)$/.exec(url.pathname);
    if (req.method === 'GET' && font) {
      const f = path.join(here, 'fonts', font[1]);
      if (!fs.existsSync(f)) return send(res, 404, { errors: ['Not found'] });
      res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' });
      return res.end(fs.readFileSync(f));
    }
    if (req.method === 'GET' && url.pathname === '/api/map') return send(res, 200, regenerate());

    if (req.method === 'POST' && url.pathname === '/api/plan') {
      const { source, target, create } = await readBody(req);
      const r = planMove(ctx, source, target, { create: !!create });
      if (r.errors) return send(res, 400, { errors: r.errors });
      return send(res, 200, summarize(ctx, r.plan));
    }
    if (req.method === 'POST' && url.pathname === '/api/move') {
      const { source, target, create } = await readBody(req);
      const r = planMove(ctx, source, target, { create: !!create }); // re-planned from disk, never from a stale preview
      if (r.errors) return send(res, 400, { errors: r.errors });
      const result = applyPlan(ctx, r.plan);
      history.push({ label: `${source} → ${target || config.root}`, pairs: r.plan.pairs.map(({ from, to }) => ({ from, to })) });
      console.log(`moved ${source} -> ${target || config.root} (${result.moves.length} files, ${result.importCount} imports)`);
      return send(res, 200, { result, map: regenerate() });
    }
    if (req.method === 'POST' && url.pathname === '/api/methods/plan') {
      const r = analyzeMethodMove(ctx, await readBody(req));
      if (r.errors) return send(res, 400, { errors: r.errors });
      return send(res, 200, r.plan);
    }
    if (req.method === 'POST' && url.pathname === '/api/undo') {
      const last = history.at(-1);
      if (!last) return send(res, 400, { errors: ['Nothing to undo.'] });
      const r = planUndo(ctx, last.pairs);
      if (r.errors) return send(res, 400, { errors: r.errors });
      const result = applyPlan(ctx, r.plan);
      history.pop();
      console.log(`undo ${last.label}`);
      return send(res, 200, { result, undone: last.label, map: regenerate() });
    }
    send(res, 404, { errors: ['Not found'] });
  } catch (e) {
    console.error(e);
    send(res, 500, { errors: [e.message] });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Project map: http://localhost:${PORT}`);
  console.log(`App root: ${config.root}  (Ctrl+C to stop)`);
});
