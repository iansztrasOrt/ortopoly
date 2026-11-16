import { describe, it, expect } from 'vitest';
import { setup, act, own, player, NOW } from './helpers.js';
import { onDisconnectTimeout, onReconnect, skipTurnIfAway, hostBankrupt, hostReplaceWithBot } from '../engine/game.js';
import { makeCtx } from '../engine/util.js';
import { seededRng } from '../engine/rng.js';

const ctx = () => makeCtx({ rng: seededRng(3), now: NOW });

describe('bancarrota', () => {
  it('ante otro jugador: todo pasa al acreedor (hipotecadas con 10% y cartas)', () => {
    const s = setup();
    const p1 = player(s, 'p1');
    p1.money = 100;
    p1.jailCards = ['chance'];
    own(s, 'p1', [1, 3]);
    s.props[1].level = 1;
    s.props[3].level = 1;
    s.bank.houses = 30;
    own(s, 'p1', [12], { mortgaged: true });
    own(s, 'p2', [39]);
    s.props[39].level = 5;
    s.bank.hotels = 11;
    p1.position = 37;
    act(s, 'p1', { type: 'roll' }, [[1, 1]]);
    expect(s.debts[0]).toMatchObject({ debtorId: 'p1', creditorId: 'p2', amount: 2000 });
    expect(act(s, 'p1', { type: 'roll' }, [[1, 2]]).error).toBe('debts_pending');
    expect(act(s, 'p1', { type: 'declareBankruptcy' }).ok).toBe(true);
    // Tras una acción rechazada el estado se restaura: volver a buscar al jugador.
    expect(player(s, 'p1').bankrupt).toBe(true);
    // 100 + 2 casas vendidas (2*25) = 150 al acreedor
    expect(player(s, 'p2').money).toBe(1500 + 150);
    expect(s.props[1].owner).toBe('p2');
    expect(s.props[12]).toMatchObject({ owner: 'p2', mortgaged: true });
    expect(s.mortgageDecisions).toEqual([{ playerId: 'p2', pos: 12 }]);
    expect(player(s, 'p2').jailCards).toEqual(['chance']);
    expect(s.bank.houses).toBe(32);
    expect(s.turn.playerId).toBe('p2');
    // El acreedor decide: pagar solo el 10% ($8 de una hipoteca de $75).
    expect(act(s, 'p2', { type: 'mortgageDecision', pos: 12, lift: false }).ok).toBe(true);
    expect(player(s, 'p2').money).toBe(1650 - 8);
    expect(s.props[12].mortgaged).toBe(true);
  });

  it('no se puede declarar bancarrota si se puede pagar', () => {
    const s = setup();
    own(s, 'p2', [3]);
    player(s, 'p1').money = 3;
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    player(s, 'p1').money = 10;
    expect(act(s, 'p1', { type: 'declareBankruptcy' }).error).toBe('can_pay_debt');
  });

  it('ante el banco: propiedades se subastan una por una sin edificios ni hipoteca', () => {
    const s = setup();
    const p1 = player(s, 'p1');
    p1.money = 20;
    p1.jailCards = ['community'];
    s.decks.community = s.decks.community.filter((c) => c !== 'k_jailfree');
    own(s, 'p1', [6, 8, 9]);
    s.props[6].level = 2;
    s.props[8].level = 2;
    s.props[9].level = 2;
    s.bank.houses = 26;
    own(s, 'p1', [5], { mortgaged: true });
    p1.position = 0;
    act(s, 'p1', { type: 'roll' }, [[1, 3]]); // impuesto $200
    expect(s.debts[0]).toMatchObject({ debtorId: 'p1', creditorId: null, amount: 200 });
    expect(act(s, 'p1', { type: 'declareBankruptcy' }).ok).toBe(true);
    expect(player(s, 'p1').bankrupt).toBe(true);
    expect(s.bank.houses).toBe(32);
    expect(s.decks.community.at(-1)).toBe('k_jailfree');
    expect(s.auction).toMatchObject({ kind: 'property', source: 'bankruptcy' });
    const first = s.auction.pos;
    expect(s.props[5]).toMatchObject({ owner: null, mortgaged: false, level: 0 });
    expect(s.auction.active.sort()).toEqual(['p2', 'p3']);
    act(s, 'p2', { type: 'bid', amount: 40 });
    act(s, 'p3', { type: 'withdraw' });
    expect(s.props[first].owner).toBe('p2');
    expect(s.auction.pos).not.toBe(first); // arranca la siguiente
    expect(s.auctionQueue.length).toBe(2);
  });

  it('último jugador en pie gana', () => {
    const s = setup();
    player(s, 'p3').bankrupt = true;
    player(s, 'p3').bankruptOrder = 1;
    s.bankruptCount = 1;
    own(s, 'p2', [39]);
    s.props[39].level = 5;
    player(s, 'p1').position = 37;
    player(s, 'p1').money = 10;
    act(s, 'p1', { type: 'roll' }, [[1, 1]]);
    act(s, 'p1', { type: 'declareBankruptcy' });
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe('p2');
    expect(s.ranking).toEqual(['p2', 'p1', 'p3']);
  });
});

describe('tratos', () => {
  it('intercambio con propiedad hipotecada: el receptor paga 10% o levanta la hipoteca', () => {
    const s = setup();
    own(s, 'p1', [1], { mortgaged: true });
    own(s, 'p1', [3]);
    const offer = { to: 'p2', give: { props: [1, 3] }, get: { money: 100 } };
    expect(act(s, 'p1', { type: 'proposeTrade', offer }).ok).toBe(true);
    const id = s.trades[0].id;
    expect(act(s, 'p3', { type: 'acceptTrade', tradeId: id }).error).toBe('not_trade_recipient');
    expect(act(s, 'p2', { type: 'acceptTrade', tradeId: id }).ok).toBe(true);
    expect(s.props[1].owner).toBe('p2');
    expect(player(s, 'p1').money).toBe(1600);
    expect(s.mortgageDecisions).toMatchObject([{ playerId: 'p2', pos: 1, interest: 3 }]);
    expect(act(s, 'p1', { type: 'roll' }, [[1, 2]]).error).toBe('decision_pending');
    expect(act(s, 'p2', { type: 'mortgageDecision', pos: 1, lift: true }).ok).toBe(true);
    expect(player(s, 'p2').money).toBe(1500 - 100 - 33);
    expect(s.props[1].mortgaged).toBe(false);
  });

  it('no se pueden intercambiar propiedades de grupos con edificios', () => {
    const s = setup();
    own(s, 'p1', [1, 3]);
    s.props[3].level = 1;
    const r = act(s, 'p1', { type: 'proposeTrade', offer: { to: 'p2', give: { props: [1] }, get: { money: 10 } } });
    expect(r.error).toBe('group_has_buildings');
  });

  it('cartas de cárcel, fuera de turno, rechazo y contraoferta', () => {
    const s = setup();
    player(s, 'p2').jailCards = ['chance'];
    own(s, 'p3', [5]);
    // p2 propone a p3 fuera de su turno
    expect(act(s, 'p2', { type: 'proposeTrade', offer: { to: 'p3', give: { cards: 1 }, get: { props: [5] } } }).ok).toBe(true);
    const id = s.trades[0].id;
    expect(act(s, 'p3', {
      type: 'counterTrade', tradeId: id, offer: { give: { props: [5] }, get: { cards: 1, money: 50 } },
    }).ok).toBe(true);
    expect(s.trades.length).toBe(1);
    expect(s.trades[0]).toMatchObject({ from: 'p3', to: 'p2', counterOf: id });
    expect(act(s, 'p2', { type: 'acceptTrade', tradeId: s.trades[0].id }).ok).toBe(true);
    expect(player(s, 'p3').jailCards).toEqual(['chance']);
    expect(s.props[5].owner).toBe('p2');
    expect(player(s, 'p3').money).toBe(1550);
  });

  it('se revalida al aceptar (el proponente gastó el dinero)', () => {
    const s = setup();
    own(s, 'p2', [39]);
    act(s, 'p1', { type: 'proposeTrade', offer: { to: 'p2', give: { money: 1000 }, get: { props: [39] } } });
    player(s, 'p1').money = 10;
    expect(act(s, 'p2', { type: 'acceptTrade', tradeId: s.trades[0].id }).error).toBe('trade_insufficient_funds');
    expect(s.props[39].owner).toBe('p2');
  });
});

describe('desconexiones', () => {
  it('desconexión en medio de una subasta: se retira (salvo que vaya ganando)', () => {
    const s = setup();
    act(s, 'p1', { type: 'roll' }, [[1, 2]]);
    act(s, 'p1', { type: 'decline' });
    act(s, 'p2', { type: 'bid', amount: 20 });
    onDisconnectTimeout(s, 'p2', ctx());
    expect(s.auction.active).toContain('p2');
    onDisconnectTimeout(s, 'p3', ctx());
    expect(s.auction.active).not.toContain('p3');
    act(s, 'p1', { type: 'withdraw' });
    expect(s.props[3].owner).toBe('p2');
  });

  it('desconexión en medio de un trato: se cancela', () => {
    const s = setup();
    own(s, 'p2', [1]);
    act(s, 'p1', { type: 'proposeTrade', offer: { to: 'p2', give: { money: 100 }, get: { props: [1] } } });
    onDisconnectTimeout(s, 'p2', ctx());
    expect(s.trades.length).toBe(0);
    expect(s.hostDecision).toBe('p2');
  });

  it('turno del ausente se salta; el anfitrión lo reemplaza con bot o lo declara en bancarrota', () => {
    const s = setup();
    onDisconnectTimeout(s, 'p1', ctx());
    expect(s.turn.playerId).toBe('p2');
    onReconnect(s, 'p1');
    expect(s.hostDecision).toBe(null);
    onDisconnectTimeout(s, 'p3', ctx());
    expect(hostReplaceWithBot(s, 'p3', ctx()).ok).toBe(true);
    expect(player(s, 'p3').isBot).toBe(true);
    expect(hostBankrupt(s, 'p2', ctx()).ok).toBe(true);
    expect(player(s, 'p2').bankrupt).toBe(true);
    expect(skipTurnIfAway(s, ctx())).toBe(false);
  });
});
