// Subastas en tiempo real (propiedades y, por escasez, casas).
// Reglas: la puja debe superar la más alta (incremento mínimo $1). Ante dos
// pujas iguales gana la que llegó primero (el servidor serializa: la segunda
// se rechaza). Quien va ganando no puede retirarse. Termina cuando:
//   - solo queda activo quien va ganando, o
//   - nadie queda activo (sin venta), o
//   - vence el temporizador (gana la puja más alta, si la hay).

import { SPACES } from './board.js';
import {
  fail, getPlayer, requirePlayer, activePlayers, log, emit, nextId,
} from './util.js';
import { charge, debit } from './bank.js';
import { buildBlocker } from './legal.js';
import { finishLanding, placeBuilding, autoBuildLot } from './rules.js';

export const AUCTION_START_MS = 20000;
export const AUCTION_BID_MS = 10000;

export function startAuction(state, ctx, { kind = 'property', pos, source, requester = null, participants = null, minBid = 1 }) {
  const active = participants || activePlayers(state).map((p) => p.id);
  state.auction = {
    id: nextId(state),
    kind,
    pos,
    source,
    requester,
    minBid,
    highBid: 0,
    highBidder: null,
    active: [...active],
    participants: [...active],
    bids: [],
    startedAt: ctx.now,
    endsAt: ctx.now + AUCTION_START_MS,
  };
  log(state, ctx, kind === 'house' ? 'house_auction_start' : 'auction_start', { pos, requester, minBid });
  emit(ctx, { type: 'auction', pos, kind });
  checkAuction(state, ctx);
}

export function startHouseAuction(state, ctx, { requester, pos, participants }) {
  startAuction(state, ctx, {
    kind: 'house', pos, source: 'house', requester, participants, minBid: SPACES[pos].houseCost,
  });
}

export function placeBid(state, pid, amount, ctx) {
  const a = state.auction;
  if (!a) fail('no_auction');
  const p = requirePlayer(state, pid);
  if (!a.active.includes(pid)) fail('not_in_auction');
  if (!Number.isInteger(amount) || amount <= 0) fail('invalid_amount');
  if (amount < a.minBid) fail('bid_below_minimum', { min: a.minBid });
  if (amount <= a.highBid) fail('bid_too_low', { min: a.highBid + 1 });
  if (amount > p.money) fail('insufficient_funds');
  a.highBid = amount;
  a.highBidder = pid;
  a.bids.push({ playerId: pid, amount, t: ctx.now });
  if (a.bids.length > 60) a.bids.shift();
  a.endsAt = Math.max(a.endsAt, ctx.now + AUCTION_BID_MS);
  log(state, ctx, 'bid', { player: pid, amount, pos: a.pos });
  emit(ctx, { type: 'bid', playerId: pid, amount });
  checkAuction(state, ctx);
}

export function withdrawFromAuction(state, pid, ctx, { silent = false } = {}) {
  const a = state.auction;
  if (!a) fail('no_auction');
  if (!a.active.includes(pid)) fail('not_in_auction');
  if (a.highBidder === pid) fail('high_bidder_cannot_withdraw');
  a.active = a.active.filter((id) => id !== pid);
  if (!silent) log(state, ctx, 'auction_withdraw', { player: pid });
  checkAuction(state, ctx);
}

/** Cierra la subasta si se cumplen las condiciones de fin por retiros. */
export function checkAuction(state, ctx) {
  const a = state.auction;
  if (!a) return;
  a.active = a.active.filter((id) => {
    const p = getPlayer(state, id);
    return p && !p.bankrupt;
  });
  if (a.active.length === 0) closeAuction(state, ctx);
  else if (a.active.length === 1 && a.active[0] === a.highBidder) closeAuction(state, ctx);
}

export function tickAuction(state, ctx) {
  if (state.auction && ctx.now >= state.auction.endsAt) closeAuction(state, ctx);
}

export function closeAuction(state, ctx) {
  const a = state.auction;
  if (!a) return;
  state.auction = null;
  const winner = a.highBidder ? getPlayer(state, a.highBidder) : null;
  if (a.kind === 'property') {
    if (winner && !winner.bankrupt && state.props[a.pos].owner === null) {
      state.props[a.pos].owner = winner.id;
      winner.stats.auctionsWon += 1;
      winner.stats.propertiesBought += 1;
      log(state, ctx, 'auction_won', { player: winner.id, pos: a.pos, amount: a.highBid });
      emit(ctx, { type: 'bought', playerId: winner.id, pos: a.pos });
      charge(state, winner.id, null, a.highBid, ctx, 'auction');
    } else {
      log(state, ctx, 'auction_no_sale', { pos: a.pos });
    }
  } else if (a.kind === 'house') {
    let lot = null;
    if (winner && !winner.bankrupt && state.bank.houses > 0) {
      if (winner.id === a.requester && !buildBlocker(state, winner.id, a.pos, { ignoreTurn: true, ignoreFunds: true })) lot = a.pos;
      else lot = autoBuildLot(state, winner.id);
    }
    if (lot !== null && winner.money >= a.highBid) {
      debit(state, winner.id, a.highBid, ctx, 'auction');
      placeBuilding(state, lot);
      winner.stats.auctionsWon += 1;
      log(state, ctx, 'house_auction_won', { player: winner.id, pos: lot, amount: a.highBid });
      emit(ctx, { type: 'build', playerId: winner.id, pos: lot, level: state.props[lot].level });
    } else {
      log(state, ctx, 'auction_no_sale', { pos: a.pos, kind: 'house' });
    }
  }
  emit(ctx, { type: 'auctionEnd', pos: a.pos, winner: winner ? winner.id : null, amount: a.highBid });
  if (a.source === 'decline' && state.turn.phase === 'auction') finishLanding(state);
  startNextAuction(state, ctx);
}

/** Subasta de la siguiente propiedad que dejó una bancarrota ante el banco. */
export function startNextAuction(state, ctx) {
  if (state.phase !== 'playing' || state.auction) return;
  while (state.auctionQueue.length) {
    const pos = state.auctionQueue.shift();
    if (state.props[pos].owner === null) {
      startAuction(state, ctx, { kind: 'property', pos, source: 'bankruptcy' });
      return;
    }
  }
}
