import { effectiveMastery } from '../domain/mastery.js';
import { localDateStr, addDays } from '../domain/streak.js';
import { ACHIEVEMENTS } from '../domain/achievements.js';
import { userLevel, userStreaks } from '../service.js';

export function register(router, db) {
  router.get('/api/stats', async (ctx) => {
    const userId = ctx.user.id;
    const today = localDateStr();

    // XP per local day, last 30 days (zero-filled).
    const since30 = addDays(today, -29);
    const xpByDayMap = new Map();
    for (const r of db
      .prepare('SELECT amount, created_at FROM xp_events WHERE user_id = ?')
      .all(userId)) {
      const day = localDateStr(new Date(r.created_at));
      if (day >= since30) xpByDayMap.set(day, (xpByDayMap.get(day) || 0) + r.amount);
    }
    const xpByDay = [];
    for (let d = since30; d <= today; d = addDays(d, 1)) {
      xpByDay.push({ date: d, xp: xpByDayMap.get(d) || 0 });
    }

    // Words written per day for the heatmap: last 18 full weeks.
    const since126 = addDays(today, -125);
    const wordsByDay = db
      .prepare(
        `SELECT entry_date AS date, SUM(word_count) AS words, COUNT(*) AS entries
         FROM entries WHERE user_id = ? AND entry_date >= ? GROUP BY entry_date`,
      )
      .all(userId, since126);

    const unlocked = new Map(
      db.prepare('SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ?').all(userId)
        .map((r) => [r.achievement_id, r.unlocked_at]),
    );
    const achievements = ACHIEVEMENTS.map((a) => ({
      id: a.id,
      icon: a.icon,
      name: a.name,
      desc: a.desc,
      unlockedAt: unlocked.get(a.id) ?? null,
    }));

    const entryAgg = db
      .prepare(
        `SELECT COUNT(*) AS entries, COALESCE(SUM(word_count), 0) AS words, COALESCE(MAX(word_count), 0) AS maxEntry
         FROM entries WHERE user_id = ?`,
      )
      .get(userId);
    const challengesCompleted = db
      .prepare("SELECT COUNT(DISTINCT challenge_id) AS n FROM entries WHERE user_id = ? AND kind = 'challenge'")
      .get(userId).n;
    const now = Date.now();
    const masteries = db
      .prepare('SELECT mastery, mastery_updated_at FROM words WHERE user_id = ?')
      .all(userId)
      .map((r) => effectiveMastery(r.mastery, r.mastery_updated_at, now));
    const avgMastery = masteries.length ? Math.round(masteries.reduce((s, m) => s + m, 0) / masteries.length) : 0;

    return {
      level: userLevel(db, userId),
      streak: userStreaks(db, userId, today),
      xpByDay,
      wordsByDay,
      achievements,
      totals: {
        entries: entryAgg.entries,
        words: entryAgg.words,
        maxEntryWords: entryAgg.maxEntry,
        wordbankCount: masteries.length,
        avgMastery,
        challengesCompleted,
      },
    };
  });
}
