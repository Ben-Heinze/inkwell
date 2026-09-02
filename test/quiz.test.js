import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLearnQuestions, buildPracticeQuestion, sanitizeQuestions, shuffle } from '../server/domain/quiz.js';

const target = { word: 'ephemeral', pos: 'adjective', definition: 'lasting a very short time', example: 'The frost made ephemeral patterns on the glass.' };
const pool = [
  { word: 'serene', pos: 'adjective', definition: 'calm and peaceful', example: 'The lake was serene at dawn.' },
  { word: 'arduous', pos: 'adjective', definition: 'very difficult', example: 'An arduous climb over wet stone.' },
  { word: 'candid', pos: 'adjective', definition: 'truthful and direct', example: 'Her candid answer surprised us.' },
  { word: 'zenith', pos: 'noun', definition: 'the highest point', example: 'The sun reached its zenith.' },
  { word: 'meander', pos: 'verb', definition: 'to wander a winding course', example: 'The river meanders through the valley.' },
];

// deterministic rng
function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

test('learn flow builds 3 questions with valid answers', () => {
  const qs = buildLearnQuestions(target, pool, seeded());
  assert.equal(qs.length, 3);
  const [q1, q2, q3] = qs;
  assert.equal(q1.type, 'mcq-def');
  assert.equal(q1.choices[q1.answer], target.definition);
  assert.equal(q1.choices.length, 4);
  assert.equal(new Set(q1.choices).size, 4);
  assert.equal(q2.type, 'mcq-word');
  assert.equal(q2.choices[q2.answer], target.word);
  assert.equal(q3.type, 'blank');
  assert.equal(q3.choices.length, 3);
  assert.ok(q3.choices[q3.answer].includes('_____'));
  assert.ok(!q3.choices[q3.answer].toLowerCase().includes('ephemeral'));
});

test('sanitize strips answers and the giveaway word on mcq-word', () => {
  const qs = sanitizeQuestions(buildLearnQuestions(target, pool, seeded(7)));
  for (const q of qs) {
    assert.equal(q.answer, undefined);
    assert.ok(q.choices.length >= 3);
    if (q.type === 'mcq-word') assert.equal(q.word, undefined);
  }
});

test('practice question is one of the known types with a valid answer', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const q = buildPracticeQuestion(target, pool, seeded(seed));
    assert.ok(['mcq-def', 'mcq-word', 'blank'].includes(q.type));
    assert.ok(q.answer >= 0 && q.answer < q.choices.length);
  }
});

test('shuffle preserves elements', () => {
  const arr = [1, 2, 3, 4, 5];
  const s = shuffle(arr, seeded(3));
  assert.deepEqual([...s].sort(), arr);
  assert.deepEqual(arr, [1, 2, 3, 4, 5]); // no mutation
});
