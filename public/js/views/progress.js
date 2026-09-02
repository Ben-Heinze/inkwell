import { api } from '../api.js';
import { h, levelRing, fmtNumber, fmtDate } from '../ui.js';
import { setLevel } from '../main.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function sparkline(points, { width = 560, height = 96 } = {}) {
  const max = Math.max(...points.map((p) => p.xp), 10);
  const stepX = width / (points.length - 1 || 1);
  const y = (v) => height - 6 - (v / max) * (height - 16);
  const coords = points.map((p, i) => `${(i * stepX).toFixed(1)},${y(p.xp).toFixed(1)}`);
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'sparkline', preserveAspectRatio: 'none' });
  svg.append(
    svgEl('path', {
      d: `M0,${height} L${coords.join(' L')} L${width},${height} Z`,
      class: 'spark-area',
    }),
    svgEl('path', { d: `M${coords.join(' L')}`, class: 'spark-line', fill: 'none' }),
  );
  return svg;
}

function heatmap(wordsByDay, today) {
  const byDate = new Map(wordsByDay.map((d) => [d.date, d]));
  const cells = [];
  // 18 columns of weeks, ending on today's week; rows are Mon..Sun
  const todayD = new Date(`${today}T12:00:00`);
  const dow = (todayD.getDay() + 6) % 7; // Mon=0
  const end = new Date(todayD);
  end.setDate(end.getDate() + (6 - dow));
  const start = new Date(end);
  start.setDate(start.getDate() - (18 * 7 - 1));
  const grid = h('div', { class: 'heatmap' });
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const data = byDate.get(key);
    const words = data?.words || 0;
    const level = words === 0 ? 0 : words < 50 ? 1 : words < 150 ? 2 : words < 400 ? 3 : 4;
    const future = key > today;
    cells.push(
      h('div', {
        class: `heat-cell heat-${level}${future ? ' heat-future' : ''}`,
        title: future ? '' : `${fmtDate(key, { year: true })} — ${fmtNumber(words)} words${data ? ` · ${data.entries} ${data.entries === 1 ? 'entry' : 'entries'}` : ''}`,
      }),
    );
  }
  grid.append(...cells);
  return grid;
}

export async function renderProgress(view, { stale }) {
  const data = await api.get('/api/stats');
  if (stale()) return;
  setLevel(data.level);

  const lvl = data.level;
  const xpTotal30 = data.xpByDay.reduce((s, d) => s + d.xp, 0);

  view.append(
    h('header', { class: 'page-head' }, h('h1', {}, 'Progress')),

    h('div', { class: 'progress-grid' },
      h('div', { class: 'card level-hero' },
        levelRing(lvl.level, lvl.progress, 110),
        h('div', {},
          h('div', { class: 'level-hero-title' }, lvl.title),
          h('div', { class: 'muted' }, `Level ${lvl.level} · ${fmtNumber(lvl.totalXp)} XP`),
          h('div', { class: 'muted small' }, `${fmtNumber(lvl.nextLevelAt - lvl.totalXp)} XP to level ${lvl.level + 1}`),
        ),
      ),
      h('div', { class: 'card streak-hero' },
        h('div', { class: 'streak-hero-flame' }, '🔥'),
        h('div', {},
          h('div', { class: 'streak-hero-num' }, data.streak.current),
          h('div', { class: 'muted small' }, 'current streak'),
          h('div', { class: 'muted small' }, `best: ${data.streak.longest} ${data.streak.longest === 1 ? 'day' : 'days'}`),
        ),
      ),
      h('div', { class: 'card totals-card' },
        [
          ['Entries', data.totals.entries],
          ['Words written', data.totals.words],
          ['Longest entry', data.totals.maxEntryWords],
          ['Wordbank', data.totals.wordbankCount],
          ['Avg mastery', `${data.totals.avgMastery}%`],
          ['Challenges', data.totals.challengesCompleted],
        ].map(([label, value]) =>
          h('div', { class: 'total-stat' },
            h('div', { class: 'total-num' }, typeof value === 'number' ? fmtNumber(value) : value),
            h('div', { class: 'muted small' }, label),
          ),
        ),
      ),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'row spread center-v' },
        h('h2', { class: 'card-title' }, 'XP — last 30 days'),
        h('span', { class: 'muted small' }, `${fmtNumber(xpTotal30)} XP earned`),
      ),
      sparkline(data.xpByDay),
    ),

    h('div', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Writing days'),
      heatmap(data.wordsByDay, data.xpByDay.at(-1).date),
      h('div', { class: 'heat-legend muted small' },
        'less ',
        [0, 1, 2, 3, 4].map((l) => h('span', { class: `heat-cell heat-${l} inline` })),
        ' more',
      ),
    ),

    h('div', { class: 'card' },
      h('h2', { class: 'card-title' },
        `Achievements — ${data.achievements.filter((a) => a.unlockedAt).length}/${data.achievements.length}`),
      h('div', { class: 'ach-grid' },
        data.achievements.map((a) =>
          h('div', { class: `ach-tile${a.unlockedAt ? ' unlocked' : ''}`, title: a.desc },
            h('div', { class: 'ach-icon' }, a.unlockedAt ? a.icon : '🔒'),
            h('div', { class: 'ach-name' }, a.name),
            h('div', { class: 'muted tiny' }, a.unlockedAt ? fmtDate(a.unlockedAt, { year: true }) : a.desc),
          ),
        ),
      ),
    ),
  );
}
