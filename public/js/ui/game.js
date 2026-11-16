// Pantalla de juego: tablero + panel lateral, cola de animaciones, botones
// contextuales y diálogos bloqueantes según el estado del servidor.
import { JAIL_FINE, SPACES } from '/engine/board.js';
import { blockingReason } from '/engine/legal.js';
import { h, clear, sleep } from '../dom.js';
import { t, money } from '../i18n/index.js';
import {
  store, myId, me, nameOf, playerColor, playerEmoji, serverNow, isHost,
} from '../store.js';
import { act, call } from '../net.js';
import { sfx } from '../audio.js';
import { createBoard } from './board.js';
import {
  renderPlayers, renderAssets, renderLog, createChat, floatMoney, burstReaction, avatarEl,
} from './panels.js';
import {
  openDeed, openBuy, openAuction, openDebt, openMortgageDecision, openTradeReceived, openHostDecision, openPlayer,
} from './dialogs.js';
import { openTradeComposer } from './trade.js';
import {
  currentModalKey, isBlockingOpen, closeModal, refreshModal, confirmDialog,
} from './modals.js';
import { toast, announce } from './toast.js';
import { formatLog } from './format.js';

export function mountGame(view, { onLeave }) {
  clear(view);
  const boardWrap = h('section', { class: 'board-wrap', 'aria-label': 'Tablero' });
  const playersList = h('ul', { class: 'player-list' });
  const hostTools = h('div', { class: 'btn-row' });
  const playersCard = h('section', { class: 'card', 'aria-labelledby': 'players-title' },
    h('div', { class: 'panel-title' }, h('h2', { id: 'players-title' }, t('lobby.players', { n: store.game.players.length })), hostTools),
    playersList);

  const tabsDef = [['assets', t('game.tabs.assets')], ['log', t('game.tabs.log')], ['chat', t('game.tabs.chat')]];
  let activeTab = 'assets';
  try { activeTab = localStorage.getItem('ortopoly.tab') || 'assets'; } catch { /* */ }
  const tabButtons = {};
  const panels = {};
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const tabsCard = h('section', { class: 'card' }, tabBar);
  for (const [id, label] of tabsDef) {
    tabButtons[id] = h('button', {
      class: 'tab', role: 'tab', type: 'button', id: `tab-${id}`, 'aria-controls': `panel-${id}`,
      on: { click: () => selectTab(id) },
    }, label);
    tabBar.append(tabButtons[id]);
    panels[id] = h('div', { class: 'tabpanel', role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}` });
    tabsCard.append(panels[id]);
  }
  const chat = createChat();
  panels.chat.append(chat.el);
  let unread = false;

  function selectTab(id) {
    activeTab = id;
    try { localStorage.setItem('ortopoly.tab', id); } catch { /* */ }
    for (const [tid] of tabsDef) {
      tabButtons[tid].setAttribute('aria-selected', String(tid === id));
      panels[tid].hidden = tid !== id;
    }
    if (id === 'chat') {
      unread = false;
      renderTabDots();
      chat.render();
    }
  }

  function renderTabDots() {
    tabButtons.chat.querySelector('.dot')?.remove();
    if (unread) tabButtons.chat.append(h('span', { class: 'dot', 'aria-label': 'nuevo' }));
  }

  const side = h('aside', { class: 'side' }, playersCard, tabsCard);
  view.append(h('div', { class: 'game' }, boardWrap, side));

  const board = createBoard(boardWrap, { onCellClick: (pos) => openDeed(pos) });
  selectTab(activeTab);

  // ---------------------------------------------------------------- centro

  const timerBar = h('div', { class: 'timer-bar', hidden: true }, h('i'));
  let timerInterval = setInterval(updateTimer, 250);

  function updateTimer() {
    const g = store.game;
    if (!g || !g.turn.deadline || g.phase !== 'playing') {
      timerBar.hidden = true;
      return;
    }
    const total = (g.settings.turnTimer || 60) * 1000;
    const left = Math.max(0, g.turn.deadline - serverNow());
    timerBar.hidden = false;
    timerBar.firstChild.style.width = `${(left / total) * 100}%`;
    timerBar.classList.toggle('low', left < 10000);
    timerBar.title = t('game.timer', { s: Math.ceil(left / 1000) });
  }

  function btn(label, onClick, { primary = false, disabled = false, cls = '' } = {}) {
    return h('button', { class: ['btn', primary && 'btn-primary', cls], type: 'button', disabled, on: { click: onClick } }, label);
  }

  function renderCenter(state) {
    const cur = state.players.find((p) => p.id === state.turn.playerId);
    const mine = cur && cur.id === myId();
    const meP = me();
    const blocked = blockingReason(state);
    let sub = '';
    if (state.debts.length) {
      const d = state.debts[0];
      sub = t('debt.waiting', { player: nameOf(d.debtorId), amount: money(d.amount) });
    } else if (blocked && blocked !== 'game_not_running') {
      sub = t(`game.blocked.${blocked}`);
    } else if (cur && cur.inJail && state.turn.phase === 'roll') {
      sub = t('game.jail', { n: cur.jailTurns + 1 });
    } else if (cur && !mine) {
      sub = `${cur.name} ${t(`game.phase.${state.turn.phase}`)}`;
    }
    if (state.turn.autopilot) sub = `${sub ? `${sub} · ` : ''}🤖 ${t('game.autopilot')}`;
    clear(board.top).append(
      h('div', { class: 'turn-banner' }, cur ? avatarEl(cur.id) : null,
        h('div', {}, h('div', {}, mine ? t('game.yourTurn') : t('game.turnOf', { player: cur ? cur.name : '' })),
          sub ? h('div', { class: 'turn-sub' }, sub) : null)),
      timerBar,
    );

    const acts = [];
    if (meP && !meP.bankrupt) {
      const myDebt = state.debts[0] && state.debts[0].debtorId === myId();
      if (myDebt) acts.push(btn(t('game.resolveDebt'), () => syncBlocking(true), { primary: true }));
      if (mine && state.turn.phase === 'roll') {
        if (meP.inJail) {
          acts.push(btn(t('game.tryDoubles'), () => act('roll'), { primary: true, disabled: Boolean(blocked) }));
          acts.push(btn(t('game.payBail'), () => act('payBail'), { disabled: Boolean(blocked) || meP.money < JAIL_FINE }));
          if (meP.jailCards.length) acts.push(btn(t('game.useCard'), () => act('useJailCard'), { disabled: Boolean(blocked) }));
        } else {
          acts.push(btn(state.turn.doubles > 0 ? t('game.rollAgain') : t('game.roll'), () => act('roll'), { primary: true, disabled: Boolean(blocked) }));
        }
      }
      if (mine && state.turn.phase === 'buy') {
        acts.push(btn(t('game.buy', { price: money(SPACES[state.turn.pendingBuy].price) }), () => syncBlocking(true), { primary: true }));
      }
      if (mine && state.turn.phase === 'end') {
        acts.push(btn(t('game.endTurn'), () => act('endTurn'), { primary: true, disabled: Boolean(blocked) }));
      }
      if (!mine && cur) acts.push(h('span', { class: 'muted' }, t('game.waitingFor', { player: cur.name })));
      acts.push(btn(`🤝 ${t('game.trade')}`, () => openTradeComposer(), { cls: 'btn-teal' }));
    } else {
      acts.push(h('span', { class: 'chip' }, meP ? `💀 ${t('game.bankruptWatching')}` : `👀 ${t('game.spectating')}`));
    }
    clear(board.actions).append(...acts);

    const chips = [];
    if (state.settings.houseRules.freeParkingPot) chips.push(h('span', { class: 'chip' }, `⛲ ${t('game.pot', { amount: money(state.pot) })}`));
    chips.push(h('span', { class: 'chip' }, `🏠 ${t('game.housesLeft', { houses: state.bank.houses, hotels: state.bank.hotels })}`));
    clear(board.foot).append(...chips);
    updateTimer();
  }

  // ---------------------------------------------------------------- diálogos bloqueantes

  let lastDesired = null;

  function desiredBlocking(state) {
    if (!state || state.phase !== 'playing') return null;
    const meP = me();
    if (!meP || meP.bankrupt) {
      if (isHost() && state.hostDecision) return { key: `host-${state.hostDecision}`, open: () => openHostDecision(state.hostDecision) };
      return null;
    }
    const md = state.mortgageDecisions.find((d) => d.playerId === myId());
    if (md) return { key: `mdec-${md.pos}`, open: () => openMortgageDecision(md) };
    if (state.debts[0] && state.debts[0].debtorId === myId()) return { key: 'debt', open: () => openDebt({ onTrade: () => openTradeComposer() }) };
    if (state.auction) return { key: `auction-${state.auction.id}`, open: () => openAuction() };
    const tr = state.trades.find((x) => x.to === myId());
    if (tr) return { key: `trade-${tr.id}`, open: () => openTradeReceived(tr, { onCounter: (orig) => openTradeComposer({ counter: orig }) }) };
    if (state.turn.playerId === myId() && state.turn.phase === 'buy' && !blockingReason(state)) {
      const pos = state.turn.pendingBuy;
      return { key: `buy-${pos}`, open: () => openBuy(pos) };
    }
    if (isHost() && state.hostDecision && state.hostDecision !== myId()) {
      return { key: `host-${state.hostDecision}`, open: () => openHostDecision(state.hostDecision) };
    }
    return null;
  }

  function syncBlocking(force = false) {
    const d = desiredBlocking(store.game);
    const cur = currentModalKey();
    const isChild = cur && /^(confirm-|counter-|trade-composer)/.test(cur);
    if (d) {
      if (cur === d.key) refreshModal();
      else if (isChild && d.key === lastDesired && !force) refreshModal();
      else d.open();
    } else if (cur && isBlockingOpen()) {
      closeModal({ silent: true });
    } else {
      refreshModal();
    }
    lastDesired = d ? d.key : null;
  }

  const onResync = () => setTimeout(() => syncBlocking(), 0);
  window.addEventListener('ortopoly:resync', onResync);

  // ---------------------------------------------------------------- animaciones

  let queue = Promise.resolve();
  let animating = 0;

  async function runEvents(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'dice':
          await board.dice.roll(ev.dice);
          break;
        case 'move':
          await board.animateMove(ev);
          break;
        case 'card':
          board.showCard(ev);
          await sleep(650);
          break;
        case 'money':
          floatMoney(playersList, ev.playerId, ev.delta);
          if (ev.playerId === myId()) (ev.delta > 0 ? sfx.coin : sfx.pay)();
          break;
        case 'bought':
          sfx.buy();
          board.highlight(ev.pos);
          break;
        case 'build':
          sfx.build();
          break;
        case 'jail':
          sfx.jail();
          break;
        case 'turn':
          if (ev.playerId === myId()) {
            sfx.turn();
            toast(t('game.yourTurn'), 'success', { timeout: 2200 });
          }
          break;
        case 'bid':
          if (ev.playerId !== myId()) sfx.bid();
          break;
        case 'debt':
          if (ev.playerId === myId()) sfx.error();
          break;
        case 'gameOver':
          sfx.win();
          break;
        default:
          break;
      }
    }
  }

  function moversIn(events) {
    return new Set(events.filter((e) => e.type === 'move').map((e) => e.playerId));
  }

  // ---------------------------------------------------------------- render

  function renderAll() {
    const state = store.game;
    if (!state) return;
    renderPlayers(playersList, state, { onSelect: (id) => openPlayer(id, { onTrade: (to) => openTradeComposer({ to }), onOpenDeed: openDeed }) });
    playersCard.querySelector('h2').textContent = t('lobby.players', { n: state.players.filter((p) => !p.bankrupt).length });
    renderAssets(panels.assets, state, { onOpenDeed: openDeed });
    renderLog(panels.log, state);
    renderCenter(state);
    clear(hostTools);
    if (isHost()) {
      hostTools.append(h('button', {
        class: 'btn btn-xs btn-danger', type: 'button', title: t('game.endGame'),
        on: { click: async () => { if (await confirmDialog(t('game.confirmEndGame'), { danger: true })) call('game:host', { type: 'endGame' }); } },
      }, '🏁'));
    }
    hostTools.append(h('button', {
      class: 'btn btn-xs', type: 'button', title: t('game.leaveGame'),
      on: { click: async () => { if (await confirmDialog(t('game.confirmLeave'), { danger: true })) onLeave(); } },
    }, '🚪'));
    syncBlocking();
  }

  let lastLogId = 0;
  function announceNews(state) {
    const fresh = state.log.filter((e) => e.id > lastLogId);
    if (fresh.length) {
      lastLogId = fresh[fresh.length - 1].id;
      if (fresh.length <= 4) announce(fresh.map(formatLog).join(' '));
    }
  }

  function update(kind, payload = {}) {
    const state = store.game;
    if (kind === 'game' && state) {
      const events = payload.events || [];
      if (!payload.prev) {
        board.update(state);
        lastLogId = state.log.length ? state.log[state.log.length - 1].id : 0;
      } else {
        const movers = moversIn(events);
        board.update(state, { syncTokens: movers.size === 0 && animating === 0 });
        if (events.length) {
          animating += 1;
          queue = queue.then(() => runEvents(events)).catch(console.error).then(() => {
            animating -= 1;
            if (animating === 0 && store.game) board.update(store.game);
          });
        }
        announceNews(state);
      }
      renderAll();
    } else if (kind === 'room') {
      if (state) renderAll();
    } else if (kind === 'chat') {
      chat.render();
      if (activeTab !== 'chat' && payload.kind === 'msg') {
        unread = true;
        renderTabDots();
        if (payload.playerId !== myId()) sfx.message();
      }
    } else if (kind === 'reaction') {
      burstReaction(playersList, payload.playerId, payload.emoji);
    }
  }

  // ---------------------------------------------------------------- teclado

  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || currentModalKey()) return;
    const state = store.game;
    if (!state || state.turn.playerId !== myId()) {
      if (e.key.toLowerCase() === 't') openTradeComposer();
      return;
    }
    const k = e.key.toLowerCase();
    if ((k === 'r' || k === ' ') && state.turn.phase === 'roll') {
      e.preventDefault();
      act('roll');
    } else if (k === 'e' && state.turn.phase === 'end') {
      act('endTurn');
    } else if (k === 't') {
      openTradeComposer();
    }
  }
  document.addEventListener('keydown', onKey);

  board.update(store.game);
  renderAll();
  lastLogId = store.game.log.length ? store.game.log[store.game.log.length - 1].id : 0;

  return {
    update,
    destroy() {
      clearInterval(timerInterval);
      timerInterval = null;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('ortopoly:resync', onResync);
      closeModal({ silent: true });
    },
  };
}

export { playerColor, playerEmoji };
