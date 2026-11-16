// Infraestructura de modales: uno a la vez, con foco atrapado y Escape para
// los que no son bloqueantes. Cada modal tiene una `key`; si el estado del
// juego cambia, el controlador llama a `refreshModal()` para actualizarlo sin
// perder lo que el usuario está escribiendo.
import { h, clear } from '../dom.js';
import { t } from '../i18n/index.js';

let current = null; // { key, blocking, el, update, onClose, prevFocus }

export function currentModalKey() {
  return current ? current.key : null;
}

export function isBlockingOpen() {
  return Boolean(current && current.blocking);
}

/**
 * openModal({ key, title, blocking, wide, build(body, ctrl) → { update?, foot? } })
 */
export function openModal({ key, title, blocking = false, wide = false, build, onClose }) {
  if (current && current.key === key) {
    refreshModal();
    return current;
  }
  closeModal({ silent: true });
  const root = document.getElementById('modal-root');
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  const titleEl = h('h2', { id: titleId }, title);
  const closeBtn = blocking ? null : h('button', {
    class: 'icon-btn', type: 'button', 'aria-label': t('common.close'), on: { click: () => closeModal() },
  }, '✕');
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot' });
  const dialog = h('div', {
    class: ['modal', wide && 'wide'], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
  }, h('div', { class: 'modal-head' }, titleEl, closeBtn), body, foot);
  const backdrop = h('div', {
    class: 'modal-backdrop',
    on: {
      mousedown: (e) => { if (e.target === backdrop && !blocking) closeModal(); },
    },
  }, dialog);
  const ctrl = {
    setTitle: (txt) => { titleEl.textContent = txt; },
    close: () => closeModal(),
    foot,
    body,
  };
  const api = build(body, ctrl) || {};
  if (!foot.children.length) foot.remove();
  current = {
    key, blocking, el: backdrop, update: api.update, onClose, prevFocus: document.activeElement,
  };
  root.append(backdrop);
  backdrop.addEventListener('keydown', trapFocus);
  api.update?.();
  const first = dialog.querySelector('[data-autofocus]') || dialog.querySelector('button:not(:disabled), input, select, textarea, [href]');
  (first || dialog).focus?.();
  return current;
}

export function refreshModal() {
  if (current && current.update) current.update();
}

export function closeModal({ silent = false } = {}) {
  if (!current) return;
  const c = current;
  current = null;
  c.el.remove();
  if (!silent) c.onClose?.();
  if (c.prevFocus && document.contains(c.prevFocus)) c.prevFocus.focus?.();
  if (!silent) window.dispatchEvent(new CustomEvent('ortopoly:resync'));
}

function trapFocus(e) {
  if (!current) return;
  if (e.key === 'Escape' && !current.blocking) {
    e.preventDefault();
    closeModal();
    return;
  }
  if (e.key !== 'Tab') return;
  const items = [...current.el.querySelectorAll('button:not(:disabled), input:not(:disabled), select, textarea, [href], [tabindex]:not([tabindex="-1"])')]
    .filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Confirmación simple (promesa true/false). */
export function confirmDialog(message, { okText = t('common.confirm'), danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      key: `confirm-${Date.now()}`,
      title: t('common.confirm'),
      onClose: () => { if (!answered) resolve(false); },
      build(body, ctrl) {
        body.append(h('p', {}, message));
        ctrl.foot.append(
          h('button', { class: 'btn', type: 'button', on: { click: () => { answered = true; resolve(false); ctrl.close(); } } }, t('common.cancel')),
          h('button', {
            class: ['btn', danger ? 'btn-danger' : 'btn-primary'], type: 'button', 'data-autofocus': true,
            on: { click: () => { answered = true; resolve(true); ctrl.close(); } },
          }, okText),
        );
      },
    });
  });
}

export function replaceBody(body, ...nodes) {
  clear(body);
  body.append(...nodes);
}
