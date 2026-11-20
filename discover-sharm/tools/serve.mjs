#!/usr/bin/env node
/**
 * Local dev server (zero dependencies).
 *
 *   node tools/serve.mjs --site www            → http://localhost:8080  (serves dist/www;  build first: npm run build)
 *   node tools/serve.mjs --site app  --port 8082
 *   node tools/serve.mjs --site admin --port 8083
 *   node tools/serve.mjs --site www --api https://your-legacy-backend   (only for the old non-Supabase mode)
 *
 * - Clean URLs: /excursions → /excursions/ → excursions/index.html
 * - Unknown paths get 404.html (same behaviour as GitHub Pages, so the
 *   legacy-link redirect can be tested locally)
 * - --api forwards /api/* to your live backend so the catalog and login work
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const SITE = arg('--site', 'www');
const ROOT = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'dist', SITE);
if (!fs.existsSync(ROOT)) { console.error(`dist/${SITE} not found — run: npm run build`); process.exit(1); }
const PORT = Number(arg('--port', process.env.PORT || 8080));
const API = (arg('--api', process.env.DS_API || '') || '').replace(/\/$/, '');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

const send = (res, code, body, type = 'text/html; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);

  if (p.startsWith('/api/')) {
    if (!API) return send(res, 502, JSON.stringify({ error: 'Start the server with --api <backend url> to use /api locally' }), TYPES['.json']);
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await fetch(API + p + url.search, { method: req.method, headers: { 'Content-Type': req.headers['content-type'] || 'application/json', ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      return send(res, r.status, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') || TYPES['.json']);
    } catch (e) { return send(res, 502, JSON.stringify({ error: String(e) }), TYPES['.json']); }
  }

  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' + url.search }); return res.end(); }
    file = path.join(file, 'index.html');
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  send(res, 404, fs.readFileSync(path.join(ROOT, '404.html')));
}).listen(PORT, () => console.log(`Discover Sharm [${SITE}] → http://localhost:${PORT}${API ? `   (API → ${API})` : '   (no --api: catalog will be empty)'}`));
