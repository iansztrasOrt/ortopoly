// Paneles laterales: jugadores, mis bienes, registro y chat.
import { SPACES, OWNABLE, GROUP_ORDER, HOTEL_LEVEL, unmortgageCost } from '/engine/board.js';
import {
  buildBlocker, sellBlocker, mortgageBlocker, unmortgageBlocker, ownsFullGroup,
} from '/engine/legal.js';
import { h, clear } from '../dom.js';
import { t, tr, money } from '../i18n/index.js';
import {
  store, myId, spaceName, groupInfo, playerColor, playerEmoji, isConnected, member, nameOf,
} from '../store.js';
import { act, call } from '../net.js';
import { formatLog, errorText, timeOf } from './format.js';

export function avatarEl(id, { small = false } = {}) {
  return h('span', { class: ['avatar', small && 'sm'], style: { '--pc': playerColor(id) }, 'aria-hidden': 'true' }, playerEmoji(id));
}

// ---------------------------------------------------------------- jugadores

export function renderPlayers(list, state, { onSelect }) {
  clear(list);
  const order = state.order.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
  for (const p of order) {
    const badges = [];
    if (p.id === myId()) badges.push(h('span', { class: 'badge ok' }, t('game.me')));
    if (store.room?.hostId === p.id) badges.push(h('span', { class: 'badge host', title: t('game.host') }, '👑'));
    if (p.isBot) badges.push(h('span', { class: 'badge', title: t('game.bot') }, '🤖'));
    if (p.inJail) badges.push(h('span', { class: 'badge', title: t('game.inJail') }, '🔒'));
    if (!p.isBot && !isConnected(p.id)) badges.push(h('span', { class: 'badge', title: t('game.offline') }, '📴'));
    if (p.jailCards.length) badges.push(h('span', { class: 'badge', title: t('game.cards', { n: p.jailCards.length }) }, `🎟️${p.jailCards.length}`));
    const owned = OWNABLE.filter((pos) => state.props[pos].owner === p.id).length;
    const row = h('button', {
      type: 'button',
      class: ['prow', state.turn.playerId === p.id && 'turn', p.bankrupt && 'bankrupt'],
      style: { '--pc': playerColor(p.id) },
      dataset: { player: p.id },
      'aria-label': `${p.name}, ${money(p.money)}${p.bankrupt ? `, ${t('game.bankrupt')}` : ''}`,
      on: { click: () => onSelect(p.id) },
    },
    avatarEl(p.id),
    h('div', {},
      h('div', { class: 'pname' }, h('span', {}, p.name), ...badges),
      h('div', { class: 'psub' }, p.bankrupt ? t('game.bankrupt') : `${owned} 🏠 · ${t('game.netWorth', { amount: money(state.netWorth?.[p.id] ?? p.money) })}`)),
    h('div', { class: 'money', dataset: { money: p.id } }, money(p.money)));
    list.append(h('li', {}, row));
  }
}

export function floatMoney(list, playerId, delta) {
  const row = list.querySelector(`[data-player="${CSS.escape(playerId)}"]`);
  if (!row) return;
  const el = h('span', { class: ['money-float', delta > 0 ? 'up' : 'down'], 'aria-hidden': 'true' }, `${delta > 0 ? '+' : ''}${money(delta)}`);
  row.append(el);
  setTimeout(() => el.remove(), 1700);
}

export function burstReaction(list, playerId, emoji) {
  const row = list.querySelector(`[data-player="${CSS.escape(playerId)}"]`);
  if (!row) return;
  const el = h('span', { class: 'reaction-burst', 'aria-hidden': 'true' }, emoji);
  row.append(el);
  setTimeout(() => el.remove(), 2100);
}

// ---------------------------------------------------------------- bienes

function levelText(pr) {
  if (pr.mortgaged) return t('deed.mortgaged');
  return tr('deed.level')[pr.level];
}

/** Botones de gestión de una propiedad propia, habilitados solo si la acción es legal. */
export function manageButtons(state, pos, { size = 'btn-xs' } = {}) {
  const sp = SPACES[pos];
  const pr = state.props[pos];
  const me = myId();
  const btns = [];
  const mk = (label, reason, onClick, cls = '') => h('button', {
    type: 'button',
    class: ['btn', size, cls],
    disabled: Boolean(reason),
    title: reason ? errorText(reason) : label,
    on: { click: onClick },
  }, label);
  if (sp.type === 'street') {
    const b = buildBlocker(state, me, pos);
    const showBuild = ownsFullGroup(state, me, sp.group);
    if (showBuild && pr.level < HOTEL_LEVEL) {
      btns.push(mk(pr.level === HOTEL_LEVEL - 1 ? `🏨 ${t('deed.buildHotel')}` : `🏠 ${t('deed.build')}`, b, () => act('build', { pos })));
    }
    if (pr.level > 0) btns.push(mk(`− ${t('deed.sell')}`, sellBlocker(state, me, pos), () => act('sell', { pos })));
  }
  if (!pr.mortgaged) {
    btns.push(mk(t('deed.mortgageBtn', { amount: money(sp.mortgage) }), mortgageBlocker(state, me, pos), () => act('mortgage', { pos })));
  } else {
    btns.push(mk(t('deed.unmortgageBtn', { amount: money(unmortgageCost(pos)) }), unmortgageBlocker(state, me, pos), () => act('unmortgage', { pos }), 'btn-teal'));
  }
  return btns;
}

export function propsByGroup(state, playerId) {
  const out = [];
  for (const g of GROUP_ORDER) {
    const list = OWNABLE.filter((pos) => SPACES[pos].group === g && state.props[pos].owner === playerId);
    if (list.length) out.push([g, list]);
  }
  return out;
}

export function renderAssets(el, state, { onOpenDeed, manage = true, playerId = myId() } = {}) {
  clear(el);
  const p = state.players.find((x) => x.id === playerId);
  if (!p) {
    el.append(h('p', { class: 'muted' }, `👀 ${t('game.spectating')}`));
    return;
  }
  el.append(h('div', { class: 'assets-head' },
    h('div', {}, h('div', { class: 'label' }, t('game.money')), h('div', { class: 'big-money' }, money(p.money))),
    h('div', { class: 'muted' }, t('game.netWorth', { amount: money(state.netWorth?.[p.id] ?? p.money) }))));
  if (p.jailCards.length) el.append(h('p', { class: 'chip' }, `🎟️ ${t('game.cards', { n: p.jailCards.length })}`));
  const groups = propsByGroup(state, playerId);
  if (!groups.length) {
    el.append(h('p', { class: 'muted' }, t('game.noProps')));
    return;
  }
  for (const [g, list] of groups) {
    const gi = groupInfo(g);
    const block = h('div', { class: 'group-block', style: { '--gcol': gi.color } },
      h('div', { class: 'group-title' }, h('i'), gi.label, ` (${list.length}/${OWNABLE.filter((pos) => SPACES[pos].group === g).length})`));
    for (const pos of list) {
      const pr = state.props[pos];
      block.append(h('div', { class: ['prop-row', pr.mortgaged && 'mortgaged'] },
        h('button', { class: 'pn', type: 'button', on: { click: () => onOpenDeed(pos) } },
          spaceName(pos), h('small', {}, levelText(pr))),
        manage ? h('div', { class: 'btn-row' }, ...manageButtons(state, pos)) : h('span')));
    }
    el.append(block);
  }
}

// ---------------------------------------------------------------- registro

export function renderLog(el, state) {
  clear(el);
  const list = h('ol', { class: 'log-list', reversed: true });
  const entries = state.log.slice(-120).reverse();
  for (const e of entries) {
    list.append(h('li', {}, h('span', { class: 't' }, timeOf(e.t)), formatLog(e)));
  }
  el.append(list);
}

// ---------------------------------------------------------------- chat

const REACTIONS = ['👏', '😂', '😱', '😡', '🤑', '🙏', '🔥', '💸'];

export function createChat() {
  const list = h('ul', { class: 'chat-list', 'aria-live': 'polite' });
  const input = h('input', {
    class: 'input', maxlength: '240', placeholder: t('chat.placeholder'), 'aria-label': t('chat.placeholder'), autocomplete: 'off',
  });
  const form = h('form', {
    class: 'chat-form',
    on: {
      submit: async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        const res = await call('chat:send', { text });
        if (!res.ok) input.value = text;
      },
    },
  }, input, h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, t('chat.send')));
  const reactions = h('div', { class: 'reactions', role: 'group', 'aria-label': t('chat.react') },
    REACTIONS.map((emoji) => h('button', { type: 'button', 'aria-label': emoji, on: { click: () => call('chat:react', { emoji }) } }, emoji)));
  const el = h('div', { class: 'chat-box' }, list, reactions, form);

  function render() {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    clear(list);
    for (const m of store.chat) {
      if (m.kind === 'system') {
        const params = { ...(m.params || {}) };
        if (params.player) params.player = nameOf(params.player);
        list.append(h('li', { class: 'system' }, t(`chat.system.${m.key}`, params)));
      } else {
        list.append(h('li', { style: { '--pc': playerColor(m.playerId) } },
          h('b', {}, `${member(m.playerId)?.name || m.name}: `), m.text));
      }
    }
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  render();
  return { el, render, input };
}
