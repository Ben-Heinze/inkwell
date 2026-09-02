// Achievement catalog. Social achievements are deliberately absent (feature
// deferred); each entry is a pure predicate over the user's stats snapshot.

export const ACHIEVEMENTS = [
  { id: 'first-entry', icon: '✒️', name: 'First Words', desc: 'Write your first entry', check: (s) => s.entryCount >= 1 },
  { id: 'entries-10', icon: '📓', name: 'Ten Pages In', desc: 'Write 10 entries', check: (s) => s.entryCount >= 10 },
  { id: 'entries-50', icon: '📚', name: 'Volume One', desc: 'Write 50 entries', check: (s) => s.entryCount >= 50 },
  { id: 'words-1k', icon: '🖋️', name: 'Thousand-Word March', desc: 'Write 1,000 words in total', check: (s) => s.totalWords >= 1000 },
  { id: 'words-10k', icon: '🏛️', name: 'Ten Thousand Strong', desc: 'Write 10,000 words in total', check: (s) => s.totalWords >= 10000 },
  { id: 'entry-500', icon: '📜', name: 'Long-Form', desc: 'Write 500+ words in a single entry', check: (s) => s.maxEntryWords >= 500 },
  { id: 'streak-3', icon: '🔥', name: 'Kindling', desc: 'Reach a 3-day prompt streak', check: (s) => s.longestStreak >= 3 },
  { id: 'streak-7', icon: '🕯️', name: 'Week of Fire', desc: 'Reach a 7-day prompt streak', check: (s) => s.longestStreak >= 7 },
  { id: 'streak-30', icon: '🌋', name: 'Unbroken Month', desc: 'Reach a 30-day prompt streak', check: (s) => s.longestStreak >= 30 },
  { id: 'learn-10', icon: '🧠', name: 'Lexicon Rising', desc: 'Grow your wordbank to 10 words', check: (s) => s.wordbankCount >= 10 },
  { id: 'learn-25', icon: '🗝️', name: 'Collector of Words', desc: 'Grow your wordbank to 25 words', check: (s) => s.wordbankCount >= 25 },
  { id: 'learn-50', icon: '👑', name: 'Half-Century Lexicon', desc: 'Grow your wordbank to 50 words', check: (s) => s.wordbankCount >= 50 },
  { id: 'mastery-100', icon: '💎', name: 'Mastered', desc: 'Bring a word to 100% mastery', check: (s) => s.maxMastery >= 100 },
  { id: 'scholar', icon: '🎓', name: 'Scholar', desc: 'Hold 10 words at 90%+ mastery', check: (s) => s.wordsAbove90 >= 10 },
  { id: 'show-off', icon: '✨', name: 'Show-Off', desc: 'Use 5 wordbank words in one entry', check: (s) => s.maxWordbankUsedInEntry >= 5 },
  { id: 'challenge-1', icon: '🎯', name: 'Challenger', desc: 'Complete your first challenge', check: (s) => s.challengesCompleted >= 1 },
  { id: 'challenge-10', icon: '🏆', name: 'Gauntlet', desc: 'Complete 10 challenges', check: (s) => s.challengesCompleted >= 10 },
  { id: 'level-5', icon: '⭐', name: 'Rising Star', desc: 'Reach level 5', check: (s) => s.level >= 5 },
  { id: 'level-10', icon: '🌟', name: 'Wordsmith Proper', desc: 'Reach level 10', check: (s) => s.level >= 10 },
];

export function evaluateAchievements(stats, unlockedIds) {
  const have = new Set(unlockedIds);
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.check(stats));
}
