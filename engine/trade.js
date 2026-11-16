// Tratos entre jugadores: propiedades, dinero y cartas de "salir de la cárcel",
// en ambos sentidos. Se pueden proponer en cualquier momento (aunque no sea tu
// turno). Se revalidan al aceptar, porque el estado pudo cambiar.

import { SPACES, mortgageInterest } from './board.js';
import { fail, getPlayer, requirePlayer, log, emit, nextId } from './util.js';
import { transfer } from './bank.js';
import { tradeablePropBlocker } from './legal.js';

export const MAX_PENDING_TRADES_PER_PLAYER = 3;

function normalizeSide(side = {}) {
  const props = Array.isArray(side.props) ? [...new Set(side.props.map(Number))] : [];
  return {
    money: Math.max(0, Math.floor(Number(side.money) || 0)),
    props: props.filter((n) => Number.isInteger(n)),
    cards: Math.max(0, Math.floor(Number(side.cards) || 0)),
  };
}

function validateSide(state, ownerId, side) {
  const owner = getPlayer(state, ownerId);
  if (!owner || owner.bankrupt) fail('player_bankrupt');
  if (side.money > owner.money) fail('trade_insufficient_funds', { player: ownerId });
  if (side.cards > owner.jailCards.length) fail('trade_missing_cards', { player: ownerId });
  for (const pos of side.props) {
    const reason = tradeablePropBlocker(state, ownerId, pos);
    if (reason) fail(reason === 'not_owner' ? 'trade_prop_not_owned' : reason, { pos });
  }
}

function isEmpty(side) {
  return side.money === 0 && side.props.length === 0 && side.cards === 0;
}

export function proposeTrade(state, fromId, offer, ctx) {
  requirePlayer(state, fromId);
  const toId = offer && offer.to;
  if (!toId || toId === fromId) fail('invalid_trade_partner');
  requirePlayer(state, toId);
  const give = normalizeSide(offer.give);
  const get = normalizeSide(offer.get);
  if (isEmpty(give) && isEmpty(get)) fail('empty_trade');
  validateSide(state, fromId, give);
  validateSide(state, toId, get);
  const pending = state.trades.filter((t) => t.status === 'pending' && t.from === fromId).length;
  if (pending >= MAX_PENDING_TRADES_PER_PLAYER) fail('too_many_trades');
  const trade = {
    id: nextId(state), from: fromId, to: toId, give, get, status: 'pending',
    createdAt: ctx.now, counterOf: offer.counterOf || null,
  };
  state.trades.push(trade);
  log(state, ctx, 'trade_proposed', { player: fromId, to: toId, tradeId: trade.id });
  emit(ctx, { type: 'trade', tradeId: trade.id, from: fromId, to: toId });
  return trade;
}

function findPending(state, tradeId) {
  const t = state.trades.find((x) => x.id === Number(tradeId) && x.status === 'pending');
  if (!t) fail('trade_not_found');
  return t;
}

function moveSide(state, fromId, toId, side, ctx) {
  const from = getPlayer(state, fromId);
  const to = getPlayer(state, toId);
  if (side.money) transfer(state, fromId, toId, side.money, ctx, 'trade');
  for (const pos of side.props) {
    state.props[pos].owner = toId;
    if (state.props[pos].mortgaged) {
      // Interés del 10%: el receptor decide pagar solo el 10% o levantar la hipoteca.
      state.mortgageDecisions.push({ playerId: toId, pos, interest: mortgageInterest(pos) });
    }
  }
  for (let i = 0; i < side.cards; i += 1) to.jailCards.push(from.jailCards.pop());
}

export function acceptTrade(state, pid, tradeId, ctx) {
  requirePlayer(state, pid);
  const t = findPending(state, tradeId);
  if (t.to !== pid) fail('not_trade_recipient');
  validateSide(state, t.from, t.give);
  validateSide(state, t.to, t.get);
  moveSide(state, t.from, t.to, t.give, ctx);
  moveSide(state, t.to, t.from, t.get, ctx);
  t.status = 'accepted';
  state.trades = state.trades.filter((x) => x.status === 'pending');
  // Otros tratos que involucraban estas propiedades quedan inválidos.
  const moved = new Set([...t.give.props, ...t.get.props]);
  state.trades = state.trades.filter((x) => ![...x.give.props, ...x.get.props].some((pos) => moved.has(pos)));
  log(state, ctx, 'trade_accepted', {
    player: pid, from: t.from, give: t.give, get: t.get, tradeId: t.id,
  });
  emit(ctx, { type: 'tradeDone', tradeId: t.id });
}

export function rejectTrade(state, pid, tradeId, ctx) {
  const t = findPending(state, tradeId);
  if (t.to !== pid && t.from !== pid) fail('not_trade_party');
  t.status = t.from === pid ? 'cancelled' : 'rejected';
  state.trades = state.trades.filter((x) => x.status === 'pending');
  log(state, ctx, t.status === 'cancelled' ? 'trade_cancelled' : 'trade_rejected', { player: pid, tradeId: t.id });
}

/** Contraoferta: rechaza la original y propone una nueva al proponente. */
export function counterTrade(state, pid, tradeId, offer, ctx) {
  const t = findPending(state, tradeId);
  if (t.to !== pid) fail('not_trade_recipient');
  const snapshot = state.trades.slice();
  t.status = 'countered';
  state.trades = state.trades.filter((x) => x.status === 'pending');
  try {
    return proposeTrade(state, pid, { ...offer, to: t.from, counterOf: t.id }, ctx);
  } catch (e) {
    t.status = 'pending';
    state.trades = snapshot;
    throw e;
  }
}

/** Cancela tratos de/para un jugador (desconexión, bancarrota, expulsión). */
export function cancelTradesFor(state, pid, ctx) {
  const before = state.trades.length;
  state.trades = state.trades.filter((t) => t.from !== pid && t.to !== pid);
  if (state.trades.length !== before) log(state, ctx, 'trades_cancelled_disconnect', { player: pid });
}

/** Valor aproximado de un lado del trato (lo usan los bots). */
export function sideValue(state, side) {
  let v = side.money + side.cards * 50;
  for (const pos of side.props) {
    const sp = SPACES[pos];
    v += state.props[pos].mortgaged ? sp.price - sp.mortgage - Math.ceil(sp.mortgage / 10) : sp.price;
  }
  return v;
}
