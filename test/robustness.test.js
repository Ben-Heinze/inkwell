// Malformed input, HTTP edge cases, persistence across restarts, and
// time-dependent behavior (streak backfill, mastery decay) against a real app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startApp, makeClient, registerUser, quizAnswers } from './helpers.js';
import { createApp } from '../server/index.js';
import { createRouter, readJsonBody, ApiError } from '../server/http.js';
import { localDateStr, addDays } from '../server/domain/streak.js';
import { getDailyPrompt } from '../server/service.js';

let app;
let client;

before(async () => {
  app = await startApp();
  client = makeClient(app.base);
  assert.equal((await registerUser(client, 'robusta')).status, 201);
});

after(() => app.close());

// ---- router & body-parsing units ---------------------------------------

test('router matches params and rejects near-misses', () => {
  const r = createRouter();
  const hits = [];
  r.get('/api/entries/:id', (ctx) => hits.push(ctx));
  assert.equal(r.match('GET', '/api/entries/42').params.id, '42');
  assert.equal(r.match('GET', '/api/entries/a%20b').params.id, 'a b');
  assert.equal(r.match('POST', '/api/entries/42'), null);
  assert.equal(r.match('GET', '/api/entries'), null);
  assert.equal(r.match('GET', '/api/entries/42/extra'), null);
});

test('readJsonBody enforces the size limit and JSON validity', async () => {
  async function* stream(chunks) {
    for (const c of chunks) yield Buffer.from(c);
  }
  await assert.rejects(readJsonBody(stream(['a'.repeat(600), 'b'.repeat(600)]), 1000), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 413);
    return true;
  });
  await assert.rejects(readJsonBody(stream(['{not json'])), (err) => err.status === 400);
  assert.deepEqual(await readJsonBody(stream([])), {});
  assert.deepEqual(await readJsonBody(stream(['{"a":', '1}'])), { a: 1 });
});

// ---- HTTP edge cases -----------------------------------------------------

test('malformed and hostile requests get clean errors', async () => {
  const badJson = await client.raw('/api/entries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{oops',
  });
  assert.equal(badJson.status, 400);

  assert.equal((await client.get('/api/nope')).status, 404);
  assert.equal((await client.get('/api/nope')).data.error, 'No such endpoint');
  assert.equal((await client.raw('/api/entries', { method: 'PATCH' })).status, 404);
  assert.equal((await client.raw('/app.css', { method: 'POST' })).status, 405);
  assert.equal((await client.get('/api/entries/notanumber')).status, 404);

  const huge = await client.post('/api/entries', { kind: 'journal', body: 'a '.repeat(150_000) });
  assert.equal(huge.status, 413);
});

test('entry validation rejects junk payloads', async () => {
  assert.equal((await client.post('/api/entries', { kind: 'journal', body: '   \n\t  ' })).status, 422);
  assert.equal((await client.post('/api/entries', { kind: 'weird', body: 'hello there' })).status, 400);
  assert.equal((await client.post('/api/entries', { kind: 'journal', body: 12345 })).status, 400);
  assert.equal((await client.post('/api/entries', { kind: 'challenge', body: 'no challenge id given here' })).status, 404);
});

test('auth boundaries: 8-char password ok, 21-char username not', async () => {
  const c = makeClient(app.base);
  assert.equal((await c.post('/api/auth/register', { username: 'edgecase', password: '12345678' })).status, 201);
  assert.equal(
    (await makeClient(app.base).post('/api/auth/register', { username: 'u'.repeat(21), password: 'password123' })).status,
    422,
  );
});

// ---- XP and constraint boundaries ---------------------------------------

test('writing XP boundaries: 24 words → 10 XP, 25 words → 11 XP', async () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const a = await client.post('/api/entries', { kind: 'journal', body: words(24) });
  assert.equal(a.data.xp.total, 10);
  const b = await client.post('/api/entries', { kind: 'journal', body: words(25) });
  assert.equal(b.data.xp.total, 11);
});

test('challenge passes at exactly the minimum word count', async () => {
  const grat = app.db.prepare("SELECT id, min_words FROM challenges WHERE key = 'three-gratitudes'").get();
  const body = 'grateful ' + Array.from({ length: grat.min_words - 1 }, (_, i) => `thing${i}`).join(' ');
  const res = await client.post('/api/entries', { kind: 'challenge', challengeId: grat.id, body });
  assert.equal(res.status, 201);
  assert.equal(res.data.entry.wordCount, grat.min_words);
});

// ---- quiz robustness -----------------------------------------------------

test('quiz shrugs off out-of-range and non-numeric answers', async () => {
  const start = await client.post('/api/words/learn/start');
  const sid = start.data.sessionId;
  const answers = quizAnswers(app.db, sid);

  const wild = await client.post(`/api/quiz/${sid}/answer`, { choice: 99 });
  assert.equal(wild.status, 200);
  assert.equal(wild.data.correct, false);

  const banana = await client.post(`/api/quiz/${sid}/answer`, { choice: 'banana' });
  assert.equal(banana.status, 200);
  assert.equal(banana.data.correct, false);

  const last = await client.post(`/api/quiz/${sid}/answer`, { choice: answers[2] });
  assert.equal(last.data.done, true);
  assert.equal(last.data.correctCount, 1);
  assert.equal(last.data.learned.mastery, 55); // 50 + 5×1
});

// ---- time-dependent behavior --------------------------------------------

test('streaks survive backfilled history and unlock badges', async () => {
  const userId = app.db.prepare("SELECT id FROM users WHERE username = 'robusta'").get().id;
  const promptId = app.db.prepare('SELECT id FROM prompts LIMIT 1').get().id;
  const today = localDateStr();
  const iso = new Date().toISOString();
  const ins = app.db.prepare(
    `INSERT INTO entries (user_id, kind, title, body, word_count, entry_date, prompt_id, xp_awarded, wordbank_used, created_at, updated_at)
     VALUES (?, 'daily', '', 'backfilled history entry', 3, ?, ?, 0, 0, ?, ?)`,
  );
  ins.run(userId, addDays(today, -1), promptId, iso, iso);
  ins.run(userId, addDays(today, -2), promptId, iso, iso);

  const dash = await client.get('/api/dashboard');
  assert.equal(dash.data.streak.current, 2);
  assert.equal(dash.data.streak.doneToday, false);

  const entry = await client.post('/api/entries', {
    kind: 'daily',
    body: 'Writing my daily prompt today to extend a streak that started two days ago in this test.',
  });
  assert.equal(entry.status, 201);
  assert.equal(entry.data.streak.current, 3);
  assert.ok(entry.data.newAchievements.some((a) => a.id === 'streak-3'));
});

test('mastery decays over time and practice materializes the new value', async () => {
  const userId = app.db.prepare("SELECT id FROM users WHERE username = 'robusta'").get().id;
  const past = new Date(Date.now() - 13 * 86400000).toISOString();
  app.db
    .prepare(
      `INSERT INTO words (user_id, word, pos, definition, example, source, mastery, mastery_updated_at, added_at)
       VALUES (?, 'fadetest', 'noun', 'a word planted in the past to decay', '', 'custom', 80, ?, ?)`,
    )
    .run(userId, past, past);

  // 13 days − 3 grace = 10 days × 0.5 = −5
  const words = await client.get('/api/words');
  const faded = words.data.words.find((w) => w.word === 'fadetest');
  assert.equal(faded.mastery, 75);
  assert.equal(faded.due, false); // 75 is exactly the threshold; due is < 75

  // practice: questions come lowest-mastery-first (the word learned at 55, then fadetest)
  const start = await client.post('/api/words/practice/start');
  const answers = quizAnswers(app.db, start.data.sessionId);
  const first = await client.post(`/api/quiz/${start.data.sessionId}/answer`, { choice: answers[0] });
  assert.ok(first.data.word.to > first.data.word.from);
  const second = await client.post(`/api/quiz/${start.data.sessionId}/answer`, { choice: answers[1] });
  assert.equal(second.data.word.word, 'fadetest');
  assert.equal(second.data.word.from, 75);
  assert.equal(second.data.word.to, 83);

  // the decayed-then-bumped value is now stored with a fresh timestamp
  const row = app.db.prepare('SELECT mastery, mastery_updated_at FROM words WHERE user_id = ? AND word = ?').get(userId, 'fadetest');
  assert.equal(row.mastery, 83);
  assert.ok(Date.now() - Date.parse(row.mastery_updated_at) < 60_000);
});

// ---- determinism & persistence ------------------------------------------

test('daily prompt choice is deterministic and memoized per date', async () => {
  const p1 = getDailyPrompt(app.db, '2030-06-15');
  const p2 = getDailyPrompt(app.db, '2030-06-15');
  assert.equal(p1.id, p2.id);
  const memo = app.db.prepare("SELECT prompt_id FROM daily_prompts WHERE date = '2030-06-15'").get();
  assert.equal(memo.prompt_id, p1.id);
  const otherDay = getDailyPrompt(app.db, '2030-06-16');
  assert.ok(otherDay.id); // may or may not differ, but must exist
});

test('data survives a restart and re-seeding never duplicates', async () => {
  const fresh = await startApp();
  try {
    const c = makeClient(fresh.base);
    await registerUser(c, 'phoenix');
    const made = await c.post('/api/entries', { kind: 'journal', title: 'Keep me', body: 'This entry must survive a full application restart to prove persistence.' });
    assert.equal(made.status, 201);
    const counts = () => ({
      words: fresh.db.prepare('SELECT COUNT(*) AS n FROM catalog_words').get().n,
      prompts: fresh.db.prepare('SELECT COUNT(*) AS n FROM prompts').get().n,
      challenges: fresh.db.prepare("SELECT COUNT(*) AS n FROM challenges WHERE kind = 'seed'").get().n,
    });
    const before = counts();

    // stop everything, reopen the same database file
    fresh.server.close();
    fresh.db.close();
    const reopened = createApp({ dbPath: fresh.dbPath });
    await new Promise((resolve) => reopened.server.listen(0, '127.0.0.1', resolve));
    try {
      const c2 = makeClient(`http://127.0.0.1:${reopened.server.address().port}`);
      const login = await c2.post('/api/auth/login', { username: 'phoenix', password: 'password123' });
      assert.equal(login.status, 200);
      const list = await c2.get('/api/entries');
      assert.equal(list.data.entries.length, 1);
      assert.equal(list.data.entries[0].title, 'Keep me');
      assert.deepEqual(
        {
          words: reopened.db.prepare('SELECT COUNT(*) AS n FROM catalog_words').get().n,
          prompts: reopened.db.prepare('SELECT COUNT(*) AS n FROM prompts').get().n,
          challenges: reopened.db.prepare("SELECT COUNT(*) AS n FROM challenges WHERE kind = 'seed'").get().n,
        },
        before,
      );
    } finally {
      reopened.server.close();
      reopened.db.close();
    }
  } finally {
    try { fresh.close(); } catch { /* already closed above */ }
  }
});
