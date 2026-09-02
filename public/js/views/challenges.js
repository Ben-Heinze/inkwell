import { api } from '../api.js';
import { h, toast, fmtNumber } from '../ui.js';
import { navigate } from '../main.js';

function challengeCard(c) {
  return h('div', { class: `card challenge-card${c.completions > 0 ? ' completed' : ''}` },
    h('div', { class: 'challenge-icon' }, c.image || '🎯'),
    h('div', { class: 'challenge-body' },
      h('div', { class: 'row spread center-v' },
        h('h3', { class: 'challenge-title' }, c.title),
        c.completions > 0 && h('span', { class: 'done-mark', title: `Completed ${c.completions}×` }, `✓${c.completions > 1 ? ` ×${c.completions}` : ''}`),
      ),
      h('p', { class: 'muted challenge-desc' }, c.description),
      h('div', { class: 'row gap wrap center-v' },
        c.minWords && h('span', { class: 'chip' }, `≥ ${fmtNumber(c.minWords)} words`),
        c.requiredWords.length > 0 && h('span', { class: 'chip' }, `use: ${c.requiredWords.join(', ')}`),
        h('a', { class: 'btn btn-small ' + (c.completions > 0 ? 'btn-ghost' : 'btn-primary'), href: `#/write?challenge=${c.id}` },
          c.completions > 0 ? 'Write again' : 'Start'),
      ),
    ),
  );
}

export async function renderChallenges(view, { stale }) {
  const data = await api.get('/api/challenges');
  if (stale()) return;

  const surpriseBtn = h('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      surpriseBtn.disabled = true;
      try {
        const { challenge } = await api.post('/api/challenges/surprise');
        navigate(`#/write?challenge=${challenge.id}`);
      } catch (err) {
        toast(err.message, { type: 'warn' });
      } finally {
        surpriseBtn.disabled = false;
      }
    },
  }, '🎲 Surprise me');

  view.append(
    h('header', { class: 'page-head' },
      h('h1', {}, 'Challenges'),
      h('p', { class: 'muted' }, 'Constraints breed invention: word minimums, required words, image prompts. Completing one pays +40 XP.'),
    ),
    h('div', { class: 'card surprise-card' },
      h('div', {},
        h('h3', {}, 'Surprise challenge'),
        h('p', { class: 'muted small' }, 'A personal challenge built from your three most-faded wordbank words — use them or lose them.'),
      ),
      surpriseBtn,
    ),
    data.surprises.length > 0 &&
      h('section', {},
        h('h2', { class: 'section-title' }, 'Your open surprises'),
        h('div', { class: 'challenge-grid' }, data.surprises.map(challengeCard)),
      ),
    h('section', {},
      data.surprises.length > 0 && h('h2', { class: 'section-title' }, 'The gauntlet'),
      h('div', { class: 'challenge-grid' }, data.challenges.map(challengeCard)),
    ),
  );
}
