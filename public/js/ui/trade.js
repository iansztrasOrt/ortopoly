// Compositor de tratos (propuesta nueva o contraoferta).
import { SPACES } from '/engine/board.js';
import { tradeablePropBlocker } from '/engine/legal.js';
import { h, clear } from '../dom.js';
import { t, money } from '../i18n/index.js';
import { store, myId, spaceName, groupInfo, nameOf } from '../store.js';
import { act } from '../net.js';
import { openModal } from './modals.js';
import { propsByGroup, avatarEl } from './panels.js';
import { errorText } from './format.js';
import { toast } from './toast.js';
import { tradeSideList } from './dialogs.js';

/**
 * @param {object} opts
 * @param {string} [opts.to] socio preseleccionado
 * @param {object} [opts.counter] trato original (para contraoferta: se invierte)
 */
export function openTradeComposer({ to = null, counter = null } = {}) {
  const state = store.game;
  const others = state.players.filter((p) => p.id !== myId() && !p.bankrupt);
  if (!others.length) return;
  let partner = counter ? counter.from : (to && others.some((p) => p.id === to) ? to : others[0].id);
  const give = { money: 0, props: new Set(), cards: 0 };
  const get = { money: 0, props: new Set(), cards: 0 };
  if (counter) {
    // En la contraoferta, lo que el otro pedía es lo que yo daría, y viceversa.
    counter.get.props.forEach((p) => give.props.add(p));
    counter.give.props.forEach((p) => get.props.add(p));
    give.money = counter.get.money;
    get.money = counter.give.money;
    give.cards = counter.get.cards;
    get.cards = counter.give.cards;
  }

  openModal({
    key: counter ? `counter-${counter.id}` : 'trade-composer',
    wide: true,
    title: counter ? `${t('trade.counter')} · ${nameOf(partner)}` : t('trade.title'),
    build(body, ctrl) {
      const select = h('select', {
        class: 'select', 'aria-label': t('trade.with'), disabled: Boolean(counter),
        on: {
          change: () => {
            partner = select.value;
            get.props.clear();
            get.money = 0;
            get.cards = 0;
            renderCols();
          },
        },
      }, others.map((p) => h('option', { value: p.id, selected: p.id === partner }, p.name)));
      const cols = h('div', { class: 'trade-cols' });
      const pending = h('div');
      body.append(h('label', { class: 'field' }, h('span', {}, t('trade.with')), select), cols,
        h('p', { class: 'muted', style: { fontSize: '.85rem' } }, t('trade.mortgagedNote')), pending);

      function column(ownerId, side, title) {
        const owner = store.game.players.find((p) => p.id === ownerId);
        const col = h('div', { class: 'trade-col' }, h('h3', {}, avatarEl(ownerId, { small: true }), ' ', title));
        const list = h('div', { class: 'trade-props' });
        for (const [g, positions] of propsByGroup(store.game, ownerId)) {
          const gi = groupInfo(g);
          for (const pos of positions) {
            const reason = tradeablePropBlocker(store.game, ownerId, pos);
            const id = `tp-${ownerId}-${pos}`;
            const cb = h('input', {
              type: 'checkbox', id, checked: side.props.has(pos), disabled: Boolean(reason),
              on: { change: () => { if (cb.checked) side.props.add(pos); else side.props.delete(pos); } },
            });
            if (reason) side.props.delete(pos);
            const pr = store.game.props[pos];
            list.append(h('label', { class: ['trade-prop', reason && 'disabled'], for: id, style: { '--gcol': gi.color }, title: reason ? errorText(reason) : '' },
              cb, h('span', {}, spaceName(pos), pr.mortgaged ? ` · ${t('deed.mortgaged').toLowerCase()}` : '', reason === 'group_has_buildings' ? ` · ${t('trade.hasBuildings')}` : '')));
          }
        }
        if (!list.children.length) list.append(h('p', { class: 'muted' }, t('trade.nothing')));
        const moneyIn = h('input', {
          class: 'input', type: 'number', min: '0', max: String(owner.money), step: '1', value: String(side.money || 0), inputmode: 'numeric',
          on: { input: () => { side.money = Math.max(0, Math.min(owner.money, Math.floor(Number(moneyIn.value) || 0))); } },
        });
        col.append(list, h('label', { class: 'field' }, h('span', {}, `${t('trade.money')} (${t('trade.max')} ${money(owner.money)})`), moneyIn));
        if (owner.jailCards.length) {
          const cardsIn = h('input', {
            class: 'input', type: 'number', min: '0', max: String(owner.jailCards.length), step: '1', value: String(side.cards || 0),
            on: { input: () => { side.cards = Math.max(0, Math.min(owner.jailCards.length, Math.floor(Number(cardsIn.value) || 0))); } },
          });
          col.append(h('label', { class: 'field' }, h('span', {}, t('trade.cards')), cardsIn));
        } else {
          side.cards = 0;
        }
        return col;
      }

      function renderCols() {
        clear(cols).append(
          column(myId(), give, t('trade.youGive')),
          column(partner, get, t('trade.theyGive', { player: nameOf(partner) })),
        );
        ctrl.setTitle(counter ? `${t('trade.counter')} · ${nameOf(partner)}` : t('trade.title'));
      }

      function renderPending() {
        clear(pending);
        const mine = store.game.trades.filter((tr) => tr.from === myId());
        if (!mine.length) return;
        pending.append(h('h3', { style: { fontSize: '1rem' } }, t('trade.pendingOut')));
        for (const tr of mine) {
          pending.append(h('div', { class: 'banner teal' },
            h('span', {}, `→ ${nameOf(tr.to)}`),
            h('div', { class: 'trade-summary', style: { flex: '1' } }, tradeSideList(tr.give), tradeSideList(tr.get)),
            h('button', { class: 'btn btn-sm', type: 'button', on: { click: () => act('rejectTrade', { tradeId: tr.id }) } }, t('trade.cancel'))));
        }
      }

      const send = h('button', {
        class: 'btn btn-primary',
        type: 'button',
        on: {
          click: async () => {
            const offer = {
              to: partner,
              give: { money: give.money, props: [...give.props], cards: give.cards },
              get: { money: get.money, props: [...get.props], cards: get.cards },
            };
            if (!offer.give.money && !offer.get.money && !offer.give.props.length && !offer.get.props.length && !offer.give.cards && !offer.get.cards) {
              toast(t('trade.empty'), 'warn');
              return;
            }
            const res = counter
              ? await act('counterTrade', { tradeId: counter.id, offer })
              : await act('proposeTrade', { offer });
            if (res.ok) {
              toast(t('trade.sent', { player: nameOf(partner) }), 'success');
              ctrl.close();
            }
          },
        },
      }, t('trade.send'));
      ctrl.foot.append(h('button', { class: 'btn', type: 'button', on: { click: () => ctrl.close() } }, t('common.cancel')), send);
      renderCols();
      return { update: renderPending };
    },
  });
}

export { SPACES };
