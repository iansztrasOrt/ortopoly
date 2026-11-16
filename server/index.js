// Servidor HTTP + Socket.IO. El servidor es la única fuente de verdad: el
// cliente solo envía intenciones y renderiza el estado que recibe.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';
import { createStore } from './persistence.js';
import { createLimiters } from './rateLimit.js';
import { publicView } from '../engine/game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 250;
const SAVE_MS = 5000;

export async function startServer({ port = PORT, persist = process.env.PERSIST, quiet = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
      + "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; "
      + "base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    );
    next();
  });
  const staticOpts = { maxAge: '1h', fallthrough: true };
  app.use('/engine', express.static(path.join(ROOT, 'engine'), staticOpts));
  app.use('/shared', express.static(path.join(ROOT, 'shared'), staticOpts));
  app.use(express.static(path.join(ROOT, 'public'), { ...staticOpts, maxAge: 0 }));
  app.get('/healthz', (req, res) => res.json({ ok: true, rooms: manager.rooms.size }));
  app.get('/sala/:code', (req, res) => res.redirect(`/?sala=${encodeURIComponent(req.params.code)}`));

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10000,
    pingTimeout: 8000,
    cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined,
  });

  const channel = (room) => `room:${room.code}`;
  const bound = new Map(); // `${code}:${playerId}` → socket.id

  function sendGame(target, room, events = []) {
    target.emit('game:state', {
      state: room.game ? publicView(room.game) : null,
      events,
      serverNow: Date.now(),
    });
  }

  const manager = new RoomManager({
    notify(room, info) {
      if (room.deleted) return;
      const to = io.to(channel(room));
      if (info.lobby) to.emit('room:state', manager.publicRoom(room));
      if (info.game) sendGame(to, room, info.events || []);
      if (info.chat) to.emit('chat:message', info.chat);
      if (info.reaction) to.emit('chat:reaction', info.reaction);
      if (info.kicked) {
        const sid = bound.get(`${room.code}:${info.kicked}`);
        const s = sid && io.sockets.sockets.get(sid);
        if (s) {
          s.emit('room:kicked', { code: room.code });
          s.leave(channel(room));
          s.data = {};
        }
        bound.delete(`${room.code}:${info.kicked}`);
      }
    },
  });

  const store = await createStore({ mode: persist, dataDir: path.join(ROOT, 'data') });
  manager.restore(await store.load());
  manager.onDelete = (room) => {
    store.remove(room.code).catch(() => {});
    io.in(channel(room)).socketsLeave(channel(room));
  };
  if (!quiet && manager.rooms.size) console.log(`[persist] ${manager.rooms.size} sala(s) recuperada(s)`);

  function bind(socket, room, member) {
    const key = `${room.code}:${member.id}`;
    const prevSid = bound.get(key);
    if (prevSid && prevSid !== socket.id) {
      const prev = io.sockets.sockets.get(prevSid);
      if (prev) {
        prev.emit('session:replaced');
        prev.leave(channel(room));
        prev.data = {};
      }
    }
    if (socket.data.code && (socket.data.code !== room.code || socket.data.playerId !== member.id)) unbind(socket);
    bound.set(key, socket.id);
    socket.data = { code: room.code, playerId: member.id };
    socket.join(channel(room));
    manager.setConnected(room, member.id, true);
    socket.emit('room:state', manager.publicRoom(room));
    sendGame(socket, room);
  }

  function unbind(socket) {
    const { code, playerId } = socket.data || {};
    if (!code) return;
    const key = `${code}:${playerId}`;
    socket.data = {};
    const room = manager.rooms.get(code);
    if (room) socket.leave(channel(room));
    if (bound.get(key) === socket.id) {
      bound.delete(key);
      if (room) manager.setConnected(room, playerId, false);
    }
  }

  io.on('connection', (socket) => {
    socket.data = {};
    const limits = createLimiters();

    const ctxOf = () => {
      const { code, playerId } = socket.data;
      const room = code ? manager.rooms.get(code) : null;
      return room ? { room, playerId } : null;
    };

    function on(event, handler, { limiter = 'actions', needsRoom = true } = {}) {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!limits[limiter].take()) {
          reply({ ok: false, error: 'rate_limited' });
          return;
        }
        try {
          if (needsRoom) {
            const c = ctxOf();
            if (!c) {
              reply({ ok: false, error: 'no_session' });
              return;
            }
            const res = handler(payload || {}, c) || { ok: true };
            if (!res.ok && !quiet) console.warn(`[accion invalida] ${c.room.code} ${c.playerId} ${event}:${payload?.type || ''} → ${res.error}`);
            reply(stripInternal(res));
          } else {
            reply(stripInternal(handler(payload || {}) || { ok: true }));
          }
        } catch (e) {
          console.error(`[socket] ${event}`, e);
          reply({ ok: false, error: 'server_error' });
        }
      });
    }

    on('room:create', ({ name }) => {
      const res = manager.createRoom(name);
      if (!res.ok) return res;
      bind(socket, res.room, res.member);
      return session(res);
    }, { needsRoom: false });

    on('room:join', ({ code, name }) => {
      const res = manager.joinRoom(code, name);
      if (!res.ok) return res;
      bind(socket, res.room, res.member);
      return session(res);
    }, { needsRoom: false });

    on('session:resume', ({ code, playerId, secret }) => {
      const res = manager.resume(code, playerId, secret);
      if (!res.ok) return res;
      bind(socket, res.room, res.member);
      return session(res);
    }, { needsRoom: false });

    on('room:leave', (p, { room, playerId }) => {
      unbind(socket);
      manager.leave(room, playerId);
      return { ok: true };
    });

    on('lobby:update', (patch, { room, playerId }) => manager.updateMember(room, playerId, patch));
    on('lobby:settings', ({ settings }, { room, playerId }) => manager.updateSettings(room, playerId, settings));
    on('lobby:kick', ({ playerId: target }, { room, playerId }) => manager.kick(room, playerId, target));
    on('lobby:addBot', (p, { room, playerId }) => manager.addBot(room, playerId));
    on('lobby:start', (p, { room, playerId }) => manager.start(room, playerId));
    on('game:action', (action, { room, playerId }) => manager.action(room, playerId, action));
    on('game:host', (payload, { room, playerId }) => manager.host(room, playerId, payload));
    on('game:rematch', (p, { room, playerId }) => manager.rematch(room, playerId));
    on('chat:send', ({ text }, { room, playerId }) => manager.chat(room, playerId, text), { limiter: 'chat' });
    on('chat:react', ({ emoji }, { room, playerId }) => manager.react(room, playerId, emoji), { limiter: 'chat' });

    socket.on('disconnect', () => unbind(socket));
  });

  const tickTimer = setInterval(() => manager.tick(), TICK_MS);
  const saveTimer = setInterval(() => {
    if (manager.takeDirty()) store.save(manager.serialize()).catch((e) => console.warn('[persist]', e.message));
  }, SAVE_MS);

  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  if (!quiet) console.log(`Ortopoly escuchando en http://localhost:${actualPort}`);

  async function close() {
    clearInterval(tickTimer);
    clearInterval(saveTimer);
    try {
      await store.save(manager.serialize());
    } catch (e) {
      console.warn('[persist]', e.message);
    }
    io.close();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { app, io, server, manager, port: actualPort, close };
}

function session({ room, member }) {
  return { ok: true, code: room.code, playerId: member.id, secret: member.secret };
}

function stripInternal(res) {
  const out = { ok: res.ok };
  if (res.error) out.error = res.error;
  if (res.params) out.params = res.params;
  for (const k of ['code', 'playerId', 'secret']) if (res[k] !== undefined) out[k] = res[k];
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const srv = await startServer();
  const shutdown = async () => {
    console.log('Guardando salas y cerrando…');
    await srv.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
