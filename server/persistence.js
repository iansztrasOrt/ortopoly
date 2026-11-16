// Persistencia opcional de salas para recuperar partidas tras un reinicio.
//   PERSIST=file  (por defecto) → ./data/rooms.json
//   PERSIST=redis + REDIS_URL   → claves ortopoly:room:<CODE> con TTL de 24 h
//   PERSIST=none                → solo memoria

import fs from 'node:fs/promises';
import path from 'node:path';

export class MemoryStore {
  async load() { return []; }
  async save() {}
  async remove() {}
}

export class FileStore {
  constructor(file) {
    this.file = file;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data.rooms) ? data.rooms : [];
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('[persist] no se pudo leer', this.file, e.message);
      return [];
    }
  }

  async save(rooms) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ savedAt: Date.now(), rooms }));
    await fs.rename(tmp, this.file);
  }

  async remove() {}
}

export class RedisStore {
  constructor(url) {
    this.url = url;
    this.client = null;
    this.prefix = 'ortopoly:room:';
  }

  async connect() {
    if (this.client) return this.client;
    const { createClient } = await import('redis');
    this.client = createClient({ url: this.url });
    this.client.on('error', (e) => console.warn('[redis]', e.message));
    await this.client.connect();
    return this.client;
  }

  async load() {
    const c = await this.connect();
    const rooms = [];
    for await (const key of c.scanIterator({ MATCH: `${this.prefix}*` })) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        const raw = await c.get(k);
        if (raw) rooms.push(JSON.parse(raw));
      }
    }
    return rooms;
  }

  async save(rooms) {
    const c = await this.connect();
    const multi = c.multi();
    for (const r of rooms) multi.set(this.prefix + r.code, JSON.stringify(r), { EX: 86400 });
    await multi.exec();
  }

  async remove(code) {
    const c = await this.connect();
    await c.del(this.prefix + code);
  }
}

export async function createStore({ mode = process.env.PERSIST || 'file', dataDir = 'data' } = {}) {
  if (mode === 'none') return new MemoryStore();
  if (mode === 'redis') {
    if (!process.env.REDIS_URL) {
      console.warn('[persist] PERSIST=redis sin REDIS_URL; uso archivo.');
    } else {
      try {
        const store = new RedisStore(process.env.REDIS_URL);
        await store.connect();
        return store;
      } catch (e) {
        console.warn('[persist] Redis no disponible, uso archivo:', e.message);
      }
    }
  }
  return new FileStore(path.resolve(dataDir, 'rooms.json'));
}
