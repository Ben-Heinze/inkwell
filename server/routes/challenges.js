import { ApiError } from '../http.js';
import { effectiveMastery } from '../domain/mastery.js';

const SURPRISE_TITLES = ['Wild Card', 'Lexical Gauntlet', 'Word Weaver', 'Curveball', 'The Recall'];

function challengeToApi(row, completions) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    minWords: row.min_words,
    requiredWords: JSON.parse(row.required_words || '[]'),
    image: row.image,
    completions: completions.get(row.id) || 0,
  };
}

export function register(router, db) {
  router.get('/api/challenges', async (ctx) => {
    const rows = db
      .prepare('SELECT * FROM challenges WHERE user_id IS NULL OR user_id = ? ORDER BY kind DESC, id')
      .all(ctx.user.id);
    const completions = new Map(
      db
        .prepare("SELECT challenge_id, COUNT(*) AS n FROM entries WHERE user_id = ? AND kind = 'challenge' GROUP BY challenge_id")
        .all(ctx.user.id)
        .map((r) => [r.challenge_id, r.n]),
    );
    const all = rows.map((r) => challengeToApi(r, completions));
    return {
      challenges: all.filter((c) => c.kind === 'seed'),
      // only surface surprise challenges that are still open
      surprises: all.filter((c) => c.kind === 'surprise' && c.completions === 0),
    };
  });

  router.get('/api/challenges/:id', async (ctx) => {
    const row = db.prepare('SELECT * FROM challenges WHERE id = ?').get(Number(ctx.params.id));
    if (!row || (row.user_id && row.user_id !== ctx.user.id)) throw new ApiError(404, 'Challenge not found');
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM entries WHERE user_id = ? AND challenge_id = ?")
      .get(ctx.user.id, row.id).n;
    return { challenge: challengeToApi(row, new Map([[row.id, n]])) };
  });

  // Generate a personal challenge from the user's most-faded wordbank words.
  router.post('/api/challenges/surprise', async (ctx) => {
    const now = Date.now();
    const words = db
      .prepare("SELECT word, mastery, mastery_updated_at FROM words WHERE user_id = ?")
      .all(ctx.user.id)
      .map((r) => ({ word: r.word, eff: effectiveMastery(r.mastery, r.mastery_updated_at, now) }))
      .sort((a, b) => a.eff - b.eff)
      .slice(0, 3)
      .map((r) => r.word);
    if (words.length < 3) {
      throw new ApiError(422, 'Learn at least 3 words first — surprise challenges are built from your wordbank');
    }
    const title = SURPRISE_TITLES[Math.floor(Math.random() * SURPRISE_TITLES.length)];
    const description = `Write a piece — any topic, any form — that naturally works in all three of these words from your wordbank: ${words.map((w) => `“${w}”`).join(', ')}.`;
    const key = `surprise-${ctx.user.id}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const info = db
      .prepare(
        `INSERT INTO challenges (key, kind, user_id, title, description, min_words, required_words)
         VALUES (?, 'surprise', ?, ?, ?, 100, ?)`,
      )
      .run(key, ctx.user.id, `Surprise: ${title}`, description, JSON.stringify(words));
    const row = db.prepare('SELECT * FROM challenges WHERE id = ?').get(Number(info.lastInsertRowid));
    ctx.status = 201;
    return { challenge: challengeToApi(row, new Map()) };
  });
}
