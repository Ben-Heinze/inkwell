// Security-focused tests: user isolation, session integrity, injection probes,
// and content fidelity. Two users (alice, bob) share one app instance.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, makeClient, registerUser } from './helpers.js';

let app;
let alice;
let bob;

before(async () => {
  app = await startApp();
  alice = makeClient(app.base);
  bob = makeClient(app.base);
  assert.equal((await registerUser(alice, 'alice')).status, 201);
  assert.equal((await registerUser(bob, 'bob')).status, 201);
});

after(() => app.close());

test('session cookies are HttpOnly and SameSite=Lax', async () => {
  const probe = makeClient(app.base);
  const res = await registerUser(probe, 'cookieprobe');
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Expires=/i);
});

test('garbage and expired session tokens are rejected', async () => {
  const stranger = makeClient(app.base);
  stranger.setCookie('inkwell_session=not-a-real-token');
  assert.equal((await stranger.get('/api/dashboard')).status, 401);

  // a real token that has expired
  const userId = app.db.prepare("SELECT id FROM users WHERE username = 'alice'").get().id;
  app.db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run('expired-token-000', userId, new Date(Date.now() - 1000).toISOString());
  const expired = makeClient(app.base);
  expired.setCookie('inkwell_session=expired-token-000');
  assert.equal((await expired.get('/api/auth/me')).status, 401);
});

test('the daily prompt is the same for every user', async () => {
  const a = await alice.get('/api/dashboard');
  const b = await bob.get('/api/dashboard');
  assert.equal(a.data.daily.prompt.id, b.data.daily.prompt.id);
  assert.equal(a.data.daily.prompt.text, b.data.daily.prompt.text);
});

let aliceEntryId;
test('entries are invisible and untouchable across users', async () => {
  const created = await alice.post('/api/entries', {
    kind: 'journal',
    title: 'Private',
    body: 'This entry contains the marker needleXYZ and belongs to alice alone, no one else should ever read it.',
  });
  assert.equal(created.status, 201);
  aliceEntryId = created.data.entry.id;

  const bobList = await bob.get('/api/entries');
  assert.equal(bobList.data.entries.length, 0);
  assert.equal((await bob.get(`/api/entries/${aliceEntryId}`)).status, 404);
  assert.equal((await bob.put(`/api/entries/${aliceEntryId}`, { body: 'hijacked' })).status, 404);
  assert.equal((await bob.del(`/api/entries/${aliceEntryId}`)).status, 404);

  // alice's entry is untouched by all of that
  const still = await alice.get(`/api/entries/${aliceEntryId}`);
  assert.equal(still.status, 200);
  assert.match(still.data.entry.body, /needleXYZ/);
});

test('wordbank words are per-user', async () => {
  const added = await alice.post('/api/words', { word: 'quixotic', definition: 'idealistic to an impractical degree' });
  assert.equal(added.status, 201);
  const wordId = added.data.word.id;

  const bobWords = await bob.get('/api/words');
  assert.equal(bobWords.data.words.length, 0);
  assert.equal((await bob.del(`/api/words/${wordId}`)).status, 404);
  const aliceWords = await alice.get('/api/words');
  assert.ok(aliceWords.data.words.some((w) => w.word === 'quixotic'));
});

test('quiz sessions cannot be answered by another user', async () => {
  const start = await alice.post('/api/words/learn/start');
  assert.equal(start.status, 200);
  assert.equal((await bob.post(`/api/quiz/${start.data.sessionId}/answer`, { choice: 0 })).status, 404);
  // still answerable by its owner afterwards
  assert.equal((await alice.post(`/api/quiz/${start.data.sessionId}/answer`, { choice: 0 })).status, 200);
});

test('surprise challenges are private to their creator', async () => {
  await alice.post('/api/words', { word: 'saudade', definition: 'melancholic longing' });
  await alice.post('/api/words', { word: 'hygge', definition: 'cozy contentment' });
  const surprise = await alice.post('/api/challenges/surprise');
  assert.equal(surprise.status, 201);
  const sid = surprise.data.challenge.id;

  assert.equal((await bob.get(`/api/challenges/${sid}`)).status, 404);
  const attempt = await bob.post('/api/entries', {
    kind: 'challenge',
    challengeId: sid,
    body: Array.from({ length: 120 }, (_, i) => `w${i}`).join(' '),
  });
  assert.equal(attempt.status, 404);
  const bobChallenges = await bob.get('/api/challenges');
  assert.ok(!bobChallenges.data.surprises.some((c) => c.id === sid));
  assert.equal((await alice.get(`/api/challenges/${sid}`)).status, 200);
});

test('SQL injection probes are rejected or inert', async () => {
  // hostile usernames never pass validation
  const evilName = await makeClient(app.base).post('/api/auth/register', {
    username: "a' OR 1=1 --",
    password: 'password123',
  });
  assert.equal(evilName.status, 422);
  const evilLogin = await makeClient(app.base).post('/api/auth/login', {
    username: "alice' --",
    password: 'password123',
  });
  assert.equal(evilLogin.status, 401);

  // hostile search strings are treated as literal text
  const evilSearch = await alice.get(`/api/entries?q=${encodeURIComponent("needleXYZ' OR '1'='1")}`);
  assert.equal(evilSearch.status, 200);
  assert.equal(evilSearch.data.entries.length, 0);
  const honestSearch = await alice.get('/api/entries?q=needleXYZ');
  assert.equal(honestSearch.data.entries.length, 1);

  // hostile word text never passes validation, and the table survives
  const evilWord = await alice.post('/api/words', { word: "x'); DROP TABLE words;--", definition: 'nope' });
  assert.equal(evilWord.status, 422);
  assert.equal((await alice.get('/api/words')).status, 200);
  assert.ok(app.db.prepare("SELECT name FROM sqlite_master WHERE name = 'words'").get());
});

test('entry content is stored and returned byte-for-byte', async () => {
  const body =
    'Tricky content: <script>alert("xss")</script> & "double" \'single\' `backtick` 100% ünïcode 🖋️\nsecond line\tand a tab.';
  const created = await alice.post('/api/entries', { kind: 'journal', title: '<b>title</b>', body });
  assert.equal(created.status, 201);
  const read = await alice.get(`/api/entries/${created.data.entry.id}`);
  assert.equal(read.data.entry.body, body);
  assert.equal(read.data.entry.title, '<b>title</b>');
});
