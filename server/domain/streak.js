// Daily-prompt streaks, computed from a set of local calendar dates.

export function localDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// dates: iterable of 'YYYY-MM-DD'. A streak is alive if it includes today or
// ended yesterday (today's prompt isn't done *yet*).
export function computeStreaks(dates, today) {
  const set = new Set(dates);
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  let longest = 0;
  for (const d of set) {
    if (set.has(addDays(d, -1))) continue; // not the start of a run
    let len = 1;
    let c = d;
    while (set.has(addDays(c, 1))) {
      len++;
      c = addDays(c, 1);
    }
    if (len > longest) longest = len;
  }
  return { current, longest, doneToday: set.has(today) };
}
