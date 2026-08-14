// 決定的に再現できる乱数（テスト用にシードを渡せる）
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const defaultRng: Rng = () => Math.random();

export function shuffle<T>(items: readonly T[], rng: Rng = defaultRng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pick<T>(items: readonly T[], rng: Rng = defaultRng): T {
  return items[Math.floor(rng() * items.length)];
}

export function randomInt(minInclusive: number, maxInclusive: number, rng: Rng = defaultRng): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

export function uid(prefix: string, rng: Rng = defaultRng): string {
  const body = Math.floor(rng() * 0xffffffff)
    .toString(36)
    .padStart(6, '0');
  const tail = Math.floor(rng() * 0xffffffff).toString(36);
  return `${prefix}_${body}${tail}`;
}
