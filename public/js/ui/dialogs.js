// Diálogos del juego: título de propiedad, compra, subasta, deuda, hipoteca
// recibida, trato recibido, decisión del anfitrión y bienes de otro jugador.
import {
  SPACES, RAILROAD_RENT, unmortgageCost, mortgageInterest,
} from '/engine/board.js';
import { computeRent } from '/engine/rules.js';
import { ownsFullGroup } from '/engine/legal.js';
import { liquidationValue } from '/engine/bank.js';
import { h, clear } from '../dom.js';
import { t, tr, money } from '../i18n/index.js';
import {
  store, myId, me, spaceName, groupInfo, nameOf, serverNow, isHost, theme,
} from '../store.js';
import { act, call, showError } from '../net.js';
import { openModal, confirmDialog, closeModal } from './modals.js';
import { manageButtons, renderAssets, avatarEl } from './panels.js';
import { reasonText, cardText } from './format.js';
import { isLight } from './board.js';
import { sfx } from '../audio.js';

// ---------------------------------------------------------------- título de propiedad

export function deedCard(pos, state) {
  const sp = SPACES[pos];
  const pr = state?.props[pos];
  const name = spaceName(pos);
  if (!sp.price) {
    const special = tr(`deed.special.${sp.type}`);
    return h('div', { class: 'deed' },
      h('div', { class: 'deed-head', style: { '--gcol': 'var(--ink)' } }, h('strong', {}, name)),
      h('div', { class: 'deed-body' }, h('p', { class: 'center-t' },
        typeof special === 'string' ? special.replace('{amount}', money(sp.amount || 0)) : '')));
  }
  const g = groupInfo(sp.group);
  const head = h('div', {
    class: ['deed-head', sp.type === 'street' && isLight(g.color) && 'light'],
    style: { '--gcol': sp.type === 'street' ? g.color : 'var(--ink-2)' },
  }, h('small', {}, t('deed.title')), h('strong', {}, name));
  const body = h('div', { class: 'deed-body' });
  const level = pr ? pr.level : -1;
  const row = (label, value, cur = false) => h('div', { class: ['r', cur && 'cur'] }, h('span', {}, label), h('b', {}, value));
  if (sp.type === 'street') {
    const full = pr && pr.owner && ownsFullGroup(state, pr.owner, sp.group);
    body.append(row(t('deed.rent'), money(sp.rent[0]), level === 0 && !full));
    body.append(row(t('deed.rentGroup'), money(sp.rent[0] * 2), level === 0 && full));
    for (let i = 1; i <= 4; i += 1) body.append(row(t('deed.withHouses', { n: i }), money(sp.rent[i]), level === i));
    body.append(row(t('deed.withHotel'), money(sp.rent[5]), level === 5));
    body.append(h('hr'));
    body.append(h('div', { class: 'center-t' }, t('deed.houseCost', { amount: money(sp.houseCost) })));
    body.append(h('div', { class: 'center-t' }, t('deed.hotelCost', { amount: money(sp.houseCost) })));
  } else if (sp.type === 'railroad') {
    body.prepend(h('div', { class: 'deed-icon' }, '🚆'));
    for (let i = 1; i <= 4; i += 1) body.append(row(t('deed.railroadRent', { n: i }), money(RAILROAD_RENT[i])));
  } else {
    body.prepend(h('div', { class: 'deed-icon' }, pos === 12 ? '💡' : '🚰'));
    body.append(h('div', { class: 'center-t' }, t('deed.utilityRent1')));
    body.append(h('div', { class: 'center-t' }, t('deed.utilityRent2')));
  }
  body.append(h('hr'));
  body.append(h('div', { class: 'center-t' }, t('deed.mortgage', { amount: money(sp.mortgage) })));
  body.append(h('div', { class: 'center-t' }, t('deed.unmortgage', { amount: money(unmortgageCost(pos)) })));
  if (pr) {
    body.append(h('hr'));
    if (pr.owner) {
      body.append(h('div', { class: 'center-t' }, t('deed.owner', { player: nameOf(pr.owner) })));
      if (sp.type !== 'utility') body.append(h('div', { class: 'center-t' }, t('deed.currentRent', { amount: money(computeRent(state, pos)) })));
    } else {
      body.append(h('div', { class: 'center-t' }, t('deed.noOwner', { amount: money(sp.price) })));
    }
    if (pr.mortgaged) body.append(h('div', { class: 'stamp' }, t('deed.mortgaged')));
  }
  return h('div', { class: 'deed', style: { '--gcol': g.color } }, head, body);
}

export function openDeed(pos) {
  openModal({
    key: `deed-${pos}`,
    title: spaceName(pos),
    build(body, ctrl) {
      const holder = h('div');
      const tools = h('div', { class: 'btn-row', style: { justifyContent: 'center' } });
      body.append(holder, tools);
      return {
        update() {
          const state = store.game;
          clear(holder).append(deedCard(pos, state));
          clear(tools);
          if (state && state.props[pos] && state.props[pos].owner === myId() && state.phase === 'playing') {
            tools.append(...manageButtons(state, pos, { size: 'btn-sm' }));
          }
          ctrl.setTitle(spaceName(pos));
        },
      };
    },
  });
}

// ---------------------------------------------------------------- compra

export function openBuy(pos) {
  const sp = SPACES[pos];
  openModal({
    key: `buy-${pos}`,
    blocking: true,
    title: t('buy.title', { name: spaceName(pos) }),
    build(body, ctrl) {
      const noAuctions = store.game.settings.houseRules.noAuctions;
      const info = h('p', { class: 'muted' }, noAuctions ? t('buy.textNoAuction') : t('buy.text'));
      const warn = h('p', { class: 'banner' }, t('buy.cantAfford'));
      const buyBtn = h('button', { class: 'btn btn-primary', type: 'button', 'data-autofocus': true, on: { click: () => act('buy') } }, t('game.buy', { price: money(sp.price) }));
      const decline = h('button', { class: 'btn', type: 'button', on: { click: () => act('decline') } }, noAuctions ? t('game.declineNoAuction') : t('game.decline'));
      const manage = h('div');
      body.append(deedCard(pos, store.game), info, warn, manage);
      ctrl.foot.append(decline, buyBtn);
      return {
        update() {
          const can = me() && me().money >= sp.price;
          buyBtn.disabled = !can;
          warn.hidden = can;
          clear(manage);
          if (!can) renderAssets(manage, store.game, { onOpenDeed: () => {} });
        },
      };
    },
  });
}

// ---------------------------------------------------------------- subasta

export function openAuction() {
  const a0 = store.game.auction;
  const key = `auction-${a0.id}`;
  openModal({
    key,
    blocking: true,
    wide: false,
    title: a0.kind === 'house' ? t('auction.houseTitle') : t('auction.title', { name: spaceName(a0.pos) }),
    build(body, ctrl) {
      const deedHolder = h('div');
      const high = h('div', { class: 'auction-high' });
      const bar = h('div', { class: 'auction-bar' }, h('i'));
      const ends = h('div', { class: 'muted', style: { textAlign: 'center', fontSize: '.85rem' } });
      const status = h('p', { class: 'banner teal', hidden: true });
      const quick = h('div', { class: 'bid-grid' });
      const input = h('input', {
        class: 'input', type: 'number', inputmode: 'numeric', min: '1', step: '1', 'aria-label': t('auction.custom'), placeholder: t('auction.custom'),
      });
      const customForm = h('form', {
        class: 'bid-custom',
        on: {
          submit: (e) => {
            e.preventDefault();
            const amount = Math.floor(Number(input.value));
            if (amount > 0) bid(amount);
          },
        },
      }, input, h('button', { class: 'btn btn-primary', type: 'submit' }, t('auction.bid')));
      const withdraw = h('button', { class: 'btn btn-danger', type: 'button', on: { click: () => act('withdraw') } }, t('auction.withdraw'));
      const active = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
      const bidLog = h('div', { class: 'bid-log', 'aria-live': 'polite' });
      if (a0.kind === 'house') body.append(h('p', { class: 'muted' }, t('auction.houseText')));
      else deedHolder.append(deedCard(a0.pos, store.game));
      body.append(deedHolder, high, bar, ends, status, quick, customForm, active, bidLog);
      ctrl.foot.append(withdraw);

      async function bid(amount) {
        const res = await act('bid', { amount });
        if (res.ok) {
          input.value = '';
          sfx.bid();
        }
      }

      const steps = [1, 10, 50, 100];
      const buttons = steps.map((inc) => {
        const b = h('button', { class: 'btn btn-sm', type: 'button' });
        b.addEventListener('click', () => {
          const a = store.game.auction;
          if (!a) return;
          bid(Math.max(a.minBid, a.highBid + inc));
        });
        quick.append(b);
        return [inc, b];
      });

      const timer = setInterval(() => {
        if (!document.contains(bar)) {
          clearInterval(timer);
          return;
        }
        const a = store.game?.auction;
        if (!a) return;
        const total = Math.max(1, a.endsAt - (a.bids.length ? a.bids[a.bids.length - 1].t : a.startedAt));
        const left = Math.max(0, a.endsAt - serverNow());
        bar.firstChild.style.width = `${Math.min(100, (left / total) * 100)}%`;
        ends.textContent = t('auction.endsIn', { s: Math.ceil(left / 1000) });
      }, 250);

      return {
        update() {
          const a = store.game?.auction;
          if (!a) return;
          const meP = me();
          const amIn = a.active.includes(myId());
          const lead = a.highBidder === myId();
          clear(high).append(
            h('div', { class: 'label' }, t('auction.high')),
            h('div', { class: 'amt' }, a.highBidder ? money(a.highBid) : '—'),
            h('div', { class: 'muted' }, a.highBidder ? t('auction.by', { player: nameOf(a.highBidder) }) : t('auction.min', { amount: money(a.minBid) })),
          );
          status.hidden = !(lead || !amIn);
          status.textContent = lead ? t('auction.youLead') : (a.participants.includes(myId()) ? t('auction.withdrawn') : t('auction.spectator'));
          for (const [inc, b] of buttons) {
            const amount = Math.max(a.minBid, a.highBid + inc);
            b.textContent = `${money(amount)}`;
            b.disabled = !amIn || lead || !meP || amount > meP.money;
          }
          input.disabled = !amIn || lead;
          customForm.querySelector('button').disabled = !amIn || lead;
          withdraw.disabled = !amIn || lead;
          active.textContent = t('auction.active', { names: a.active.map(nameOf).join(', ') });
          clear(bidLog).append(...a.bids.slice(-5).reverse().map((b) => h('div', {}, `${nameOf(b.playerId)}: ${money(b.amount)}`)));
        },
      };
    },
  });
}

// ---------------------------------------------------------------- deuda

export function openDebt({ onTrade }) {
  openModal({
    key: 'debt',
    blocking: true,
    wide: true,
    title: t('debt.title'),
    build(body, ctrl) {
      const text = h('p');
      const short = h('p', { class: 'banner' });
      const liq = h('p', { class: 'muted' });
      const assets = h('div');
      body.append(text, short, liq, assets);
      const bankrupt = h('button', {
        class: 'btn btn-danger',
        type: 'button',
        on: {
          click: async () => {
            if (await confirmDialog(t('debt.confirmBankrupt'), { okText: t('debt.bankrupt'), danger: true })) {
              await act('declareBankruptcy');
            }
            window.dispatchEvent(new CustomEvent('ortopoly:resync'));
          },
        },
      }, t('debt.bankrupt'));
      const trade = h('button', { class: 'btn', type: 'button', on: { click: () => onTrade() } }, t('game.trade'));
      const pay = h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => act('payDebt') } });
      ctrl.foot.append(bankrupt, trade, pay);
      return {
        update() {
          const state = store.game;
          const d = state.debts[0];
          const meP = me();
          if (!d || !meP) return;
          text.textContent = t('debt.text', {
            amount: money(d.amount), creditor: nameOf(d.creditorId), reason: reasonText(d.reason), money: money(meP.money),
          });
          const missing = d.amount - meP.money;
          short.hidden = missing <= 0;
          short.textContent = t('debt.short', { amount: money(missing) });
          liq.textContent = t('debt.liquidation', { amount: money(liquidationValue(state, myId())) });
          pay.textContent = t('debt.pay', { amount: money(d.amount) });
          pay.disabled = missing > 0;
          bankrupt.disabled = missing <= 0;
          renderAssets(assets, state, { onOpenDeed: () => {} });
        },
      };
    },
  });
}

// ---------------------------------------------------------------- hipoteca recibida

export function openMortgageDecision(decision) {
  const { pos } = decision;
  openModal({
    key: `mdec-${pos}`,
    blocking: true,
    title: t('mortgageDecision.title'),
    build(body, ctrl) {
      body.append(deedCard(pos, store.game), h('p', {}, t('mortgageDecision.text', {
        name: spaceName(pos), interest: money(mortgageInterest(pos)), lift: money(unmortgageCost(pos)),
      })));
      const keep = h('button', { class: 'btn', type: 'button', on: { click: () => act('mortgageDecision', { pos, lift: false }) } }, t('mortgageDecision.keep', { amount: money(mortgageInterest(pos)) }));
      const lift = h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => act('mortgageDecision', { pos, lift: true }) } }, t('mortgageDecision.lift', { amount: money(unmortgageCost(pos)) }));
      ctrl.foot.append(keep, lift);
      return { update() { lift.disabled = !me() || me().money < unmortgageCost(pos); } };
    },
  });
}

// ---------------------------------------------------------------- trato recibido

export function tradeSideList(side) {
  const items = [];
  if (side.money) items.push(money(side.money));
  for (const pos of side.props) {
    const pr = store.game.props[pos];
    items.push(`${spaceName(pos)}${pr && pr.mortgaged ? ` (${t('deed.mortgaged').toLowerCase()})` : ''}`);
  }
  if (side.cards) items.push(`🎟️ × ${side.cards}`);
  if (!items.length) items.push(t('trade.nothing'));
  return h('ul', {}, items.map((x) => h('li', {}, x)));
}

export function openTradeReceived(trade, { onCounter }) {
  openModal({
    key: `trade-${trade.id}`,
    blocking: true,
    title: t('trade.received', { player: nameOf(trade.from) }),
    build(body, ctrl) {
      body.append(h('div', { class: 'trade-summary' },
        h('div', {}, h('strong', {}, t('trade.youGet')), tradeSideList(trade.give)),
        h('div', {}, h('strong', {}, t('trade.youGive')), tradeSideList(trade.get))));
      if ([...trade.give.props].some((pos) => store.game.props[pos].mortgaged)) body.append(h('p', { class: 'muted' }, t('trade.mortgagedNote')));
      ctrl.foot.append(
        h('button', { class: 'btn btn-danger', type: 'button', on: { click: () => act('rejectTrade', { tradeId: trade.id }) } }, t('trade.reject')),
        h('button', { class: 'btn', type: 'button', on: { click: () => onCounter(trade) } }, t('trade.counter')),
        h('button', { class: 'btn btn-primary', type: 'button', 'data-autofocus': true, on: { click: () => act('acceptTrade', { tradeId: trade.id }) } }, t('trade.accept')),
      );
    },
  });
}

// ---------------------------------------------------------------- anfitrión

export function openHostDecision(playerId) {
  openModal({
    key: `host-${playerId}`,
    blocking: true,
    title: t('host.decisionTitle', { player: nameOf(playerId) }),
    build(body, ctrl) {
      body.append(h('p', {}, t('host.decisionText')));
      const send = async (type) => {
        const res = await call('game:host', { type, playerId });
        if (!res.ok) showError(res);
      };
      ctrl.foot.append(
        h('button', { class: 'btn', type: 'button', on: { click: () => send('dismiss') } }, t('host.wait')),
        h('button', { class: 'btn btn-danger', type: 'button', on: { click: () => send('bankrupt') } }, t('host.bankrupt')),
        h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => send('replaceWithBot') } }, t('host.bot')),
      );
    },
  });
}

// ---------------------------------------------------------------- bienes de un jugador

export function openPlayer(playerId, { onTrade, onOpenDeed }) {
  openModal({
    key: `player-${playerId}`,
    title: nameOf(playerId),
    build(body, ctrl) {
      const holder = h('div');
      body.append(holder);
      if (playerId !== myId() && me() && !me().bankrupt) {
        ctrl.foot.append(h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => onTrade(playerId) } }, t('game.trade')));
      }
      if (isHost() && playerId !== myId()) {
        const p = store.game.players.find((x) => x.id === playerId);
        if (p && !p.bankrupt) {
          ctrl.foot.prepend(
            h('button', {
              class: 'btn btn-sm', type: 'button',
              on: { click: async () => { const r = await call('game:host', { type: 'replaceWithBot', playerId }); if (!r.ok) showError(r); } },
            }, t('host.bot')),
            h('button', {
              class: 'btn btn-sm btn-danger', type: 'button',
              on: {
                click: async () => {
                  if (await confirmDialog(`${t('host.bankrupt')}: ${nameOf(playerId)}?`, { danger: true })) {
                    const r = await call('game:host', { type: 'bankrupt', playerId });
                    if (!r.ok) showError(r);
                  }
                },
              },
            }, t('host.bankrupt')),
          );
        }
      }
      return {
        update() {
          renderAssets(holder, store.game, { playerId, manage: playerId === myId(), onOpenDeed });
        },
      };
    },
  });
}

export { cardText, avatarEl, theme, closeModal };
