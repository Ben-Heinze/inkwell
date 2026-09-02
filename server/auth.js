import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

// Versioned scrypt params. s2 follows the OWASP password-storage cheat sheet
// (N=2^17, r=8, p=1); s1 hashes from older installs still verify and are
// transparently rehashed on the next successful login.
const SCRYPT_SCHEMES = {
  s1: { N: 16384, r: 8, p: 1 },
  s2: { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }, // scrypt needs 128*N*r bytes
};
const CURRENT_SCHEME = 's2';
const KEYLEN = 32;
const SESSION_DAYS = 30;
export const COOKIE_NAME = 'inkwell_session';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT_SCHEMES[CURRENT_SCHEME]);
  return `${CURRENT_SCHEME}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  const params = SCRYPT_SCHEMES[parts[0]];
  if (parts.length !== 3 || !params) return false;
  const salt = Buffer.from(parts[1], 'base64url');
  const expect = Buffer.from(parts[2], 'base64url');
  const got = scryptSync(password, salt, expect.length, params);
  return timingSafeEqual(got, expect);
}

export function passwordNeedsRehash(stored) {
  return !String(stored).startsWith(`${CURRENT_SCHEME}$`);
}

// Hash of a throwaway password, verified against when a username doesn't
// exist so login timing doesn't reveal which usernames are taken.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('base64url'));

export function dummyVerify(password) {
  verifyPassword(password, DUMMY_HASH);
  return false;
}

// Session tokens are stored hashed so a leaked database can't be replayed
// into live sessions; the cookie carries the raw token.
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('base64url');
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    userId,
    expiresAt,
  );
  return { token, expiresAt };
}

export function sessionCookie(token, expiresAt) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearedCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function userFromRequest(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT u.id, u.username, u.created_at FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`,
      )
      .get(hashToken(token), new Date().toISOString()) || null
  );
}

export function deleteSession(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(token));
}

export function pruneSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}
