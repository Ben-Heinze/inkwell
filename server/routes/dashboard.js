import { isDue } from '../domain/mastery.js';
import { localDateStr } from '../domain/streak.js';
import { ACHIEVEMENTS } from '../domain/achievements.js';
import { userLevel, userStreaks, getDailyPrompt, wordToApi } from '../service.js';

export function register(router, db) {
  router.get('/api/dashboard', async (ctx) => {
    const userId = ctx.user.id;
    const today = localDateStr();
    const prompt = getDailyPrompt(db, today);
    const dailyEntry = prompt
      ? db
          .prepare("SELECT id FROM entries WHERE user_id = ? AND kind = 'daily' AND entry_date = ?")
          .get(userId, today)
      : null;

    const now = Date.now();
    const words = db.prepare('SELECT * FROM words WHERE user_id = ?').all(userId).map((r) => wordToApi(r, now));
    const dueWords = words
      .filter((w) => isDue(w.mastery))
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, 5);

    const recentEntries = db
      .prepare(
        `SELECT id, kind, title, word_count, entry_date, created_at FROM entries
         WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
      )
      .all(userId)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        wordCount: r.word_count,
        entryDate: r.entry_date,
        createdAt: r.created_at,
      }));

    const byId = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
    const recentAchievements = db
      .prepare('SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ? ORDER BY unlocked_at DESC LIMIT 3')
      .all(userId)
      .map((r) => {
        const def = byId.get(r.achievement_id);
        return def ? { id: def.id, icon: def.icon, name: def.name, desc: def.desc, unlockedAt: r.unlocked_at } : null;
      })
      .filter(Boolean);

    const totals = db
      .prepare('SELECT COUNT(*) AS entries, COALESCE(SUM(word_count), 0) AS words FROM entries WHERE user_id = ?')
      .get(userId);

    return {
      user: ctx.user,
      today,
      level: userLevel(db, userId),
      streak: userStreaks(db, userId, today),
      daily: prompt
        ? {
            prompt: { id: prompt.id, text: prompt.text, image: prompt.image },
            completed: Boolean(dailyEntry),
            entryId: dailyEntry?.id ?? null,
          }
        : null,
      dueWords,
      wordbank: { total: words.length, due: words.filter((w) => isDue(w.mastery)).length },
      recentEntries,
      recentAchievements,
      totals: { entries: totals.entries, words: totals.words },
    };
  });
}
