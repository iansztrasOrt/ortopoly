// Simulación completa con bots: verifica que el motor nunca se traba y que se
// conservan las invariantes (stock de edificios, dinero, dueños).

import { describe, it, expect } from 'vitest';
import { createGame, autoDriven, autoStep, tick, publicView } from '../engine/game.js';
import { OWNABLE, HOTEL_LEVEL, DEFAULT_HOUSES, DEFAULT_HOTELS } from '../engine/board.js';
import { seededRng } from '../engine/rng.js';
import { makeCtx } from '../engine/util.js';

function checkInvariants(s) {
  let houses = 0;
  let hotels = 0;
  for (const pos of OWNABLE) {
    const pr = s.props[pos];
    if (pr.level === HOTEL_LEVEL) hotels += 1;
    else houses += pr.level;
    if (pr.owner) {
      const owner = s.players.find((p) => p.id === pr.owner);
      expect(owner.bankrupt).toBe(false);
    }
    if (pr.level > 0) expect(pr.mortgaged).toBe(false);
  }
  expect(houses + s.bank.houses).toBe(DEFAULT_HOUSES);
  expect(hotels + s.bank.hotels).toBe(DEFAULT_HOTELS);
  for (const p of s.players) expect(p.money).toBeGreaterThanOrEqual(0);
}

function simulate(seed, players = 4, settings = {}) {
  const rng = seededRng(seed);
  let now = 0;
  const list = Array.from({ length: players }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}`, avatar: 'cat', color: '#111', isBot: true }));
  const s = createGame({ players: list, settings }, makeCtx({ rng, now }));
  let steps = 0;
  while (s.phase === 'playing' && steps < 8000) {
    now += 700;
    const ctx = makeCtx({ rng, now });
    tick(s, ctx);
    let acted = false;
    for (const { id, autopilot } of autoDriven(s, now)) {
      const r = autoStep(s, id, ctx, { autopilot });
      if (r) acted = true;
    }
    if (!acted && s.auction) now = s.auction.endsAt;
    steps += 1;
    if (steps % 50 === 0) checkInvariants(s);
  }
  checkInvariants(s);
  return { s, steps };
}

describe('simulación con bots', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`partida completa sin trabarse (semilla ${seed})`, () => {
      const { s, steps } = simulate(seed, 3 + (seed % 3), seed % 2 ? { houseRules: { freeParkingPot: true, doubleGo: true } } : {});
      expect(s.phase).toBe('ended');
      expect(s.winner).toBeTruthy();
      expect(s.ranking.length).toBe(s.players.length);
      const view = publicView(s);
      expect(typeof view.decks.chance).toBe('number');
      expect(JSON.parse(JSON.stringify(view)).players.length).toBe(s.players.length);
    });
  }
});

describe('temporizador de turno', () => {
  it('al vencer, el piloto automático juega por el jugador y pasa el turno', async () => {
    const { setup } = await import('./helpers.js');
    const s = setup({ settings: { turnTimer: 60 } });
    s.turn.deadline = 1_000_000 + 60_000;
    const rng = seededRng(9);
    let now = s.turn.deadline + 1;
    tick(s, makeCtx({ rng, now }));
    expect(s.turn.autopilot).toBe(true);
    expect(autoDriven(s, now)).toContainEqual({ id: 'p1', autopilot: true });
    for (let i = 0; i < 20 && s.turn.playerId === 'p1'; i += 1) {
      now += 700;
      const ctx = makeCtx({ rng, now });
      tick(s, ctx);
      for (const { id, autopilot } of autoDriven(s, now)) autoStep(s, id, ctx, { autopilot });
      if (s.auction) {
        // el piloto automático no compra: se retira de la subasta; los demás también
        for (const id of [...s.auction.active]) autoStep(s, id, ctx, { autopilot: true });
      }
    }
    expect(s.turn.playerId).toBe('p2');
    expect(s.turn.autopilot).toBe(false);
  });
});
