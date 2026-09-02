import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XP_RULES, entryXpBreakdown, xpForLevel, levelInfo } from '../server/domain/xp.js';

test('short entries earn no writing XP but still work', () => {
  const xp = entryXpBreakdown({ wordCount: 5, kind: 'journal', wordbankUsedCount: 0 });
  assert.equal(xp.total, 0);
  assert.equal(xp.items.length, 0);
});

test('journal entry XP scales with word count and caps at 50', () => {
  assert.equal(entryXpBreakdown({ wordCount: 10, kind: 'journal' }).total, 10);
  assert.equal(entryXpBreakdown({ wordCount: 100, kind: 'journal' }).total, 14);
  assert.equal(entryXpBreakdown({ wordCount: 1000, kind: 'journal' }).total, 50);
  assert.equal(entryXpBreakdown({ wordCount: 50000, kind: 'journal' }).total, 50);
});

test('daily prompt adds bonus on top of writing XP', () => {
  const xp = entryXpBreakdown({ wordCount: 100, kind: 'daily' });
  assert.equal(xp.total, 14 + XP_RULES.dailyBonus);
  assert.ok(xp.items.some((i) => i.reason === 'daily'));
});

test('challenge bonus only on first completion', () => {
  const first = entryXpBreakdown({ wordCount: 100, kind: 'challenge', firstChallengeCompletion: true });
  const repeat = entryXpBreakdown({ wordCount: 100, kind: 'challenge', firstChallengeCompletion: false });
  assert.equal(first.total - repeat.total, XP_RULES.challengeBonus);
});

test('wordbank usage bonus counts distinct words, capped', () => {
  const xp = entryXpBreakdown({ wordCount: 100, kind: 'journal', wordbankUsedCount: 3 });
  assert.ok(xp.items.some((i) => i.reason === 'words' && i.amount === 15));
  const capped = entryXpBreakdown({ wordCount: 100, kind: 'journal', wordbankUsedCount: 12 });
  const item = capped.items.find((i) => i.reason === 'words');
  assert.equal(item.amount, XP_RULES.wordUseMax * XP_RULES.wordUseBonus);
});

test('level curve is monotonic and starts at level 1', () => {
  assert.equal(xpForLevel(1), 0);
  for (let l = 2; l < 40; l++) assert.ok(xpForLevel(l) > xpForLevel(l - 1));
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(0).title, 'Inkling');
  assert.equal(levelInfo(99).level, 1);
  assert.equal(levelInfo(100).level, 2);
  const big = levelInfo(3000);
  assert.ok(big.level >= 10);
  assert.ok(big.progress >= 0 && big.progress <= 1);
});
