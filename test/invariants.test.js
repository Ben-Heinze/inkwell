// Property-style invariants over the game rules, plus whole-catalog checks:
// every seed word must produce a valid quiz, and no two catalog words may
// collide through inflection (which would double-count usage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryXpBreakdown, xpForLevel, levelInfo } from '../server/domain/xp.js';
import { MASTERY_RULES, effectiveMastery, applyPractice, applyUse } from '../server/domain/mastery.js';
import { computeStreaks, addDays } from '../server/domain/streak.js';
import { buildLearnQuestions, sanitizeQuestions } from '../server/domain/quiz.js';
import { inflections, blankOut } from '../shared/wordmatch.js';
import { seededRand } from './helpers.js';

const catalog = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'seed', 'words.json'), 'utf8'),
);

test('level curve: every XP total maps to a consistent level', () => {
  let prevLevel = 0;
  for (let xp = 0; xp <= 30000; xp += 111) {
    const info = levelInfo(xp);
    assert.ok(info.level >= 1);
    assert.ok(info.level >= prevLevel, 'level never decreases as XP grows');
    assert.ok(xpForLevel(info.level) <= xp, `xp ${xp} below its level threshold`);
    assert.ok(xp < xpForLevel(info.level + 1), `xp ${xp} should already be next level`);
    assert.ok(info.progress >= 0 && info.progress < 1);
    assert.ok(info.title.length > 0);
    prevLevel = info.level;
  }
  // exact boundaries
  assert.equal(levelInfo(99).level, 1);
  assert.equal(levelInfo(100).level, 2);
  assert.equal(levelInfo(282).level, 2);
  assert.equal(levelInfo(283).level, 3);
});

test('entry XP: total always equals the sum of its parts and never goes negative', () => {
  const rand = seededRand(7);
  for (let i = 0; i < 300; i++) {
    const wordCount = Math.floor(rand() * 2000);
    const kind = ['journal', 'daily', 'challenge'][Math.floor(rand() * 3)];
    const used = Math.floor(rand() * 12);
    const first = rand() < 0.5;
    const xp = entryXpBreakdown({ wordCount, kind, wordbankUsedCount: used, firstChallengeCompletion: first });
    assert.equal(xp.total, xp.items.reduce((s, it) => s + it.amount, 0));
    assert.ok(xp.total >= 0);
    for (const item of xp.items) assert.ok(item.amount > 0, 'no zero/negative line items');
    // more words never pays less
    const more = entryXpBreakdown({ wordCount: wordCount + 100, kind, wordbankUsedCount: used, firstChallengeCompletion: first });
    assert.ok(more.total >= xp.total);
  }
});

test('mastery: decay never raises a value, never crosses the floor, respects grace', () => {
  const rand = seededRand(11);
  const now = Date.now();
  for (let i = 0; i < 500; i++) {
    const stored = Math.round(rand() * 1000) / 10; // 0..100
    const daysAgo = rand() * 120;
    const eff = effectiveMastery(stored, new Date(now - daysAgo * 86400000).toISOString(), now);
    assert.ok(eff <= stored, 'decay never raises mastery');
    if (daysAgo <= MASTERY_RULES.graceDays) assert.equal(eff, stored);
    if (stored > MASTERY_RULES.decayFloor) assert.ok(eff >= MASTERY_RULES.decayFloor);
    else assert.equal(eff, stored, 'values under the floor are untouched');
  }
});

test('practice and use gains stay inside their caps for every starting value', () => {
  for (let m = 0; m <= 100; m += 0.5) {
    const p = applyPractice(m);
    assert.ok(p >= m, 'practice never lowers mastery');
    if (m < MASTERY_RULES.practiceCap) assert.ok(p <= MASTERY_RULES.practiceCap);
    const u = applyUse(m);
    assert.ok(u >= m && u <= MASTERY_RULES.max);
  }
  assert.equal(applyUse(99), 100);
});

test('streaks: random histories obey the definition', () => {
  const rand = seededRand(23);
  const today = '2026-09-02';
  for (let iter = 0; iter < 200; iter++) {
    const dates = [];
    for (let back = 0; back < 40; back++) {
      if (rand() < 0.45) dates.push(addDays(today, -back));
    }
    const s = computeStreaks(dates, today);
    const set = new Set(dates);

    assert.equal(s.doneToday, set.has(today));
    // independent longest: walk sorted dates
    const sorted = [...set].sort();
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const d of sorted) {
      run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = d;
    }
    assert.equal(s.longest, longest);
    // current: anchored at today (or yesterday), all days present, then a gap
    if (s.current === 0) {
      assert.ok(!set.has(today) && !set.has(addDays(today, -1)));
    } else {
      const anchor = set.has(today) ? today : addDays(today, -1);
      for (let i = 0; i < s.current; i++) assert.ok(set.has(addDays(anchor, -i)));
      assert.ok(!set.has(addDays(anchor, -s.current)));
      assert.ok(s.current <= s.longest);
    }
  }
});

test('every catalog word yields a complete, well-formed learn quiz', () => {
  for (const target of catalog) {
    const pool = catalog.filter((w) => w.word !== target.word);
    const qs = buildLearnQuestions(target, pool, seededRand(target.word.length * 131));
    assert.equal(qs.length, 3, `${target.word}: expected 3 questions`);

    const [def, word, blank] = qs;
    assert.equal(def.type, 'mcq-def');
    assert.equal(new Set(def.choices).size, 4, `${target.word}: duplicate definition choices`);
    assert.equal(def.choices[def.answer], target.definition);

    assert.equal(word.type, 'mcq-word');
    assert.equal(new Set(word.choices).size, 4, `${target.word}: duplicate word choices`);
    assert.equal(word.choices[word.answer], target.word);

    assert.equal(blank.type, 'blank');
    assert.equal(blank.choices.length, 3);
    for (const c of blank.choices) assert.ok(c.includes('_____'), `${target.word}: unblanked sentence`);
    assert.equal(blank.choices[blank.answer], blankOut(target.example, target.word).text);

    const clean = sanitizeQuestions(qs);
    for (const q of clean) assert.equal(q.answer, undefined);
    assert.equal(clean[1].word, undefined, 'mcq-word must not leak the answer word');
  }
});

test('no two catalog words collide through inflection', () => {
  const formSets = catalog.map((w) => ({ word: w.word, forms: inflections(w.word) }));
  for (let i = 0; i < formSets.length; i++) {
    for (let j = i + 1; j < formSets.length; j++) {
      const a = formSets[i];
      const b = formSets[j];
      for (const form of a.forms) {
        assert.ok(
          !b.forms.has(form),
          `"${a.word}" and "${b.word}" both match token "${form}" — usage would double-count`,
        );
      }
    }
  }
});
