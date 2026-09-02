// Wordbank mastery: quiz-seeded, decays with disuse, only real writing
// can push a word to 100.

export const MASTERY_RULES = {
  graceDays: 3, // no decay for this long after the last touch
  decayPerDay: 0.5,
  decayFloor: 20, // decay never drags a word below this
  learnBase: 50, // finishing the learn flow starts here...
  learnPerCorrect: 5, // ...plus this per correct quiz answer (max 65 — never 100 off the bat)
  practiceGain: 8,
  practiceCap: 95, // flashcards alone can't fully master a word
  useGain: 6, // using the word in an entry — the only road to 100
  max: 100,
  customStart: 40, // words the user adds themselves
  dueThreshold: 75, // below this a word shows up as "fading"
};

const round1 = (v) => Math.round(v * 10) / 10;

export function effectiveMastery(stored, updatedAtIso, now = Date.now()) {
  const updated = Date.parse(updatedAtIso);
  if (!Number.isFinite(updated)) return stored;
  const decayDays = (now - updated) / 86400000 - MASTERY_RULES.graceDays;
  if (decayDays <= 0 || stored <= MASTERY_RULES.decayFloor) return stored;
  return Math.max(MASTERY_RULES.decayFloor, round1(stored - decayDays * MASTERY_RULES.decayPerDay));
}

export function initialMastery(correctCount) {
  const c = Math.max(0, Math.min(3, correctCount));
  return MASTERY_RULES.learnBase + MASTERY_RULES.learnPerCorrect * c;
}

export function applyPractice(current) {
  if (current >= MASTERY_RULES.practiceCap) return round1(current);
  return round1(Math.min(MASTERY_RULES.practiceCap, current + MASTERY_RULES.practiceGain));
}

export function applyUse(current) {
  return round1(Math.min(MASTERY_RULES.max, current + MASTERY_RULES.useGain));
}

export function isDue(effective) {
  return effective < MASTERY_RULES.dueThreshold;
}
