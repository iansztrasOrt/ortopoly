// Garantiza que todo código de error y entrada de registro del motor tenga texto,
// y que las traducciones tengan las mismas claves.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import es from '../public/js/i18n/es.js';
import en from '../public/js/i18n/en.js';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../engine/cards.js';

const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
const source = ['engine', 'server'].flatMap((dir) => fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))).join('\n');

describe('i18n', () => {
  it('es y en tienen exactamente las mismas claves', () => {
    expect(keys(en).sort()).toEqual(keys(es).sort());
  });

  it('todos los códigos de error del motor y del servidor están traducidos', () => {
    const codes = new Set([...source.matchAll(/(?:fail|no)\('([a-z_]+)'/g)].map((m) => m[1]));
    for (const m of source.matchAll(/return '([a-z_]+)';/g)) codes.add(m[1]);
    codes.delete('roll');
    const missing = [...codes].filter((c) => !es.errors[c] && !es.lobby.startHint[c]);
    expect(missing).toEqual([]);
  });

  it('todas las entradas del registro tienen texto', () => {
    const logKeys = new Set([...source.matchAll(/log\(state, ctx, (?:[^'\n]*\? )?'([a-z_]+)'(?: : '([a-z_]+)')?/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean));
    const missing = [...logKeys].filter((k) => !es.log[k]);
    expect(logKeys.size).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  it('las 32 cartas tienen texto', () => {
    for (const c of [...CHANCE_CARDS, ...COMMUNITY_CARDS]) expect(es.cards[c.id]).toBeTruthy();
  });
});
