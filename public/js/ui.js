// DOM helpers, toasts, modals, and small shared widgets.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---- toasts -------------------------------------------------------------

export function toast(content, { type = 'info', ms = 3800 } = {}) {
  const root = document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${type}` }, content);
  root.append(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 350);
  }, ms);
  return el;
}

export function achievementToasts(list = []) {
  list.forEach((a, i) => {
    setTimeout(() => {
      toast(
        h('div', { class: 'ach-toast' },
          h('span', { class: 'ach-toast-icon' }, a.icon),
          h('div', {},
            h('div', { class: 'ach-toast-title' }, 'Achievement unlocked!'),
            h('div', { class: 'ach-toast-name' }, `${a.name} — ${a.desc}`),
          ),
        ),
        { type: 'achievement', ms: 5200 },
      );
    }, i * 700);
  });
}

// ---- modals -------------------------------------------------------------

export function modal(content, { closable = true, wide = false } = {}) {
  const root = document.getElementById('modal-root');
  const box = h('div', { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog' }, content);
  const overlay = h('div', { class: 'modal-overlay' }, box);
  const close = () => {
    overlay.classList.add('modal-closing');
    setTimeout(() => overlay.remove(), 180);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (closable && e.key === 'Escape') close();
  };
  if (closable) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    box.append(h('button', { class: 'modal-x', onclick: close, 'aria-label': 'Close' }, '×'));
  }
  root.append(overlay);
  return { close, box };
}

export function confirmModal(message, { confirmLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    const m = modal(
      h('div', { class: 'confirm' },
        h('p', {}, message),
        h('div', { class: 'row gap end' },
          h('button', {
            class: 'btn btn-ghost',
            onclick: () => { m.close(); resolve(false); },
          }, 'Cancel'),
          h('button', {
            class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
            onclick: () => { m.close(); resolve(true); },
          }, confirmLabel),
        ),
      ),
      { closable: false },
    );
  });
}

// ---- widgets ------------------------------------------------------------

export function masteryBand(m) {
  if (m >= 90) return 'max';
  if (m >= 75) return 'great';
  if (m >= 60) return 'high';
  if (m >= 40) return 'mid';
  return 'low';
}

export function masteryBar(value, { showLabel = true } = {}) {
  const v = Math.round(value);
  return h('div', { class: 'mastery' },
    h('div', { class: 'bar' },
      h('div', { class: `bar-fill band-${masteryBand(v)}`, style: `width:${Math.max(2, v)}%` }),
    ),
    showLabel && h('span', { class: 'mastery-label' }, `${v}%`),
  );
}

export function progressBar(ratio, { label } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return h('div', { class: 'progress' },
    h('div', { class: 'bar' }, h('div', { class: 'bar-fill band-accent', style: `width:${pct}%` })),
    label != null && h('span', { class: 'progress-label' }, label),
  );
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function levelRing(level, progress, size = 84) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'level-ring');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  const track = document.createElementNS(SVG_NS, 'circle');
  const arc = document.createElementNS(SVG_NS, 'circle');
  for (const [el, cls] of [[track, 'ring-track'], [arc, 'ring-arc']]) {
    el.setAttribute('cx', size / 2);
    el.setAttribute('cy', size / 2);
    el.setAttribute('r', r);
    el.setAttribute('fill', 'none');
    el.setAttribute('class', cls);
  }
  arc.setAttribute('stroke-dasharray', `${c * Math.min(1, Math.max(0, progress))} ${c}`);
  arc.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', '50%');
  text.setAttribute('y', '50%');
  text.setAttribute('class', 'ring-text');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.textContent = level;
  svg.append(track, arc, text);
  return svg;
}

export const KIND_META = {
  journal: { icon: '📓', label: 'Journal' },
  daily: { icon: '☀️', label: 'Daily prompt' },
  challenge: { icon: '🎯', label: 'Challenge' },
};

export function kindBadge(kind) {
  const meta = KIND_META[kind] || KIND_META.journal;
  return h('span', { class: `badge badge-${kind}` }, `${meta.icon} ${meta.label}`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(value, { year = false } = {}) {
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return year || d.getFullYear() !== new Date().getFullYear() ? `${base}, ${d.getFullYear()}` : base;
}

export function fmtNumber(n) {
  return Number(n).toLocaleString('en-US');
}

export function el(id) {
  return document.getElementById(id);
}
