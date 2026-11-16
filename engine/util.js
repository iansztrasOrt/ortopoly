// Utilidades compartidas por los módulos del motor.

export class RuleError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.name = 'RuleError';
    this.code = code;
    this.params = params;
  }
}

export function fail(code, params) {
  throw new RuleError(code, params);
}

export function getPlayer(state, id) {
  return state.players.find((p) => p.id === id) || null;
}

export function requirePlayer(state, id) {
  const p = getPlayer(state, id);
  if (!p) fail('unknown_player');
  if (p.bankrupt) fail('player_bankrupt');
  return p;
}

export function activePlayers(state) {
  return state.players.filter((p) => !p.bankrupt);
}

export function nextId(state) {
  state.seq = (state.seq || 0) + 1;
  return state.seq;
}

/** Registro de eventos estructurado {k, p}: el cliente lo traduce con i18n. */
export function log(state, ctx, k, p = {}) {
  state.logSeq = (state.logSeq || 0) + 1;
  state.log.push({ id: state.logSeq, t: ctx.now, k, p });
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
}

/** Eventos efímeros para animaciones (dados, movimiento, cartas, dinero). */
export function emit(ctx, event) {
  if (ctx && Array.isArray(ctx.events)) ctx.events.push(event);
}

export function makeCtx({ rng, now = Date.now() } = {}) {
  return { rng, now, events: [] };
}
