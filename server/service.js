// Cross-route domain services: XP ledger, stats snapshot, achievements,
// daily prompt selection.

import { levelInfo } from './domain/xp.js';
import { effectiveMastery } from './domain/mastery.js';
import { computeStreaks, localDateStr } from './domain/streak.js';
import { evaluateAchievements } from './domain/achievements.js';

export function nowIso() {
  return new Date().toISOString();
}

export function awardXp(db, userId, items, refId = null) {
  const ins = db.prepare('INSERT INTO xp_events (user_id, amount, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?)');
  const at = nowIso();
  for (const item of items) ins.run(userId, item.amount, item.reason, refId, at);
}

export function totalXp(db, userId) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM xp_events WHERE user_id = ?').get(userId).t;
}

export function userLevel(db, userId) {
  return levelInfo(totalXp(db, userId));
}

export function dailyDates(db, userId) {
  return db
    .prepare("SELECT DISTINCT entry_date FROM entries WHERE user_id = ? AND kind = 'daily'")
    .all(userId)
    .map((r) => r.entry_date);
}

export function userStreaks(db, userId, today = localDateStr()) {
  return computeStreaks(dailyDates(db, userId), today);
}

// Snapshot of everything the achievement predicates (and the stats page) need.
export function userStats(db, userId, now = Date.now()) {
  const entryAgg = db
    .prepare(
      `SELECT COUNT(*) AS entryCount, COALESCE(SUM(word_count), 0) AS totalWords,
              COALESCE(MAX(word_count), 0) AS maxEntryWords, COALESCE(MAX(wordbank_used), 0) AS maxWordbankUsedInEntry
       FROM entries WHERE user_id = ?`,
    )
    .get(userId);
  const challengesCompleted = db
    .prepare("SELECT COUNT(DISTINCT challenge_id) AS n FROM entries WHERE user_id = ? AND kind = 'challenge'")
    .get(userId).n;
  const wordRows = db.prepare('SELECT mastery, mastery_updated_at FROM words WHERE user_id = ?').all(userId);
  let maxMastery = 0;
  let wordsAbove90 = 0;
  for (const w of wordRows) {
    const eff = effectiveMastery(w.mastery, w.mastery_updated_at, now);
    if (eff > maxMastery) maxMastery = eff;
    if (eff >= 90) wordsAbove90++;
  }
  const streaks = userStreaks(db, userId);
  const level = userLevel(db, userId);
  return {
    entryCount: entryAgg.entryCount,
    totalWords: entryAgg.totalWords,
    maxEntryWords: entryAgg.maxEntryWords,
    maxWordbankUsedInEntry: entryAgg.maxWordbankUsedInEntry,
    challengesCompleted,
    wordbankCount: wordRows.length,
    maxMastery,
    wordsAbove90,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    level: level.level,
    totalXp: level.totalXp,
  };
}

// Evaluate + persist newly unlocked achievements; returns them (display form).
export function checkAchievements(db, userId) {
  const unlocked = db.prepare('SELECT achievement_id FROM achievements WHERE user_id = ?').all(userId).map((r) => r.achievement_id);
  const stats = userStats(db, userId);
  const fresh = evaluateAchievements(stats, unlocked);
  if (fresh.length > 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)');
    const at = nowIso();
    for (const a of fresh) ins.run(userId, a.id, at);
  }
  return fresh.map(({ id, icon, name, desc }) => ({ id, icon, name, desc }));
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// The same prompt for every user on a given date: deterministic pick,
// memoized so the choice survives seed-file edits.
export function getDailyPrompt(db, date = localDateStr()) {
  const existing = db
    .prepare('SELECT p.* FROM daily_prompts d JOIN prompts p ON p.id = d.prompt_id WHERE d.date = ?')
    .get(date);
  if (existing) return existing;
  const ids = db.prepare('SELECT id FROM prompts ORDER BY id').all().map((r) => r.id);
  if (ids.length === 0) return null;
  const id = ids[fnv1a(date) % ids.length];
  db.prepare('INSERT OR IGNORE INTO daily_prompts (date, prompt_id) VALUES (?, ?)').run(date, id);
  return db.prepare('SELECT * FROM prompts WHERE id = ?').get(id);
}

// Word row -> API shape with decay applied.
export function wordToApi(row, now = Date.now()) {
  return {
    id: row.id,
    word: row.word,
    pos: row.pos,
    definition: row.definition,
    example: row.example,
    source: row.source,
    mastery: effectiveMastery(row.mastery, row.mastery_updated_at, now),
    timesUsed: row.times_used,
    lastUsedAt: row.last_used_at,
    addedAt: row.added_at,
  };
}
