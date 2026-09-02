import { createServer as createHttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, defaultDbPath } from './db.js';
import { createRouter, readJsonBody, sendJson, ApiError } from './http.js';
import { userFromRequest } from './auth.js';
import * as authRoutes from './routes/auth.js';
import * as entriesRoutes from './routes/entries.js';
import * as wordsRoutes from './routes/words.js';
import * as challengesRoutes from './routes/challenges.js';
import * as dashboardRoutes from './routes/dashboard.js';
import * as statsRoutes from './routes/stats.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
const SHARED_DIR = join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, pathname) {
  let root = PUBLIC_DIR;
  let rel = pathname;
  if (pathname === '/shared' || pathname.startsWith('/shared/')) {
    root = SHARED_DIR;
    rel = pathname.slice('/shared'.length) || '/';
  }
  if (rel === '/' || !extname(rel)) {
    // SPA fallback: any extension-less GET renders the app shell
    root = PUBLIC_DIR;
    rel = '/index.html';
  }
  const file = normalize(join(root, rel));
  if (!file.startsWith(root + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  let data;
  try {
    data = readFileSync(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'max-age=60',
  });
  res.end(data);
}

export function createApp({ dbPath = defaultDbPath() } = {}) {
  const db = openDb(dbPath);
  const router = createRouter();
  for (const mod of [authRoutes, entriesRoutes, wordsRoutes, challengesRoutes, dashboardRoutes, statsRoutes]) {
    mod.register(router, db);
  }

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const matched = router.match(req.method, url.pathname);
        if (!matched) throw new ApiError(404, 'No such endpoint');
        const user = userFromRequest(db, req);
        if (!user && !url.pathname.startsWith('/api/auth/')) throw new ApiError(401, 'Sign in required');
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJsonBody(req) : {};
        const ctx = {
          req,
          res,
          db,
          user,
          params: matched.params,
          query: Object.fromEntries(url.searchParams),
          body,
          status: 200,
        };
        const result = await matched.handler(ctx);
        sendJson(res, ctx.status, result ?? {});
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(res, url.pathname);
      } else {
        res.writeHead(405, { 'content-type': 'text/plain' });
        res.end('Method not allowed');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        sendJson(res, err.status, { error: err.message, ...err.extra });
      } else {
        console.error(err);
        sendJson(res, 500, { error: 'Internal server error' });
      }
    }
  });

  return { server, db };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const dbPath = defaultDbPath();
  const { server } = createApp({ dbPath });
  server.listen(port, host, () => {
    console.log(`Inkwell is running → http://${host}:${port}`);
    console.log(`Journal database: ${dbPath}`);
  });
}
