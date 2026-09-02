import { api } from '../api.js';
import { h, clear, toast, modal, progressBar, achievementToasts, fmtNumber } from '../ui.js';
import { setLevel, navigate } from '../main.js';
import { countWords, findWordUsage } from '/shared/wordmatch.js';

function draftKey(ctx) {
  if (ctx.mode === 'daily') return `inkwell-draft:daily:${ctx.date}`;
  if (ctx.mode === 'challenge') return `inkwell-draft:challenge:${ctx.challenge.id}`;
  if (ctx.mode === 'journal') return 'inkwell-draft:journal';
  return null;
}

function loadDraft(key) {
  if (!key) return null;
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function saveDraft(key, title, body) {
  if (!key) return;
  try {
    if (!title && !body) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ title, body }));
  } catch { /* storage unavailable */ }
}

function clearDraft(key) {
  if (!key) return;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

async function resolveContext(query) {
  if (query.get('edit')) {
    const { entry } = await api.get(`/api/entries/${query.get('edit')}`);
    return { mode: 'edit', entry };
  }
  if (query.get('daily')) {
    const dash = await api.get('/api/dashboard');
    if (!dash.daily) return { mode: 'journal' };
    if (dash.daily.completed) return { mode: 'daily-done', entryId: dash.daily.entryId };
    return { mode: 'daily', prompt: dash.daily.prompt, date: dash.today, streak: dash.streak };
  }
  if (query.get('challenge')) {
    const { challenge } = await api.get(`/api/challenges/${query.get('challenge')}`);
    return { mode: 'challenge', challenge };
  }
  return { mode: 'journal' };
}

export async function renderEditor(view, { query, stale }) {
  const [ctx, wordsData] = await Promise.all([resolveContext(query), api.get('/api/words')]);
  if (stale()) return;
  const bank = wordsData.words;

  if (ctx.mode === 'daily-done') {
    view.append(
      h('div', { class: 'card' },
        h('h2', {}, "Today's prompt is done ✓"),
        h('p', { class: 'muted' }, 'One daily entry per day — come back tomorrow to keep the streak going.'),
        h('div', { class: 'row gap' },
          h('a', { class: 'btn btn-primary', href: `#/entry/${ctx.entryId}` }, 'Read today’s entry'),
          h('a', { class: 'btn btn-ghost', href: '#/write' }, 'Free-write instead'),
        ),
      ),
    );
    return;
  }

  const isEdit = ctx.mode === 'edit';
  const challenge = ctx.mode === 'challenge' ? ctx.challenge : null;
  const key = draftKey(ctx);
  const draft = isEdit ? null : loadDraft(key);

  // ---- context panel ----
  let contextPanel = null;
  if (ctx.mode === 'daily') {
    contextPanel = h('div', { class: 'context-panel daily' },
      h('div', { class: 'context-kind' }, '☀️ Daily prompt'),
      ctx.prompt.image && h('div', { class: 'prompt-image' }, ctx.prompt.image),
      h('p', { class: 'prompt-text' }, ctx.prompt.text),
    );
  } else if (challenge) {
    contextPanel = h('div', { class: 'context-panel challenge' },
      h('div', { class: 'context-kind' }, `🎯 Challenge — ${challenge.title}`),
      challenge.image && h('div', { class: 'prompt-image' }, challenge.image),
      h('p', { class: 'prompt-text' }, challenge.description),
    );
  } else if (isEdit && ctx.entry.promptText) {
    contextPanel = h('div', { class: 'context-panel daily' },
      h('div', { class: 'context-kind' }, '☀️ Daily prompt'),
      h('p', { class: 'prompt-text' }, ctx.entry.promptText),
    );
  } else if (isEdit && ctx.entry.challengeTitle) {
    contextPanel = h('div', { class: 'context-panel challenge' },
      h('div', { class: 'context-kind' }, `🎯 Challenge — ${ctx.entry.challengeTitle}`),
    );
  }

  // ---- inputs ----
  const title = h('input', {
    class: 'entry-title-input',
    placeholder: 'Title (optional)',
    maxlength: 200,
    value: isEdit ? ctx.entry.title : draft?.title || '',
  });
  const body = h('textarea', {
    class: 'entry-body-input',
    placeholder: ctx.mode === 'journal' ? 'Write freely. No quotas, no judges.' : 'Start writing…',
    spellcheck: 'true',
  });
  body.value = isEdit ? ctx.entry.body : draft?.body || '';

  // ---- live status bar ----
  const wcLabel = h('span', { class: 'wc' }, '0 words');
  const bankChips = h('div', { class: 'bank-chips' });
  const constraintBox = challenge ? h('div', { class: 'constraints' }) : null;

  function autosize() {
    body.style.height = 'auto';
    body.style.height = `${Math.max(body.scrollHeight, 260)}px`;
  }

  function refreshStatus() {
    const text = body.value;
    const wc = countWords(text);
    wcLabel.textContent = `${fmtNumber(wc)} word${wc === 1 ? '' : 's'}`;

    clear(bankChips);
    const used = findWordUsage(text, bank);
    for (const u of used.slice(0, 8)) {
      bankChips.append(h('span', { class: 'chip chip-bank', title: 'Wordbank word — earns mastery and XP' }, `✨ ${u.word}`));
    }
    if (used.length > 8) bankChips.append(h('span', { class: 'chip' }, `+${used.length - 8} more`));

    if (challenge && constraintBox) {
      clear(constraintBox);
      if (challenge.minWords) {
        const ratio = Math.min(1, wc / challenge.minWords);
        constraintBox.append(
          h('div', { class: `constraint${wc >= challenge.minWords ? ' met' : ''}` },
            h('span', { class: 'constraint-tick' }, wc >= challenge.minWords ? '✓' : '○'),
            h('span', {}, `${fmtNumber(wc)} / ${fmtNumber(challenge.minWords)} words`),
            progressBar(ratio),
          ),
        );
      }
      if (challenge.requiredWords.length > 0) {
        const found = new Set(findWordUsage(text, challenge.requiredWords.map((w) => ({ word: w }))).map((u) => u.word));
        constraintBox.append(
          h('div', { class: 'constraint required-words' },
            h('span', { class: 'muted small' }, 'Required:'),
            challenge.requiredWords.map((w) =>
              h('span', { class: `chip chip-req${found.has(w) ? ' met' : ''}` }, `${found.has(w) ? '✓' : '○'} ${w}`),
            ),
          ),
        );
      }
    }
  }

  const persistDraft = () => !isEdit && saveDraft(key, title.value, body.value);
  let draftTimer = null;
  const onInput = () => {
    autosize();
    refreshStatus();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistDraft, 600);
  };
  body.addEventListener('input', onInput);
  title.addEventListener('input', onInput);

  // ---- save ----
  const saveBtn = h('button', { class: 'btn btn-primary', onclick: save }, isEdit ? 'Save changes' : 'Save entry');

  async function save() {
    const text = body.value;
    if (countWords(text) === 0) {
      toast('Write something first — even one honest sentence.', { type: 'warn' });
      return;
    }
    saveBtn.disabled = true;
    try {
      if (isEdit) {
        await api.put(`/api/entries/${ctx.entry.id}`, { title: title.value, body: text });
        toast('Saved ✓');
        navigate(`#/entry/${ctx.entry.id}`);
        return;
      }
      const payload = {
        kind: ctx.mode === 'daily' ? 'daily' : challenge ? 'challenge' : 'journal',
        title: title.value,
        body: text,
      };
      if (challenge) payload.challengeId = challenge.id;
      const result = await api.post('/api/entries', payload);
      clearDraft(key);
      setLevel(result.level);
      showResults(result, ctx);
    } catch (err) {
      if (err.status === 422 && err.payload.missing) {
        toast(`Not quite: still missing ${err.payload.missing.map((w) => `“${w}”`).join(', ')}`, { type: 'warn' });
      } else if (err.status === 422 && err.payload.minWords) {
        toast(`Keep going — ${err.payload.minWords} words needed, you have ${err.payload.wordCount}.`, { type: 'warn' });
      } else if (err.status === 409) {
        toast(err.message, { type: 'warn' });
      } else {
        toast(err.message, { type: 'error' });
      }
      refreshStatus();
    } finally {
      saveBtn.disabled = false;
    }
  }

  document.addEventListener('keydown', function onKey(e) {
    if (!document.body.contains(body)) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  view.append(
    h('div', { class: 'editor-wrap' },
      contextPanel,
      h('div', { class: 'card editor-card' },
        title,
        body,
        h('div', { class: 'editor-status' },
          h('div', { class: 'row gap center-v wrap' }, wcLabel, bankChips),
          constraintBox,
          h('div', { class: 'row gap end center-v' },
            draft && (draft.title || draft.body) ? h('span', { class: 'muted small' }, 'Draft restored') : null,
            h('span', { class: 'muted small kbd-hint' }, 'Ctrl+Enter to save'),
            saveBtn,
          ),
        ),
      ),
    ),
  );
  autosize();
  refreshStatus();
  body.focus();
}

function showResults(result, ctx) {
  const { xp, wordsUsed, streak, newAchievements, entry } = result;
  const rows = xp.items.map((i) =>
    h('div', { class: 'xp-row' }, h('span', {}, i.label), h('span', { class: 'xp-amount' }, `+${i.amount}`)),
  );
  const m = modal(
    h('div', { class: 'results' },
      h('div', { class: 'results-head' },
        h('div', { class: 'results-total' }, `+${xp.total} XP`),
        h('div', { class: 'muted' }, xp.total > 0 ? 'Nice work.' : 'Saved — short entries earn XP at 10+ words.'),
      ),
      rows.length > 0 && h('div', { class: 'xp-rows' }, rows),
      wordsUsed.length > 0 &&
        h('div', { class: 'results-words' },
          h('h3', {}, `Wordbank words used (${wordsUsed.length})`),
          wordsUsed.map((w) =>
            h('div', { class: 'xp-row' },
              h('span', {}, `✨ ${w.word}`),
              h('span', { class: 'mastery-shift' }, `${Math.round(w.from)}% → ${Math.round(w.to)}%`),
            ),
          ),
        ),
      ctx.mode === 'daily' &&
        h('div', { class: 'results-streak' },
          h('span', { class: 'flame-icon big' }, '🔥'),
          h('span', {}, `${streak.current}-day streak${streak.current > (streak.longest ?? 0) - 1 ? '' : ` (best: ${streak.longest})`}`),
        ),
      h('div', { class: 'row gap end' },
        h('button', { class: 'btn btn-ghost', onclick: () => { m.close(); navigate(`#/entry/${entry.id}`); } }, 'Read it'),
        h('button', {
          class: 'btn btn-primary',
          onclick: () => { m.close(); navigate(ctx.mode === 'journal' ? '#/journal' : '#/'); },
        }, 'Done'),
      ),
    ),
  );
  achievementToasts(newAchievements);
}
