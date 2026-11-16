// Sala de espera: jugadores en vivo, ficha/color, listo, reglas, bots y chat.
import { AVATARS, COLORS } from '/shared/avatars.js';
import { THEMES } from '/shared/themes/index.js';
import { h, clear, replace } from '../dom.js';
import { t, tr } from '../i18n/index.js';
import { store, myId, isHost } from '../store.js';
import { call, showError } from '../net.js';
import { avatarEl, createChat } from './panels.js';
import { toast } from './toast.js';
import { confirmDialog } from './modals.js';

const MONEY_OPTIONS = [500, 1000, 1500, 2000, 2500, 3000];
const TIMER_OPTIONS = [0, 60, 90];

async function send(event, payload) {
  const res = await call(event, payload);
  if (!res.ok) showError(res);
  return res;
}

export function mountLobby(view, { onLeave }) {
  clear(view);
  const head = h('section', { class: 'card lobby-head' });
  const playersCard = h('section', { class: 'card card-pad' });
  const meCard = h('section', { class: 'card card-pad' });
  const rulesCard = h('section', { class: 'card card-pad' });
  const chat = createChat();
  const chatCard = h('section', { class: 'card card-pad' }, h('h2', {}, t('game.tabs.chat')), chat.el);
  view.append(h('div', { class: 'lobby' }, head,
    h('section', {}, playersCard, meCard),
    h('section', {}, rulesCard, chatCard)));

  function shareUrl() {
    return `${location.origin}/?sala=${store.room.code}`;
  }

  function renderHead() {
    const room = store.room;
    const copy = h('button', {
      class: 'btn btn-sm', type: 'button',
      on: {
        click: async () => {
          try {
            await navigator.clipboard.writeText(shareUrl());
            toast(t('lobby.copied'), 'success');
          } catch {
            prompt(t('lobby.copyLink'), shareUrl());
          }
        },
      },
    }, `🔗 ${t('lobby.copyLink')}`);
    replace(head,
      h('div', {}, h('div', { class: 'label' }, t('lobby.code')), h('div', { class: 'room-code', 'aria-label': `${t('lobby.code')} ${room.code.split('').join(' ')}` }, room.code),
        h('div', { class: 'muted' }, t('lobby.share'))),
      h('div', { class: 'btn-row' }, copy,
        h('button', {
          class: 'btn btn-sm btn-danger', type: 'button',
          on: { click: async () => { if (await confirmDialog(t('lobby.leave'))) onLeave(); } },
        }, t('lobby.leave'))),
    );
  }

  function renderPlayers() {
    const room = store.room;
    const list = h('ul', { class: 'member-list' });
    for (const m of room.members) {
      const badges = [];
      if (m.id === room.hostId) badges.push(h('span', { class: 'badge host' }, `👑 ${t('lobby.host')}`));
      if (m.id === myId()) badges.push(h('span', { class: 'badge' }, t('lobby.you')));
      if (m.spectator) badges.push(h('span', { class: 'badge' }, `👀 ${t('lobby.spectator')}`));
      else if (m.id !== room.hostId) badges.push(h('span', { class: ['badge', m.ready && 'ok'] }, m.ready ? `✓ ${t('lobby.ready')}` : t('lobby.notReady')));
      if (!m.connected && !m.isBot) badges.push(h('span', { class: 'badge' }, t('lobby.disconnected')));
      const kick = isHost() && m.id !== myId()
        ? h('button', { class: 'btn btn-xs btn-danger', type: 'button', on: { click: () => send('lobby:kick', { playerId: m.id }) } }, t('lobby.kick'))
        : h('span');
      list.append(h('li', { class: ['member', !m.connected && !m.isBot && 'offline'] },
        avatarEl(m.id), h('div', { class: 'name' }, h('span', {}, m.name), ...badges), kick));
    }
    const start = h('button', {
      class: 'btn btn-primary btn-block', type: 'button', disabled: Boolean(room.canStart),
      on: { click: () => send('lobby:start') },
    }, `🎲 ${t('lobby.start')}`);
    const hint = room.canStart ? h('p', { class: 'muted', style: { margin: 0 } }, tr(`lobby.startHint`)[room.canStart] || '') : null;
    const addBot = isHost() && room.settings.houseRules.bots
      ? h('button', { class: 'btn btn-block', type: 'button', disabled: room.members.filter((m) => !m.spectator).length >= 8, on: { click: () => send('lobby:addBot') } }, `🤖 ${t('lobby.addBot')}`)
      : null;
    replace(playersCard, h('h2', {}, t('lobby.players', { n: room.members.filter((m) => !m.spectator).length })), list,
      isHost() ? h('div', { style: { display: 'grid', gap: '8px' } }, addBot, start, hint) : h('p', { class: 'muted' }, t('lobby.waiting')));
    playersCard.style.display = 'grid';
    playersCard.style.gap = '12px';
  }

  function renderMe() {
    const room = store.room;
    const mine = room.members.find((m) => m.id === myId());
    if (!mine) return;
    if (mine.spectator) {
      replace(meCard, h('h2', {}, mine.name), h('p', { class: 'muted' }, `👀 ${t('lobby.spectatorFull')}`));
      return;
    }
    const avatars = h('div', { class: 'picker', role: 'group', 'aria-label': t('lobby.yourToken') },
      AVATARS.map((a) => {
        const takenBy = room.members.find((m) => m.avatar === a.id && m.id !== myId());
        return h('button', {
          class: 'pick', type: 'button', title: a.label, 'aria-label': a.label, 'aria-pressed': String(mine.avatar === a.id), disabled: Boolean(takenBy),
          on: { click: () => send('lobby:update', { avatar: a.id }) },
        }, a.emoji);
      }));
    const colors = h('div', { class: 'picker', role: 'group', 'aria-label': t('lobby.yourColor') },
      COLORS.map((c) => {
        const takenBy = room.members.find((m) => m.color === c.id && m.id !== myId());
        return h('button', {
          class: 'pick color', type: 'button', style: { '--c': c.hex }, title: c.label, 'aria-label': c.label,
          'aria-pressed': String(mine.color === c.id), disabled: Boolean(takenBy),
          on: { click: () => send('lobby:update', { color: c.id }) },
        });
      }));
    const ready = mine.id === room.hostId ? null : h('button', {
      class: ['btn', 'btn-block', mine.ready ? '' : 'btn-primary'], type: 'button',
      on: { click: () => send('lobby:update', { ready: !mine.ready }) },
    }, mine.ready ? t('lobby.imNotReady') : `✓ ${t('lobby.imReady')}`);
    replace(meCard,
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, avatarEl(mine.id), h('h2', {}, mine.name)),
      h('div', { class: 'label' }, t('lobby.yourToken')), avatars,
      h('div', { class: 'label' }, t('lobby.yourColor')), colors,
      ready,
    );
    meCard.style.display = 'grid';
    meCard.style.gap = '10px';
    meCard.style.marginTop = '0';
  }

  function renderRules() {
    const room = store.room;
    const s = room.settings;
    const host = isHost();
    const update = (patch) => send('lobby:settings', { settings: patch });
    const sel = (label, value, options, fmt, onChange) => h('label', { class: 'field' }, h('span', {}, label),
      h('select', { class: 'select', disabled: !host, on: { change: (e) => onChange(e.target.value) } },
        options.map((o) => h('option', { value: String(o), selected: String(o) === String(value) }, fmt(o)))));
    const rules = h('div', { class: 'rules-grid' },
      Object.keys(s.houseRules).map((k) => {
        const [title, desc] = tr(`houseRules.${k}`);
        const id = `hr-${k}`;
        return h('label', { class: 'check', for: id },
          h('input', {
            type: 'checkbox', id, checked: s.houseRules[k], disabled: !host,
            on: { change: (e) => update({ houseRules: { [k]: e.target.checked } }) },
          }),
          h('strong', {}, title), h('small', {}, desc));
      }));
    replace(rulesCard,
      h('h2', {}, t('lobby.settings')),
      host ? null : h('p', { class: 'muted', style: { margin: 0 } }, t('lobby.settingsHostOnly')),
      h('div', { class: 'settings-row' },
        sel(t('lobby.startingMoney'), s.startingMoney, MONEY_OPTIONS, (o) => `$${Number(o).toLocaleString('es-AR')}`, (v) => update({ startingMoney: Number(v) })),
        sel(t('lobby.turnTimer'), s.turnTimer, TIMER_OPTIONS, (o) => (Number(o) ? t('lobby.seconds', { n: o }) : t('lobby.timerOff')), (v) => update({ turnTimer: Number(v) })),
        sel(t('lobby.theme'), s.theme, Object.keys(THEMES), (id) => THEMES[id].name, (v) => update({ theme: v }))),
      h('p', { class: 'muted', style: { margin: 0, fontSize: '.88rem' } }, `🎲 ${t('lobby.order')}`),
      h('div', { class: 'label' }, t('lobby.houseRules')),
      rules,
    );
    rulesCard.style.display = 'grid';
    rulesCard.style.gap = '12px';
  }

  function renderAll() {
    if (!store.room) return;
    renderHead();
    renderPlayers();
    renderMe();
    renderRules();
  }
  renderAll();

  return {
    update(kind) {
      if (kind === 'room') renderAll();
      if (kind === 'chat') chat.render();
    },
    destroy() {},
  };
}
