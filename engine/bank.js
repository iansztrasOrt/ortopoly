// Dinero, deudas y bancarrota.
// Acreedores: id de jugador, null (= banco) o 'pot' (= bote del estacionamiento,
// solo con la regla de la casa activa; se comporta como el banco en bancarrotas).

import { SPACES, HOTEL_LEVEL, OWNABLE, groupMembers } from './board.js';
import { JAIL_FREE_CARD } from './cards.js';
import { getPlayer, activePlayers, log, emit, fail, nextId } from './util.js';

export const POT = 'pot';

const FINE_REASONS = new Set(['tax', 'card', 'jail_fine', 'repairs', 'interest']);

/** A quién se le paga cuando el destinatario es "el banco". */
export function bankCreditor(state, reason) {
  if (state.settings.houseRules.freeParkingPot && FINE_REASONS.has(reason)) return POT;
  return null;
}

function bumpMax(p) {
  if (p.money > p.stats.maxMoney) p.stats.maxMoney = p.money;
}

export function credit(state, pid, amount, ctx, reason) {
  if (amount <= 0) return;
  const p = getPlayer(state, pid);
  p.money += amount;
  bumpMax(p);
  emit(ctx, { type: 'money', playerId: pid, delta: amount, reason });
}

export function debit(state, pid, amount, ctx, reason) {
  if (amount <= 0) return;
  const p = getPlayer(state, pid);
  p.money -= amount;
  emit(ctx, { type: 'money', playerId: pid, delta: -amount, reason });
}

/** Transferencia directa sin validaciones (las hace quien llama). */
export function transfer(state, fromId, toId, amount, ctx, reason) {
  if (amount <= 0) return;
  if (fromId !== null && fromId !== POT) debit(state, fromId, amount, ctx, reason);
  if (fromId === POT) state.pot -= amount;
  if (toId === POT) {
    state.pot += amount;
    emit(ctx, { type: 'pot', delta: amount });
  } else if (toId !== null) {
    credit(state, toId, amount, ctx, reason);
  }
  if (reason === 'rent' && fromId && toId && toId !== POT) {
    getPlayer(state, fromId).stats.rentPaid += amount;
    getPlayer(state, toId).stats.rentCollected += amount;
  }
}

export function hasPendingDebt(state, pid) {
  return state.debts.some((d) => d.debtorId === pid);
}

/**
 * Cobra `amount` al deudor. Si tiene efectivo (y no tiene otras deudas en cola)
 * paga en el acto; si no, se encola una deuda que bloquea el avance del juego
 * hasta que la pague o se declare en bancarrota.
 */
export function charge(state, debtorId, creditorId, amount, ctx, reason) {
  if (amount <= 0) return true;
  const p = getPlayer(state, debtorId);
  if (!hasPendingDebt(state, debtorId) && p.money >= amount) {
    transfer(state, debtorId, creditorId, amount, ctx, reason);
    return true;
  }
  const debt = { id: nextId(state), debtorId, creditorId, amount, reason, createdAt: ctx.now };
  state.debts.push(debt);
  log(state, ctx, 'debt_created', { player: debtorId, creditor: creditorId, amount, reason });
  emit(ctx, { type: 'debt', playerId: debtorId, amount });
  return false;
}

export function payDebt(state, pid, ctx) {
  const debt = state.debts[0];
  if (!debt || debt.debtorId !== pid) fail('no_debt_to_pay');
  const p = getPlayer(state, pid);
  if (p.money < debt.amount) fail('insufficient_funds', { needed: debt.amount - p.money });
  state.debts.shift();
  transfer(state, pid, debt.creditorId, debt.amount, ctx, debt.reason);
  log(state, ctx, 'debt_paid', { player: pid, creditor: debt.creditorId, amount: debt.amount, reason: debt.reason });
}

/** Valor de reventa (mitad del costo) de los edificios de un solar. */
export function buildingSaleValue(pos, level) {
  return level * (SPACES[pos].houseCost / 2);
}

export function countBuildings(state, pid) {
  let houses = 0;
  let hotels = 0;
  for (const pos of OWNABLE) {
    const pr = state.props[pos];
    if (pr.owner !== pid) continue;
    if (pr.level === HOTEL_LEVEL) hotels += 1;
    else houses += pr.level;
  }
  return { houses, hotels };
}

export function ownedBy(state, pid) {
  return OWNABLE.filter((pos) => state.props[pos].owner === pid);
}

export function netWorth(state, pid) {
  const p = getPlayer(state, pid);
  let total = p.money;
  for (const pos of ownedBy(state, pid)) {
    const sp = SPACES[pos];
    const pr = state.props[pos];
    total += pr.mortgaged ? sp.price - sp.mortgage : sp.price;
    if (pr.level > 0) total += pr.level * sp.houseCost;
  }
  return total;
}

/** Dinero que se podría juntar vendiendo todo e hipotecando todo. */
export function liquidationValue(state, pid) {
  const p = getPlayer(state, pid);
  let total = p.money;
  for (const pos of ownedBy(state, pid)) {
    const pr = state.props[pos];
    total += buildingSaleValue(pos, pr.level);
    if (!pr.mortgaged) total += SPACES[pos].mortgage;
  }
  return total;
}

/**
 * Declarar bancarrota.
 * - Ante un jugador: los edificios se venden al banco (mitad), y TODO pasa al
 *   acreedor: dinero, propiedades (hipotecadas incluidas; el acreedor deberá
 *   pagar el 10% o levantar la hipoteca) y cartas de "salir de la cárcel".
 * - Ante el banco: los edificios vuelven al banco, las propiedades quedan libres
 *   (sin hipoteca) y se subastan una por una; las cartas vuelven a su mazo.
 */
export function bankruptPlayer(state, pid, ctx, hooks, { forced = false } = {}) {
  const p = getPlayer(state, pid);
  if (!p || p.bankrupt) fail('player_bankrupt');
  const debt = state.debts.find((d) => d.debtorId === pid);
  if (!forced) {
    if (!debt || state.debts[0].debtorId !== pid) fail('no_debt_to_pay');
    if (p.money >= debt.amount) fail('can_pay_debt');
  }
  let creditor = null;
  if (debt && debt.creditorId && debt.creditorId !== POT) {
    const c = getPlayer(state, debt.creditorId);
    if (c && !c.bankrupt) creditor = c;
  }

  // 1) Liquidar edificios al banco.
  for (const pos of ownedBy(state, pid)) {
    const pr = state.props[pos];
    if (pr.level > 0) {
      if (pr.level === HOTEL_LEVEL) state.bank.hotels += 1;
      else state.bank.houses += pr.level;
      p.money += buildingSaleValue(pos, pr.level);
      pr.level = 0;
    }
  }

  const owned = ownedBy(state, pid);
  if (creditor) {
    if (p.money > 0) transfer(state, pid, creditor.id, p.money, ctx, 'bankruptcy');
    for (const pos of owned) {
      state.props[pos].owner = creditor.id;
      if (state.props[pos].mortgaged) state.mortgageDecisions.push({ playerId: creditor.id, pos });
    }
    creditor.jailCards.push(...p.jailCards);
    log(state, ctx, 'bankrupt_to_player', { player: pid, creditor: creditor.id, props: owned });
  } else {
    if (p.money > 0) debit(state, pid, p.money, ctx, 'bankruptcy');
    for (const pos of owned) {
      state.props[pos] = { owner: null, level: 0, mortgaged: false };
      state.auctionQueue.push(pos);
    }
    for (const deck of p.jailCards) state.decks[deck].push(JAIL_FREE_CARD[deck]);
    log(state, ctx, 'bankrupt_to_bank', { player: pid, props: owned });
  }
  p.jailCards = [];
  p.money = 0;
  p.bankrupt = true;
  p.inJail = false;
  state.bankruptCount = (state.bankruptCount || 0) + 1;
  p.bankruptOrder = state.bankruptCount;

  // 2) Limpiar todo lo pendiente del jugador eliminado.
  state.debts = state.debts.filter((d) => d.debtorId !== pid);
  for (const d of state.debts) if (d.creditorId === pid) d.creditorId = null;
  state.mortgageDecisions = state.mortgageDecisions.filter((d) => d.playerId !== pid);
  for (const t of state.trades) {
    if (t.status === 'pending' && (t.from === pid || t.to === pid)) t.status = 'cancelled';
  }
  state.trades = state.trades.filter((t) => t.status === 'pending');
  if (state.auction) {
    state.auction.active = state.auction.active.filter((id) => id !== pid);
    if (state.auction.highBidder === pid) {
      state.auction.highBidder = null;
      state.auction.highBid = 0;
    }
  }
  emit(ctx, { type: 'bankrupt', playerId: pid });

  // 3) Turno / fin de partida / subastas pendientes.
  if (hooks.checkGameOver(state, ctx)) return;
  if (state.turn.playerId === pid) hooks.nextTurn(state, ctx);
  if (state.auction) hooks.checkAuction(state, ctx);
  hooks.startNextAuction(state, ctx);
}

export function remainingPlayers(state) {
  return activePlayers(state).length;
}

export function groupLevels(state, group) {
  return groupMembers(group).map((pos) => state.props[pos].level);
}
