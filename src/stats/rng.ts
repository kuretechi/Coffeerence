/** シード付き決定論的乱数。同じシードなら常に同じ列を返す。 */
export interface RNG {
  /** [0, 1) の一様乱数。 */
  next(): number;
  /** [0, n) の整数。n が正の整数でなければ例外。 */
  nextInt(n: number): number;
}

/** mulberry32。シードは呼び出し側が必ず渡す（既定値を隠さない）。 */
export function createRNG(seed: number): RNG {
  if (!Number.isFinite(seed)) throw new Error('seed must be finite');
  let state = Math.trunc(seed) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt(n: number) {
      if (!Number.isInteger(n) || n <= 0) throw new Error('nextInt requires a positive integer');
      return Math.floor(next() * n);
    },
  };
}
