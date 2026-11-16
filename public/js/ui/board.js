// Tablero: casillas (CSS Grid), edificios, dueños, fichas animadas, dados y cartas.
import { SPACES, HOTEL_LEVEL } from '/engine/board.js';
import { h, clear, sleep, prefersReducedMotion } from '../dom.js';
import { t, tr, money, interpolate } from '../i18n/index.js';
import { store, spaceName, groupInfo, playerColor, playerEmoji, theme } from '../store.js';
import { sfx } from '../audio.js';

const C = 14; // % esquina
const W = 8; // % casilla

export function gridPos(pos) {
  if (pos <= 10) return [11, 11 - pos];
  if (pos <= 20) return [11 - (pos - 10), 1];
  if (pos <= 30) return [1, 1 + (pos - 20)];
  return [1 + (pos - 30), 11];
}

function sideOf(pos) {
  if (pos % 10 === 0) return 'corner';
  if (pos < 10) return 'b';
  if (pos < 20) return 'l';
  if (pos < 30) return 't';
  return 'r';
}

/** Centro de la casilla en % del tablero. */
export function cellCenter(pos) {
  if (pos === 0) return [100 - C / 2, 100 - C / 2];
  if (pos < 10) return [100 - C - W * (pos - 1) - W / 2, 100 - C / 2 + 1.5];
  if (pos === 10) return [C / 2, 100 - C / 2];
  if (pos < 20) return [C / 2 - 1.5, 100 - C - W * (pos - 11) - W / 2];
  if (pos === 20) return [C / 2, C / 2];
  if (pos < 30) return [C + W * (pos - 21) + W / 2, C / 2 - 1.5];
  if (pos === 30) return [100 - C / 2, C / 2];
  return [100 - C / 2 + 1.5, C + W * (pos - 31) + W / 2];
}

const OFFSETS = [[0, 0], [-2.3, -2.3], [2.3, 2.3], [2.3, -2.3], [-2.3, 2.3], [0, -3.4], [0, 3.4], [-3.4, 0]];
const JAIL_CELL = [9.25, 90.75];
const VISIT = [[2.6, 97.3], [2.6, 92], [2.6, 87.6], [6.4, 97.4], [10.6, 97.4], [2.6, 89.8], [8.5, 97.4], [12.6, 97.4]];

const ICONS = {
  railroad: '🚆', chance: '❓', community: '🏘️', parking: '⛲', gotojail: '👮', go: '⬅',
};

function iconFor(sp) {
  if (sp.type === 'utility') return sp.pos === 12 ? '💡' : '🚰';
  if (sp.type === 'tax') return sp.pos === 4 ? '💸' : '💎';
  return ICONS[sp.type] || '';
}

function isLight(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 165;
}

export { isLight };

export function createBoard(container, { onCellClick }) {
  const cells = new Map();
  const board = h('div', { class: 'board', role: 'grid', 'aria-label': 'Tablero' });

  for (const sp of SPACES) {
    const [row, col] = gridPos(sp.pos);
    const side = sideOf(sp.pos);
    const cell = h('button', {
      class: ['cell', side === 'corner' ? 'corner' : `side-${side}`, sp.type, sp.type === 'jail' && 'jail', sp.type === 'go' && 'go'],
      type: 'button',
      style: { gridRow: String(row), gridColumn: String(col) },
      dataset: { pos: String(sp.pos) },
      on: { click: () => onCellClick(sp.pos) },
    });
    cells.set(sp.pos, cell);
    board.append(cell);
  }

  const centerBrand = h('div', { class: 'center-brand', 'aria-hidden': 'true' }, 'Ortopoly');
  const decks = h('div', { class: 'decks', 'aria-hidden': 'true' });
  const top = h('div', { class: 'center-top' });
  const dice = createDice();
  const actions = h('div', { class: 'actions' });
  const mid = h('div', { class: 'center-mid' }, dice.el, actions);
  const foot = h('div', { class: 'center-foot' });
  const center = h('div', { class: 'center' }, centerBrand, decks, top, mid, foot);
  board.append(center);

  const tokensLayer = h('div', { class: 'tokens', 'aria-hidden': 'true' });
  board.append(tokensLayer);
  container.append(board);

  const tokenEls = new Map();
  const displayPos = new Map();
  const animating = new Set();
  let renderedTheme = null;
  let lastState = null;

  function renderCellContent(sp) {
    const cell = cells.get(sp.pos);
    clear(cell);
    const name = spaceName(sp.pos);
    if (sp.type === 'go') {
      cell.append(h('div', { class: 'inner' },
        h('div', { class: 'sub' }, t('deed.goShort')),
        h('div', { class: 'cname' }, name),
        h('div', { class: 'big' }, '⬅')));
    } else if (sp.type === 'jail') {
      cell.append(h('div', { class: 'inner' },
        h('div', { class: 'jail-box' }, h('span', {}, name))),
      h('div', { class: 'jail-visit' }, t('deed.visiting')));
    } else if (sp.type === 'parking' || sp.type === 'gotojail') {
      cell.append(h('div', { class: 'inner' },
        h('div', { class: 'big' }, iconFor(sp)),
        h('div', { class: 'cname' }, name)));
    } else if (sp.type === 'street') {
      const g = groupInfo(sp.group);
      cell.style.setProperty('--gcol', g.color);
      cell.append(h('div', { class: 'inner' },
        h('div', { class: 'band' }),
        h('div', { class: 'name' }, name),
        h('div', { class: 'price' }, money(sp.price)),
        h('div', { class: 'owner-bar' })));
    } else {
      const sub = sp.price ? money(sp.price) : sp.type === 'tax' ? `${t('debt.pay', { amount: money(sp.amount) })}` : '';
      cell.append(h('div', { class: 'inner' },
        h('div', { class: 'name' }, name),
        h('div', { class: 'icon' }, iconFor(sp)),
        h('div', { class: 'price' }, sub),
        sp.price ? h('div', { class: 'owner-bar' }) : null));
    }
    cell.setAttribute('aria-label', name);
  }

  function renderStatic() {
    const th = theme();
    if (renderedTheme === th.id) return;
    renderedTheme = th.id;
    for (const sp of SPACES) renderCellContent(sp);
    clear(decks).append(
      h('div', { class: 'deck chance' }, th.decks.chance),
      h('div', { class: 'deck community' }, th.decks.community),
    );
  }

  function updateCells(state) {
    for (const sp of SPACES) {
      if (!sp.price) continue;
      const cell = cells.get(sp.pos);
      const pr = state.props[sp.pos];
      const owner = pr.owner;
      cell.classList.toggle('owned', Boolean(owner));
      cell.classList.toggle('mortgaged', Boolean(pr.mortgaged));
      cell.style.setProperty('--owner', owner ? playerColor(owner) : 'transparent');
      const inner = cell.querySelector('.inner');
      if (inner) inner.dataset.mortgaged = t('deed.mortgaged');
      if (sp.type === 'street') {
        const band = cell.querySelector('.band');
        clear(band);
        if (pr.level === HOTEL_LEVEL) band.append(h('div', { class: 'hotel', 'aria-hidden': 'true' }, 'H'));
        else for (let i = 0; i < pr.level; i += 1) band.append(h('div', { class: 'house', 'aria-hidden': 'true' }));
      }
      const ownerName = owner ? state.players.find((p) => p.id === owner)?.name : null;
      const parts = [spaceName(sp.pos), money(sp.price)];
      if (ownerName) parts.push(t('deed.owner', { player: ownerName }));
      if (pr.level) parts.push(tr('deed.level')[pr.level]);
      if (pr.mortgaged) parts.push(t('deed.mortgaged'));
      cell.setAttribute('aria-label', parts.join(', '));
    }
  }

  function tokenFor(p) {
    let el = tokenEls.get(p.id);
    if (!el) {
      el = h('div', { class: 'token', style: { '--pc': playerColor(p.id) } }, h('span', {}, playerEmoji(p.id)));
      tokenEls.set(p.id, el);
      tokensLayer.append(el);
    }
    return el;
  }

  function layoutTokens() {
    const state = lastState;
    if (!state) return;
    const groups = new Map();
    for (const p of state.players) {
      const el = tokenFor(p);
      el.classList.toggle('bankrupt', p.bankrupt);
      el.classList.toggle('current', state.turn.playerId === p.id);
      if (p.bankrupt) continue;
      const pos = displayPos.has(p.id) ? displayPos.get(p.id) : p.position;
      const key = pos === 10 ? (p.inJail && !animating.has(p.id) ? 'jail' : 'visit') : String(pos);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    for (const [key, list] of groups) {
      list.forEach((p, i) => {
        let x;
        let y;
        if (key === 'jail') {
          [x, y] = JAIL_CELL;
          const [ox, oy] = OFFSETS[i % OFFSETS.length];
          x += ox * 0.8;
          y += oy * 0.8;
        } else if (key === 'visit') {
          [x, y] = VISIT[i % VISIT.length];
        } else {
          [x, y] = cellCenter(Number(key));
          const [ox, oy] = list.length === 1 ? [0, 0] : OFFSETS[(i + 1) % OFFSETS.length];
          x += ox;
          y += oy;
        }
        const el = tokenEls.get(p.id);
        el.style.left = `${x}%`;
        el.style.top = `${y}%`;
      });
    }
  }

  async function animateMove(ev) {
    const { playerId, from, to, steps, direct } = ev;
    const el = tokenEls.get(playerId);
    animating.add(playerId);
    const reduce = prefersReducedMotion();
    if (direct || reduce || !el) {
      displayPos.set(playerId, to);
      layoutTokens();
      await sleep(reduce ? 0 : 250);
    } else {
      const n = Math.abs(steps);
      const dir = Math.sign(steps) || 1;
      const delay = n > 14 ? 90 : 150;
      let cur = from;
      for (let i = 0; i < n; i += 1) {
        cur = (cur + dir + 40) % 40;
        displayPos.set(playerId, cur);
        layoutTokens();
        el.classList.remove('hop');
        // reflow para reiniciar la animación
        void el.offsetWidth;
        el.classList.add('hop');
        if (i % 2 === 0 || n < 10) sfx.step();
        await sleep(delay);
      }
      displayPos.set(playerId, to);
    }
    animating.delete(playerId);
    layoutTokens();
    highlight(to);
  }

  function highlight(pos) {
    const cell = cells.get(pos);
    if (!cell) return;
    cell.classList.remove('landed');
    void cell.offsetWidth;
    cell.classList.add('landed');
  }

  function update(state, { syncTokens = true } = {}) {
    lastState = state;
    renderStatic();
    updateCells(state);
    if (syncTokens) {
      for (const p of state.players) if (!animating.has(p.id)) displayPos.set(p.id, p.position);
    }
    layoutTokens();
  }

  function showCard({ deck, cardId, playerId }) {
    const th = theme();
    const params = {};
    for (const k of [5, 11, 24, 39]) params[`s${k}`] = th.spaces[k];
    const pop = h('div', {
      class: 'card-pop',
      role: 'dialog',
      'aria-label': th.decks[deck],
      style: { '--deck-c': deck === 'chance' ? 'var(--accent)' : 'var(--teal)' },
      on: { click: () => pop.remove() },
    },
    h('h3', {}, th.decks[deck]),
    h('p', {}, interpolate(tr(`cards.${cardId}`) || cardId, params)),
    h('div', { class: 'who' }, `${store.game?.players.find((p) => p.id === playerId)?.name || ''} · ${t('common.close')}`));
    center.querySelectorAll('.card-pop').forEach((n) => n.remove());
    center.append(pop);
    sfx.card();
    setTimeout(() => pop.remove(), 4200);
  }

  return {
    el: board,
    top,
    actions,
    foot,
    dice,
    update,
    animateMove,
    showCard,
    highlight,
    layoutTokens,
    isAnimating: () => animating.size > 0,
  };
}

// ---------------------------------------------------------------- dados 3D

const PIPS = {
  1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9],
};
const FACE_ROT = {
  1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180],
};

function makeDie() {
  const die = h('div', { class: 'die' });
  for (let f = 1; f <= 6; f += 1) {
    const face = h('div', { class: `face f${f}` });
    for (let cell = 1; cell <= 9; cell += 1) {
      face.append(PIPS[f].includes(cell) ? h('i', { class: 'pip' }) : h('span'));
    }
    die.append(face);
  }
  return die;
}

function createDice() {
  const d1 = makeDie();
  const d2 = makeDie();
  const el = h('div', { class: 'dice', role: 'img', 'aria-label': '' }, d1, d2);
  let spins = 0;
  function set(die, value, extra) {
    const [rx, ry] = FACE_ROT[value];
    die.style.transform = `rotateX(${rx + extra * 360 + 15}deg) rotateY(${ry + extra * 360 - 15}deg)`;
  }
  set(d1, 1, 0);
  set(d2, 6, 0);
  return {
    el,
    async roll(values, { animate = true } = {}) {
      spins += 2;
      el.classList.toggle('double', values[0] === values[1]);
      el.setAttribute('aria-label', `${values[0]} + ${values[1]}`);
      if (animate && !prefersReducedMotion()) {
        sfx.dice();
        set(d1, values[0], spins);
        set(d2, values[1], spins + 1);
        await sleep(950);
      } else {
        set(d1, values[0], spins);
        set(d2, values[1], spins);
      }
    },
  };
}
