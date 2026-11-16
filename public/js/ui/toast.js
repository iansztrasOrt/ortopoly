import { h } from '../dom.js';

const MAX = 4;

/** kind: info | success | warn | error */
export function toast(message, kind = 'info', { timeout = 3800 } = {}) {
  const root = document.getElementById('toasts');
  if (!root || !message) return;
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  root.append(el);
  while (root.children.length > MAX) root.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, timeout);
}

export function announce(message) {
  const live = document.getElementById('sr-live');
  if (live) live.textContent = message;
}
