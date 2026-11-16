// Levanta Ortopoly y lo publica con un túnel gratuito de Cloudflare
// (https://xxxx.trycloudflare.com) para jugar con amigos que están en otro lado.
//
// Uso:  npm run online
// Descarga `cloudflared` automáticamente la primera vez (en ./bin) si no está instalado.
// Mientras esta ventana siga abierta, el link funciona. Ctrl+C para cerrar.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = path.join(ROOT, 'bin');
const PORT = Number(process.env.PORT) || 3000;
const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';

function assetName() {
  const arch = os.arch() === 'arm64' ? 'arm64' : os.arch() === 'arm' ? 'arm' : 'amd64';
  if (process.platform === 'win32') return { file: `cloudflared-windows-${os.arch() === 'ia32' ? '386' : 'amd64'}.exe`, exe: 'cloudflared.exe' };
  if (process.platform === 'darwin') return { file: `cloudflared-darwin-${arch}.tgz`, exe: 'cloudflared', tgz: true };
  return { file: `cloudflared-linux-${arch}`, exe: 'cloudflared' };
}

function onPath(cmd) {
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.split(/\r?\n/)[0].trim() : null;
}

async function ensureCloudflared() {
  if (process.env.CLOUDFLARED_BIN) return process.env.CLOUDFLARED_BIN;
  const system = onPath('cloudflared');
  if (system) return system;
  const { file, exe, tgz } = assetName();
  const target = path.join(BIN_DIR, exe);
  // Lugares donde puede estar si se bajó a mano o se instaló con winget/MSI.
  const candidates = [
    target,
    path.join(os.homedir(), 'Downloads', file),
    path.join(os.homedir(), 'Descargas', file),
    path.join(os.homedir(), 'Downloads', exe),
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
  ];
  const found = candidates.find((p) => !p.endsWith('.tgz') && fs.existsSync(p));
  if (found) return found;

  fs.mkdirSync(BIN_DIR, { recursive: true });
  const dest = tgz ? path.join(BIN_DIR, file) : target;
  console.log(`⬇️  Descargando cloudflared (${file}), es una sola vez…`);
  try {
    const res = await fetch(RELEASES + file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  } catch (e) {
    // Plan B: curl (incluido en Windows 10/11 y en Mac) usa la configuración de red del sistema.
    console.log(`   La descarga directa falló (${e.cause?.code || e.message}); pruebo con curl…`);
    const r = spawnSync(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-fL', '--retry', '2', '-o', dest, RELEASES + file], { stdio: 'inherit' });
    if (r.status !== 0 || !fs.existsSync(dest)) {
      throw new Error(`No se pudo descargar cloudflared. Bajalo con el navegador desde ${RELEASES + file} (queda en Descargas) y volvé a abrir este programa.`);
    }
  }
  if (tgz) {
    const r = spawnSync('tar', ['-xzf', dest, '-C', BIN_DIR], { stdio: 'inherit' });
    fs.rmSync(dest, { force: true });
    if (r.status !== 0) throw new Error('No se pudo descomprimir cloudflared.');
  }
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  return target;
}

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch { /* no hay navegador: no pasa nada */ }
}

function banner(url) {
  const line = '═'.repeat(Math.max(48, url.length + 8));
  console.log(`\n╔${line}╗`);
  console.log(`║  🎲 ¡Ortopoly está online!${' '.repeat(line.length - 27)}║`);
  console.log(`║${' '.repeat(line.length)}║`);
  console.log(`║    ${url}${' '.repeat(line.length - url.length - 4)}║`);
  console.log(`║${' '.repeat(line.length)}║`);
  console.log(`║  Pasale este link a tus amigos.${' '.repeat(line.length - 32)}║`);
  console.log(`║  Creá la sala y compartí el código.${' '.repeat(line.length - 36)}║`);
  console.log(`║  No cierres esta ventana mientras juegan.${' '.repeat(line.length - 42)}║`);
  console.log(`╚${line}╝\n`);
}

const srv = await startServer({ port: PORT });
let tunnel = null;

async function shutdown(code = 0) {
  if (tunnel && !tunnel.killed) tunnel.kill();
  await srv.close();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  const bin = await ensureCloudflared();
  console.log('🌐 Abriendo el túnel de Cloudflare…');
  tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${srv.port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let found = false;
  const onData = (chunk) => {
    const text = chunk.toString();
    if (process.env.DEBUG_TUNNEL) process.stdout.write(text);
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !found) {
      found = true;
      banner(m[0]);
      openBrowser(m[0]);
    }
  };
  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);
  setTimeout(() => {
    if (!found) {
      console.log('⏳ El túnel está tardando. Si no aparece el link en un minuto, revisá tu conexión o corré con DEBUG_TUNNEL=1 para ver detalles.');
      console.log(`   Mientras tanto, en tu red local se juega en http://localhost:${srv.port}`);
    }
  }, 30000);
  tunnel.on('exit', (code) => {
    console.log(`El túnel se cerró (código ${code}).`);
    shutdown(code || 0);
  });
} catch (e) {
  console.error(`❌ ${e.message}`);
  console.error(`   El juego igual funciona en tu red: http://localhost:${srv.port}`);
  console.error('   Podés instalar cloudflared a mano: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
}
