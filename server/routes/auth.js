import { ApiError } from '../http.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  sessionCookie,
  clearedCookie,
  deleteSession,
  pruneSessions,
} from '../auth.js';
import { nowIso, userLevel } from '../service.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function register(router, db) {
  router.post('/api/auth/register', async (ctx) => {
    const { username, password } = ctx.body;
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw new ApiError(422, 'Username must be 3–20 characters: letters, digits, underscore');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw new ApiError(422, 'Password must be at least 8 characters');
    }
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) throw new ApiError(409, 'That username is taken');
    const info = db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, hashPassword(password), nowIso());
    const userId = Number(info.lastInsertRowid);
    const session = createSession(db, userId);
    ctx.res.setHeader('set-cookie', sessionCookie(session.token, session.expiresAt));
    ctx.status = 201;
    return { user: { id: userId, username }, level: userLevel(db, userId) };
  });

  router.post('/api/auth/login', async (ctx) => {
    const { username, password } = ctx.body;
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? ''));
    if (!row || !verifyPassword(String(password ?? ''), row.password_hash)) {
      throw new ApiError(401, 'Wrong username or password');
    }
    pruneSessions(db);
    const session = createSession(db, row.id);
    ctx.res.setHeader('set-cookie', sessionCookie(session.token, session.expiresAt));
    return { user: { id: row.id, username: row.username }, level: userLevel(db, row.id) };
  });

  router.post('/api/auth/logout', async (ctx) => {
    deleteSession(db, ctx.req);
    ctx.res.setHeader('set-cookie', clearedCookie());
    return { ok: true };
  });

  router.get('/api/auth/me', async (ctx) => {
    if (!ctx.user) throw new ApiError(401, 'Not signed in');
    return { user: ctx.user, level: userLevel(db, ctx.user.id) };
  });
}
