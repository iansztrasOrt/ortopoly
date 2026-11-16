// Pantalla inicial: nombre, crear sala o unirse con código / enlace.
import { h, clear } from '../dom.js';
import { t } from '../i18n/index.js';
import { startSession } from '../net.js';
import { theme } from '../store.js';

export function mountHome(view) {
  clear(view);
  const params = new URLSearchParams(location.search);
  const invited = (params.get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  let savedName = '';
  try { savedName = localStorage.getItem('ortopoly.name') || ''; } catch { /* */ }

  const nameInput = h('input', {
    class: 'input', id: 'name', maxlength: '20', autocomplete: 'nickname', placeholder: t('home.namePh'), value: savedName, required: true,
  });
  const codeInput = h('input', {
    class: 'input code-input', id: 'code', maxlength: '6', autocomplete: 'off', placeholder: t('home.codePh'),
    value: invited, 'aria-label': t('home.code'),
    on: { input: () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); } },
  });

  const remember = () => { try { localStorage.setItem('ortopoly.name', nameInput.value.trim()); } catch { /* */ } };
  let busy = false;
  async function go(event, payload) {
    if (busy) return;
    if (!nameInput.value.trim()) {
      nameInput.focus();
      nameInput.reportValidity();
      return;
    }
    busy = true;
    remember();
    await startSession(event, payload);
    busy = false;
  }

  const createBtn = h('button', {
    class: 'btn btn-primary btn-block', type: 'button',
    on: { click: () => go('room:create', { name: nameInput.value }) },
  }, t('home.create'));
  const joinForm = h('form', {
    class: 'join-row',
    on: {
      submit: (e) => {
        e.preventDefault();
        if (codeInput.value.length < 5) { codeInput.focus(); return; }
        go('room:join', { code: codeInput.value, name: nameInput.value });
      },
    },
  }, codeInput, h('button', { class: 'btn btn-teal', type: 'submit' }, t('home.join')));

  const groups = Object.values(theme().groups).slice(0, 8);
  const mini = h('div', { class: 'mini-board', 'aria-hidden': 'true' },
    groups.map((g, i) => h('span', { style: { background: g.color, transform: `rotate(${(i % 2 ? 1 : -1) * (i + 2)}deg)` } })));

  view.append(h('div', { class: 'home' },
    h('section', { class: 'hero' },
      h('h1', {}, 'Orto', h('em', {}, 'poly')),
      h('p', { class: 'lead' }, t('app.tagline')),
      h('p', { class: 'muted' }, t('app.players')),
      mini),
    h('section', { class: 'card home-form', 'aria-label': t('home.create') },
      invited ? h('p', { class: 'notice' }, t('home.invited', { code: invited })) : null,
      h('label', { class: 'field', for: 'name' }, h('span', {}, t('home.name')), nameInput),
      invited ? null : createBtn,
      invited ? null : h('div', { class: 'divider' }, t('home.or')),
      h('div', { class: 'field' }, h('span', { class: 'label' }, t('home.code')), joinForm),
      invited ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', on: { click: () => { history.replaceState(null, '', '/'); mountHome(view); } } }, t('home.create')) : null),
    h('section', { class: 'card how' }, h('h2', {}, t('home.how')), h('p', { class: 'muted', style: { margin: 0 } }, t('home.howText')))));
  (invited && savedName ? codeInput : nameInput).focus();
  return { update() {}, destroy() {} };
}
