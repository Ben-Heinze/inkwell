import { ApiError } from '../http.js';
import { tx } from '../db.js';
import { countWords, findWordUsage } from '../../shared/wordmatch.js';
import { entryXpBreakdown } from '../domain/xp.js';
import { effectiveMastery, applyUse } from '../domain/mastery.js';
import { localDateStr } from '../domain/streak.js';
import { nowIso, awardXp, userLevel, userStreaks, checkAchievements, getDailyPrompt } from '../service.js';

const KINDS = new Set(['journal', 'daily', 'challenge']);

function entryToApi(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    wordCount: row.word_count,
    entryDate: row.entry_date,
    promptId: row.prompt_id,
    promptText: row.prompt_text ?? null,
    promptImage: row.prompt_image ?? null,
    challengeId: row.challenge_id,
    challengeTitle: row.challenge_title ?? null,
    xpAwarded: row.xp_awarded,
    wordbankUsed: row.wordbank_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ENTRY_SELECT = `
  SELECT e.*, p.text AS prompt_text, p.image AS prompt_image, c.title AS challenge_title
  FROM entries e
  LEFT JOIN prompts p ON p.id = e.prompt_id
  LEFT JOIN challenges c ON c.id = e.challenge_id`;

export function register(router, db) {
  router.get('/api/entries', async (ctx) => {
    const { kind, q } = ctx.query;
    const limit = Math.min(Number(ctx.query.limit) || 50, 200);
    const offset = Math.max(Number(ctx.query.offset) || 0, 0);
    const where = ['e.user_id = ?'];
    const args = [ctx.user.id];
    if (kind && KINDS.has(kind)) {
      where.push('e.kind = ?');
      args.push(kind);
    }
    if (q) {
      where.push('(e.title LIKE ? OR e.body LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const rows = db
      .prepare(`${ENTRY_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset);
    return {
      entries: rows.map((r) => {
        const api = entryToApi(r);
        api.snippet = r.body.slice(0, 220);
        delete api.body;
        return api;
      }),
    };
  });

  router.get('/api/entries/:id', async (ctx) => {
    const row = db.prepare(`${ENTRY_SELECT} WHERE e.id = ? AND e.user_id = ?`).get(Number(ctx.params.id), ctx.user.id);
    if (!row) throw new ApiError(404, 'Entry not found');
    return { entry: entryToApi(row) };
  });

  router.post('/api/entries', async (ctx) => {
    const { kind = 'journal', title = '', body = '' } = ctx.body;
    if (!KINDS.has(kind)) throw new ApiError(400, 'Unknown entry kind');
    if (typeof body !== 'string' || typeof title !== 'string') throw new ApiError(400, 'Bad payload');
    const wordCount = countWords(body);
    if (wordCount === 0) throw new ApiError(422, 'Write something first');
    if (body.length > 200_000) throw new ApiError(413, 'Entry is too long');

    const today = localDateStr();
    const userId = ctx.user.id;

    return tx(db, () => {
      let promptId = null;
      let challengeId = null;
      let firstCompletion = true;

      if (kind === 'daily') {
        const prompt = getDailyPrompt(db, today);
        if (!prompt) throw new ApiError(500, 'No prompts available');
        const existing = db
          .prepare("SELECT id FROM entries WHERE user_id = ? AND kind = 'daily' AND entry_date = ?")
          .get(userId, today);
        if (existing) throw new ApiError(409, "You've already answered today's prompt");
        promptId = prompt.id;
      } else if (kind === 'challenge') {
        const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(Number(ctx.body.challengeId));
        if (!challenge || (challenge.user_id && challenge.user_id !== userId)) {
          throw new ApiError(404, 'Challenge not found');
        }
        const required = JSON.parse(challenge.required_words || '[]');
        const found = new Set(findWordUsage(body, required.map((w) => ({ word: w }))).map((u) => u.word));
        const missing = required.filter((w) => !found.has(w));
        const minWords = challenge.min_words || 0;
        if (missing.length > 0 || wordCount < minWords) {
          throw new ApiError(422, 'Challenge requirements not met', {
            missing,
            wordCount,
            minWords: challenge.min_words,
          });
        }
        firstCompletion = !db
          .prepare('SELECT 1 FROM entries WHERE user_id = ? AND challenge_id = ?')
          .get(userId, challenge.id);
        challengeId = challenge.id;
      }

      // Wordbank usage: bump mastery on every distinct word found.
      const bank = db.prepare('SELECT id, word, mastery, mastery_updated_at FROM words WHERE user_id = ?').all(userId);
      const used = findWordUsage(body, bank);
      const at = nowIso();
      const updateWord = db.prepare(
        'UPDATE words SET mastery = ?, mastery_updated_at = ?, times_used = times_used + 1, last_used_at = ? WHERE id = ?',
      );
      const wordsUsed = used.map((u) => {
        const from = effectiveMastery(u.mastery, u.mastery_updated_at);
        const to = applyUse(from);
        updateWord.run(to, at, at, u.id);
        return { id: u.id, word: u.word, from, to };
      });

      const xp = entryXpBreakdown({
        wordCount,
        kind,
        wordbankUsedCount: used.length,
        firstChallengeCompletion: firstCompletion,
      });
      const info = db
        .prepare(
          `INSERT INTO entries (user_id, kind, title, body, word_count, entry_date, prompt_id, challenge_id, xp_awarded, wordbank_used, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, kind, title.slice(0, 200), body, wordCount, today, promptId, challengeId, xp.total, used.length, at, at);
      const entryId = Number(info.lastInsertRowid);
      awardXp(db, userId, xp.items, entryId);

      const streak = userStreaks(db, userId, today);
      const newAchievements = checkAchievements(db, userId);
      const row = db.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).get(entryId);
      ctx.status = 201;
      return {
        entry: entryToApi(row),
        xp,
        wordsUsed,
        streak,
        level: userLevel(db, userId),
        newAchievements,
        firstCompletion: kind === 'challenge' ? firstCompletion : undefined,
      };
    });
  });

  // Edits update text only — no XP or mastery re-awards (that would be farmable).
  router.put('/api/entries/:id', async (ctx) => {
    const id = Number(ctx.params.id);
    const row = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(id, ctx.user.id);
    if (!row) throw new ApiError(404, 'Entry not found');
    const title = typeof ctx.body.title === 'string' ? ctx.body.title.slice(0, 200) : row.title;
    const body = typeof ctx.body.body === 'string' ? ctx.body.body : row.body;
    const wordCount = countWords(body);
    if (wordCount === 0) throw new ApiError(422, 'Write something first');
    db.prepare('UPDATE entries SET title = ?, body = ?, word_count = ?, updated_at = ? WHERE id = ?').run(
      title,
      body,
      wordCount,
      nowIso(),
      id,
    );
    const updated = db.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).get(id);
    return { entry: entryToApi(updated) };
  });

  router.delete('/api/entries/:id', async (ctx) => {
    const info = db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').run(Number(ctx.params.id), ctx.user.id);
    if (info.changes === 0) throw new ApiError(404, 'Entry not found');
    return { ok: true };
  });
}
