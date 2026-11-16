// Test de integración: 3 clientes reales por Socket.IO contra el servidor.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as connect } from 'socket.io-client';
import { startServer } from '../server/index.js';

let srv;
let url;
const sockets = [];

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  s.lastGame = null;
  s.lastRoom = null;
  s.on('game:state', (msg) => { s.lastGame = msg; });
  s.on('room:state', (msg) => { s.lastRoom = msg; });
  return s;
}

const call = (s, event, payload = {}) => new Promise((resolve) => s.emit(event, payload, resolve));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  srv = await startServer({ port: 0, persist: 'none', quiet: true });
  url = `http://localhost:${srv.port}`;
});

afterAll(async () => {
  sockets.forEach((s) => s.close());
  await srv.close();
});

describe('servidor Socket.IO', () => {
  it('lobby → partida → acciones validadas → reconexión', async () => {
    const a = client();
    const b = client();
    const c = client();
    const created = await call(a, 'room:create', { name: '<b>Ana</b>' });
    expect(created.ok).toBe(true);
    expect(created.code).toMatch(/^[A-Z0-9]{5}$/);
    const jb = await call(b, 'room:join', { code: created.code.toLowerCase(), name: 'Beto' });
    const jc = await call(c, 'room:join', { code: created.code, name: 'Caro' });
    expect(jb.ok && jc.ok).toBe(true);
    await wait(50);
    expect(a.lastRoom.members.map((m) => m.name)).toEqual(['bAna/b', 'Beto', 'Caro']);

    // Ficha única
    const taken = a.lastRoom.members[0].avatar;
    expect((await call(b, 'lobby:update', { avatar: taken })).error).toBe('avatar_taken');
    // No se puede arrancar sin listos; solo el anfitrión
    expect((await call(a, 'lobby:start')).error).toBe('players_not_ready');
    expect((await call(b, 'lobby:start')).error).toBe('host_only');
    await call(b, 'lobby:update', { ready: true });
    await call(c, 'lobby:update', { ready: true });
    expect((await call(a, 'lobby:start')).ok).toBe(true);
    await wait(50);
    const state = a.lastGame.state;
    expect(state.phase).toBe('playing');
    expect(typeof state.decks.chance).toBe('number'); // el orden del mazo no se filtra

    const ids = { [created.playerId]: a, [jb.playerId]: b, [jc.playerId]: c };
    const current = ids[state.turn.playerId];
    const other = Object.values(ids).find((s) => s !== current);
    // Dos jugadores intentan tirar a la vez: solo uno es válido.
    const [r1, r2] = await Promise.all([call(current, 'game:action', { type: 'roll' }), call(other, 'game:action', { type: 'roll' })]);
    expect(r1.ok).toBe(true);
    expect(r2).toMatchObject({ ok: false, error: 'not_your_turn' });
    expect((await call(other, 'game:action', { type: 'hack' })).error).toBe('unknown_action');

    // Chat sanitizado
    const got = new Promise((r) => b.once('chat:message', r));
    await call(a, 'chat:send', { text: '<img src=x onerror=alert(1)> hola' });
    expect((await got).text).toBe('img src=x onerror=alert(1) hola');

    // Reconexión con el token de sesión
    c.close();
    await wait(100);
    const c2 = client();
    const resumed = await call(c2, 'session:resume', { code: created.code, playerId: jc.playerId, secret: jc.secret });
    expect(resumed.ok).toBe(true);
    await wait(50);
    expect(c2.lastGame.state.players.length).toBe(3);
    expect((await call(c2, 'session:resume', { code: created.code, playerId: jc.playerId, secret: 'nope' })).error).toBe('invalid_session');
  });

  it('límite de tasa por socket', async () => {
    const s = client();
    await call(s, 'room:create', { name: 'Spam' });
    const results = await Promise.all(Array.from({ length: 30 }, () => call(s, 'chat:send', { text: 'hola' })));
    expect(results.some((r) => r.error === 'rate_limited')).toBe(true);
  });
});

describe('espectadores', () => {
  it('unirse a una partida en curso entra como espectador, no puede jugar pero sí chatear', async () => {
    const host = client();
    const created = await call(host, 'room:create', { name: 'Host' });
    await call(host, 'lobby:settings', { settings: { houseRules: { bots: true } } });
    await call(host, 'lobby:addBot');
    await call(host, 'lobby:addBot');
    expect((await call(host, 'lobby:start')).ok).toBe(true);
    const spec = client();
    const joined = await call(spec, 'room:join', { code: created.code, name: 'Mirón' });
    expect(joined.ok).toBe(true);
    await wait(50);
    const me = spec.lastRoom.members.find((m) => m.id === joined.playerId);
    expect(me.spectator).toBe(true);
    expect(spec.lastGame.state.players.some((p) => p.id === joined.playerId)).toBe(false);
    expect((await call(spec, 'game:action', { type: 'roll' })).ok).toBe(false);
    expect((await call(spec, 'chat:send', { text: 'hola' })).ok).toBe(true);
    // Revancha: el espectador pasa a jugador.
    await call(host, 'game:host', { type: 'endGame' });
    expect((await call(host, 'game:rematch')).ok).toBe(true);
    await wait(50);
    expect(spec.lastRoom.members.find((m) => m.id === joined.playerId).spectator).toBe(false);
  });
});
