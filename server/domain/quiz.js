// Builds quiz questions for the learn flow and practice mode.
// Questions carry their answer index; sanitize before sending to the client.

import { blankOut } from '../../shared/wordmatch.js';

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickN(arr, n, rand = Math.random) {
  return shuffle(arr, rand).slice(0, n);
}

function defDistractors(target, pool, n, rand) {
  const usable = pool.filter((p) => p.definition && p.definition !== target.definition && p.word !== target.word);
  const samePos = usable.filter((p) => p.pos === target.pos);
  const picked = pickN(samePos.length >= n ? samePos : usable, n, rand);
  return picked;
}

function mcqDef(target, pool, rand) {
  const ds = defDistractors(target, pool, 3, rand);
  const choices = shuffle([target.definition, ...ds.map((d) => d.definition)], rand);
  return {
    type: 'mcq-def',
    word: target.word,
    prompt: `Which definition matches “${target.word}”?`,
    choices,
    answer: choices.indexOf(target.definition),
  };
}

function mcqWord(target, pool, rand) {
  const ds = defDistractors(target, pool, 3, rand);
  const choices = shuffle([target.word, ...ds.map((d) => d.word)], rand);
  return {
    type: 'mcq-word',
    word: target.word,
    prompt: `Which word means: “${target.definition}”?`,
    choices,
    answer: choices.indexOf(target.word),
  };
}

// A mini paragraph of three sentences with their vocab words blanked out;
// the user picks the blank where the target word belongs.
function blankPlacement(target, pool, rand) {
  const others = pickN(
    pool.filter((p) => p.example && p.word !== target.word && blankOut(p.example, p.word).blanked),
    2,
    rand,
  );
  if (others.length < 2) return null;
  const entries = shuffle([target, ...others], rand);
  const choices = entries.map((e) => blankOut(e.example, e.word).text);
  return {
    type: 'blank',
    word: target.word,
    prompt: `Where does “${target.word}” fit best?`,
    choices,
    answer: entries.indexOf(target),
  };
}

// The learn flow's quiz: two multiple-choice questions, then blank placement.
export function buildLearnQuestions(target, pool, rand = Math.random) {
  const qs = [mcqDef(target, pool, rand), mcqWord(target, pool, rand)];
  const blank = blankPlacement(target, pool, rand);
  if (blank) qs.push(blank);
  return qs;
}

// One question about an already-known word, random type.
export function buildPracticeQuestion(target, pool, rand = Math.random) {
  const builders = [mcqDef, mcqWord];
  if (target.example && blankOut(target.example, target.word).blanked) builders.push(blankPlacement);
  const builder = builders[Math.floor(rand() * builders.length)];
  return builder(target, pool, rand) || mcqDef(target, pool, rand);
}

export function sanitizeQuestions(questions) {
  return questions.map(({ answer, ...rest }) => {
    // for mcq-word the target word IS the answer — never send it down
    if (rest.type === 'mcq-word') delete rest.word;
    return rest;
  });
}
