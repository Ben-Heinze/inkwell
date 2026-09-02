// Seed-content integrity: the quiz builders and challenge validation depend
// on these invariants, so bad seed data fails loudly here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankOut, findWordUsage, inflections } from '../shared/wordmatch.js';

const SEED = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'seed');
const words = JSON.parse(readFileSync(join(SEED, 'words.json'), 'utf8'));
const prompts = JSON.parse(readFileSync(join(SEED, 'prompts.json'), 'utf8'));
const challenges = JSON.parse(readFileSync(join(SEED, 'challenges.json'), 'utf8'));

test('catalog is large and unique', () => {
  assert.ok(words.length >= 140, `only ${words.length} words`);
  assert.equal(new Set(words.map((w) => w.word)).size, words.length, 'duplicate words');
  assert.equal(new Set(words.map((w) => w.definition)).size, words.length, 'duplicate definitions');
});

test('every word has pos, definition, and a blankable example', () => {
  const posSet = new Set(['noun', 'verb', 'adjective', 'adverb']);
  for (const w of words) {
    assert.ok(posSet.has(w.pos), `${w.word}: bad pos ${w.pos}`);
    assert.ok(w.definition.length >= 8, `${w.word}: thin definition`);
    const r = blankOut(w.example, w.word);
    assert.ok(r.blanked, `${w.word}: example does not contain the word ("${w.example}")`);
  }
});

test('each part of speech has enough words for distractors', () => {
  const byPos = {};
  for (const w of words) byPos[w.pos] = (byPos[w.pos] || 0) + 1;
  for (const [pos, n] of Object.entries(byPos)) {
    assert.ok(n >= 4, `${pos} has only ${n} words — MCQs need 4 same-pos options`);
  }
});

test('prompts are plentiful with unique keys', () => {
  assert.ok(prompts.length >= 50);
  assert.equal(new Set(prompts.map((p) => p.key)).size, prompts.length);
  for (const p of prompts) assert.ok(p.text.length >= 10);
});

test('challenge required words are actually detectable', () => {
  assert.ok(challenges.length >= 10);
  assert.equal(new Set(challenges.map((c) => c.key)).size, challenges.length);
  for (const c of challenges) {
    assert.ok(c.minWords || (c.requiredWords || []).length, `${c.key}: no constraint at all`);
    for (const req of c.requiredWords || []) {
      const sample = `I ${req} it.`;
      const found = findWordUsage(sample, [{ word: req }]);
      assert.equal(found.length, 1, `${c.key}: required word "${req}" not detectable`);
      assert.ok(inflections(req).size >= 1);
    }
  }
});
