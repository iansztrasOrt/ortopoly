// i18n mínimo: diccionarios por idioma con fallback a español.
import es from './es.js';
import en from './en.js';

const DICTS = { es, en };
let lang = 'es';

try {
  const saved = localStorage.getItem('ortopoly.lang');
  if (saved && DICTS[saved]) lang = saved;
} catch { /* sin storage */ }

export function getLang() {
  return lang;
}

export function setLang(next) {
  if (!DICTS[next]) return;
  lang = next;
  document.documentElement.lang = next;
  try { localStorage.setItem('ortopoly.lang', next); } catch { /* */ }
}

function lookup(dict, key) {
  return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
}

/** Valor crudo (string, array u objeto). */
export function tr(key) {
  const v = lookup(DICTS[lang], key);
  return v !== undefined ? v : lookup(DICTS.es, key);
}

/** Traducción con reemplazo de {params}. */
export function t(key, params = {}) {
  const v = tr(key);
  if (typeof v !== 'string') return v === undefined ? key : v;
  return interpolate(v, params);
}

export function interpolate(str, params = {}) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

export function has(key) {
  return lookup(DICTS.es, key) !== undefined;
}

export function money(n) {
  const v = Math.round(Number(n) || 0);
  const s = Math.abs(v).toLocaleString(lang === 'es' ? 'es-AR' : 'en-US');
  return `${v < 0 ? '−' : ''}$${s}`;
}
