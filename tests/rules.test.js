import { describe, it, expect } from 'vitest';
import { setup, act, own, player, topCard, NOW } from './helpers.js';
import { computeRent } from '../engine/rules.js';
import { rollForOrder } from '../engine/game.js';
import { fixedDice } from '../engine/rng.js';

describe('dados y turnos', () => {
  it('tres dobles seguidos → cárcel sin mover', () => {
    const s = setup();
    const p1 = player(s, 'p1');
    p1.position = 10;
    own(s, 'p1', [14]);
    expect(act(s, 'p1', { type: 'roll' }, [[2, 2]]).ok).toBe(true);
    expect(p1.position).toBe(14);
    expect(s.turn.phase).toBe('roll'); // dobles: vuelve a tirar
    expect(act(s, 'p1', { type: 'roll' }, [[3, 3]]).ok).toBe(true);
    expect(p1.position).toBe(20);
    const money = p1.money;
    expect(act(s, 'p1', { type: 'roll' }, [[4, 4]]).ok).toBe(true);
    expect(p1.position).toBe(10);
    expect(p1.inJail).toBe(true);
    expect(p1.money).toBe(money); // no cobra Salida ni mueve
    expect(s.turn.phase).toBe('end');
    expect(act(s, 'p1', { type: 'roll' }, [[1, 2]]).error).toBe('cannot_roll_now');
  });

  it('no se puede terminar el turno sin tirar, y tras tirar pasa al siguiente', () => {
    const s = setup();
    own(s, 'p1', [3]);
    expect(act(s, 'p1', { type: 'endTurn' }).error).toBe('must_roll');
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(act(s, 'p1', { type: 'endTurn' }).ok).toBe(true);
    expect(s.turn.playerId).toBe('p2');
  });

  it('pasar por Salida cobra $200', () => {
    const s = setup();
    const p1 = player(s, 'p1');
    p1.position = 38;
    own(s, 'p1', [3]);
    act(s, 'p1', { type: 'roll' }, [[2, 3]]);
    expect(p1.position).toBe(3);
    expect(p1.money).toBe(1700);
  });

  it('orden inicial por dados con desempate', () => {
    // a=7, b=7, c=5 → desempate a vs b: a=2, b=12
    const rng = fixedDice([3, 4], [5, 2], [2, 3], [1, 1], [6, 6]);
    const { order, rounds } = rollForOrder(['a', 'b', 'c'], rng);
    expect(order).toEqual(['b', 'a', 'c']);
    expect(rounds.length).toBe(2);
  });

  it('dos jugadores actúan a la vez: el servidor serializa y rechaza la inválida', () => {
    const s = setup();
    own(s, 'p1', [5]);
    const v = s.version;
    const r1 = act(s, 'p1', { type: 'roll' }, [[2, 3]]);
    const r2 = act(s, 'p2', { type: 'roll' }, [[6, 6]]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe('not_your_turn');
    expect(s.version).toBe(v + 1);
    // La misma acción repetida por el jugador correcto también se rechaza.
    expect(act(s, 'p1', { type: 'roll' }, [[1, 2]]).error).toBe('cannot_roll_now');
    expect(player(s, 'p2').position).toBe(0);
  });
});

describe('cárcel', () => {
  it('salir con dobles mueve pero NO da turno extra', () => {
    const s = setup();
    const p1 = player(s, 'p1');
    Object.assign(p1, { position: 10, inJail: true, jailTurns: 0 });
    own(s, 'p1', [16]);
    act(s, 'p1', { type: 'roll' }, [[3, 3]]);
    expect(p1.inJail).toBe(false);
    expect(p1.position).toBe(16);
    expect(s.turn.phase).toBe('end');
    expect(s.turn.extraRoll).toBe(false);
  });

  it('fallar 2 veces se queda; al 3.er intento fallido paga $50 y mueve', () => {
    const s = setup();
    const p1 = player(s, 'p1');
    Object.assign(p1, { position: 10, inJail: true, jailTurns: 0 });
    own(s, 'p1', [13]);
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(p1.inJail).toBe(true);
    expect(p1.position).toBe(10);
    p1.jailTurns = 2;
    s.turn.phase = 'roll';
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(p1.inJail).toBe(false);
    expect(p1.position).toBe(13);
    expect(p1.money).toBe(1450);
    expect(s.turn.phase).toBe('end');
  });

  it('pagar fianza o usar la carta antes de tirar; la carta vuelve al mazo', () => {
    const s = setup();
    const p1 = player(s, 'p1');
    Object.assign(p1, { position: 10, inJail: true, jailCards: ['chance'] });
    s.decks.chance = s.decks.chance.filter((c) => c !== 'c_jailfree');
    expect(act(s, 'p1', { type: 'useJailCard' }).ok).toBe(true);
    expect(p1.inJail).toBe(false);
    expect(s.decks.chance.at(-1)).toBe('c_jailfree');
    p1.inJail = true;
    expect(act(s, 'p1', { type: 'payBail' }).ok).toBe(true);
    expect(p1.money).toBe(1450);
    expect(act(s, 'p1', { type: 'payBail' }).error).toBe('not_in_jail');
  });

  it('en la cárcel se siguen cobrando alquileres (salvo regla de la casa)', () => {
    const s = setup();
    own(s, 'p2', [3]);
    player(s, 'p2').inJail = true;
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(player(s, 'p2').money).toBe(1504);

    const s2 = setup({ settings: { houseRules: { noRentInJail: true } } });
    own(s2, 'p2', [3]);
    player(s2, 'p2').inJail = true;
    act(s2, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(player(s2, 'p2').money).toBe(1500);
  });
});

describe('alquileres', () => {
  it('doble alquiler en solar sin casas con grupo completo y sin hipotecas', () => {
    const s = setup();
    own(s, 'p2', [1, 3]);
    expect(computeRent(s, 3)).toBe(8);
    s.props[1].mortgaged = true;
    expect(computeRent(s, 3)).toBe(4);
  });

  it('ferrocarriles y servicios', () => {
    const s = setup();
    own(s, 'p2', [5, 15, 25]);
    expect(computeRent(s, 5)).toBe(100);
    own(s, 'p2', [12]);
    expect(computeRent(s, 12, { diceTotal: 7 })).toBe(28);
    own(s, 'p2', [28]);
    expect(computeRent(s, 12, { diceTotal: 7 })).toBe(70);
  });

  it('impuesto va al banco; con la regla de la casa va al bote y se cobra en el estacionamiento', () => {
    const s = setup({ settings: { houseRules: { freeParkingPot: true } } });
    act(s, 'p1', { type: 'roll' }, [[1, 3]]);
    expect(player(s, 'p1').money).toBe(1300);
    expect(s.pot).toBe(200);
    act(s, 'p1', { type: 'endTurn' });
    player(s, 'p2').position = 15;
    own(s, 'p3', [15]);
    act(s, 'p2', { type: 'roll' }, [[2, 3]]);
    expect(player(s, 'p2').position).toBe(20);
    expect(player(s, 'p2').money).toBe(1700);
    expect(s.pot).toBe(0);
  });
});

describe('cartas', () => {
  it('"servicio más cercano" con dueño: tira dados y paga 10×', () => {
    const s = setup();
    const p1 = player(s, 'p1');
    p1.position = 4;
    own(s, 'p2', [12]); // posee UN solo servicio: igual paga 10×
    topCard(s, 'chance', 'c_utility');
    act(s, 'p1', { type: 'roll' }, [[1, 2], [5, 6]]);
    expect(p1.position).toBe(12);
    expect(p1.money).toBe(1500 - 110);
    expect(player(s, 'p2').money).toBe(1610);
  });

  it('"ferrocarril más cercano" con dueño paga el doble; desde 36 pasa por Salida', () => {
    const s = setup();
    const p1 = player(s, 'p1');
    p1.position = 19;
    own(s, 'p2', [25, 5]);
    topCard(s, 'chance', 'c_rail_a');
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(p1.position).toBe(25);
    expect(p1.money).toBe(1500 - 100);

    const s2 = setup();
    const q = player(s2, 'p1');
    q.position = 33;
    own(s2, 'p2', [5]);
    topCard(s2, 'chance', 'c_rail_b');
    act(s2, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(q.position).toBe(5);
    expect(q.money).toBe(1500 + 200 - 50);
  });

  it('"ferrocarril/servicio más cercano" sin dueño ofrece comprar', () => {
    const s = setup();
    player(s, 'p1').position = 4;
    topCard(s, 'chance', 'c_utility');
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(s.turn.phase).toBe('buy');
    expect(s.turn.pendingBuy).toBe(12);
  });

  it('retroceder 3 casillas desde Fortuna 36 cae en Vecindario 33 y resuelve otra carta', () => {
    const s = setup();
    player(s, 'p1').position = 33;
    topCard(s, 'chance', 'c_back3');
    topCard(s, 'community', 'k_bank_error');
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(player(s, 'p1').position).toBe(33);
    expect(player(s, 'p1').money).toBe(1700);
  });

  it('reparaciones con casas y hoteles mezclados', () => {
    const s = setup();
    own(s, 'p1', [11, 13, 14]);
    s.props[11].level = 5;
    s.props[13].level = 4;
    s.props[14].level = 4;
    player(s, 'p1').position = 4;
    topCard(s, 'chance', 'c_repairs');
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(player(s, 'p1').money).toBe(1500 - (8 * 25 + 100));

    const s2 = setup();
    own(s2, 'p1', [11, 13, 14]);
    s2.props[11].level = 5;
    s2.props[13].level = 4;
    s2.props[14].level = 4;
    player(s2, 'p1').position = 30 - 30 + 0;
    player(s2, 'p1').position = 31;
    own(s2, 'p1', [34]);
    topCard(s2, 'community', 'k_street_repairs');
    act(s2, 'p1', { type: 'roll' }, [[1, 1]]);
    expect(player(s2, 'p1').money).toBe(1500 - (8 * 40 + 115));
  });

  it('presidente de la mesa y cumpleaños; la carta de cárcel se retiene', () => {
    const s = setup({ players: 4 });
    player(s, 'p1').position = 4;
    topCard(s, 'chance', 'c_chairman');
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    expect(player(s, 'p1').money).toBe(1350);
    expect(player(s, 'p4').money).toBe(1550);

    const s2 = setup();
    player(s2, 'p1').position = 0;
    topCard(s2, 'community', 'k_birthday');
    act(s2, 'p1', { type: 'roll' }, [[1, 1]]);
    expect(player(s2, 'p1').money).toBe(1520);

    const s3 = setup();
    topCard(s3, 'community', 'k_jailfree');
    act(s3, 'p1', { type: 'roll' }, [[1, 1]]);
    expect(player(s3, 'p1').jailCards).toEqual(['community']);
    expect(s3.decks.community).not.toContain('k_jailfree');
    expect(s3.decks.community.length).toBe(15);
  });

  it('cumpleaños con un jugador sin efectivo → deuda que bloquea el turno', () => {
    const s = setup();
    player(s, 'p2').money = 5;
    own(s, 'p2', [39]);
    topCard(s, 'community', 'k_birthday');
    act(s, 'p1', { type: 'roll' }, [[1, 1]]);
    expect(s.debts.length).toBe(1);
    expect(s.debts[0]).toMatchObject({ debtorId: 'p2', creditorId: 'p1', amount: 10 });
    expect(act(s, 'p1', { type: 'roll' }, [[1, 2]]).error).toBe('debts_pending');
    expect(act(s, 'p2', { type: 'payDebt' }).error).toBe('insufficient_funds');
    expect(act(s, 'p2', { type: 'mortgage', pos: 39 }).ok).toBe(true);
    expect(act(s, 'p2', { type: 'payDebt' }).ok).toBe(true);
    expect(s.debts.length).toBe(0);
    expect(player(s, 'p1').money).toBe(1520);
    expect(act(s, 'p1', { type: 'roll' }, [[1, 2]]).ok).toBe(true);
  });
});
