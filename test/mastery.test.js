import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTERY_RULES,
  effectiveMastery,
  initialMastery,
  applyPractice,
  applyUse,
  isDue,
} from '../server/domain/mastery.js';

const DAY = 86400000;

test('no decay inside the grace period', () => {
  const now = Date.now();
  const iso = new Date(now - 2 * DAY).toISOString();
  assert.equal(effectiveMastery(80, iso, now), 80);
});

test('decay after grace, 0.5 per day', () => {
  const now = Date.now();
  const iso = new Date(now - 13 * DAY).toISOString();
  // 13 days - 3 grace = 10 days * 0.5 = 5
  assert.equal(effectiveMastery(80, iso, now), 75);
});

test('decay floors at 20 and never lifts values already below', () => {
  const now = Date.now();
  const longAgo = new Date(now - 1000 * DAY).toISOString();
  assert.equal(effectiveMastery(80, longAgo, now), MASTERY_RULES.decayFloor);
  assert.equal(effectiveMastery(10, longAgo, now), 10);
});

test('initial mastery never reaches 100 off the bat', () => {
  assert.equal(initialMastery(0), 50);
  assert.equal(initialMastery(3), 65);
  assert.equal(initialMastery(99), 65);
  assert.ok(initialMastery(3) < 100);
});

test('practice caps at 95; writing reaches 100', () => {
  assert.equal(applyPractice(90), 95);
  assert.equal(applyPractice(95), 95);
  assert.equal(applyPractice(97), 97); // already above cap via writing — never lowered
  assert.equal(applyUse(95), 100);
  assert.equal(applyUse(98), 100);
  assert.equal(applyUse(40), 46);
});

test('due threshold', () => {
  assert.ok(isDue(50));
  assert.ok(!isDue(80));
});
