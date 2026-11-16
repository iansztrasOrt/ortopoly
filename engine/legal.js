// Chequeos de legalidad compartidos por servidor (validación) y cliente
// (habilitar/deshabilitar botones). Cada función devuelve null si la acción es
// legal, o un código de motivo traducible por i18n.

import { SPACES, HOTEL_LEVEL, groupMembers, unmortgageCost } from './board.js';
import { getPlayer } from './util.js';

export function hasDebt(state, pid) {
  return state.debts.some((d) => d.debtorId === pid);
}

export function ownsFullGroup(state, pid, group) {
  const members = groupMembers(group);
  return members.length > 0 && members.every((pos) => state.props[pos].owner === pid);
}

export function groupHasMortgage(state, group) {
  return groupMembers(group).some((pos) => state.props[pos].mortgaged);
}

export function groupHasBuildings(state, group) {
  return groupMembers(group).some((pos) => state.props[pos].level > 0);
}

export function groupLevels(state, group) {
  return groupMembers(group).map((pos) => state.props[pos].level);
}

function baseOwnership(state, pid, pos) {
  if (state.phase !== 'playing') return 'game_not_running';
  const sp = SPACES[pos];
  if (!sp || !sp.price) return 'not_ownable';
  const p = getPlayer(state, pid);
  if (!p || p.bankrupt) return 'player_bankrupt';
  if (state.props[pos].owner !== pid) return 'not_owner';
  return null;
}

/** ¿Puede construir (casa u hotel) en `pos`? Ignora la escasez que se resuelve por subasta. */
export function buildBlocker(state, pid, pos, { ignoreTurn = false, ignoreFunds = false } = {}) {
  const base = baseOwnership(state, pid, pos);
  if (base) return base;
  const sp = SPACES[pos];
  if (sp.type !== 'street') return 'not_a_street';
  if (!ignoreTurn) {
    if (state.turn.playerId !== pid) return 'not_your_turn';
    if (state.auction) return 'auction_in_progress';
    if (!['roll', 'end'].includes(state.turn.phase)) return 'cannot_build_now';
  }
  if (hasDebt(state, pid)) return 'has_debt';
  const pr = state.props[pos];
  if (!ownsFullGroup(state, pid, sp.group)) return 'need_full_group';
  if (groupHasMortgage(state, sp.group)) return 'group_mortgaged';
  if (pr.level >= HOTEL_LEVEL) return 'max_level';
  if (pr.level > Math.min(...groupLevels(state, sp.group))) return 'uneven_build';
  if (!ignoreFunds && getPlayer(state, pid).money < sp.houseCost) return 'insufficient_funds';
  if (pr.level === HOTEL_LEVEL - 1) {
    if (state.bank.hotels <= 0) return 'no_hotels_left';
  } else if (state.bank.houses <= 0) return 'no_houses_left';
  return null;
}

export function sellBlocker(state, pid, pos) {
  const base = baseOwnership(state, pid, pos);
  if (base) return base;
  const sp = SPACES[pos];
  if (sp.type !== 'street') return 'not_a_street';
  const pr = state.props[pos];
  if (pr.level <= 0) return 'no_buildings';
  if (state.turn.playerId !== pid && !hasDebt(state, pid)) return 'sell_only_turn_or_debt';
  if (pr.level < Math.max(...groupLevels(state, sp.group))) return 'uneven_sell';
  return null;
}

export function mortgageBlocker(state, pid, pos) {
  const base = baseOwnership(state, pid, pos);
  if (base) return base;
  const sp = SPACES[pos];
  const pr = state.props[pos];
  if (pr.mortgaged) return 'already_mortgaged';
  if (sp.type === 'street' && groupHasBuildings(state, sp.group)) return 'sell_buildings_first';
  return null;
}

export function unmortgageBlocker(state, pid, pos) {
  const base = baseOwnership(state, pid, pos);
  if (base) return base;
  const pr = state.props[pos];
  if (!pr.mortgaged) return 'not_mortgaged';
  if (hasDebt(state, pid)) return 'has_debt';
  if (state.mortgageDecisions.some((d) => d.pos === pos)) return 'decision_pending';
  if (getPlayer(state, pid).money < unmortgageCost(pos)) return 'insufficient_funds';
  return null;
}

/** ¿Se puede incluir esta propiedad en un trato? */
export function tradeablePropBlocker(state, pid, pos) {
  const base = baseOwnership(state, pid, pos);
  if (base) return base;
  const sp = SPACES[pos];
  if (sp.type === 'street' && groupHasBuildings(state, sp.group)) return 'group_has_buildings';
  if (state.mortgageDecisions.some((d) => d.pos === pos)) return 'decision_pending';
  return null;
}

/** El juego no puede avanzar (tirar, comprar, terminar turno) mientras haya algo pendiente. */
export function blockingReason(state) {
  if (state.phase !== 'playing') return 'game_not_running';
  if (state.auction) return 'auction_in_progress';
  if (state.debts.length) return 'debts_pending';
  if (state.mortgageDecisions.length) return 'decision_pending';
  return null;
}
