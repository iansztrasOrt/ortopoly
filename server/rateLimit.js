// Límite de tasa por socket (token bucket).

export class TokenBucket {
  constructor({ capacity, refillPerSec, now = Date.now }) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.now = now;
    this.last = now();
  }

  take(cost = 1) {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSec);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

export function createLimiters() {
  return {
    actions: new TokenBucket({ capacity: 20, refillPerSec: 8 }),
    chat: new TokenBucket({ capacity: 5, refillPerSec: 0.7 }),
  };
}
