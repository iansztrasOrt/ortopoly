// Formateo de entradas del registro y textos de cartas según idioma y tema.
import { tr, t, money, interpolate } from '../i18n/index.js';
import { nameOf, spaceName, theme } from '../store.js';

const PLAYER_KEYS = new Set(['player', 'owner', 'creditor', 'to', 'from', 'winner', 'requester']);
const MONEY_KEYS = new Set(['amount', 'price', 'cost', 'min']);

export function cardText(id) {
  const th = theme();
  const params = {};
  for (const k of [5, 11, 24, 39]) params[`s${k}`] = th.spaces[k];
  const txt = tr(`cards.${id}`);
  return typeof txt === 'string' ? interpolate(txt, params) : id;
}

export function formatLog(entry) {
  const tpl = tr(`log.${entry.k}`);
  if (typeof tpl !== 'string') return entry.k;
  const p = entry.p || {};
  const params = {};
  for (const [k, v] of Object.entries(p)) {
    if (PLAYER_KEYS.has(k)) params[k] = nameOf(v);
    else if (k === 'pos') params[k] = spaceName(v);
    else if (MONEY_KEYS.has(k)) params[k] = money(v);
    else params[k] = v;
  }
  if (p.dice) params.dice = `${p.dice[0]} + ${p.dice[1]}`;
  if (entry.k === 'rolled') params.double = p.double ? tr('log.doubleSuffix') : '';
  if (entry.k === 'go_to_jail') params.reason = (tr('log.jailReason') || {})[p.reason] || '';
  if (entry.k === 'game_start') params.order = (p.order || []).map(nameOf).join(' → ');
  if (entry.k === 'card_drawn') {
    params.deck = theme().decks[p.deck];
    params.card = cardText(p.card);
  }
  if (entry.k === 'debt_created' || entry.k === 'debt_paid') params.creditor = nameOf(p.creditor);
  return interpolate(tpl, params);
}

export function reasonText(reason) {
  const r = tr(`reasons.${reason}`);
  return typeof r === 'string' ? r : reason;
}

export function errorText(code) {
  const key = `errors.${code}`;
  const v = t(key);
  return v === key ? code : v;
}

export function timeOf(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
