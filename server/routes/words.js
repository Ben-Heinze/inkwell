import { randomBytes } from 'node:crypto';
import { ApiError } from '../http.js';
import { tx } from '../db.js';
import { MASTERY_RULES, effectiveMastery, initialMastery, applyPractice, isDue } from '../domain/mastery.js';
import { XP_RULES } from '../domain/xp.js';
import { buildLearnQuestions, buildPracticeQuestion, sanitizeQuestions } from '../domain/quiz.js';
import { nowIso, awardXp, userLevel, checkAchievements, wordToApi } from '../service.js';

const WORD_RE = /^[\p{L}][\p{L}' -]{0,39}$/u;

function catalogPool(db, excludeWord) {
  return db
    .prepare('SELECT word, pos, definition, example FROM catalog_words WHERE word <> ?')
    .all(excludeWord ?? '');
}

export function register(router, db) {
  router.get('/api/words', async (ctx) => {
    const now = Date.now();
    const rows = db.prepare('SELECT * FROM words WHERE user_id = ?').all(ctx.user.id);
    const words = rows.map((r) => {
      const api = wordToApi(r, now);
      api.due = isDue(api.mastery);
      return api;
    });
    const q = (ctx.query.q || '').toLowerCase();
    const filtered = q
      ? words.filter((w) => w.word.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q))
      : words;
    const sort = ctx.query.sort || 'mastery';
    const cmp = {
      mastery: (a, b) => a.mastery - b.mastery,
      recent: (a, b) => (a.addedAt < b.addedAt ? 1 : -1),
      alpha: (a, b) => a.word.localeCompare(b.word),
      used: (a, b) => b.timesUsed - a.timesUsed,
    }[sort];
    if (cmp) filtered.sort(cmp);
    const due = words.filter((w) => w.due).length;
    const avg = words.length ? words.reduce((s, w) => s + w.mastery, 0) / words.length : 0;
    return {
      words: filtered,
      totals: { count: words.length, due, avgMastery: Math.round(avg) },
      catalogRemaining: db
        .prepare('SELECT COUNT(*) AS n FROM catalog_words WHERE word NOT IN (SELECT word FROM words WHERE user_id = ?)')
        .get(ctx.user.id).n,
    };
  });

  router.post('/api/words', async (ctx) => {
    const word = String(ctx.body.word ?? '').trim();
    const definition = String(ctx.body.definition ?? '').trim();
    const pos = String(ctx.body.pos ?? '').trim().slice(0, 20);
    const example = String(ctx.body.example ?? '').trim().slice(0, 300);
    if (!WORD_RE.test(word)) throw new ApiError(422, 'Words are 1–40 letters (spaces and hyphens allowed)');
    if (!definition || definition.length > 500) throw new ApiError(422, 'A definition is required (max 500 chars)');
    const exists = db
      .prepare('SELECT 1 FROM words WHERE user_id = ? AND word = ? COLLATE NOCASE')
      .get(ctx.user.id, word);
    if (exists) throw new ApiError(409, 'That word is already in your wordbank');
    const at = nowIso();
    const info = db
      .prepare(
        `INSERT INTO words (user_id, word, pos, definition, example, source, mastery, mastery_updated_at, added_at)
         VALUES (?, ?, ?, ?, ?, 'custom', ?, ?, ?)`,
      )
      .run(ctx.user.id, word.toLowerCase(), pos, definition, example, MASTERY_RULES.customStart, at, at);
    const row = db.prepare('SELECT * FROM words WHERE id = ?').get(Number(info.lastInsertRowid));
    const newAchievements = checkAchievements(db, ctx.user.id);
    ctx.status = 201;
    return { word: wordToApi(row), newAchievements };
  });

  router.delete('/api/words/:id', async (ctx) => {
    const info = db.prepare('DELETE FROM words WHERE id = ? AND user_id = ?').run(Number(ctx.params.id), ctx.user.id);
    if (info.changes === 0) throw new ApiError(404, 'Word not found');
    return { ok: true };
  });

  // Learn flow: present a new catalog word, then quiz it (2 MCQs + placement).
  router.post('/api/words/learn/start', async (ctx) => {
    const target = db
      .prepare(
        `SELECT * FROM catalog_words WHERE word NOT IN (SELECT word FROM words WHERE user_id = ?)
         ORDER BY RANDOM() LIMIT 1`,
      )
      .get(ctx.user.id);
    if (!target) throw new ApiError(422, 'You have learned every word in the catalog — add your own!');
    const questions = buildLearnQuestions(target, catalogPool(db, target.word));
    const sessionId = randomBytes(16).toString('base64url');
    const payload = {
      mode: 'learn',
      catalogId: target.id,
      word: { word: target.word, pos: target.pos, definition: target.definition, example: target.example },
      questions,
    };
    db.prepare('INSERT INTO quiz_sessions (id, user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
      sessionId,
      ctx.user.id,
      'learn',
      JSON.stringify(payload),
      nowIso(),
    );
    return { sessionId, word: payload.word, questions: sanitizeQuestions(questions) };
  });

  // Practice mode: one question each for the most-faded words.
  router.post('/api/words/practice/start', async (ctx) => {
    const now = Date.now();
    const rows = db
      .prepare("SELECT * FROM words WHERE user_id = ? AND definition <> ''")
      .all(ctx.user.id)
      .map((r) => ({ row: r, eff: effectiveMastery(r.mastery, r.mastery_updated_at, now) }))
      .sort((a, b) => a.eff - b.eff)
      .slice(0, 5);
    if (rows.length === 0) throw new ApiError(422, 'No words to practice yet — learn a few first');
    const pool = catalogPool(db, null);
    const questions = rows.map(({ row }) => {
      const q = buildPracticeQuestion(
        { word: row.word, pos: row.pos, definition: row.definition, example: row.example },
        pool.filter((p) => p.word !== row.word),
      );
      q.wordId = row.id;
      return q;
    });
    const sessionId = randomBytes(16).toString('base64url');
    db.prepare('INSERT INTO quiz_sessions (id, user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
      sessionId,
      ctx.user.id,
      'practice',
      JSON.stringify({ mode: 'practice', questions }),
      nowIso(),
    );
    return { sessionId, questions: sanitizeQuestions(questions) };
  });

  // Grade one answer; server-side so mastery/XP can't be self-reported.
  router.post('/api/quiz/:id/answer', async (ctx) => {
    return tx(db, () => {
      const session = db
        .prepare('SELECT * FROM quiz_sessions WHERE id = ? AND user_id = ? AND completed = 0')
        .get(ctx.params.id, ctx.user.id);
      if (!session) throw new ApiError(404, 'Quiz session not found');
      const payload = JSON.parse(session.payload);
      const question = payload.questions[session.step];
      if (!question) throw new ApiError(400, 'Quiz already finished');
      const choice = Number(ctx.body.choice);
      const correct = choice === question.answer;
      const newStep = session.step + 1;
      const newCorrect = session.correct + (correct ? 1 : 0);
      const done = newStep >= payload.questions.length;
      const at = nowIso();
      db.prepare('UPDATE quiz_sessions SET step = ?, correct = ?, completed = ? WHERE id = ?').run(
        newStep,
        newCorrect,
        done ? 1 : 0,
        session.id,
      );

      const result = {
        correct,
        answer: question.answer,
        step: session.step,
        totalSteps: payload.questions.length,
        done,
      };

      if (payload.mode === 'practice' && question.wordId) {
        const w = db.prepare('SELECT * FROM words WHERE id = ? AND user_id = ?').get(question.wordId, ctx.user.id);
        if (w) {
          const from = effectiveMastery(w.mastery, w.mastery_updated_at);
          const to = correct ? applyPractice(from) : from;
          db.prepare('UPDATE words SET mastery = ?, mastery_updated_at = ? WHERE id = ?').run(to, at, w.id);
          if (correct) {
            awardXp(db, ctx.user.id, [{ amount: XP_RULES.practiceCorrect, reason: 'practice' }], w.id);
          }
          result.word = { id: w.id, word: w.word, from, to };
        }
      }

      if (done) {
        result.correctCount = newCorrect;
        if (payload.mode === 'learn') {
          const mastery = initialMastery(newCorrect);
          const info = db
            .prepare(
              `INSERT INTO words (user_id, word, pos, definition, example, source, catalog_id, mastery, mastery_updated_at, added_at)
               VALUES (?, ?, ?, ?, ?, 'seed', ?, ?, ?, ?)
               ON CONFLICT(user_id, word) DO NOTHING`,
            )
            .run(
              ctx.user.id,
              payload.word.word,
              payload.word.pos,
              payload.word.definition,
              payload.word.example,
              payload.catalogId,
              mastery,
              at,
              at,
            );
          if (info.changes > 0) {
            awardXp(db, ctx.user.id, [{ amount: XP_RULES.learnWord, reason: 'learn' }], Number(info.lastInsertRowid));
          }
          const row = db
            .prepare('SELECT * FROM words WHERE user_id = ? AND word = ?')
            .get(ctx.user.id, payload.word.word);
          result.learned = row ? wordToApi(row) : null;
        }
        result.newAchievements = checkAchievements(db, ctx.user.id);
        result.level = userLevel(db, ctx.user.id);
      }
      return result;
    });
  });
}
