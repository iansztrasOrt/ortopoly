import { describe, it, expect } from 'vitest';
import { setup, act, own, player } from './helpers.js';
import { tick } from '../engine/game.js';
import { makeCtx } from '../engine/util.js';
import { seededRng } from '../engine/rng.js';

function pinkMonopoly(money = 5000) {
  const s = setup();
  own(s, 'p1', [11, 13, 14]);
  player(s, 'p1').money = money;
  return s;
}

describe('construcción uniforme', () => {
  it('requiere grupo completo y sin hipotecas', () => {
    const s = setup();
    own(s, 'p1', [11, 13]);
    expect(act(s, 'p1', { type: 'build', pos: 11 }).error).toBe('need_full_group');
    own(s, 'p1', [14]);
    s.props[14].mortgaged = true;
    expect(act(s, 'p1', { type: 'build', pos: 11 }).error).toBe('group_mortgaged');
  });

  it('diferencia máxima de 1 al construir y al vender', () => {
    const s = pinkMonopoly();
    expect(act(s, 'p1', { type: 'build', pos: 11 }).ok).toBe(true);
    expect(act(s, 'p1', { type: 'build', pos: 11 }).error).toBe('uneven_build');
    expect(act(s, 'p1', { type: 'build', pos: 13 }).ok).toBe(true);
    expect(act(s, 'p1', { type: 'build', pos: 14 }).ok).toBe(true);
    expect(act(s, 'p1', { type: 'build', pos: 11 }).ok).toBe(true); // [2,1,1]
    expect(act(s, 'p1', { type: 'sell', pos: 13 }).error).toBe('uneven_sell');
    expect(act(s, 'p1', { type: 'sell', pos: 11 }).ok).toBe(true); // [1,1,1]
    expect(s.bank.houses).toBe(29);
    expect(player(s, 'p1').money).toBe(5000 - 4 * 100 + 50);
  });

  it('no se puede hipotecar con edificios en el grupo', () => {
    const s = pinkMonopoly();
    act(s, 'p1', { type: 'build', pos: 11 });
    expect(act(s, 'p1', { type: 'mortgage', pos: 13 }).error).toBe('sell_buildings_first');
  });

  it('escasez: sin casas en el banco no se construye; sin hoteles tampoco', () => {
    const s = pinkMonopoly();
    s.bank.houses = 0;
    expect(act(s, 'p1', { type: 'build', pos: 11 }).error).toBe('no_houses_left');
    s.props[11].level = 4;
    s.props[13].level = 4;
    s.props[14].level = 4;
    s.bank.hotels = 0;
    expect(act(s, 'p1', { type: 'build', pos: 11 }).error).toBe('no_hotels_left');
    s.bank.hotels = 1;
    expect(act(s, 'p1', { type: 'build', pos: 11 }).ok).toBe(true);
    expect(s.props[11].level).toBe(5);
    expect(s.bank.houses).toBe(4); // el hotel devuelve 4 casas
    expect(s.bank.hotels).toBe(0);
  });

  it('casas escasas y otro interesado → subasta de casas', () => {
    const s = pinkMonopoly();
    own(s, 'p2', [16, 18, 19]);
    player(s, 'p2').money = 3000;
    s.bank.houses = 2;
    const r = act(s, 'p1', { type: 'build', pos: 11 });
    expect(r.ok).toBe(true);
    expect(s.auction).toMatchObject({ kind: 'house', requester: 'p1', minBid: 100 });
    expect(s.auction.active.sort()).toEqual(['p1', 'p2']);
    expect(act(s, 'p2', { type: 'bid', amount: 99 }).error).toBe('bid_below_minimum');
    expect(act(s, 'p2', { type: 'bid', amount: 120 }).ok).toBe(true);
    expect(act(s, 'p1', { type: 'withdraw' }).ok).toBe(true);
    expect(s.auction).toBe(null);
    expect(s.bank.houses).toBe(1);
    expect(player(s, 'p2').money).toBe(3000 - 120);
    expect([16, 18, 19].map((p) => s.props[p].level).reduce((a, b) => a + b)).toBe(1);
  });

  it('vender hotel sin casas disponibles en el banco', () => {
    const s = pinkMonopoly(0);
    for (const pos of [11, 13, 14]) s.props[pos].level = 5;
    s.bank.houses = 0;
    s.bank.hotels = 9;
    s.debts.push({ id: 99, debtorId: 'p1', creditorId: 'p2', amount: 1000, reason: 'rent', createdAt: 0 });
    s.turn.playerId = 'p2';
    // Fuera de turno solo puede vender por tener deuda.
    expect(act(s, 'p1', { type: 'sell', pos: 11 }).ok).toBe(true);
    expect(s.props[11].level).toBe(0);
    expect(player(s, 'p1').money).toBe(5 * 50);
    expect(s.bank.hotels).toBe(10);
    // Con 2 casas en el banco: queda con 2 casas.
    s.bank.houses = 2;
    expect(act(s, 'p1', { type: 'sell', pos: 13 }).ok).toBe(true);
    expect(s.props[13].level).toBe(2);
    expect(s.bank.houses).toBe(0);
    expect(player(s, 'p1').money).toBe(250 + 3 * 50);
  });

  it('vender fuera de turno sin deuda no está permitido', () => {
    const s = pinkMonopoly();
    s.props[11].level = 1;
    s.turn.playerId = 'p2';
    expect(act(s, 'p1', { type: 'sell', pos: 11 }).error).toBe('sell_only_turn_or_debt');
  });
});

describe('hipotecas', () => {
  it('hipotecar y deshipotecar con 10%', () => {
    const s = setup();
    own(s, 'p1', [1]);
    expect(act(s, 'p1', { type: 'mortgage', pos: 1 }).ok).toBe(true);
    expect(player(s, 'p1').money).toBe(1530);
    expect(act(s, 'p1', { type: 'unmortgage', pos: 1 }).ok).toBe(true);
    expect(player(s, 'p1').money).toBe(1530 - 33);
  });
});

describe('subastas', () => {
  it('si no compra hay subasta obligatoria; todos se retiran menos uno', () => {
    const s = setup();
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(s.turn.phase).toBe('buy');
    act(s, 'p1', { type: 'decline' });
    expect(s.auction.pos).toBe(3);
    expect(s.turn.phase).toBe('auction');
    expect(act(s, 'p1', { type: 'endTurn' }).error).toBe('auction_in_progress');
    expect(act(s, 'p2', { type: 'bid', amount: 10 }).ok).toBe(true);
    expect(act(s, 'p2', { type: 'withdraw' }).error).toBe('high_bidder_cannot_withdraw');
    act(s, 'p1', { type: 'withdraw' });
    expect(s.auction).not.toBe(null);
    act(s, 'p3', { type: 'withdraw' });
    expect(s.auction).toBe(null);
    expect(s.props[3].owner).toBe('p2');
    expect(player(s, 'p2').money).toBe(1490);
    expect(s.turn.phase).toBe('end');
  });

  it('empate de pujas: gana la primera; la segunda igual se rechaza', () => {
    const s = setup();
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    act(s, 'p1', { type: 'decline' });
    expect(act(s, 'p2', { type: 'bid', amount: 50 }).ok).toBe(true);
    const r = act(s, 'p3', { type: 'bid', amount: 50 });
    expect(r.error).toBe('bid_too_low');
    expect(s.auction.highBidder).toBe('p2');
    expect(act(s, 'p3', { type: 'bid', amount: 5000 }).error).toBe('insufficient_funds');
  });

  it('el temporizador cierra la subasta con la puja más alta', () => {
    const s = setup();
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    act(s, 'p1', { type: 'decline' });
    act(s, 'p3', { type: 'bid', amount: 30 });
    const ctx = makeCtx({ rng: seededRng(1), now: s.auction.endsAt + 1 });
    expect(tick(s, ctx)).toBe(true);
    expect(s.props[3].owner).toBe('p3');
  });

  it('si todos se retiran sin pujar, queda sin dueño', () => {
    const s = setup();
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    act(s, 'p1', { type: 'decline' });
    ['p1', 'p2', 'p3'].forEach((id) => act(s, id, { type: 'withdraw' }));
    expect(s.auction).toBe(null);
    expect(s.props[3].owner).toBe(null);
  });

  it('regla de la casa "sin subastas"', () => {
    const s = setup({ settings: { houseRules: { noAuctions: true } } });
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    act(s, 'p1', { type: 'decline' });
    expect(s.auction).toBe(null);
    expect(s.turn.phase).toBe('end');
  });
});
