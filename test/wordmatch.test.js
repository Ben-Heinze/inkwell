import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, countWords, inflections, findWordUsage, blankOut } from '../shared/wordmatch.js';

test('tokenize and countWords', () => {
  assert.deepEqual(tokenize("It's a fine day — isn't it?"), ["it's", 'a', 'fine', 'day', "isn't", 'it']);
  assert.equal(countWords('one two  three\nfour'), 4);
  assert.equal(countWords('   '), 0);
});

test('inflections cover common forms', () => {
  const f = inflections('carry');
  assert.ok(f.has('carries'));
  assert.ok(f.has('carried'));
  assert.ok(f.has('carrying'));
  const g = inflections('grouse');
  assert.ok(g.has('grousing'));
  assert.ok(g.has('groused'));
  const p = inflections('zigzag');
  assert.ok(p.has('zigzagged'));
  assert.ok(p.has('zigzagging'));
});

test('findWordUsage matches inflected forms, case-insensitive', () => {
  const words = [
    { id: 1, word: 'meander' },
    { id: 2, word: 'ephemeral' },
    { id: 3, word: 'quell' },
  ];
  const used = findWordUsage('The path Meandered along; an ephemeral mist rose.', words);
  assert.deepEqual(used.map((u) => u.id).sort(), [1, 2]);
});

test('no false substring matches', () => {
  const used = findWordUsage('The vex is not in convexity or vexillology here: cat.', [
    { id: 1, word: 'vex' },
    { id: 2, word: 'cat' },
  ]);
  // "vex" appears standalone once; "convexity"/"vexillology" must not count.
  assert.equal(used.find((u) => u.id === 1).count, 1);
  assert.equal(used.find((u) => u.id === 2).count, 1);
});

test('phrases match on word boundaries', () => {
  const used = findWordUsage('He was down to earth about it.', [{ id: 1, word: 'down to earth' }]);
  assert.equal(used.length, 1);
  const not = findWordUsage('showdown to earthworms', [{ id: 1, word: 'down to earth' }]);
  assert.equal(not.length, 0);
});

test('blankOut removes the inflected occurrence', () => {
  const r = blankOut('The river meanders through the valley.', 'meander');
  assert.ok(r.blanked);
  assert.equal(r.text, 'The river _____ through the valley.');
  const miss = blankOut('No such word here.', 'meander');
  assert.ok(!miss.blanked);
});
