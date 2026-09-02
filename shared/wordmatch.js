// Word tokenizing, counting, and wordbank-usage detection.
// Shared verbatim between the server (XP/mastery awards) and the browser
// (live editor highlighting), so both sides always agree on what counts.

const TOKEN_RE = /[\p{L}\p{N}'’]+/gu;

export function tokenize(text) {
  const matches = String(text).toLowerCase().match(TOKEN_RE) || [];
  const out = [];
  for (const m of matches) {
    const t = m.replace(/^['’]+|['’]+$/g, '');
    if (t) out.push(t);
  }
  return out;
}

export function countWords(text) {
  return tokenize(text).length;
}

// Plausible inflected forms of a single word (lowercase). Over-generation is
// fine — bogus forms like "vivids" simply never occur in real text — but the
// forms must never collide with common unrelated words.
export function inflections(word) {
  const w = String(word).toLowerCase().trim();
  const forms = new Set([w]);
  if (!w || w.includes(' ')) return forms;
  forms.add(w + 's');
  forms.add(w + 'es');
  forms.add(w + 'ed');
  forms.add(w + 'd');
  forms.add(w + 'ing');
  if (w.endsWith('e')) {
    forms.add(w.slice(0, -1) + 'ing');
  }
  if (w.endsWith('y') && w.length > 2) {
    const stem = w.slice(0, -1);
    forms.add(stem + 'ies');
    forms.add(stem + 'ied');
  }
  // final-consonant doubling: pat -> patted / patting
  if (/[aeiou][bdgklmnprtvz]$/.test(w) && !/[aeiou][aeiou][bdgklmnprtvz]$/.test(w)) {
    const dbl = w + w[w.length - 1];
    forms.add(dbl + 'ed');
    forms.add(dbl + 'ing');
  }
  return forms;
}

// words: [{ word, ...rest }] -> [{ word, ...rest, count }] for every word
// found in the text (any inflected form, case-insensitive, word-boundary).
export function findWordUsage(text, words) {
  const counts = new Map();
  for (const t of tokenize(text)) counts.set(t, (counts.get(t) || 0) + 1);
  const lowerText = String(text).toLowerCase();
  const used = [];
  for (const w of words) {
    const target = String(w.word).toLowerCase().trim();
    if (!target) continue;
    let count = 0;
    if (target.includes(' ')) {
      // phrase: check each occurrence has non-letter boundaries
      let idx = lowerText.indexOf(target);
      while (idx !== -1) {
        const before = lowerText[idx - 1];
        const after = lowerText[idx + target.length];
        if ((!before || !/[\p{L}\p{N}]/u.test(before)) && (!after || !/[\p{L}\p{N}]/u.test(after))) count++;
        idx = lowerText.indexOf(target, idx + target.length);
      }
    } else {
      for (const form of inflections(target)) count += counts.get(form) || 0;
    }
    if (count > 0) used.push({ ...w, count });
  }
  return used;
}

// Replace the (inflected) occurrence of `word` in `text` with a blank.
// Returns { text, blanked } — used to build fill-in-the-blank quizzes.
export function blankOut(text, word) {
  const forms = inflections(word);
  const re = new RegExp(TOKEN_RE.source, 'gu');
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = m[0].replace(/^['’]+|['’]+$/g, '').toLowerCase();
    if (forms.has(token)) {
      return {
        text: text.slice(0, m.index) + '_____' + text.slice(m.index + m[0].length),
        blanked: true,
      };
    }
  }
  return { text, blanked: false };
}
