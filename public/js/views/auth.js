import { api } from '../api.js';
import { h } from '../ui.js';
import { state, navigate } from '../main.js';

export async function renderAuth(view) {
  let mode = 'login';
  const error = h('p', { class: 'form-error', hidden: true });

  const username = h('input', {
    class: 'input', name: 'username', autocomplete: 'username',
    placeholder: 'Username', maxlength: 20, autofocus: true,
  });
  const password = h('input', {
    class: 'input', name: 'password', type: 'password',
    autocomplete: 'current-password', placeholder: 'Password',
  });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in');
  const hint = h('p', { class: 'muted small' });

  const tabs = ['login', 'register'].map((m) =>
    h('button', {
      type: 'button',
      class: 'tab',
      onclick: (e) => {
        mode = m;
        for (const t of e.target.parentElement.children) t.classList.remove('active');
        e.target.classList.add('active');
        submit.textContent = m === 'login' ? 'Sign in' : 'Create account';
        hint.textContent = m === 'register' ? 'Pick any username (3–20 letters/digits) and a password of 8+ characters. Everything you write stays on this machine.' : '';
        error.hidden = true;
      },
    }, m === 'login' ? 'Sign in' : 'New account'),
  );
  tabs[0].classList.add('active');

  const form = h('form', {
    class: 'auth-form',
    onsubmit: async (e) => {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        const data = await api.post(`/api/auth/${mode}`, {
          username: username.value.trim(),
          password: password.value,
        });
        state.user = data.user;
        state.level = data.level;
        navigate('#/');
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      } finally {
        submit.disabled = false;
      }
    },
  }, username, password, error, submit, hint);

  view.append(
    h('div', { class: 'auth-wrap' },
      h('div', { class: 'card auth-card' },
        h('div', { class: 'auth-brand' }, '🖋️'),
        h('h1', { class: 'auth-title' }, 'Inkwell'),
        h('p', { class: 'muted auth-tag' }, 'Write daily. Grow your words.'),
        h('div', { class: 'tabs' }, tabs),
        form,
      ),
    ),
  );
}
