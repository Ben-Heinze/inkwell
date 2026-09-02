// Shared plumbing for server-facing tests: boot the real app on a temp DB,
// and speak to it with independent cookie-jar clients.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';

export async function startApp() {
  const dir = mkdtempSync(join(tmpdir(), 'inkwell-test-'));
  const dbPath = join(dir, 'test.db');
  const app = createApp({ dbPath });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return {
    db: app.db,
    server: app.server,
    dbPath,
    base: `http://127.0.0.1:${app.server.address().port}`,
    close() {
      app.server.close();
      app.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Each client keeps its own session cookie, so tests can act as several users.
export function makeClient(base) {
  let cookie = '';
  async function req(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
  }
  return {
    get: (p) => req('GET', p),
    post: (p, b = {}) => req('POST', p, b),
    put: (p, b) => req('PUT', p, b),
    del: (p) => req('DELETE', p),
    raw: (path, opts = {}) =>
      fetch(base + path, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } }),
    setCookie(c) { cookie = c; },
  };
}

export async function registerUser(client, username) {
  return client.post('/api/auth/register', { username, password: 'password123' });
}

// Correct answers for a quiz session, read straight from the database.
export function quizAnswers(db, sessionId) {
  const row = db.prepare('SELECT payload FROM quiz_sessions WHERE id = ?').get(sessionId);
  return JSON.parse(row.payload).questions.map((q) => q.answer);
}

export function seededRand(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}
