/** mulberry32: быстрый детерминированный ГПСЧ. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a: из набора частей получаем 32-битный seed для независимого потока. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export interface Rng {
  next(): number
  /** целое в [min, max] включительно */
  int(min: number, max: number): number
  pick<T>(arr: readonly T[]): T
  chance(p: number): boolean
}

export function createRng(seed: number): Rng {
  const f = mulberry32(seed)
  return {
    next: f,
    int: (min, max) => (max <= min ? min : min + Math.floor(f() * (max - min + 1))),
    pick: (arr) => arr[Math.floor(f() * arr.length)],
    chance: (p) => f() < p,
  }
}
