// Reglas del juego: movimiento, casillas, cartas, cárcel, turnos, construcción
// e hipotecas. Todas las funciones mutan `state` (JSON plano) y validan antes
// de mutar; ante una acción ilegal lanzan RuleError.

import {
  SPACES, BOARD_SIZE, GO_SALARY, JAIL_POS, JAIL_FINE, MAX_JAIL_TURNS, HOTEL_LEVEL,
  RAILROAD_RENT, UTILITY_MULTIPLIER, RAILROADS, UTILITIES, OWNABLE,
  groupMembers, nextOfType, forwardDistance, unmortgageCost, mortgageInterest,
} from './board.js';
import { cardById, JAIL_FREE_CARD } from './cards.js';
import { rollDice } from './rng.js';
import {
  fail, getPlayer, requirePlayer, activePlayers, log, emit,
} from './util.js';
import {
  credit, debit, charge, bankCreditor, countBuildings, netWorth, buildingSaleValue,
  hasPendingDebt, payDebt as bankPayDebt, bankruptPlayer,
} from './bank.js';
import {
  buildBlocker, sellBlocker, mortgageBlocker, unmortgageBlocker, blockingReason,
  ownsFullGroup, groupHasMortgage, groupLevels,
} from './legal.js';
import { startAuction, startHouseAuction, startNextAuction, checkAuction } from './auction.js';

export const HOUSE_SCARCITY_THRESHOLD = 3;

// ---------------------------------------------------------------- alquileres

export function computeRent(state, pos, { diceTotal = 0, railroadMultiplier = 1, utilityForceTen = false } = {}) {
  const sp = SPACES[pos];
  const pr = state.props[pos];
  if (!pr || pr.owner === null || pr.mortgaged) return 0;
  if (sp.type === 'street') {
    if (pr.level === 0) {
      const monopoly = ownsFullGroup(state, pr.owner, sp.group) && !groupHasMortgage(state, sp.group);
      return monopoly ? sp.rent[0] * 2 : sp.rent[0];
    }
    return sp.rent[pr.level];
  }
  if (sp.type === 'railroad') {
    const count = RAILROADS.filter((r) => state.props[r].owner === pr.owner).length;
    return RAILROAD_RENT[count] * railroadMultiplier;
  }
  if (sp.type === 'utility') {
    if (utilityForceTen) return 10 * diceTotal;
    const count = UTILITIES.filter((u) => state.props[u].owner === pr.owner).length;
    return UTILITY_MULTIPLIER[count] * diceTotal;
  }
  return 0;
}

// ---------------------------------------------------------------- movimiento

function passGo(state, p, ctx) {
  credit(state, p.id, GO_SALARY, ctx, 'go');
  p.stats.passedGo += 1;
  log(state, ctx, 'pass_go', { player: p.id, amount: GO_SALARY });
}

/** Mueve `steps` casillas (negativo = retroceder, sin cobrar Salida). */
export function movePlayer(state, pid, steps, ctx) {
  const p = getPlayer(state, pid);
  const from = p.position;
  const to = (((from + steps) % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
  p.position = to;
  emit(ctx, { type: 'move', playerId: pid, from, to, steps });
  if (steps > 0 && from + steps >= BOARD_SIZE) passGo(state, p, ctx);
  return to;
}

export function advanceTo(state, pid, target, ctx) {
  const p = getPlayer(state, pid);
  const steps = forwardDistance(p.position, target) || BOARD_SIZE;
  return movePlayer(state, pid, steps, ctx);
}

export function sendToJail(state, pid, ctx, reason = 'space') {
  const p = getPlayer(state, pid);
  const from = p.position;
  p.position = JAIL_POS;
  p.inJail = true;
  p.jailTurns = 0;
  p.stats.timesJailed += 1;
  emit(ctx, { type: 'move', playerId: pid, from, to: JAIL_POS, steps: 0, direct: true });
  emit(ctx, { type: 'jail', playerId: pid });
  if (state.turn.playerId === pid) {
    state.turn.extraRoll = false;
  }
  log(state, ctx, 'go_to_jail', { player: pid, reason });
}

// ---------------------------------------------------------------- casillas

export function resolveLanding(state, pid, ctx, opts = {}) {
  const p = getPlayer(state, pid);
  const sp = SPACES[p.position];
  const rules = state.settings.houseRules;
  switch (sp.type) {
    case 'go':
      if (rules.doubleGo) {
        credit(state, pid, GO_SALARY, ctx, 'go_bonus');
        log(state, ctx, 'go_bonus', { player: pid, amount: GO_SALARY });
      }
      break;
    case 'street':
    case 'railroad':
    case 'utility': {
      const pr = state.props[sp.pos];
      if (pr.owner === null) {
        state.turn.phase = 'buy';
        state.turn.pendingBuy = sp.pos;
        log(state, ctx, 'may_buy', { player: pid, pos: sp.pos, price: sp.price });
        return;
      }
      if (pr.owner === pid) {
        log(state, ctx, 'own_property', { player: pid, pos: sp.pos });
        break;
      }
      if (pr.mortgaged) {
        log(state, ctx, 'mortgaged_no_rent', { player: pid, pos: sp.pos });
        break;
      }
      const owner = getPlayer(state, pr.owner);
      if (rules.noRentInJail && owner.inJail) {
        log(state, ctx, 'owner_in_jail_no_rent', { player: pid, owner: owner.id, pos: sp.pos });
        break;
      }
      let diceTotal = state.turn.dice ? state.turn.dice[0] + state.turn.dice[1] : 0;
      if (sp.type === 'utility' && opts.utilityTen) {
        const dice = rollDice(ctx.rng);
        diceTotal = dice[0] + dice[1];
        emit(ctx, { type: 'dice', playerId: pid, dice, purpose: 'utility' });
        log(state, ctx, 'utility_roll', { player: pid, dice });
      }
      const rent = computeRent(state, sp.pos, {
        diceTotal,
        railroadMultiplier: opts.railroadDouble ? 2 : 1,
        utilityForceTen: Boolean(opts.utilityTen),
      });
      log(state, ctx, 'pay_rent', { player: pid, owner: owner.id, pos: sp.pos, amount: rent });
      charge(state, pid, owner.id, rent, ctx, 'rent');
      break;
    }
    case 'tax':
      log(state, ctx, 'pay_tax', { player: pid, pos: sp.pos, amount: sp.amount });
      charge(state, pid, bankCreditor(state, 'tax'), sp.amount, ctx, 'tax');
      break;
    case 'chance':
    case 'community':
      drawCard(state, pid, sp.type, ctx);
      break;
    case 'gotojail':
      sendToJail(state, pid, ctx, 'space');
      break;
    case 'parking':
      if (rules.freeParkingPot && state.pot > 0) {
        const amount = state.pot;
        state.pot = 0;
        credit(state, pid, amount, ctx, 'pot');
        emit(ctx, { type: 'pot', delta: -amount });
        log(state, ctx, 'collect_pot', { player: pid, amount });
      } else {
        log(state, ctx, 'free_parking', { player: pid });
      }
      break;
    case 'jail':
      log(state, ctx, 'just_visiting', { player: pid });
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- cartas

export function drawCard(state, pid, deck, ctx) {
  const pile = state.decks[deck];
  const id = pile.shift();
  const card = cardById(id);
  if (card.action !== 'jailFree') pile.push(id);
  getPlayer(state, pid).stats.cardsDrawn += 1;
  emit(ctx, { type: 'card', playerId: pid, deck, cardId: id });
  log(state, ctx, 'card_drawn', { player: pid, deck, card: id });
  applyCard(state, pid, card, deck, ctx);
}

export function applyCard(state, pid, card, deck, ctx) {
  const p = getPlayer(state, pid);
  switch (card.action) {
    case 'moveTo':
      advanceTo(state, pid, card.target, ctx);
      resolveLanding(state, pid, ctx);
      break;
    case 'moveBy':
      movePlayer(state, pid, card.steps, ctx);
      resolveLanding(state, pid, ctx);
      break;
    case 'nearestUtility':
      advanceTo(state, pid, nextOfType(p.position, UTILITIES), ctx);
      resolveLanding(state, pid, ctx, { utilityTen: true });
      break;
    case 'nearestRailroad':
      advanceTo(state, pid, nextOfType(p.position, RAILROADS), ctx);
      resolveLanding(state, pid, ctx, { railroadDouble: true });
      break;
    case 'collect':
      credit(state, pid, card.amount, ctx, 'card');
      break;
    case 'pay':
      charge(state, pid, bankCreditor(state, 'card'), card.amount, ctx, 'card');
      break;
    case 'jailFree':
      p.jailCards.push(deck);
      break;
    case 'goToJail':
      sendToJail(state, pid, ctx, 'card');
      break;
    case 'repairs': {
      const { houses, hotels } = countBuildings(state, pid);
      const amount = houses * card.house + hotels * card.hotel;
      log(state, ctx, 'repairs', { player: pid, houses, hotels, amount });
      charge(state, pid, bankCreditor(state, 'repairs'), amount, ctx, 'repairs');
      break;
    }
    case 'payEach':
      for (const other of activePlayers(state)) {
        if (other.id !== pid) charge(state, pid, other.id, card.amount, ctx, 'card');
      }
      break;
    case 'collectEach':
      for (const other of activePlayers(state)) {
        if (other.id !== pid) charge(state, other.id, pid, card.amount, ctx, 'card');
      }
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- turnos

export function finishLanding(state) {
  const p = getPlayer(state, state.turn.playerId);
  state.turn.pendingBuy = null;
  state.turn.phase = state.turn.extraRoll && p && !p.inJail && !p.bankrupt ? 'roll' : 'end';
}

export function nextTurn(state, ctx) {
  if (state.phase !== 'playing') return;
  const order = state.order;
  const idx = order.indexOf(state.turn.playerId);
  let next = null;
  for (let i = 1; i <= order.length; i += 1) {
    const cand = getPlayer(state, order[(idx + i) % order.length]);
    if (cand && !cand.bankrupt) {
      next = cand;
      break;
    }
  }
  if (!next) return;
  const timer = state.settings.turnTimer || 0;
  state.turn = {
    number: (state.turn.number || 0) + 1,
    playerId: next.id,
    phase: 'roll',
    dice: null,
    doubles: 0,
    extraRoll: false,
    pendingBuy: null,
    startedAt: ctx.now,
    deadline: timer ? ctx.now + timer * 1000 : null,
    autopilot: false,
  };
  next.stats.turns += 1;
  log(state, ctx, 'turn_start', { player: next.id });
  emit(ctx, { type: 'turn', playerId: next.id });
}

export function computeRanking(state) {
  const alive = activePlayers(state)
    .map((p) => ({ id: p.id, worth: netWorth(state, p.id) }))
    .sort((a, b) => b.worth - a.worth)
    .map((x) => x.id);
  const dead = state.players
    .filter((p) => p.bankrupt)
    .sort((a, b) => b.bankruptOrder - a.bankruptOrder)
    .map((p) => p.id);
  return [...alive, ...dead];
}

export function endGame(state, ctx, reason) {
  state.phase = 'ended';
  state.auction = null;
  state.auctionQueue = [];
  state.ranking = computeRanking(state);
  state.finalWorth = Object.fromEntries(state.players.map((p) => [p.id, netWorth(state, p.id)]));
  state.winner = state.ranking[0];
  state.endedAt = ctx.now;
  log(state, ctx, 'game_over', { winner: state.winner, reason });
  emit(ctx, { type: 'gameOver', winner: state.winner });
}

export function checkGameOver(state, ctx) {
  if (state.phase !== 'playing') return true;
  if (activePlayers(state).length <= 1) {
    endGame(state, ctx, 'last_player');
    return true;
  }
  return false;
}

export const bankruptcyHooks = { checkGameOver, nextTurn, startNextAuction, checkAuction };

// ---------------------------------------------------------------- acciones de turno

function assertTurn(state, pid) {
  requirePlayer(state, pid);
  if (state.turn.playerId !== pid) fail('not_your_turn');
}

function assertUnblocked(state) {
  const reason = blockingReason(state);
  if (reason) fail(reason);
}

export function actRoll(state, pid, ctx) {
  assertTurn(state, pid);
  assertUnblocked(state);
  if (state.turn.phase !== 'roll') fail('cannot_roll_now');
  const p = getPlayer(state, pid);
  const dice = rollDice(ctx.rng);
  const isDouble = dice[0] === dice[1];
  const total = dice[0] + dice[1];
  state.turn.dice = dice;
  emit(ctx, { type: 'dice', playerId: pid, dice, purpose: 'move' });
  log(state, ctx, 'rolled', { player: pid, dice, double: isDouble });
  if (isDouble) p.stats.doubles += 1;

  if (p.inJail) {
    state.turn.extraRoll = false;
    if (isDouble) {
      p.inJail = false;
      p.jailTurns = 0;
      log(state, ctx, 'jail_doubles_out', { player: pid });
    } else {
      p.jailTurns += 1;
      if (p.jailTurns < MAX_JAIL_TURNS) {
        log(state, ctx, 'jail_stay', { player: pid, attempt: p.jailTurns });
        state.turn.phase = 'end';
        return;
      }
      p.inJail = false;
      p.jailTurns = 0;
      log(state, ctx, 'jail_forced_fine', { player: pid, amount: JAIL_FINE });
      charge(state, pid, bankCreditor(state, 'jail_fine'), JAIL_FINE, ctx, 'jail_fine');
    }
  } else if (isDouble) {
    state.turn.doubles += 1;
    if (state.turn.doubles >= 3) {
      log(state, ctx, 'three_doubles', { player: pid });
      sendToJail(state, pid, ctx, 'doubles');
      state.turn.phase = 'end';
      return;
    }
    state.turn.extraRoll = true;
  } else {
    state.turn.extraRoll = false;
  }

  state.turn.phase = 'resolving';
  movePlayer(state, pid, total, ctx);
  resolveLanding(state, pid, ctx);
  if (state.turn.phase === 'resolving') finishLanding(state);
}

export function actPayBail(state, pid, ctx) {
  assertTurn(state, pid);
  assertUnblocked(state);
  const p = getPlayer(state, pid);
  if (!p.inJail) fail('not_in_jail');
  if (state.turn.phase !== 'roll') fail('only_before_rolling');
  if (p.money < JAIL_FINE) fail('insufficient_funds');
  charge(state, pid, bankCreditor(state, 'jail_fine'), JAIL_FINE, ctx, 'jail_fine');
  p.inJail = false;
  p.jailTurns = 0;
  log(state, ctx, 'paid_bail', { player: pid, amount: JAIL_FINE });
}

export function actUseJailCard(state, pid, ctx) {
  assertTurn(state, pid);
  assertUnblocked(state);
  const p = getPlayer(state, pid);
  if (!p.inJail) fail('not_in_jail');
  if (state.turn.phase !== 'roll') fail('only_before_rolling');
  if (!p.jailCards.length) fail('no_jail_card');
  const deck = p.jailCards.shift();
  state.decks[deck].push(JAIL_FREE_CARD[deck]);
  p.inJail = false;
  p.jailTurns = 0;
  log(state, ctx, 'used_jail_card', { player: pid, deck });
}

export function actBuy(state, pid, ctx) {
  assertTurn(state, pid);
  assertUnblocked(state);
  if (state.turn.phase !== 'buy') fail('nothing_to_buy');
  const pos = state.turn.pendingBuy;
  const sp = SPACES[pos];
  const p = getPlayer(state, pid);
  if (p.money < sp.price) fail('insufficient_funds');
  debit(state, pid, sp.price, ctx, 'buy');
  state.props[pos].owner = pid;
  p.stats.propertiesBought += 1;
  log(state, ctx, 'bought', { player: pid, pos, price: sp.price });
  emit(ctx, { type: 'bought', playerId: pid, pos });
  finishLanding(state);
}

export function actDecline(state, pid, ctx) {
  assertTurn(state, pid);
  assertUnblocked(state);
  if (state.turn.phase !== 'buy') fail('nothing_to_buy');
  const pos = state.turn.pendingBuy;
  log(state, ctx, 'declined', { player: pid, pos });
  if (state.settings.houseRules.noAuctions) {
    finishLanding(state);
    return;
  }
  state.turn.pendingBuy = null;
  state.turn.phase = 'auction';
  startAuction(state, ctx, { kind: 'property', pos, source: 'decline' });
}

export function actEndTurn(state, pid, ctx) {
  assertTurn(state, pid);
  assertUnblocked(state);
  if (state.turn.phase !== 'end') fail(state.turn.phase === 'roll' ? 'must_roll' : 'cannot_end_now');
  log(state, ctx, 'turn_end', { player: pid });
  nextTurn(state, ctx);
}

// ---------------------------------------------------------------- edificios

/** Coloca una casa/hotel (sin cobrar; quien llama ya validó y cobró). */
export function placeBuilding(state, pos) {
  const pr = state.props[pos];
  if (pr.level === HOTEL_LEVEL - 1) {
    state.bank.hotels -= 1;
    state.bank.houses += HOTEL_LEVEL - 1;
  } else {
    state.bank.houses -= 1;
  }
  pr.level += 1;
}

/** Otros jugadores que podrían comprar una casa ahora mismo (para la subasta por escasez). */
export function eligibleHouseBuyers(state, excludeId) {
  return activePlayers(state)
    .filter((p) => p.id !== excludeId)
    .filter((p) => autoBuildLot(state, p.id) !== null)
    .map((p) => p.id);
}

/** Primer solar donde el jugador puede poner una CASA (no hotel), ignorando el turno. */
export function autoBuildLot(state, pid) {
  const p = getPlayer(state, pid);
  const candidates = OWNABLE
    .filter((pos) => SPACES[pos].type === 'street' && state.props[pos].level < HOTEL_LEVEL - 1)
    .filter((pos) => !buildBlocker(state, pid, pos, { ignoreTurn: true, ignoreFunds: true }))
    .filter((pos) => p.money >= SPACES[pos].houseCost)
    .sort((a, b) => SPACES[b].houseCost - SPACES[a].houseCost);
  return candidates.length ? candidates[0] : null;
}

export function actBuild(state, pid, pos, ctx) {
  requirePlayer(state, pid);
  const reason = buildBlocker(state, pid, pos);
  if (reason) fail(reason);
  if (state.debts.length || state.mortgageDecisions.length) fail(blockingReason(state));
  const sp = SPACES[pos];
  const pr = state.props[pos];
  const isHotel = pr.level === HOTEL_LEVEL - 1;
  if (!isHotel && state.bank.houses <= HOUSE_SCARCITY_THRESHOLD) {
    const others = eligibleHouseBuyers(state, pid);
    if (others.length) {
      startHouseAuction(state, ctx, { requester: pid, pos, participants: [pid, ...others] });
      return;
    }
  }
  debit(state, pid, sp.houseCost, ctx, 'build');
  placeBuilding(state, pos);
  log(state, ctx, isHotel ? 'built_hotel' : 'built_house', { player: pid, pos, cost: sp.houseCost });
  emit(ctx, { type: 'build', playerId: pid, pos, level: pr.level });
}

export function actSellBuilding(state, pid, pos, ctx) {
  requirePlayer(state, pid);
  const reason = sellBlocker(state, pid, pos);
  if (reason) fail(reason);
  const sp = SPACES[pos];
  const pr = state.props[pos];
  const half = sp.houseCost / 2;
  if (pr.level === HOTEL_LEVEL) {
    const housesBack = Math.min(HOTEL_LEVEL - 1, state.bank.houses);
    state.bank.hotels += 1;
    state.bank.houses -= housesBack;
    const units = HOTEL_LEVEL - housesBack; // hotel + casas que no se pudieron reponer
    pr.level = housesBack;
    credit(state, pid, units * half, ctx, 'sell');
    log(state, ctx, 'sold_hotel', { player: pid, pos, amount: units * half, housesLeft: housesBack });
  } else {
    pr.level -= 1;
    state.bank.houses += 1;
    credit(state, pid, half, ctx, 'sell');
    log(state, ctx, 'sold_house', { player: pid, pos, amount: half });
  }
  emit(ctx, { type: 'build', playerId: pid, pos, level: pr.level });
}

// ---------------------------------------------------------------- hipotecas

export function actMortgage(state, pid, pos, ctx) {
  requirePlayer(state, pid);
  const reason = mortgageBlocker(state, pid, pos);
  if (reason) fail(reason);
  state.props[pos].mortgaged = true;
  credit(state, pid, SPACES[pos].mortgage, ctx, 'mortgage');
  log(state, ctx, 'mortgaged', { player: pid, pos, amount: SPACES[pos].mortgage });
}

export function actUnmortgage(state, pid, pos, ctx) {
  requirePlayer(state, pid);
  const reason = unmortgageBlocker(state, pid, pos);
  if (reason) fail(reason);
  const cost = unmortgageCost(pos);
  debit(state, pid, cost, ctx, 'unmortgage');
  state.props[pos].mortgaged = false;
  log(state, ctx, 'unmortgaged', { player: pid, pos, amount: cost });
}

/** Al recibir una propiedad hipotecada: pagar 10% y mantenerla, o levantarla (capital + 10%). */
export function actMortgageDecision(state, pid, pos, lift, ctx) {
  requirePlayer(state, pid);
  const idx = state.mortgageDecisions.findIndex((d) => d.playerId === pid && d.pos === pos);
  if (idx < 0) fail('no_decision_pending');
  const p = getPlayer(state, pid);
  if (lift) {
    const cost = unmortgageCost(pos);
    if (p.money < cost || hasPendingDebt(state, pid)) fail('insufficient_funds');
    state.mortgageDecisions.splice(idx, 1);
    debit(state, pid, cost, ctx, 'unmortgage');
    state.props[pos].mortgaged = false;
    log(state, ctx, 'received_and_lifted', { player: pid, pos, amount: cost });
  } else {
    state.mortgageDecisions.splice(idx, 1);
    const interest = mortgageInterest(pos);
    log(state, ctx, 'paid_interest', { player: pid, pos, amount: interest });
    charge(state, pid, bankCreditor(state, 'interest'), interest, ctx, 'interest');
  }
}

// ---------------------------------------------------------------- deudas

export function actPayDebt(state, pid, ctx) {
  requirePlayer(state, pid);
  bankPayDebt(state, pid, ctx);
}

export function actDeclareBankruptcy(state, pid, ctx) {
  requirePlayer(state, pid);
  bankruptPlayer(state, pid, ctx, bankruptcyHooks);
}

export function forceBankruptcy(state, pid, ctx) {
  bankruptPlayer(state, pid, ctx, bankruptcyHooks, { forced: true });
}

export { buildingSaleValue, groupLevels, groupMembers };
