// Bots simples (y "piloto automático" para turnos vencidos o jugadores ausentes).
// botDecide devuelve UNA acción a aplicar (o null si no tiene nada que hacer).
// - Compran si pueden pagar dejando una reserva.
// - Construyen en grupos completos.
// - Aceptan tratos solo si el valor ofrecido >= valor pedido.

import { SPACES, OWNABLE, HOTEL_LEVEL, groupMembers, unmortgageCost, JAIL_FINE } from './board.js';
import { getPlayer } from './util.js';
import {
  buildBlocker, sellBlocker, mortgageBlocker, unmortgageBlocker, blockingReason, tradeablePropBlocker,
} from './legal.js';
import { sideValue } from './trade.js';

export const BOT_RESERVE = 150;

function owned(state, pid) {
  return OWNABLE.filter((pos) => state.props[pos].owner === pid);
}

/** ¿Comprar esta propiedad completaría (o acercaría) un grupo del bot? */
function groupInterest(state, pid, pos) {
  const sp = SPACES[pos];
  const members = groupMembers(sp.group);
  const mine = members.filter((m) => state.props[m].owner === pid).length;
  const others = members.filter((m) => state.props[m].owner && state.props[m].owner !== pid).length;
  if (mine === members.length - 1) return 1.6;
  if (others === 0 && mine > 0) return 1.25;
  return 1;
}

export function raiseMoneyAction(state, pid) {
  const mine = owned(state, pid);
  const sell = mine
    .filter((pos) => !sellBlocker(state, pid, pos))
    .sort((a, b) => state.props[b].level - state.props[a].level);
  if (sell.length) return { type: 'sell', pos: sell[0] };
  const mort = mine
    .filter((pos) => !mortgageBlocker(state, pid, pos))
    .sort((a, b) => groupInterest(state, pid, a) - groupInterest(state, pid, b) || SPACES[a].mortgage - SPACES[b].mortgage);
  if (mort.length) return { type: 'mortgage', pos: mort[0] };
  return null;
}

function pickBuild(state, pid) {
  const p = getPlayer(state, pid);
  const candidates = owned(state, pid)
    .filter((pos) => SPACES[pos].type === 'street')
    .filter((pos) => !buildBlocker(state, pid, pos))
    .filter((pos) => p.money - SPACES[pos].houseCost >= BOT_RESERVE + 100)
    .sort((a, b) => state.props[a].level - state.props[b].level || SPACES[b].price - SPACES[a].price);
  return candidates.length ? candidates[0] : null;
}

/** Propone comprar la pieza que le falta para completar un grupo (1 vez por turno). */
function pickTradeProposal(state, pid) {
  const p = getPlayer(state, pid);
  if (state.turn.botTradeTried) return null;
  if (state.trades.some((t) => t.from === pid)) return null;
  for (const pos of OWNABLE) {
    const sp = SPACES[pos];
    if (sp.type !== 'street') continue;
    const owner = state.props[pos].owner;
    if (!owner || owner === pid) continue;
    const members = groupMembers(sp.group);
    const missing = members.filter((m) => state.props[m].owner !== pid);
    if (missing.length !== 1 || missing[0] !== pos) continue;
    if (tradeablePropBlocker(state, owner, pos)) continue;
    const offer = Math.ceil(sp.price * 1.5);
    if (p.money - offer < BOT_RESERVE + 100) continue;
    return { type: 'proposeTrade', offer: { to: owner, give: { money: offer }, get: { props: [pos] } } };
  }
  return null;
}

function auctionDecision(state, pid, autopilot) {
  const a = state.auction;
  const p = getPlayer(state, pid);
  if (a.highBidder === pid) return null;
  if (autopilot) return { type: 'withdraw' };
  let cap;
  if (a.kind === 'house') cap = Math.floor(SPACES[a.pos].houseCost * 1.5);
  else cap = Math.floor(SPACES[a.pos].price * groupInterest(state, pid, a.pos));
  cap = Math.min(cap, p.money - Math.floor(BOT_RESERVE / 2));
  const step = a.highBid < 100 ? 10 : 25;
  let next = Math.max(a.minBid, a.highBid + step);
  if (next > cap && cap > a.highBid) next = cap;
  if (next > cap || next <= a.highBid) return { type: 'withdraw' };
  return { type: 'bid', amount: next };
}

export function botDecide(state, pid, { autopilot = false } = {}) {
  const p = getPlayer(state, pid);
  if (!p || p.bankrupt || state.phase !== 'playing') return null;

  // 1) Decisiones de hipoteca recibida.
  const md = state.mortgageDecisions.find((d) => d.playerId === pid);
  if (md) {
    const lift = !autopilot && p.money - unmortgageCost(md.pos) > 500;
    return { type: 'mortgageDecision', pos: md.pos, lift };
  }

  // 2) Deuda activa.
  const head = state.debts[0];
  if (head && head.debtorId === pid) {
    if (p.money >= head.amount) return { type: 'payDebt' };
    return raiseMoneyAction(state, pid) || { type: 'declareBankruptcy' };
  }

  // 3) Tratos recibidos.
  const trade = state.trades.find((t) => t.to === pid && t.status === 'pending');
  if (trade) {
    if (autopilot) return { type: 'rejectTrade', tradeId: trade.id };
    const offered = sideValue(state, trade.give);
    const asked = sideValue(state, trade.get);
    const affordable = trade.get.money <= p.money;
    return { type: offered >= asked && affordable ? 'acceptTrade' : 'rejectTrade', tradeId: trade.id };
  }

  // 4) Subasta.
  if (state.auction && state.auction.active.includes(pid)) return auctionDecision(state, pid, autopilot);

  // 5) Su turno.
  if (state.turn.playerId !== pid || blockingReason(state)) return null;
  const phase = state.turn.phase;
  if (phase === 'roll') {
    if (p.inJail) {
      if (p.jailCards.length) return { type: 'useJailCard' };
      const unowned = OWNABLE.filter((pos) => state.props[pos].owner === null).length;
      if (!autopilot && unowned > 10 && p.money >= JAIL_FINE + BOT_RESERVE) return { type: 'payBail' };
    }
    return { type: 'roll' };
  }
  if (phase === 'buy') {
    const sp = SPACES[state.turn.pendingBuy];
    if (!autopilot && p.money - sp.price >= BOT_RESERVE) return { type: 'buy' };
    return { type: 'decline' };
  }
  if (phase === 'end') {
    if (!autopilot) {
      const lot = pickBuild(state, pid);
      if (lot !== null) return { type: 'build', pos: lot };
      const toLift = owned(state, pid)
        .filter((pos) => !unmortgageBlocker(state, pid, pos))
        .filter((pos) => p.money - unmortgageCost(pos) > 600)
        .sort((a, b) => unmortgageCost(a) - unmortgageCost(b));
      if (toLift.length) return { type: 'unmortgage', pos: toLift[0] };
      const proposal = pickTradeProposal(state, pid);
      if (proposal) {
        state.turn.botTradeTried = true;
        return proposal;
      }
    }
    return { type: 'endTurn' };
  }
  return null;
}

export { HOTEL_LEVEL };
