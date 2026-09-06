// Deterministic pseudo-random number generation (mulberry32).
// Every source of randomness in the game flows through an Rng instance so that
// a game can be replayed exactly from its seed (used by tests and the
// simulation harness).

export class Rng {
  constructor(seed = 1) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Float in [0, 1). */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }

  /** Pick a random element of a non-empty array. */
  pick(arr) {
    return arr[this.int(arr.length)];
  }

  /** In-place Fisher–Yates shuffle. Returns the array. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Fresh independent generator derived from this one. */
  fork() {
    return new Rng(Math.floor(this.next() * 0xffffffff));
  }
}

/** Convert an arbitrary string (or number) into a 32-bit seed. */
export function seedFrom(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  const s = String(value ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A non-deterministic seed for casual play. */
export function randomSeed() {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0];
  }
  return (Math.random() * 0xffffffff) >>> 0;
}
