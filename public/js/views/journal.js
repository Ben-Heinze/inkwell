import { api } from '../api.js';
import { h, clear, kindBadge, fmtDate, fmtNumber, confirmModal, toast, debounce } from '../ui.js';
import { navigate } from '../main.js';

export async function renderJournal(view, { stale }) {
  const list = h('div', { class: 'entry-list' });
  const countLabel = h('span', { class: 'muted small' });
  let kind = '';
  let q = '';

  async function load() {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (q) params.set('q', q);
    const data = await api.get(`/api/entries?${params}`);
    if (stale()) return;
    clear(list);
    countLabel.textContent = `${data.entries.length} ${data.entries.length === 1 ? 'entry' : 'entries'}`;
    if (data.entries.length === 0) {
      list.append(
        h('div', { class: 'card empty-state' },
          h('p', { class: 'muted' }, q || kind ? 'Nothing matches.' : 'No entries yet.'),
          !q && !kind && h('a', { class: 'btn btn-primary btn-small', href: '#/write' }, '✍️ Write your first'),
        ),
      );
      return;
    }
    for (const e of data.entries) {
      list.append(
        h('a', { class: 'card entry-card', href: `#/entry/${e.id}` },
          h('div', { class: 'row spread center-v' },
            h('div', { class: 'row gap center-v' },
              kindBadge(e.kind),
              h('strong', { class: 'entry-card-title' }, e.title || 'Untitled'),
            ),
            h('span', { class: 'muted small' }, `${fmtDate(e.entryDate, { year: true })} · ${fmtNumber(e.wordCount)} words`),
          ),
          h('p', { class: 'entry-snippet' }, e.snippet + (e.snippet.length >= 220 ? '…' : '')),
        ),
      );
    }
  }

  const kindSelect = h('select', {
    class: 'input select',
    onchange: (e) => { kind = e.target.value; load(); },
  },
    h('option', { value: '' }, 'All entries'),
    h('option', { value: 'journal' }, '📓 Journal'),
    h('option', { value: 'daily' }, '☀️ Daily prompts'),
    h('option', { value: 'challenge' }, '🎯 Challenges'),
  );
  const search = h('input', {
    class: 'input',
    placeholder: 'Search entries…',
    oninput: debounce((e) => { q = e.target.value.trim(); load(); }, 300),
  });

  view.append(
    h('header', { class: 'page-head row spread center-v' },
      h('h1', {}, 'Journal'),
      h('a', { class: 'btn btn-primary', href: '#/write' }, '✍️ New entry'),
    ),
    h('div', { class: 'toolbar row gap center-v' }, kindSelect, search, countLabel),
    list,
  );
  await load();
}

export async function renderEntry(view, { arg, stale }) {
  const { entry } = await api.get(`/api/entries/${arg}`);
  if (stale()) return;

  const paragraphs = entry.body.split(/\n+/).filter((p) => p.trim().length > 0);

  view.append(
    h('div', { class: 'reader' },
      h('div', { class: 'row spread center-v reader-top' },
        h('a', { class: 'muted', href: '#/journal' }, '← Journal'),
        h('div', { class: 'row gap' },
          h('a', { class: 'btn btn-ghost btn-small', href: `#/write?edit=${entry.id}` }, 'Edit'),
          h('button', {
            class: 'btn btn-ghost btn-small danger',
            onclick: async () => {
              if (!(await confirmModal('Delete this entry? This cannot be undone.'))) return;
              await api.del(`/api/entries/${entry.id}`);
              toast('Entry deleted');
              navigate('#/journal');
            },
          }, 'Delete'),
        ),
      ),
      h('article', { class: 'card reader-card' },
        h('div', { class: 'row gap center-v wrap' },
          kindBadge(entry.kind),
          h('span', { class: 'muted small' },
            `${fmtDate(entry.entryDate, { year: true })} · ${fmtNumber(entry.wordCount)} words · +${entry.xpAwarded} XP`),
        ),
        (entry.promptText || entry.challengeTitle) &&
          h('p', { class: 'reader-context muted' },
            entry.promptText ? `Prompt: ${entry.promptText}` : `Challenge: ${entry.challengeTitle}`),
        h('h1', { class: 'reader-title' }, entry.title || 'Untitled'),
        h('div', { class: 'reader-body' }, paragraphs.map((p) => h('p', {}, p))),
      ),
    ),
  );
}
