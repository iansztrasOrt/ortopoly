// Prueba end-to-end con navegadores reales (Playwright).
// Requisito (una sola vez):  npm i -D playwright && npx playwright install chromium
// Uso:                       npm run e2e        (SCREENSHOTS=1 guarda capturas en ./e2e-shots)
//
// Levanta el servidor en un puerto libre, abre 3 jugadores + 1 espectador y
// recorre: lobby → listo → partida → tiradas/compras/subastas → trato →
// reconexión → espectador → fin de partida → revancha.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import { startServer } from '../server/index.js';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    if (process.env.PLAYWRIGHT_PATH) return createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
    console.error('Falta Playwright. Instalalo con:  npm i -D playwright && npx playwright install chromium');
    process.exit(2);
  }
}

const { chromium } = await loadPlaywright();
const shots = process.env.SCREENSHOTS ? 'e2e-shots' : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

const srv = await startServer({ port: 0, persist: 'none', quiet: true });
const base = `http://localhost:${srv.port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
let failed = false;

function check(cond, msg) {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed = true;
}

async function newPlayer(name, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  await page.goto(base);
  return page;
}

async function snap(page, name) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

try {
  const a = await newPlayer('Ana');
  await a.fill('#name', 'Ana');
  await a.click('text=Crear sala');
  await a.waitForSelector('.room-code');
  const code = (await a.textContent('.room-code')).trim();
  check(/^[A-Z0-9]{5}$/.test(code), `sala creada (${code})`);

  const b = await newPlayer('Beto');
  await b.goto(`${base}/?sala=${code}`);
  await b.fill('#name', 'Beto');
  await b.click('button:has-text("Unirse")');
  const c = await newPlayer('Caro', { width: 390, height: 844 });
  await c.fill('#name', 'Caro');
  await c.fill('#code', code);
  await c.click('button:has-text("Unirse")');
  await b.waitForSelector('.room-code');
  await c.waitForSelector('.room-code');
  check(await a.locator('.member').count() === 3, 'el anfitrión ve a los 3 jugadores');
  check(await a.locator('button:has-text("Empezar partida")').isDisabled(), 'no se puede empezar sin todos listos');
  await b.click('button:has-text("Estoy listo")');
  await c.click('button:has-text("Estoy listo")');
  await a.waitForFunction(() => !document.querySelector('button.btn-primary.btn-block')?.disabled);
  await snap(a, '01-lobby');
  await a.click('button:has-text("Empezar partida")');
  for (const p of [a, b, c]) await p.waitForSelector('.board');
  check(true, 'la partida empezó en las 3 pestañas');

  const pages = [a, b, c];
  let bought = 0;
  let auctions = 0;
  for (let round = 0; round < 12; round += 1) {
    for (const p of pages) {
      const buy = p.locator('.modal button:has-text("Comprar por")');
      if (await buy.count()) {
        if (auctions === 0) {
          await p.locator('.modal button:has-text("No comprar")').click();
          auctions += 1;
          await p.waitForTimeout(400);
        } else if (await buy.isEnabled()) {
          await buy.click();
          bought += 1;
        }
      }
      for (const q of pages) {
        const w = q.locator('.modal button:has-text("Me retiro")');
        if (await w.count() && await w.isEnabled()) await w.click();
        const pay = q.locator('.modal button:has-text("Pagar")');
        if (await pay.count() && await pay.first().isEnabled()) await pay.first().click();
      }
      const roll = p.locator('.actions button:has-text("Tirar"), .actions button:has-text("Intentar")');
      if (await roll.count() && await roll.first().isEnabled()) {
        await roll.first().click();
        await p.waitForTimeout(2600);
        continue;
      }
      const end = p.locator('.actions button:has-text("Terminar turno")');
      if (await end.count() && await end.isEnabled()) await end.click();
    }
  }
  await snap(a, '02-partida');
  check(auctions > 0, 'se jugó al menos una subasta');
  check(bought > 0, `se compraron propiedades (${bought})`);

  // Trato fuera de turno
  await b.keyboard.press('Escape');
  await b.locator('.actions button:has-text("Proponer trato")').click();
  await b.selectOption('.modal select', { label: 'Ana' });
  await b.locator('.trade-col').first().locator('input[type=number]').first().fill('10');
  await b.click('.modal button:has-text("Enviar propuesta")');
  await a.waitForSelector('.modal button:has-text("Aceptar")', { timeout: 5000 });
  await snap(a, '03-trato');
  await a.click('.modal button:has-text("Aceptar")');
  check(true, 'trato propuesto y aceptado');

  // Reconexión
  await c.reload();
  await c.waitForSelector('.board', { timeout: 8000 });
  check(true, 'Caro recargó y volvió a la partida');

  // Espectador
  const d = await newPlayer('Dani');
  await d.fill('#name', 'Dani');
  await d.fill('#code', code);
  await d.click('button:has-text("Unirse")');
  await d.waitForSelector('.board', { timeout: 5000 });
  check(await d.locator('.actions .chip').count() === 1, 'Dani entró como espectador');
  await snap(d, '04-espectador');

  // Fin y revancha
  await a.keyboard.press('Escape');
  await a.click('button[title="Terminar partida ahora"]');
  await a.click('.modal button:has-text("Confirmar")');
  await a.waitForSelector('.over', { timeout: 5000 });
  await snap(a, '05-final');
  check(await a.locator('.ranking li').count() === 3, 'ranking con 3 jugadores');
  await a.click('button:has-text("Revancha")');
  await d.waitForSelector('.room-code', { timeout: 5000 });
  check(await a.locator('.member').count() === 4, 'revancha: el espectador pasó a jugador');
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  check(errors.length === 0, `sin errores en consola${errors.length ? `:\n  ${errors.join('\n  ')}` : ''}`);
  await browser.close();
  await srv.close();
  process.exit(failed ? 1 : 0);
}
