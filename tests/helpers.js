import { createGame, applyAction } from '../engine/game.js';
import { seededRng, fixedDice } from '../engine/rng.js';
import { makeCtx } from '../engine/util.js';

export const NOW = 1_000_000;

/** Partida de prueba con turno de p1 y orden p1, p2, p3... */
export function setup({ players = 3, settings = {}, money } = {}) {
  const list = Array.from({ length: players }, (_, i) => ({
    id: `p${i + 1}`, name: `Jugador ${i + 1}`, avatar: 'rocket', color: '#000',
  }));
  const state = createGame({ players: list, settings }, makeCtx({ rng: seededRng(7), now: NOW }));
  state.order = list.map((p) => p.id);
  state.turn = {
    number: 1, playerId: 'p1', phase: 'roll', dice: null, doubles: 0, extraRoll: false,
    pendingBuy: null, startedAt: NOW, deadline: null, autopilot: false,
  };
  if (money !== undefined) state.players.forEach((p) => { p.money = money; });
  return state;
}

/** Aplica una acción con dados predefinidos. */
export function act(state, pid, action, dice = [], now = NOW) {
  const ctx = makeCtx({ rng: fixedDice(...dice), now });
  const res = applyAction(state, pid, action, ctx);
  return { ...res, ctx };
}

export function own(state, pid, positions, extra = {}) {
  for (const pos of positions) Object.assign(state.props[pos], { owner: pid, ...extra });
}

export function player(state, id) {
  return state.players.find((p) => p.id === id);
}

export function topCard(state, deck, id) {
  state.decks[deck] = [id, ...state.decks[deck].filter((c) => c !== id)];
}
