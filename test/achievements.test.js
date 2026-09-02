import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, evaluateAchievements } from '../server/domain/achievements.js';

const baseStats = {
  entryCount: 0,
  totalWords: 0,
  maxEntryWords: 0,
  maxWordbankUsedInEntry: 0,
  challengesCompleted: 0,
  wordbankCount: 0,
  maxMastery: 0,
  wordsAbove90: 0,
  currentStreak: 0,
  longestStreak: 0,
  level: 1,
};

test('all achievements have unique ids and required fields', () => {
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  assert.equal(ids.size, ACHIEVEMENTS.length);
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.icon && a.name && a.desc && typeof a.check === 'function');
    assert.ok(!a.check(baseStats), `${a.id} should not unlock on a fresh account`);
  }
});

test('first entry unlocks exactly one achievement', () => {
  const fresh = evaluateAchievements({ ...baseStats, entryCount: 1, totalWords: 20, maxEntryWords: 20 }, []);
  assert.deepEqual(fresh.map((a) => a.id), ['first-entry']);
});

test('already-unlocked achievements are not re-awarded', () => {
  const fresh = evaluateAchievements({ ...baseStats, entryCount: 1, totalWords: 20 }, ['first-entry']);
  assert.equal(fresh.length, 0);
});

test('streak and mastery predicates', () => {
  const s = { ...baseStats, longestStreak: 7, maxMastery: 100, wordsAbove90: 10 };
  const ids = evaluateAchievements(s, []).map((a) => a.id);
  assert.ok(ids.includes('streak-3'));
  assert.ok(ids.includes('streak-7'));
  assert.ok(!ids.includes('streak-30'));
  assert.ok(ids.includes('mastery-100'));
  assert.ok(ids.includes('scholar'));
});
