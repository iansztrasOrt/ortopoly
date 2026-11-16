// Pantalla final: ranking, estadísticas y revancha.
import { h, clear } from '../dom.js';
import { t, money } from '../i18n/index.js';
import { store, isHost, nameOf } from '../store.js';
import { call, showError } from '../net.js';
import { avatarEl } from './panels.js';
import { formatLog } from './format.js';

const STAT_KEYS = ['rentCollected', 'rentPaid', 'propertiesBought', 'turns', 'passedGo', 'doubles', 'timesJailed', 'auctionsWon', 'maxMoney'];
const MONEY_STATS = new Set(['rentCollected', 'rentPaid', 'maxMoney']);
const MEDALS = ['🥇', '🥈', '🥉'];

export function mountOver(view, { onLeave }) {
  clear(view);
  const root = h('div', { class: 'over' });
  view.append(root);

  function render() {
    const g = store.game;
    if (!g) return;
    const ranking = g.ranking || [];
    const winner = g.winner;
    const players = ranking.map((id) => g.players.find((p) => p.id === id)).filter(Boolean);
    const rank = h('ol', { class: 'ranking' }, players.map((p, i) => h('li', {},
      h('span', { class: 'pos' }, MEDALS[i] || `${i + 1}`),
      avatarEl(p.id),
      h('div', {}, h('strong', {}, p.name), p.bankrupt ? h('div', { class: 'muted' }, t('game.bankrupt')) : null),
      h('strong', {}, money(g.finalWorth?.[p.id] ?? 0)))));

    const table = h('table', { class: 'stats-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, ''), players.map((p) => h('th', { scope: 'col' }, p.name)))),
      h('tbody', {},
        h('tr', {}, h('th', { scope: 'row' }, t('over.worth')), players.map((p) => h('td', {}, money(g.finalWorth?.[p.id] ?? 0)))),
        STAT_KEYS.map((k) => h('tr', {}, h('th', { scope: 'row' }, t(`over.stat.${k}`)),
          players.map((p) => h('td', {}, MONEY_STATS.has(k) ? money(p.stats[k]) : String(p.stats[k])))))));

    const rematch = isHost()
      ? h('button', {
        class: 'btn btn-primary', type: 'button',
        on: { click: async () => { const r = await call('game:rematch'); if (!r.ok) showError(r); } },
      }, `🔁 ${t('over.rematch')}`)
      : h('p', { class: 'muted' }, t('over.waitRematch'));
    const lastLog = g.log.slice(-6).map((e) => h('li', {}, formatLog(e)));

    clear(root).append(
      h('section', { class: 'card over-hero' },
        h('div', { class: 'trophy', 'aria-hidden': 'true' }, '🏆'),
        h('h1', {}, t('over.title', { player: nameOf(winner) })),
        h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '16px' } }, rematch,
          h('button', { class: 'btn', type: 'button', on: { click: onLeave } }, t('over.home')))),
      h('section', { class: 'card card-pad' }, h('h2', { style: { marginBottom: '12px' } }, t('over.ranking')), rank),
      h('section', { class: 'card card-pad' }, h('h2', { style: { marginBottom: '12px' } }, t('over.stats')), h('div', { class: 'table-scroll' }, table)),
      h('section', { class: 'card card-pad' }, h('ol', { class: 'log-list' }, lastLog)),
    );
  }
  render();
  return { update(kind) { if (kind === 'game' || kind === 'room') render(); }, destroy() {} };
}
