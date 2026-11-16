// Arranque del cliente y router de pantallas (inicio → sala → juego → final).
import { store, subscribe, loadSession, clearSession } from './store.js';
import { connect, call } from './net.js';
import { t, setLang, getLang } from './i18n/index.js';
import { isMuted, setMuted } from './audio.js';
import { h, clear } from './dom.js';
import { mountHome } from './ui/home.js';
import { mountLobby } from './ui/lobby.js';
import { mountGame } from './ui/game.js';
import { mountOver } from './ui/over.js';

const view = document.getElementById('view');
let screen = null;
let screenName = null;

function desiredScreen() {
  if (!store.session) return 'home';
  if (!store.room) return 'loading';
  if (store.room.phase === 'lobby') return 'lobby';
  if (store.game && store.game.phase === 'ended') return 'over';
  if (store.game) return 'game';
  return 'loading';
}

async function leave() {
  await call('room:leave');
  clearSession();
  history.replaceState(null, '', '/');
  route();
}

function route() {
  const next = desiredScreen();
  if (next === screenName) return false;
  screen?.destroy?.();
  screenName = next;
  if (next === 'home') screen = mountHome(view);
  else if (next === 'lobby') screen = mountLobby(view, { onLeave: leave });
  else if (next === 'game') screen = mountGame(view, { onLeave: leave });
  else if (next === 'over') screen = mountOver(view, { onLeave: leave });
  else {
    clear(view).append(h('p', { class: 'muted', style: { textAlign: 'center', padding: '48px' } }, '…'));
    screen = null;
  }
  renderTopbar();
  return true;
}

function renderTopbar() {
  const info = document.getElementById('topbar-info');
  clear(info);
  if (store.room && screenName !== 'home') {
    info.append(h('span', { class: 'chip code', title: t('lobby.code') }, `# ${store.room.code}`));
  }
  const conn = document.getElementById('conn-status');
  conn.textContent = store.connected || !store.session ? '' : t('conn.offline');
}

subscribe((kind, payload) => {
  if (kind === 'route' || kind === 'room' || kind === 'game') {
    if (route()) return;
  }
  if (kind === 'conn') renderTopbar();
  screen?.update?.(kind, payload);
});

// ---------------------------------------------------------------- tema, sonido, idioma

const themeBtn = document.getElementById('theme-toggle');
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  themeBtn.textContent = mode === 'dark' ? '☀️' : '🌙';
  themeBtn.setAttribute('aria-label', mode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
}
let themeMode = null;
try { themeMode = localStorage.getItem('ortopoly.theme'); } catch { /* */ }
if (!themeMode) themeMode = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
applyTheme(themeMode);
themeBtn.addEventListener('click', () => {
  themeMode = themeMode === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('ortopoly.theme', themeMode); } catch { /* */ }
  applyTheme(themeMode);
});

const soundBtn = document.getElementById('sound-toggle');
function renderSound() {
  soundBtn.textContent = isMuted() ? '🔇' : '🔊';
  soundBtn.setAttribute('aria-pressed', String(isMuted()));
  soundBtn.setAttribute('aria-label', isMuted() ? 'Activar sonido' : 'Silenciar sonido');
}
soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  renderSound();
});
renderSound();

const langSel = document.getElementById('lang-select');
langSel.value = getLang();
document.documentElement.lang = getLang();
langSel.addEventListener('change', () => {
  setLang(langSel.value);
  screenName = null;
  route();
});

// ---------------------------------------------------------------- inicio

loadSession();
route();
connect();
