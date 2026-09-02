import { ApiError } from '../http.js';
import {
  hashPassword,
  verifyPassword,
  passwordNeedsRehash,
  dummyVerify,
  createSession,
  sessionCookie,
  clearedCookie,
  deleteSession,
  pruneSessions,
} from '../auth.js';
import { nowIso, userLevel } from '../service.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const PASSWORD_MAX = 128;

// In-memory per-IP throttle on credential endpoints. Window state is lost on
// restart, which is fine for a single-process local app.
const RATE = { login: { max: 10, windowMs: 15 * 60_000 }, register: { max: 20, windowMs: 60 * 60_000 } };
const attempts = new Map();

function throttle(ctx, kind) {
  const { max, windowMs } = RATE[kind];
  const key = `${kind}:${ctx.req.socket.remoteAddress}`;
  const now = Date.now();
  const slot = attempts.get(key);
  if (!slot || slot.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return key;
  }
  slot.count += 1;
  if (slot.count > max) {
    const mins = Math.ceil((slot.resetAt - now) / 60_000);
    throw new ApiError(429, `Too many attempts — try again in ${mins} min`);
  }
  return key;
}

export function register(router, db) {
  router.post('/api/auth/register', async (ctx) => {
    const { username, password } = ctx.body;
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw new ApiError(422, 'Username must be 3–20 characters: letters, digits, underscore');
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > PASSWORD_MAX) {
      throw new ApiError(422, `Password must be 8–${PASSWORD_MAX} characters`);
    }
    throttle(ctx, 'register');
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
    const throttleKey = throttle(ctx, 'login');
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? ''));
    const pass = String(password ?? '');
    // dummyVerify burns the same scrypt cost for unknown usernames so response
    // timing doesn't reveal which accounts exist.
    const ok = row ? verifyPassword(pass, row.password_hash) : dummyVerify(pass);
    if (!ok) throw new ApiError(401, 'Wrong username or password');
    attempts.delete(throttleKey);
    if (passwordNeedsRehash(row.password_hash)) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pass), row.id);
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
