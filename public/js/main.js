import { api } from './api.js';
import { h, clear, el, toast } from './ui.js';
import { renderAuth } from './views/auth.js';
import { renderDashboard } from './views/dashboard.js';
import { renderEditor } from './views/editor.js';
import { renderJournal, renderEntry } from './views/journal.js';
import { renderChallenges } from './views/challenges.js';
import { renderWordbank } from './views/wordbank.js';
import { renderProgress } from './views/progress.js';

export const state = {
  user: null,
  level: null,
};

const NAV = [
  { hash: '#/', icon: '🏠', label: 'Today' },
  { hash: '#/write', icon: '✍️', label: 'Write' },
  { hash: '#/journal', icon: '📓', label: 'Journal' },
  { hash: '#/challenges', icon: '🎯', label: 'Challenges' },
  { hash: '#/wordbank', icon: '📚', label: 'Wordbank' },
  { hash: '#/progress', icon: '📈', label: 'Progress' },
];

const ROUTES = {
  '/': renderDashboard,
  '/write': renderEditor,
  '/journal': renderJournal,
  '/entry': renderEntry, // /entry/:id
  '/challenges': renderChallenges,
  '/wordbank': renderWordbank,
  '/progress': renderProgress,
  '/auth': renderAuth,
};

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const path = '/' + (segments[0] || '');
  return { path, arg: segments[1] || null, query: new URLSearchParams(queryPart || '') };
}

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// Called by views after actions that change level/user so the chrome stays fresh.
export function setLevel(level) {
  if (!level) return;
  const prev = state.level?.level;
  state.level = level;
  if (prev && level.level > prev) {
    toast(`🎉 Level up! You are now level ${level.level} — ${level.title}`, { type: 'achievement', ms: 5200 });
  }
  renderChrome();
}

function renderChrome() {
  const nav = clear(el('nav'));
  const { path } = parseHash();
  for (const item of NAV) {
    const active = item.hash === '#/' ? path === '/' : item.hash.slice(1).startsWith(path);
    nav.append(
      h('a', { href: item.hash, class: `nav-item${active ? ' active' : ''}` },
        h('span', { class: 'nav-icon' }, item.icon),
        h('span', { class: 'nav-label' }, item.label),
      ),
    );
  }
  const footer = clear(el('sidebar-footer'));
  if (state.user) {
    footer.append(
      h('div', { class: 'user-chip' },
        h('div', { class: 'user-name' }, state.user.username),
        state.level && h('div', { class: 'user-level' }, `Lv ${state.level.level} · ${state.level.title}`),
      ),
      h('div', { class: 'row gap' },
        themeButton(),
        h('button', { class: 'btn btn-ghost btn-small', onclick: logout }, 'Sign out'),
      ),
    );
  } else {
    footer.append(h('div', { class: 'row gap' }, themeButton()));
  }
}

// ---- theme --------------------------------------------------------------

const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: '🌗', light: '☀️', dark: '🌙' };

function getTheme() {
  try {
    const t = localStorage.getItem('inkwell-theme');
    return THEMES.includes(t) ? t : 'auto';
  } catch {
    return 'auto';
  }
}

function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function themeButton() {
  const current = getTheme();
  return h('button', {
    class: 'btn btn-ghost btn-small',
    title: `Theme: ${current}`,
    onclick: () => {
      const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
      try { localStorage.setItem('inkwell-theme', next); } catch { /* private mode */ }
      applyTheme(next);
      renderChrome();
    },
  }, `${THEME_ICON[current]} theme`);
}

async function logout() {
  await api.post('/api/auth/logout').catch(() => {});
  state.user = null;
  state.level = null;
  navigate('#/auth');
}

// ---- render loop --------------------------------------------------------

let renderToken = 0;

export async function render() {
  const token = ++renderToken;
  const { path, arg, query } = parseHash();
  if (!state.user && path !== '/auth') {
    location.hash = '#/auth';
    return;
  }
  if (state.user && path === '/auth') {
    location.hash = '#/';
    return;
  }
  renderChrome();
  document.getElementById('app').classList.toggle('auth-mode', path === '/auth');
  const view = clear(el('view'));
  const fn = ROUTES[path];
  if (!fn) {
    view.append(h('div', { class: 'card' }, h('h2', {}, 'Page not found'), h('a', { href: '#/' }, '← Back to Today')));
    return;
  }
  try {
    await fn(view, { arg, query, stale: () => token !== renderToken });
  } catch (err) {
    if (token !== renderToken) return;
    if (err?.status === 401) {
      state.user = null;
      navigate('#/auth');
      return;
    }
    console.error(err);
    view.append(h('div', { class: 'card error-card' }, h('h2', {}, 'Something went wrong'), h('p', {}, err.message)));
  }
}

async function boot() {
  applyTheme(getTheme());
  try {
    const me = await api.get('/api/auth/me');
    state.user = me.user;
    state.level = me.level;
  } catch {
    state.user = null;
  }
  window.addEventListener('hashchange', render);
  render();
}

boot();
