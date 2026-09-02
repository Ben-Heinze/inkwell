// End-to-end API tests against a real server on a temp database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';

let server;
let db;
let base;
let dir;
let cookie = '';

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, data: await res.json() };
}

// Pull the correct answers for a quiz session straight from the DB.
function answersFor(sessionId) {
  const row = db.prepare('SELECT payload FROM quiz_sessions WHERE id = ?').get(sessionId);
  return JSON.parse(row.payload).questions.map((q) => q.answer);
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'inkwell-test-'));
  const app = createApp({ dbPath: join(dir, 'test.db') });
  server = app.server;
  db = app.db;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('unauthenticated API requests are rejected', async () => {
  const { status } = await api('GET', '/api/dashboard');
  assert.equal(status, 401);
});

test('register validates input and signs the user in', async () => {
  assert.equal((await api('POST', '/api/auth/register', { username: 'x', password: 'longenough' })).status, 422);
  assert.equal((await api('POST', '/api/auth/register', { username: 'benwrites', password: 'short' })).status, 422);
  const { status, data } = await api('POST', '/api/auth/register', { username: 'benwrites', password: 'hunter2hunter2' });
  assert.equal(status, 201);
  assert.equal(data.user.username, 'benwrites');
  assert.equal(data.level.level, 1);
  assert.ok(cookie.includes('inkwell_session='));
  const me = await api('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, 'benwrites');
});

test('duplicate username and wrong password are rejected', async () => {
  const saved = cookie;
  cookie = '';
  assert.equal((await api('POST', '/api/auth/register', { username: 'BENWRITES', password: 'hunter2hunter2' })).status, 409);
  assert.equal((await api('POST', '/api/auth/login', { username: 'benwrites', password: 'wrongwrong' })).status, 401);
  const login = await api('POST', '/api/auth/login', { username: 'benwrites', password: 'hunter2hunter2' });
  assert.equal(login.status, 200);
  assert.ok(cookie.includes('inkwell_session='));
  void saved;
});

test('dashboard shows a daily prompt and fresh stats', async () => {
  const { status, data } = await api('GET', '/api/dashboard');
  assert.equal(status, 200);
  assert.ok(data.daily.prompt.text.length > 0);
  assert.equal(data.daily.completed, false);
  assert.equal(data.streak.current, 0);
  assert.equal(data.totals.entries, 0);
});

test('a tiny entry earns no XP but unlocks First Words', async () => {
  const { status, data } = await api('POST', '/api/entries', { kind: 'journal', title: 'hi', body: 'Just five small words here.' });
  assert.equal(status, 201);
  assert.equal(data.xp.total, 0);
  assert.deepEqual(data.newAchievements.map((a) => a.id), ['first-entry']);
});

test('a real journal entry earns writing XP', async () => {
  const body = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const { status, data } = await api('POST', '/api/entries', { kind: 'journal', title: 'Sixty', body });
  assert.equal(status, 201);
  assert.equal(data.xp.total, 12); // 10 base + 60/25
  assert.equal(data.entry.wordCount, 60);
});

test('daily prompt entry: XP bonus, streak, and one-per-day', async () => {
  const body = 'Today I noticed the light on the kitchen table and it was enough to make me pause for a while.';
  const { status, data } = await api('POST', '/api/entries', { kind: 'daily', body });
  assert.equal(status, 201);
  assert.ok(data.xp.items.some((i) => i.reason === 'daily'));
  assert.equal(data.streak.current, 1);
  assert.ok(data.streak.doneToday);
  const again = await api('POST', '/api/entries', { kind: 'daily', body });
  assert.equal(again.status, 409);
  const dash = await api('GET', '/api/dashboard');
  assert.equal(dash.data.daily.completed, true);
});

let learnedWord;
test('learn flow: presentation, graded quiz, word lands in wordbank at 65', async () => {
  const start = await api('POST', '/api/words/learn/start');
  assert.equal(start.status, 200);
  const { sessionId, word, questions } = start.data;
  assert.ok(word.word && word.definition && word.pos && word.example);
  assert.equal(questions.length, 3);
  for (const q of questions) assert.equal(q.answer, undefined);

  const answers = answersFor(sessionId);
  let last;
  for (let i = 0; i < answers.length; i++) {
    last = await api('POST', `/api/quiz/${sessionId}/answer`, { choice: answers[i] });
    assert.equal(last.status, 200);
    assert.equal(last.data.correct, true);
    assert.equal(last.data.done, i === answers.length - 1);
  }
  assert.equal(last.data.correctCount, 3);
  assert.equal(last.data.learned.mastery, 65);
  learnedWord = last.data.learned;
  const done = await api('POST', `/api/quiz/${sessionId}/answer`, { choice: 0 });
  assert.equal(done.status, 404); // completed sessions are gone
});

test('learn flow with wrong answers still learns, at lower mastery', async () => {
  const start = await api('POST', '/api/words/learn/start');
  const { sessionId } = start.data;
  const answers = answersFor(sessionId);
  let last;
  for (let i = 0; i < answers.length; i++) {
    // deliberately wrong on every question
    last = await api('POST', `/api/quiz/${sessionId}/answer`, { choice: (answers[i] + 1) % 3 });
    assert.equal(last.data.correct, false);
    assert.equal(last.data.answer, answers[i]); // reveals the right one
  }
  assert.equal(last.data.learned.mastery, 50);
});

test('custom words: add, duplicate rejection, delete', async () => {
  const add = await api('POST', '/api/words', {
    word: 'petrichor',
    pos: 'noun',
    definition: 'the smell of rain on dry earth',
    example: 'The petrichor rose from the gravel road.',
  });
  assert.equal(add.status, 201);
  assert.equal(add.data.word.mastery, 40);
  const dup = await api('POST', '/api/words', { word: 'Petrichor', definition: 'again' });
  assert.equal(dup.status, 409);
  const bad = await api('POST', '/api/words', { word: '123!!', definition: 'nope' });
  assert.equal(bad.status, 422);
  const del = await api('DELETE', `/api/words/${add.data.word.id}`);
  assert.equal(del.status, 200);
});

test('using wordbank words in an entry bumps mastery and pays XP', async () => {
  const filler = Array.from({ length: 30 }, (_, i) => `filler${i}`).join(' ');
  const body = `I will use the word ${learnedWord.word} today, twice even: ${learnedWord.word}. ${filler}`;
  const { status, data } = await api('POST', '/api/entries', { kind: 'journal', body });
  assert.equal(status, 201);
  assert.equal(data.wordsUsed.length, 1);
  assert.equal(data.wordsUsed[0].word, learnedWord.word);
  assert.equal(data.wordsUsed[0].to, 71); // 65 + 6, counted once per entry
  assert.ok(data.xp.items.some((i) => i.reason === 'words' && i.amount === 5));
  const words = await api('GET', '/api/words');
  const w = words.data.words.find((x) => x.word === learnedWord.word);
  assert.equal(w.mastery, 71);
  assert.equal(w.timesUsed, 1);
});

test('challenges: constraints enforced, bonus XP once', async () => {
  const list = await api('GET', '/api/challenges');
  assert.ok(list.data.challenges.length >= 10);
  const grat = list.data.challenges.find((c) => c.title === 'Three Gratitudes');
  assert.ok(grat);

  const short = await api('POST', '/api/entries', { kind: 'challenge', challengeId: grat.id, body: 'Too short and missing the word.' });
  assert.equal(short.status, 422);
  assert.deepEqual(short.data.missing, ['grateful']);

  const filler = Array.from({ length: 70 }, (_, i) => `thing${i}`).join(' ');
  const good = await api('POST', '/api/entries', { kind: 'challenge', challengeId: grat.id, body: `I am grateful for ${filler}` });
  assert.equal(good.status, 201);
  assert.ok(good.data.xp.items.some((i) => i.reason === 'challenge' && i.amount === 40));
  assert.ok(good.data.newAchievements.some((a) => a.id === 'challenge-1'));

  const repeat = await api('POST', '/api/entries', { kind: 'challenge', challengeId: grat.id, body: `Still grateful for ${filler}` });
  assert.equal(repeat.status, 201);
  assert.ok(!repeat.data.xp.items.some((i) => i.reason === 'challenge'));
});

test('surprise challenge built from lowest-mastery wordbank words', async () => {
  await api('POST', '/api/words', { word: 'sonder', definition: 'the realization that every passerby has a full life' });
  await api('POST', '/api/words', { word: 'hiraeth', definition: 'longing for a home you cannot return to' });
  const { status, data } = await api('POST', '/api/challenges/surprise');
  assert.equal(status, 201);
  assert.equal(data.challenge.requiredWords.length, 3);
  assert.equal(data.challenge.minWords, 100);
  // the two fresh customs (mastery 40) must be among the picks
  assert.ok(data.challenge.requiredWords.includes('sonder'));
  assert.ok(data.challenge.requiredWords.includes('hiraeth'));
});

test('practice: correct answers bump mastery toward the 95 cap', async () => {
  const start = await api('POST', '/api/words/practice/start');
  assert.equal(start.status, 200);
  assert.ok(start.data.questions.length >= 1);
  const answers = answersFor(start.data.sessionId);
  const first = await api('POST', `/api/quiz/${start.data.sessionId}/answer`, { choice: answers[0] });
  assert.equal(first.data.correct, true);
  assert.ok(first.data.word.to > first.data.word.from);
  assert.ok(first.data.word.to <= 95);
});

test('entries: list, read, edit, delete', async () => {
  const list = await api('GET', '/api/entries');
  assert.ok(list.data.entries.length >= 4);
  assert.ok(list.data.entries[0].snippet !== undefined);

  const created = await api('POST', '/api/entries', { kind: 'journal', title: 'Edit me', body: 'A dozen words of original text sitting here waiting to be revised soon.' });
  const id = created.data.entry.id;
  const xpBefore = created.data.entry.xpAwarded;

  const put = await api('PUT', `/api/entries/${id}`, { body: 'Fewer words now.' });
  assert.equal(put.status, 200);
  assert.equal(put.data.entry.wordCount, 3);
  assert.equal(put.data.entry.xpAwarded, xpBefore); // edits never re-award

  const got = await api('GET', `/api/entries/${id}`);
  assert.equal(got.data.entry.body, 'Fewer words now.');

  const del = await api('DELETE', `/api/entries/${id}`);
  assert.equal(del.status, 200);
  assert.equal((await api('GET', `/api/entries/${id}`)).status, 404);
});

test('stats: totals, xp timeline, unlocked achievements', async () => {
  const { status, data } = await api('GET', '/api/stats');
  assert.equal(status, 200);
  assert.equal(data.xpByDay.length, 30);
  const todayXp = data.xpByDay.at(-1).xp;
  assert.ok(todayXp > 0);
  const first = data.achievements.find((a) => a.id === 'first-entry');
  assert.ok(first.unlockedAt);
  assert.ok(data.totals.wordbankCount >= 3);
  assert.ok(data.level.totalXp > 0);
});

test('static shell and SPA fallback are served', async () => {
  const root = await fetch(base + '/');
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type'), /text\/html/);
  const deep = await fetch(base + '/journal');
  assert.equal(deep.status, 200);
  assert.match(deep.headers.get('content-type'), /text\/html/);
  const shared = await fetch(base + '/shared/wordmatch.js');
  assert.equal(shared.status, 200);
  const traversal = await fetch(base + '/../package.json');
  assert.notEqual(traversal.status, 200);
});

test('logout clears the session', async () => {
  await api('POST', '/api/auth/logout');
  const me = await api('GET', '/api/auth/me');
  assert.equal(me.status, 401);
});
