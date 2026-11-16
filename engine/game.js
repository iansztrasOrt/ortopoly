// Punto de entrada del motor: crear partida, aplicar acciones (atómicas),
// avanzar el reloj (subastas, temporizador), desconexiones y vista para clientes.

import {
  OWNABLE, DEFAULT_HOUSES, DEFAULT_HOTELS,
} from './board.js';
import { buildDeck } from './cards.js';
import { rollDice, shuffle } from './rng.js';
import { RuleError, fail, getPlayer, log, emit } from './util.js';
import * as R from './rules.js';
import {
  placeBid, withdrawFromAuction, tickAuction, startNextAuction,
} from './auction.js';
import {
  proposeTrade, acceptTrade, rejectTrade, counterTrade, cancelTradesFor,
} from './trade.js';
import { netWorth } from './bank.js';
import { botDecide } from './bot.js';

export const DEFAULT_SETTINGS = Object.freeze({
  startingMoney: 1500,
  turnTimer: 0, // 0 | 60 | 90 segundos
  theme: 'puerto',
  houseRules: Object.freeze({
    freeParkingPot: false,
    doubleGo: false,
    noRentInJail: false,
    noAuctions: false,
    shortGame: false,
    bots: false,
  }),
});

export const SHORT_GAME = Object.freeze({ propsPerPlayer: 2, houses: 22, hotels: 8 });
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

export function normalizeSettings(input = {}) {
  const money = Number(input.startingMoney);
  const timer = Number(input.turnTimer);
  const hr = input.houseRules || {};
  return {
    startingMoney: [500, 1000, 1500, 2000, 2500, 3000].includes(money) ? money : DEFAULT_SETTINGS.startingMoney,
    turnTimer: [0, 60, 90].includes(timer) ? timer : 0,
    theme: typeof input.theme === 'string' && /^[a-z0-9-]{1,24}$/.test(input.theme) ? input.theme : DEFAULT_SETTINGS.theme,
    houseRules: Object.fromEntries(
      Object.keys(DEFAULT_SETTINGS.houseRules).map((k) => [k, Boolean(hr[k])]),
    ),
  };
}

/** Orden por tirada de dados, desempatando con nuevas tiradas entre empatados. */
export function rollForOrder(ids, rng, rounds = []) {
  const rolls = ids.map((id) => {
    const dice = rollDice(rng);
    return { id, dice, total: dice[0] + dice[1] };
  });
  rounds.push(rolls);
  const byTotal = new Map();
  for (const r of rolls) {
    if (!byTotal.has(r.total)) byTotal.set(r.total, []);
    byTotal.get(r.total).push(r.id);
  }
  const totals = [...byTotal.keys()].sort((a, b) => b - a);
  const order = [];
  for (const t of totals) {
    const group = byTotal.get(t);
    if (group.length === 1) order.push(group[0]);
    else order.push(...rollForOrder(group, rng, rounds).order);
  }
  return { order, rounds };
}

function newStats() {
  return {
    rentCollected: 0, rentPaid: 0, propertiesBought: 0, turns: 0, passedGo: 0,
    doubles: 0, timesJailed: 0, cardsDrawn: 0, auctionsWon: 0, maxMoney: 0,
  };
}

export function createGame({ players, settings }, ctx) {
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new RuleError('player_count');
  }
  const cfg = normalizeSettings(settings);
  const short = cfg.houseRules.shortGame;
  const state = {
    version: 1,
    phase: 'playing',
    settings: cfg,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      color: p.color,
      isBot: Boolean(p.isBot),
      money: cfg.startingMoney,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      bankrupt: false,
      bankruptOrder: null,
      away: false,
      stats: { ...newStats(), maxMoney: cfg.startingMoney },
    })),
    order: [],
    orderRolls: [],
    turn: { number: 0, playerId: null, phase: 'roll' },
    props: Object.fromEntries(OWNABLE.map((pos) => [pos, { owner: null, level: 0, mortgaged: false }])),
    bank: { houses: short ? SHORT_GAME.houses : DEFAULT_HOUSES, hotels: short ? SHORT_GAME.hotels : DEFAULT_HOTELS },
    decks: { chance: buildDeck('chance', ctx.rng), community: buildDeck('community', ctx.rng) },
    debts: [],
    trades: [],
    auction: null,
    auctionQueue: [],
    mortgageDecisions: [],
    hostDecision: null,
    pot: 0,
    log: [],
    seq: 0,
    logSeq: 0,
    startedAt: ctx.now,
    endedAt: null,
    winner: null,
    ranking: null,
    finalWorth: null,
  };

  const { order, rounds } = rollForOrder(state.players.map((p) => p.id), ctx.rng);
  state.order = order;
  state.orderRolls = rounds;
  log(state, ctx, 'game_start', { order, rounds });

  if (short) {
    const deck = shuffle(OWNABLE, ctx.rng);
    for (const pid of order) {
      for (let i = 0; i < SHORT_GAME.propsPerPlayer; i += 1) {
        const pos = deck.shift();
        state.props[pos].owner = pid;
        log(state, ctx, 'short_game_deal', { player: pid, pos });
      }
    }
  }

  state.turn.playerId = order[order.length - 1];
  R.nextTurn(state, ctx);
  return state;
}

const HANDLERS = {
  roll: (s, pid, a, ctx) => R.actRoll(s, pid, ctx),
  payBail: (s, pid, a, ctx) => R.actPayBail(s, pid, ctx),
  useJailCard: (s, pid, a, ctx) => R.actUseJailCard(s, pid, ctx),
  buy: (s, pid, a, ctx) => R.actBuy(s, pid, ctx),
  decline: (s, pid, a, ctx) => R.actDecline(s, pid, ctx),
  endTurn: (s, pid, a, ctx) => R.actEndTurn(s, pid, ctx),
  build: (s, pid, a, ctx) => R.actBuild(s, pid, posOf(a), ctx),
  sell: (s, pid, a, ctx) => R.actSellBuilding(s, pid, posOf(a), ctx),
  mortgage: (s, pid, a, ctx) => R.actMortgage(s, pid, posOf(a), ctx),
  unmortgage: (s, pid, a, ctx) => R.actUnmortgage(s, pid, posOf(a), ctx),
  mortgageDecision: (s, pid, a, ctx) => R.actMortgageDecision(s, pid, posOf(a), Boolean(a.lift), ctx),
  payDebt: (s, pid, a, ctx) => R.actPayDebt(s, pid, ctx),
  declareBankruptcy: (s, pid, a, ctx) => R.actDeclareBankruptcy(s, pid, ctx),
  bid: (s, pid, a, ctx) => placeBid(s, pid, Number(a.amount), ctx),
  withdraw: (s, pid, a, ctx) => withdrawFromAuction(s, pid, ctx),
  proposeTrade: (s, pid, a, ctx) => { proposeTrade(s, pid, a.offer, ctx); },
  acceptTrade: (s, pid, a, ctx) => acceptTrade(s, pid, a.tradeId, ctx),
  rejectTrade: (s, pid, a, ctx) => rejectTrade(s, pid, a.tradeId, ctx),
  counterTrade: (s, pid, a, ctx) => { counterTrade(s, pid, a.tradeId, a.offer, ctx); },
};

export const ACTION_TYPES = Object.freeze(Object.keys(HANDLERS));

function posOf(action) {
  const pos = Number(action.pos);
  if (!Number.isInteger(pos) || pos < 0 || pos > 39) fail('invalid_position');
  return pos;
}

function restore(state, backup) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, backup);
}

/**
 * Aplica una acción de forma atómica: si es ilegal, el estado queda intacto y
 * se devuelve { ok:false, error }. Las acciones se aplican una por una (el
 * servidor es de un solo hilo), así que dos acciones "simultáneas" se
 * serializan y la segunda se valida contra el estado ya actualizado.
 */
export function applyAction(state, playerId, action, ctx) {
  const handler = action && HANDLERS[action.type];
  if (!handler) return { ok: false, error: 'unknown_action' };
  if (state.phase !== 'playing') return { ok: false, error: 'game_not_running' };
  const backup = structuredClone(state);
  const eventsBefore = ctx.events.length;
  try {
    handler(state, playerId, action, ctx);
    state.version += 1;
    return { ok: true };
  } catch (e) {
    restore(state, backup);
    ctx.events.length = eventsBefore;
    if (e instanceof RuleError) return { ok: false, error: e.code, params: e.params };
    throw e;
  }
}

/** Avanza relojes: subastas vencidas, temporizador de turno, decisiones colgadas. */
export function tick(state, ctx) {
  if (state.phase !== 'playing') return false;
  const v = state.version;
  if (state.auction) {
    tickAuction(state, ctx);
    if (!state.auction && state.version === v) state.version += 1;
  }
  const timer = state.settings.turnTimer;
  if (timer) {
    if (state.auction && state.turn.deadline) {
      state.turn.deadline = Math.max(state.turn.deadline, state.auction.endsAt + 10000);
    }
    if (state.turn.deadline && ctx.now > state.turn.deadline && !state.turn.autopilot) {
      state.turn.autopilot = true;
      log(state, ctx, 'turn_timeout', { player: state.turn.playerId });
      state.version += 1;
    }
    const head = state.debts[0];
    if (head && !head.autopilot && ctx.now - head.createdAt > timer * 1000) {
      head.autopilot = true;
      state.version += 1;
    }
  }
  for (const d of state.mortgageDecisions) {
    if (!d.createdAt) d.createdAt = ctx.now;
  }
  return state.version !== v;
}

/** Jugadores que el servidor debe manejar automáticamente ahora mismo. */
export function autoDriven(state, now) {
  if (state.phase !== 'playing') return [];
  const ids = new Set(state.players.filter((p) => p.isBot && !p.bankrupt).map((p) => p.id));
  const auto = new Map([...ids].map((id) => [id, false]));
  if (state.turn.autopilot) auto.set(state.turn.playerId, true);
  const head = state.debts[0];
  if (head && head.autopilot) auto.set(head.debtorId, true);
  for (const d of state.mortgageDecisions) {
    if (d.createdAt && now - d.createdAt > 45000) auto.set(d.playerId, true);
  }
  for (const p of state.players) {
    if (p.away && !p.bankrupt && !auto.has(p.id)) {
      const mustAnswer = state.mortgageDecisions.some((d) => d.playerId === p.id)
        || (state.auction && state.auction.active.includes(p.id) && state.auction.highBidder !== p.id);
      if (mustAnswer) auto.set(p.id, true);
    }
  }
  return [...auto.entries()].map(([id, autopilot]) => ({ id, autopilot: autopilot && !getPlayer(state, id).isBot }));
}

/** Decide y aplica UNA acción automática para el jugador. */
export function autoStep(state, pid, ctx, { autopilot = false } = {}) {
  const action = botDecide(state, pid, { autopilot });
  if (!action) return null;
  const res = applyAction(state, pid, action, ctx);
  if (!res.ok && action.type !== 'declareBankruptcy') {
    // Plan B para no trabar la partida.
    const fallback = action.type === 'bid' ? { type: 'withdraw' }
      : action.type === 'buy' ? { type: 'decline' }
        : action.type === 'build' || action.type === 'unmortgage' ? { type: 'endTurn' } : null;
    if (fallback) return { action: fallback, ...applyAction(state, pid, fallback, ctx) };
  }
  return { action, ...res };
}

// ---------------------------------------------------------------- desconexión / anfitrión

/** Tras el período de gracia de una desconexión. */
export function onDisconnectTimeout(state, pid, ctx) {
  const p = getPlayer(state, pid);
  if (!p || p.bankrupt || state.phase !== 'playing') return;
  p.away = true;
  const a = state.auction;
  if (a && a.active.includes(pid) && a.highBidder !== pid) {
    withdrawFromAuction(state, pid, ctx, { silent: true });
    log(state, ctx, 'auction_withdraw_disconnect', { player: pid });
  }
  cancelTradesFor(state, pid, ctx);
  if (!p.isBot && state.hostDecision !== pid) state.hostDecision = pid;
  skipTurnIfAway(state, ctx);
  state.version += 1;
}

export function onReconnect(state, pid) {
  const p = getPlayer(state, pid);
  if (!p) return;
  p.away = false;
  if (state.hostDecision === pid) state.hostDecision = null;
  if (state.turn.playerId === pid) state.turn.autopilot = false;
  state.version += 1;
}

/** Si el jugador del turno está ausente, salta su turno (si es posible). */
export function skipTurnIfAway(state, ctx) {
  if (state.phase !== 'playing') return false;
  const p = getPlayer(state, state.turn.playerId);
  if (!p || !p.away || p.isBot) return false;
  if (state.auction) return false;
  if (state.debts.length || state.mortgageDecisions.length) return false;
  if (state.turn.phase === 'buy') {
    applyAction(state, p.id, { type: 'decline' }, ctx);
    return true;
  }
  if (['roll', 'end'].includes(state.turn.phase)) {
    log(state, ctx, 'turn_skipped', { player: p.id });
    R.nextTurn(state, ctx);
    state.version += 1;
    return true;
  }
  return false;
}

export function hostReplaceWithBot(state, pid, ctx) {
  const p = getPlayer(state, pid);
  if (!p || p.bankrupt) return { ok: false, error: 'unknown_player' };
  p.isBot = true;
  p.away = false;
  if (state.hostDecision === pid) state.hostDecision = null;
  log(state, ctx, 'replaced_by_bot', { player: pid });
  state.version += 1;
  return { ok: true };
}

export function hostBankrupt(state, pid, ctx) {
  const p = getPlayer(state, pid);
  if (!p || p.bankrupt) return { ok: false, error: 'unknown_player' };
  const backup = structuredClone(state);
  try {
    if (state.hostDecision === pid) state.hostDecision = null;
    R.forceBankruptcy(state, pid, ctx);
    log(state, ctx, 'host_bankrupt', { player: pid });
    state.version += 1;
    return { ok: true };
  } catch (e) {
    restore(state, backup);
    if (e instanceof RuleError) return { ok: false, error: e.code };
    throw e;
  }
}

export function hostEndGame(state, ctx) {
  if (state.phase !== 'playing') return { ok: false, error: 'game_not_running' };
  R.endGame(state, ctx, 'host');
  state.version += 1;
  return { ok: true };
}

/** Vista para clientes: oculta el orden de los mazos y recorta el log. */
export function publicView(state, { logLimit = 150 } = {}) {
  const view = structuredClone({ ...state, decks: undefined, log: state.log.slice(-logLimit) });
  view.decks = { chance: state.decks.chance.length, community: state.decks.community.length };
  view.netWorth = Object.fromEntries(state.players.map((p) => [p.id, netWorth(state, p.id)]));
  return view;
}

export { startNextAuction, emit };
