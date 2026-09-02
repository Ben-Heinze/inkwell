import { api } from '../api.js';
import { h, levelRing, masteryBar, fmtDate, fmtNumber, kindBadge } from '../ui.js';
import { setLevel } from '../main.js';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export async function renderDashboard(view, { stale }) {
  const data = await api.get('/api/dashboard');
  if (stale()) return;
  setLevel(data.level);

  const streakFlame = h('div', { class: `streak-flame${data.streak.current > 0 ? ' lit' : ''}` },
    h('span', { class: 'flame-icon' }, '🔥'),
    h('span', { class: 'flame-count' }, data.streak.current),
    h('span', { class: 'flame-label' }, 'day streak'),
  );

  const daily = data.daily;
  const dailyCard = h('div', { class: 'card daily-card' },
    h('div', { class: 'row spread' },
      h('h2', { class: 'card-title' }, "Today's prompt"),
      streakFlame,
    ),
    daily
      ? h('div', {},
          daily.prompt.image && h('div', { class: 'prompt-image' }, daily.prompt.image),
          h('p', { class: 'prompt-text' }, daily.prompt.text),
          daily.completed
            ? h('div', { class: 'row gap center-v' },
                h('span', { class: 'done-mark' }, '✓ Written today'),
                h('a', { class: 'btn btn-ghost btn-small', href: `#/entry/${daily.entryId}` }, 'Read it'),
              )
            : h('a', { class: 'btn btn-primary', href: '#/write?daily=1' }, 'Write it →'),
          !daily.completed && data.streak.current > 0
            ? h('p', { class: 'muted small' }, `Write today to keep your ${data.streak.current}-day streak alive.`)
            : null,
        )
      : h('p', { class: 'muted' }, 'No prompts available.'),
  );

  const lvl = data.level;
  const levelCard = h('div', { class: 'card level-card' },
    levelRing(lvl.level, lvl.progress),
    h('div', {},
      h('div', { class: 'level-title' }, lvl.title),
      h('div', { class: 'muted small' }, `${fmtNumber(lvl.totalXp)} XP total`),
      h('div', { class: 'muted small' }, `${fmtNumber(lvl.nextLevelAt - lvl.totalXp)} XP to level ${lvl.level + 1}`),
    ),
  );

  const dueCard = h('div', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Wordbank'),
    data.wordbank.total === 0
      ? h('div', {},
          h('p', { class: 'muted' }, 'Your personal dictionary is empty. Learn your first word — it takes a minute.'),
          h('a', { class: 'btn btn-primary btn-small', href: '#/wordbank?learn=1' }, '📖 Learn a word'),
        )
      : h('div', {},
          data.dueWords.length > 0
            ? h('div', {},
                h('p', { class: 'muted small' }, `${data.wordbank.due} of your ${data.wordbank.total} words are fading:`),
                h('div', { class: 'due-list' },
                  data.dueWords.map((w) =>
                    h('div', { class: 'due-word' },
                      h('span', { class: 'due-word-name' }, w.word),
                      masteryBar(w.mastery, { showLabel: false }),
                    ),
                  ),
                ),
                h('a', { class: 'btn btn-primary btn-small', href: '#/wordbank?practice=1' }, '⚡ Practice now'),
              )
            : h('div', {},
                h('p', { class: 'muted' }, `All ${data.wordbank.total} words are sharp. Learn another?`),
                h('a', { class: 'btn btn-ghost btn-small', href: '#/wordbank?learn=1' }, '📖 Learn a new word'),
              ),
        ),
  );

  const recentCard = h('div', { class: 'card' },
    h('div', { class: 'row spread' },
      h('h2', { class: 'card-title' }, 'Recent entries'),
      h('a', { class: 'muted small', href: '#/journal' }, 'All →'),
    ),
    data.recentEntries.length === 0
      ? h('p', { class: 'muted' }, 'Nothing yet. The first page is the hardest — and it can be three sentences.')
      : h('div', { class: 'entry-list compact' },
          data.recentEntries.map((e) =>
            h('a', { class: 'entry-row', href: `#/entry/${e.id}` },
              kindBadge(e.kind),
              h('span', { class: 'entry-row-title' }, e.title || 'Untitled'),
              h('span', { class: 'muted small' }, `${fmtDate(e.entryDate)} · ${fmtNumber(e.wordCount)} words`),
            ),
          ),
        ),
  );

  const achCard = data.recentAchievements.length > 0
    ? h('div', { class: 'card' },
        h('div', { class: 'row spread' },
          h('h2', { class: 'card-title' }, 'Latest badges'),
          h('a', { class: 'muted small', href: '#/progress' }, 'All →'),
        ),
        h('div', { class: 'badge-strip' },
          data.recentAchievements.map((a) =>
            h('div', { class: 'mini-badge', title: a.desc },
              h('span', { class: 'mini-badge-icon' }, a.icon),
              h('span', {}, a.name),
            ),
          ),
        ),
      )
    : null;

  view.append(
    h('header', { class: 'page-head' },
      h('h1', {}, `${greeting()}, ${data.user.username}`),
      h('p', { class: 'muted' },
        `${fmtDate(data.today, { year: true })} · ${fmtNumber(data.totals.entries)} entries · ${fmtNumber(data.totals.words)} words written`),
    ),
    h('div', { class: 'dash-grid' },
      dailyCard,
      levelCard,
      dueCard,
      recentCard,
      achCard,
    ),
  );
}
