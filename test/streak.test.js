import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreaks, addDays, localDateStr } from '../server/domain/streak.js';

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
});

test('empty history', () => {
  const s = computeStreaks([], '2026-09-02');
  assert.deepEqual(s, { current: 0, longest: 0, doneToday: false });
});

test('streak including today', () => {
  const s = computeStreaks(['2026-08-31', '2026-09-01', '2026-09-02'], '2026-09-02');
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
  assert.ok(s.doneToday);
});

test('streak alive when today not yet done', () => {
  const s = computeStreaks(['2026-08-31', '2026-09-01'], '2026-09-02');
  assert.equal(s.current, 2);
  assert.ok(!s.doneToday);
});

test('broken streak resets current but keeps longest', () => {
  const s = computeStreaks(['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23', '2026-09-01'], '2026-09-02');
  assert.equal(s.current, 1);
  assert.equal(s.longest, 4);
});

test('localDateStr shape', () => {
  assert.match(localDateStr(new Date(2026, 0, 5)), /^2026-01-05$/);
});
