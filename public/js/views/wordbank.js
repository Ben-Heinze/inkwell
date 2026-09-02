import { api } from '../api.js';
import { h, clear, toast, modal, masteryBar, achievementToasts, confirmModal, debounce, fmtNumber } from '../ui.js';
import { setLevel } from '../main.js';

const POS_OPTIONS = ['', 'noun', 'verb', 'adjective', 'adverb'];

// ---- shared quiz question UI -------------------------------------------

function questionEl(q, index, total, onAnswer) {
  const wrap = h('div', { class: 'quiz-q' });
  const status = h('div', { class: 'quiz-status' });
  const nextBtn = h('button', { class: 'btn btn-primary', hidden: true }, 'Next');
  let answered = false;

  const choiceBtns = q.choices.map((choice, i) =>
    h('button', {
      class: `quiz-choice${q.type === 'blank' ? ' quiz-sentence' : ''}`,
      onclick: async (e) => {
        if (answered) return;
        answered = true;
        for (const b of choiceBtns) b.classList.add('locked');
        e.currentTarget.classList.add('chosen');
        const res = await onAnswer(i);
        choiceBtns[res.answer]?.classList.add('right');
        if (!res.correct) e.currentTarget.classList.add('wrong');
        status.append(
          h('span', { class: res.correct ? 'quiz-verdict good' : 'quiz-verdict bad' },
            res.correct ? 'Correct!' : 'Not quite.'),
          res.word ? h('span', { class: 'muted small' }, ` ${res.word.word}: ${Math.round(res.word.from)}% → ${Math.round(res.word.to)}%`) : null,
        );
        nextBtn.hidden = false;
        nextBtn.onclick = () => res.onNext();
        nextBtn.focus();
      },
    },
      q.type === 'blank' ? h('span', { class: 'blank-label' }, String.fromCharCode(65 + i) + '. ') : null,
      choice,
    ),
  );

  wrap.append(
    h('div', { class: 'muted small' }, `Question ${index + 1} of ${total}`),
    h('h3', { class: 'quiz-prompt' }, q.prompt),
    h('div', { class: 'quiz-choices' }, choiceBtns),
    h('div', { class: 'row spread center-v' }, status, nextBtn),
  );
  return wrap;
}

async function runQuiz({ box, sessionId, questions, onDone }) {
  let idx = 0;
  const show = () => {
    clear(box);
    const q = questions[idx];
    box.append(
      questionEl(q, idx, questions.length, async (choice) => {
        const res = await api.post(`/api/quiz/${sessionId}/answer`, { choice });
        return {
          ...res,
          onNext: () => {
            if (res.done) onDone(res);
            else {
              idx += 1;
              show();
            }
          },
        };
      }),
    );
  };
  show();
}

// ---- learn flow ---------------------------------------------------------

async function openLearnFlow(refresh) {
  let start;
  try {
    start = await api.post('/api/words/learn/start');
  } catch (err) {
    toast(err.message, { type: 'warn' });
    return;
  }
  const { sessionId, word, questions } = start;
  const box = h('div', { class: 'learn-box' });
  const m = modal(box, { wide: true });

  const wordCard = (compact = false) =>
    h('div', { class: `learn-word${compact ? ' compact' : ''}` },
      h('div', { class: 'row gap center-v' },
        h('span', { class: 'learn-word-text' }, word.word),
        h('span', { class: 'chip chip-pos' }, word.pos),
      ),
      !compact && h('p', { class: 'learn-def' }, word.definition),
      !compact && h('p', { class: 'learn-example' }, `“${word.example}”`),
    );

  clear(box).append(
    h('div', { class: 'learn-intro' },
      h('div', { class: 'muted small' }, '📖 New word'),
      wordCard(),
      h('p', { class: 'muted small' },
        'Three quick questions. Your answers set the starting mastery (50–65%) — no word starts at 100. Writing with it is what masters it.'),
      h('div', { class: 'row end' },
        h('button', {
          class: 'btn btn-primary',
          onclick: () =>
            runQuiz({
              box,
              sessionId,
              questions,
              onDone: (res) => {
                clear(box).append(
                  h('div', { class: 'learn-done' },
                    h('div', { class: 'learn-done-icon' }, '📚'),
                    h('h3', {}, `“${word.word}” joined your wordbank`),
                    h('p', { class: 'muted small' }, `${res.correctCount}/${res.totalSteps} correct · +15 XP`),
                    res.learned && masteryBar(res.learned.mastery),
                    h('div', { class: 'row gap end' },
                      h('button', { class: 'btn btn-ghost', onclick: () => { m.close(); refresh(); } }, 'Done'),
                      h('button', {
                        class: 'btn btn-primary',
                        onclick: async () => { m.close(); await refresh(); openLearnFlow(refresh); },
                      }, 'Learn another'),
                    ),
                  ),
                );
                if (res.level) setLevel(res.level);
                achievementToasts(res.newAchievements || []);
              },
            }),
        }, 'Quiz me →'),
      ),
    ),
  );
}

// ---- practice flow ------------------------------------------------------

async function openPractice(refresh) {
  let start;
  try {
    start = await api.post('/api/words/practice/start');
  } catch (err) {
    toast(err.message, { type: 'warn' });
    return;
  }
  const box = h('div', { class: 'learn-box' });
  const m = modal(box, { wide: true });
  runQuiz({
    box,
    sessionId: start.sessionId,
    questions: start.questions,
    onDone: (res) => {
      clear(box).append(
        h('div', { class: 'learn-done' },
          h('div', { class: 'learn-done-icon' }, res.correctCount === res.totalSteps ? '🌟' : '⚡'),
          h('h3', {}, `Practice complete: ${res.correctCount}/${res.totalSteps}`),
          h('p', { class: 'muted small' },
            'Each correct answer sharpens a word (+8, up to 95%). Only using words in real writing reaches 100%.'),
          h('div', { class: 'row end' },
            h('button', { class: 'btn btn-primary', onclick: () => { m.close(); refresh(); } }, 'Done'),
          ),
        ),
      );
      if (res.level) setLevel(res.level);
      achievementToasts(res.newAchievements || []);
    },
  });
}

// ---- add word form ------------------------------------------------------

function addWordForm(refresh) {
  const word = h('input', { class: 'input', placeholder: 'word', maxlength: 40 });
  const pos = h('select', { class: 'input select' }, POS_OPTIONS.map((p) => h('option', { value: p }, p || 'part of speech…')));
  const definition = h('input', { class: 'input grow', placeholder: 'definition', maxlength: 500 });
  const example = h('input', { class: 'input grow', placeholder: 'example sentence (optional)', maxlength: 300 });
  return h('form', {
    class: 'add-word-form',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const res = await api.post('/api/words', {
          word: word.value.trim(),
          pos: pos.value,
          definition: definition.value.trim(),
          example: example.value.trim(),
        });
        toast(`“${res.word.word}” added (starts at ${Math.round(res.word.mastery)}%)`);
        achievementToasts(res.newAchievements || []);
        e.target.reset();
        refresh();
      } catch (err) {
        toast(err.message, { type: 'warn' });
      }
    },
  },
    h('div', { class: 'row gap wrap' }, word, pos),
    h('div', { class: 'row gap wrap' }, definition),
    h('div', { class: 'row gap wrap' }, example),
    h('div', { class: 'row end' }, h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Add to wordbank')),
  );
}

// ---- main view ----------------------------------------------------------

export async function renderWordbank(view, { query, stale }) {
  let sort = 'mastery';
  let q = '';

  const listEl = h('div', { class: 'word-grid' });
  const statsEl = h('div', { class: 'row gap wrap center-v' });
  const practiceBtn = h('button', { class: 'btn btn-ghost', onclick: () => openPractice(refresh) }, '⚡ Practice');
  let addFormEl = null;

  async function refresh() {
    const params = new URLSearchParams({ sort });
    if (q) params.set('q', q);
    const data = await api.get(`/api/words?${params}`);
    if (stale()) return;

    clear(statsEl).append(
      h('span', { class: 'stat-chip' }, `${fmtNumber(data.totals.count)} words`),
      data.totals.count > 0 && h('span', { class: 'stat-chip' }, `${data.totals.avgMastery}% avg mastery`),
      data.totals.due > 0 && h('span', { class: 'stat-chip warn' }, `${data.totals.due} fading`),
      h('span', { class: 'stat-chip' }, `${fmtNumber(data.catalogRemaining)} left to learn`),
    );
    practiceBtn.textContent = data.totals.due > 0 ? `⚡ Practice (${data.totals.due} due)` : '⚡ Practice';
    practiceBtn.disabled = data.totals.count === 0;

    clear(listEl);
    if (data.words.length === 0) {
      listEl.append(
        h('div', { class: 'card empty-state wide' },
          h('p', { class: 'muted' },
            q ? 'No words match.' : 'Your wordbank is your personal dictionary. Learn words from the catalog, then use them in entries to master them.'),
          !q && h('button', { class: 'btn btn-primary', onclick: () => openLearnFlow(refresh) }, '📖 Learn your first word'),
        ),
      );
      return;
    }
    for (const w of data.words) {
      listEl.append(
        h('div', { class: 'card word-card' },
          h('div', { class: 'row spread center-v' },
            h('div', { class: 'row gap center-v' },
              h('span', { class: 'word-card-word' }, w.word),
              w.pos && h('span', { class: 'chip chip-pos' }, w.pos),
              w.due && h('span', { class: 'chip chip-fading', title: 'Mastery is decaying — use or practice it' }, 'fading'),
            ),
            h('button', {
              class: 'icon-btn', title: 'Remove word',
              onclick: async () => {
                if (!(await confirmModal(`Remove “${w.word}” from your wordbank?`, { confirmLabel: 'Remove' }))) return;
                await api.del(`/api/words/${w.id}`);
                refresh();
              },
            }, '✕'),
          ),
          masteryBar(w.mastery),
          h('p', { class: 'word-card-def' }, w.definition),
          w.example && h('p', { class: 'word-card-ex' }, `“${w.example}”`),
          h('div', { class: 'muted small' },
            w.timesUsed > 0 ? `used ${w.timesUsed}× in your writing` : 'never used in writing yet'),
        ),
      );
    }
  }

  view.append(
    h('header', { class: 'page-head row spread center-v wrap' },
      h('div', {},
        h('h1', {}, 'Wordbank'),
        h('p', { class: 'muted' }, 'Words fade when unused — write with them to reach 100%.'),
      ),
      h('div', { class: 'row gap' },
        practiceBtn,
        h('button', { class: 'btn btn-primary', onclick: () => openLearnFlow(refresh) }, '📖 Learn a new word'),
      ),
    ),
    statsEl,
    h('div', { class: 'toolbar row gap center-v wrap' },
      h('input', {
        class: 'input', placeholder: 'Search your words…',
        oninput: debounce((e) => { q = e.target.value.trim(); refresh(); }, 300),
      }),
      h('select', {
        class: 'input select',
        onchange: (e) => { sort = e.target.value; refresh(); },
      },
        h('option', { value: 'mastery' }, 'Weakest first'),
        h('option', { value: 'recent' }, 'Recently added'),
        h('option', { value: 'alpha' }, 'A → Z'),
        h('option', { value: 'used' }, 'Most used'),
      ),
      h('button', {
        class: 'btn btn-ghost btn-small',
        onclick: (e) => {
          addFormEl.hidden = !addFormEl.hidden;
          e.target.textContent = addFormEl.hidden ? '+ Add your own' : '− Hide form';
        },
      }, '+ Add your own'),
    ),
    (addFormEl = h('div', { class: 'card add-word-card', hidden: true }, addWordForm(refresh))),
    listEl,
  );

  await refresh();
  if (query.get('learn')) openLearnFlow(refresh);
  else if (query.get('practice')) openPractice(refresh);
}
