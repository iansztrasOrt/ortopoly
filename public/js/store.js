// Estado del cliente: solo refleja lo que manda el servidor.
import { getTheme } from '/shared/themes/index.js';
import { colorHex, avatarEmoji } from '/shared/avatars.js';
import { t } from './i18n/index.js';

const SESSION_KEY = 'ortopoly.session';

export const store = {
  session: null, // { code, playerId, secret }
  room: null,
  game: null,
  serverOffset: 0,
  chat: [],
  connected: false,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(kind, payload) {
  for (const fn of listeners) fn(kind, payload);
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    store.session = raw ? JSON.parse(raw) : null;
  } catch {
    store.session = null;
  }
  return store.session;
}

export function saveSession(s) {
  store.session = s;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* */ }
}

export function clearSession() {
  store.session = null;
  store.room = null;
  store.game = null;
  store.chat = [];
  try { localStorage.removeItem(SESSION_KEY); } catch { /* */ }
}

export function myId() {
  return store.session?.playerId || null;
}

export function me() {
  return store.game?.players.find((p) => p.id === myId()) || null;
}

export function gamePlayer(id) {
  return store.game?.players.find((p) => p.id === id) || null;
}

export function member(id) {
  return store.room?.members.find((m) => m.id === id) || null;
}

export function isHost() {
  return store.room && store.room.hostId === myId();
}

export function theme() {
  return getTheme(store.room?.settings?.theme);
}

export function spaceName(pos) {
  return theme().spaces[pos] ?? `#${pos}`;
}

export function groupInfo(group) {
  return theme().groups[group] || { label: group, color: '#888' };
}

export function nameOf(id) {
  if (id === null || id === undefined) return t('common.bank');
  if (id === 'pot') return t('common.pot');
  const p = gamePlayer(id) || member(id);
  return p ? p.name : '?';
}

export function playerColor(id) {
  const p = gamePlayer(id) || member(id);
  return p ? colorHex(p.color) : '#888';
}

export function playerEmoji(id) {
  const p = gamePlayer(id) || member(id);
  if (p && p.spectator && !gamePlayer(id)) return '👀';
  return p ? avatarEmoji(p.avatar) : '❔';
}

export function serverNow() {
  return Date.now() + store.serverOffset;
}

export function isConnected(id) {
  const m = member(id);
  return m ? m.connected : false;
}
