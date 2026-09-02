// XP awards and the level curve. All balance numbers live here.

export const XP_RULES = {
  entryBase: 10, // any real entry
  wordsPerPoint: 25, // +1 XP per 25 words written...
  entryWordCap: 40, // ...capped (so writing XP tops out at 50/entry)
  minWordsForXp: 10, // entries shorter than this save fine but earn nothing
  dailyBonus: 25,
  challengeBonus: 40, // first completion of each challenge only
  wordUseBonus: 5, // per distinct wordbank word used in an entry
  wordUseMax: 5,
  learnWord: 15,
  practiceCorrect: 2,
};

export function entryXpBreakdown({ wordCount, kind, wordbankUsedCount = 0, firstChallengeCompletion = true }) {
  const items = [];
  if (wordCount >= XP_RULES.minWordsForXp) {
    const wordPts = Math.min(Math.floor(wordCount / XP_RULES.wordsPerPoint), XP_RULES.entryWordCap);
    items.push({ reason: 'entry', label: 'Writing', amount: XP_RULES.entryBase + wordPts });
  }
  if (kind === 'daily') {
    items.push({ reason: 'daily', label: 'Daily prompt', amount: XP_RULES.dailyBonus });
  }
  if (kind === 'challenge' && firstChallengeCompletion) {
    items.push({ reason: 'challenge', label: 'Challenge completed', amount: XP_RULES.challengeBonus });
  }
  const used = Math.min(wordbankUsedCount, XP_RULES.wordUseMax);
  if (used > 0) {
    items.push({ reason: 'words', label: `Wordbank words × ${used}`, amount: used * XP_RULES.wordUseBonus });
  }
  return { items, total: items.reduce((s, i) => s + i.amount, 0) };
}

// Cumulative XP required to reach a level. Level 1 starts at 0.
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.5));
}

export const LEVEL_TITLES = [
  [1, 'Inkling'],
  [2, 'Scribbler'],
  [4, 'Diarist'],
  [6, 'Storyteller'],
  [8, 'Essayist'],
  [10, 'Wordsmith'],
  [13, 'Stylist'],
  [16, 'Rhetorician'],
  [20, 'Novelist'],
  [25, 'Laureate'],
  [30, 'Luminary'],
];

export function levelInfo(totalXp) {
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) level++;
  const levelStart = xpForLevel(level);
  const nextLevelAt = xpForLevel(level + 1);
  let title = LEVEL_TITLES[0][1];
  for (const [lvl, name] of LEVEL_TITLES) {
    if (lvl <= level) title = name;
  }
  return {
    level,
    title,
    totalXp,
    levelStart,
    nextLevelAt,
    progress: (totalXp - levelStart) / (nextLevelAt - levelStart),
  };
}
