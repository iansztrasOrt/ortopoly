// Gestión de salas (lobby, sesiones, partidas, bots, temporizadores).
// No sabe nada de sockets: el transporte le pasa intenciones y recibe
// notificaciones vía `notify(room, { lobby, game, events })`.

import crypto from 'node:crypto';
import * as G from '../engine/game.js';
import { makeCtx } from '../engine/util.js';
import { AVATAR_IDS, COLOR_IDS } from '../shared/avatars.js';
import { THEMES } from '../shared/themes/index.js';
import { cleanName, cleanChat, cleanCode, REACTIONS } from './sanitize.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_SPECTATORS = 12;
const BOT_NAMES = ['Ramona', 'Tito', 'Chiqui', 'Pocho', 'Mirta', 'Coco', 'Beba', 'Tano', 'Nené', 'Toto'];

export const cryptoRng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

const ok = (extra = {}) => ({ ok: true, ...extra });
const no = (error, params) => ({ ok: false, error, params });

export class RoomManager {
  constructor({
    rng = cryptoRng,
    now = () => Date.now(),
    notify = () => {},
    graceMs = Number(process.env.DISCONNECT_GRACE_MS) || 30000,
    botIntervalMs = 900,
    idleMs = 30 * 60 * 1000,
    endedTtlMs = 2 * 60 * 60 * 1000,
    lobbyDropMs = 2 * 60 * 1000,
    maxRooms = 500,
  } = {}) {
    Object.assign(this, { rng, now, notify, graceMs, botIntervalMs, idleMs, endedTtlMs, lobbyDropMs, maxRooms });
    this.rooms = new Map();
  }

  ctx() {
    return makeCtx({ rng: this.rng, now: this.now() });
  }

  touch(room) {
    room.lastActivity = this.now();
    room.dirty = true;
  }

  // ------------------------------------------------------------------ helpers

  newCode() {
    for (let i = 0; i < 1000; i += 1) {
      let code = '';
      for (let j = 0; j < 5; j += 1) code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('no_codes');
  }

  get(code) {
    const c = cleanCode(code);
    return c ? this.rooms.get(c) || null : null;
  }

  member(room, pid) {
    return room.members.find((m) => m.id === pid) || null;
  }

  isHost(room, pid) {
    return room.hostId === pid;
  }

  freeAvatar(room) {
    return AVATAR_IDS.find((a) => !room.members.some((m) => m.avatar === a));
  }

  freeColor(room) {
    return COLOR_IDS.find((c) => !room.members.some((m) => m.color === c));
  }

  newMember(room, name, isBot = false, spectator = false) {
    return {
      id: `u_${crypto.randomBytes(5).toString('hex')}`,
      secret: crypto.randomBytes(18).toString('hex'),
      name,
      spectator,
      avatar: spectator ? null : this.freeAvatar(room),
      color: spectator ? null : this.freeColor(room),
      ready: isBot,
      isBot,
      connected: isBot,
      disconnectedAt: null,
      graceHandled: false,
      joinedAt: this.now(),
    };
  }

  // ------------------------------------------------------------------ lobby

  createRoom(rawName) {
    const name = cleanName(rawName);
    if (!name) return no('invalid_name');
    if (this.rooms.size >= this.maxRooms) return no('server_full');
    const code = this.newCode();
    const room = {
      code,
      hostId: null,
      phase: 'lobby',
      settings: G.normalizeSettings({}),
      members: [],
      game: null,
      chat: [],
      chatSeq: 0,
      createdAt: this.now(),
      lastActivity: this.now(),
      lastBotAt: 0,
      dirty: true,
    };
    const m = this.newMember(room, name);
    room.members.push(m);
    room.hostId = m.id;
    this.rooms.set(code, room);
    return ok({ room, member: m });
  }

  joinRoom(rawCode, rawName) {
    const room = this.get(rawCode);
    if (!room) return no('room_not_found');
    const name = cleanName(rawName);
    if (!name) return no('invalid_name');
    const spectator = room.phase !== 'lobby' || this.players(room).length >= G.MAX_PLAYERS;
    if (spectator && room.members.length >= G.MAX_PLAYERS + MAX_SPECTATORS) return no('room_full');
    let finalName = name;
    let n = 2;
    while (room.members.some((m) => m.name.toLowerCase() === finalName.toLowerCase())) finalName = `${name.slice(0, 17)} ${n++}`;
    const m = this.newMember(room, finalName, false, spectator);
    room.members.push(m);
    if (spectator) this.systemChat(room, 'spectator_joined', { player: m.id });
    this.touch(room);
    this.notify(room, { lobby: true });
    return ok({ room, member: m });
  }

  /** En el lobby, los espectadores se suman como jugadores mientras haya lugar. */
  promoteSpectators(room) {
    if (room.phase !== 'lobby') return;
    for (const m of room.members) {
      if (m.spectator && this.players(room).length < G.MAX_PLAYERS) {
        m.spectator = false;
        m.ready = false;
        m.avatar = this.freeAvatar(room);
        m.color = this.freeColor(room);
      }
    }
  }

  /** Miembros que juegan (no espectadores). */
  players(room) {
    return room.members.filter((m) => !m.spectator);
  }

  resume(rawCode, pid, secret) {
    const room = this.get(rawCode);
    if (!room) return no('room_not_found');
    const m = this.member(room, pid);
    if (!m || m.isBot || typeof secret !== 'string' || !timingSafeEqual(m.secret, secret)) return no('invalid_session');
    return ok({ room, member: m });
  }

  setConnected(room, pid, connected) {
    const m = this.member(room, pid);
    if (!m || m.isBot) return;
    m.connected = connected;
    if (connected) {
      m.disconnectedAt = null;
      if (room.game && m.graceHandled) G.onReconnect(room.game, pid);
      m.graceHandled = false;
    } else {
      m.disconnectedAt = this.now();
    }
    this.touch(room);
    this.notify(room, { lobby: true, game: Boolean(room.game) });
  }

  leave(room, pid) {
    const m = this.member(room, pid);
    if (!m) return;
    if (room.phase === 'lobby') {
      room.members = room.members.filter((x) => x.id !== pid);
      this.promoteSpectators(room);
      this.ensureHost(room);
    } else {
      m.connected = false;
      m.disconnectedAt = this.now() - this.graceMs; // abandono: sin período de gracia
    }
    this.touch(room);
    if (!room.members.some((x) => !x.isBot)) this.deleteRoom(room);
    else this.notify(room, { lobby: true, game: Boolean(room.game) });
  }

  ensureHost(room) {
    const host = this.member(room, room.hostId);
    if (host && !host.isBot && (host.connected || room.phase === 'lobby')) return;
    const humans = room.members.filter((m) => !m.isBot);
    const next = humans.find((m) => !m.spectator && m.connected) || humans.find((m) => !m.spectator) || humans.find((m) => m.connected) || humans[0];
    if (next && next.id !== room.hostId) {
      room.hostId = next.id;
      this.systemChat(room, 'host_changed', { player: next.id });
    }
  }

  updateMember(room, pid, patch = {}) {
    if (room.phase !== 'lobby') return no('game_in_progress');
    const m = this.member(room, pid);
    if (!m) return no('unknown_player');
    if (m.spectator && (patch.avatar !== undefined || patch.color !== undefined || patch.ready !== undefined)) return no('spectator_only');
    if (patch.avatar !== undefined) {
      if (!AVATAR_IDS.includes(patch.avatar)) return no('invalid_avatar');
      if (room.members.some((x) => x.id !== pid && x.avatar === patch.avatar)) return no('avatar_taken');
      m.avatar = patch.avatar;
    }
    if (patch.color !== undefined) {
      if (!COLOR_IDS.includes(patch.color)) return no('invalid_color');
      if (room.members.some((x) => x.id !== pid && x.color === patch.color)) return no('color_taken');
      m.color = patch.color;
    }
    if (patch.ready !== undefined) m.ready = Boolean(patch.ready);
    if (patch.name !== undefined) {
      const name = cleanName(patch.name);
      if (!name) return no('invalid_name');
      m.name = name;
    }
    this.touch(room);
    this.notify(room, { lobby: true });
    return ok();
  }

  updateSettings(room, pid, settings) {
    if (!this.isHost(room, pid)) return no('host_only');
    if (room.phase !== 'lobby') return no('game_in_progress');
    const next = G.normalizeSettings({ ...room.settings, ...settings, houseRules: { ...room.settings.houseRules, ...(settings?.houseRules || {}) } });
    if (!THEMES[next.theme]) next.theme = room.settings.theme;
    room.settings = next;
    if (!next.houseRules.bots) room.members = room.members.filter((m) => !m.isBot);
    for (const m of room.members) if (!m.isBot && m.id !== room.hostId) m.ready = false;
    this.touch(room);
    this.notify(room, { lobby: true });
    return ok();
  }

  kick(room, pid, targetId) {
    if (!this.isHost(room, pid)) return no('host_only');
    if (room.phase !== 'lobby') return no('game_in_progress');
    if (targetId === pid) return no('cannot_kick_self');
    const target = this.member(room, targetId);
    if (!target) return no('unknown_player');
    room.members = room.members.filter((m) => m.id !== targetId);
    this.promoteSpectators(room);
    this.touch(room);
    this.notify(room, { lobby: true, kicked: targetId });
    return ok({ target });
  }

  addBot(room, pid) {
    if (!this.isHost(room, pid)) return no('host_only');
    if (room.phase !== 'lobby') return no('game_in_progress');
    if (!room.settings.houseRules.bots) return no('bots_disabled');
    if (this.players(room).length >= G.MAX_PLAYERS) return no('room_full');
    const used = new Set(room.members.map((m) => m.name));
    const base = BOT_NAMES.find((n) => !used.has(`🤖 ${n}`)) || `Bot ${room.members.length + 1}`;
    const bot = this.newMember(room, `🤖 ${base}`, true);
    room.members.push(bot);
    this.touch(room);
    this.notify(room, { lobby: true });
    return ok();
  }

  canStart(room) {
    if (room.phase !== 'lobby') return 'game_in_progress';
    const players = this.players(room);
    if (players.length < G.MIN_PLAYERS) return 'need_more_players';
    if (players.length > G.MAX_PLAYERS) return 'room_full';
    if (players.some((m) => !m.isBot && m.id !== room.hostId && (!m.ready || !m.connected))) return 'players_not_ready';
    return null;
  }

  start(room, pid) {
    if (!this.isHost(room, pid)) return no('host_only');
    const reason = this.canStart(room);
    if (reason) return no(reason);
    const ctx = this.ctx();
    room.game = G.createGame({
      players: this.players(room).map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, color: m.color, isBot: m.isBot })),
      settings: room.settings,
    }, ctx);
    room.phase = 'playing';
    this.touch(room);
    this.notify(room, { lobby: true, game: true, events: [{ type: 'gameStart' }, ...ctx.events] });
    return ok();
  }

  // ------------------------------------------------------------------ juego

  action(room, pid, action) {
    if (!room.game || room.phase !== 'playing') return no('game_not_running');
    if (!action || typeof action !== 'object' || !G.ACTION_TYPES.includes(action.type)) return no('unknown_action');
    const ctx = this.ctx();
    const res = G.applyAction(room.game, pid, action, ctx);
    if (!res.ok) return res;
    this.afterGameChange(room, ctx);
    return ok();
  }

  host(room, pid, { type, playerId } = {}) {
    if (!this.isHost(room, pid)) return no('host_only');
    if (!room.game || room.phase !== 'playing') return no('game_not_running');
    const ctx = this.ctx();
    let res;
    if (type === 'replaceWithBot') res = G.hostReplaceWithBot(room.game, playerId, ctx);
    else if (type === 'bankrupt') res = G.hostBankrupt(room.game, playerId, ctx);
    else if (type === 'endGame') res = G.hostEndGame(room.game, ctx);
    else if (type === 'dismiss') {
      if (room.game.hostDecision === playerId) room.game.hostDecision = null;
      room.game.version += 1;
      res = ok();
    } else return no('unknown_action');
    if (!res.ok) return res;
    if (type === 'replaceWithBot') {
      const m = this.member(room, playerId);
      if (m) m.isBot = true;
    }
    this.afterGameChange(room, ctx);
    return ok();
  }

  afterGameChange(room, ctx) {
    if (room.game.phase === 'ended' && room.phase === 'playing') {
      room.phase = 'ended';
      room.endedAt = this.now();
    }
    this.touch(room);
    this.notify(room, { lobby: room.phase === 'ended', game: true, events: ctx.events });
  }

  rematch(room, pid) {
    if (!this.isHost(room, pid)) return no('host_only');
    if (room.phase !== 'ended') return no('game_not_ended');
    room.phase = 'lobby';
    room.game = null;
    room.members = room.members.filter((m) => m.isBot || m.connected);
    this.promoteSpectators(room);
    for (const m of room.members) m.ready = m.isBot;
    this.ensureHost(room);
    this.touch(room);
    this.notify(room, { lobby: true, game: true });
    return ok();
  }

  // ------------------------------------------------------------------ chat

  systemChat(room, key, params) {
    this.pushChat(room, { kind: 'system', key, params });
  }

  pushChat(room, msg) {
    room.chatSeq += 1;
    const entry = { id: room.chatSeq, t: this.now(), ...msg };
    room.chat.push(entry);
    if (room.chat.length > 100) room.chat.shift();
    this.notify(room, { chat: entry });
    return entry;
  }

  chat(room, pid, rawText) {
    const m = this.member(room, pid);
    if (!m) return no('unknown_player');
    const text = cleanChat(rawText);
    if (!text) return no('invalid_message');
    this.touch(room);
    return ok({ entry: this.pushChat(room, { kind: 'msg', playerId: pid, name: m.name, text }) });
  }

  react(room, pid, emoji) {
    const m = this.member(room, pid);
    if (!m) return no('unknown_player');
    if (!REACTIONS.includes(emoji)) return no('invalid_reaction');
    this.notify(room, { reaction: { playerId: pid, emoji, t: this.now() } });
    return ok();
  }

  // ------------------------------------------------------------------ reloj

  tick() {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      try {
        this.tickRoom(room, now);
      } catch (e) {
        console.error(`[tick] sala ${room.code}:`, e);
      }
    }
  }

  tickRoom(room, now) {
    // Lobby: quitar a quienes se fueron hace rato.
    if (room.phase === 'lobby') {
      const before = room.members.length;
      room.members = room.members.filter((m) => m.isBot || m.connected || now - m.disconnectedAt < this.lobbyDropMs);
      if (room.members.length !== before) {
        this.promoteSpectators(room);
        this.ensureHost(room);
        this.touch(room);
        this.notify(room, { lobby: true });
      }
    }

    const hostMember = this.member(room, room.hostId);
    if (hostMember && !hostMember.connected && now - (hostMember.disconnectedAt || now) > this.graceMs) {
      const prev = room.hostId;
      this.ensureHost(room);
      if (prev !== room.hostId) this.notify(room, { lobby: true, game: Boolean(room.game) });
    }

    const game = room.game;
    if (game && game.phase === 'playing') {
      const ctx = makeCtx({ rng: this.rng, now });
      const v = game.version;
      G.tick(game, ctx);
      for (const m of room.members) {
        if (!m.isBot && !m.connected && !m.graceHandled && now - m.disconnectedAt >= this.graceMs) {
          m.graceHandled = true;
          G.onDisconnectTimeout(game, m.id, ctx);
        }
      }
      G.skipTurnIfAway(game, ctx);
      if (now - room.lastBotAt >= this.botIntervalMs) {
        room.lastBotAt = now;
        for (const { id, autopilot } of G.autoDriven(game, now)) {
          if (game.phase !== 'playing') break;
          G.autoStep(game, id, ctx, { autopilot });
        }
      }
      if (game.version !== v || ctx.events.length) this.afterGameChange(room, ctx);
    }

    // Limpieza de salas inactivas.
    const humansOnline = room.members.some((m) => !m.isBot && m.connected);
    const idleFor = now - room.lastActivity;
    if ((!humansOnline && idleFor > this.idleMs) || (room.phase === 'ended' && now - (room.endedAt || now) > this.endedTtlMs && !humansOnline)) {
      this.deleteRoom(room);
    }
  }

  deleteRoom(room) {
    this.rooms.delete(room.code);
    room.deleted = true;
    this.onDelete?.(room);
  }

  // ------------------------------------------------------------------ vistas y persistencia

  publicRoom(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      phase: room.phase,
      settings: room.settings,
      members: room.members.map((m) => ({
        id: m.id, name: m.name, avatar: m.avatar, color: m.color, ready: m.ready, isBot: m.isBot, connected: m.connected, spectator: Boolean(m.spectator),
      })),
      canStart: this.canStart(room),
      chat: room.chat.slice(-60),
    };
  }

  serialize() {
    return [...this.rooms.values()].map((r) => {
      const { dirty, deleted, ...rest } = r;
      return rest;
    });
  }

  restore(rooms) {
    const now = this.now();
    for (const r of rooms) {
      if (!r || !r.code || this.rooms.has(r.code)) continue;
      for (const m of r.members) {
        if (!m.isBot) {
          m.connected = false;
          m.disconnectedAt = now;
          m.graceHandled = false;
        }
      }
      r.lastActivity = now;
      r.dirty = false;
      this.rooms.set(r.code, r);
    }
  }

  takeDirty() {
    let any = false;
    for (const r of this.rooms.values()) {
      if (r.dirty) any = true;
      r.dirty = false;
    }
    return any;
  }
}

function timingSafeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
