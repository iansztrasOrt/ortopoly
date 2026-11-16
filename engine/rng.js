// Utilidades de azar. El motor nunca usa Math.random directamente: el servidor
// inyecta un generador criptográfico (ctx.rng) y los tests uno determinista.

/** Generador determinista (mulberry32) para tests y reproducibilidad. */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * RNG que devuelve dados predefinidos: fixedDice([3,3],[1,2]) hará que las
 * próximas tiradas sean 3-3 y luego 1-2. Cuando se agotan, usa `fallback`.
 */
export function fixedDice(...pairs) {
  const values = pairs.flat().map((d) => (d - 1) / 6 + 0.01);
  const fallback = seededRng(42);
  const rng = () => (values.length ? values.shift() : fallback());
  rng.push = (...more) => values.push(...more.flat().map((d) => (d - 1) / 6 + 0.01));
  return rng;
}

export function rollDie(rng) {
  return 1 + Math.floor(rng() * 6);
}

export function rollDice(rng) {
  return [rollDie(rng), rollDie(rng)];
}

/** Fisher-Yates, no muta la entrada. */
export function shuffle(list, rng) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
