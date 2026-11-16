// Transporte Socket.IO: envía intenciones y recibe estado.
import { store, notify, saveSession, clearSession, loadSession } from './store.js';
import { t } from './i18n/index.js';
import { toast } from './ui/toast.js';

let socket = null;

export function connect() {
  // eslint-disable-next-line no-undef
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', async () => {
    store.connected = true;
    notify('conn');
    const s = loadSession();
    if (s) {
      const res = await call('session:resume', s);
      if (!res.ok) {
        clearSession();
        notify('route');
        if (res.error !== 'timeout') toast(t('errors.invalid_session'), 'warn');
      }
    }
  });

  socket.on('disconnect', () => {
    store.connected = false;
    notify('conn');
  });

  socket.on('room:state', (room) => {
    const prevPhase = store.room?.phase;
    store.room = room;
    if (!store.chat.length || prevPhase === undefined) store.chat = [...room.chat];
    notify('room', { prevPhase });
  });

  socket.on('game:state', ({ state, events, serverNow }) => {
    store.serverOffset = serverNow - Date.now();
    const prev = store.game;
    store.game = state;
    notify('game', { prev, events: events || [] });
  });

  socket.on('chat:message', (msg) => {
    store.chat.push(msg);
    if (store.chat.length > 150) store.chat.shift();
    notify('chat', msg);
  });

  socket.on('chat:reaction', (r) => notify('reaction', r));

  socket.on('room:kicked', () => {
    clearSession();
    toast(t('lobby.kicked'), 'warn');
    notify('route');
  });

  socket.on('session:replaced', () => {
    toast(t('conn.replaced'), 'warn');
    store.connected = false;
    notify('conn');
  });
}

export function call(event, payload = {}) {
  return new Promise((resolve) => {
    if (!socket) {
      resolve({ ok: false, error: 'no_session' });
      return;
    }
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) resolve({ ok: false, error: 'timeout' });
      else resolve(res || { ok: false, error: 'server_error' });
    });
  });
}

/** Envía una acción del juego y muestra el error (si lo hay). */
export async function act(type, extra = {}) {
  const res = await call('game:action', { type, ...extra });
  if (!res.ok) showError(res);
  return res;
}

export function showError(res) {
  const key = `errors.${res.error}`;
  const msg = t(key, formatErrorParams(res.params));
  toast(msg === key ? t('errors.generic', { code: res.error }) : msg, 'error');
}

function formatErrorParams(params = {}) {
  const out = { ...params };
  for (const k of ['min', 'needed']) if (out[k] !== undefined) out[k] = `$${out[k]}`;
  return out;
}

export async function startSession(event, payload) {
  const res = await call(event, payload);
  if (res.ok) {
    saveSession({ code: res.code, playerId: res.playerId, secret: res.secret });
    store.chat = [];
    notify('route');
  } else {
    showError(res);
  }
  return res;
}
