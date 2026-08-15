import { assertFinite } from './normal';

const LGAMMA_COF = [
  76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
  -0.5395239384953e-5,
];

/** 対数ガンマ関数 ln Γ(x)（Lanczos 近似）。二項係数のオーバーフローを避けるために使う。 */
export function lgamma(x: number): number {
  assertFinite(x, 'x');
  if (x <= 0) throw new Error('lgamma requires x > 0');
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of LGAMMA_COF) {
    y += 1;
    ser += c / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** ln C(n, k)。対数空間で計算して桁あふれを防ぐ。 */
export function logChoose(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k)) throw new Error('n and k must be integers');
  if (n < 0 || k < 0 || k > n) throw new Error('require 0 <= k <= n');
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

/** 二項分布の確率質量 P(X = k)。 */
export function binomialPmf(n: number, k: number, p: number): number {
  assertFinite(p, 'p');
  if (p < 0 || p > 1) throw new Error('p must be in [0, 1]');
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** 上側確率 P(X >= k)。片側二項検定の p 値そのもの。 */
export function binomialUpperTail(n: number, k: number, p: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k)) throw new Error('n and k must be integers');
  if (n < 0) throw new Error('n must be >= 0');
  if (k <= 0) return 1;
  if (k > n) return 0;
  let total = 0;
  for (let i = k; i <= n; i += 1) total += binomialPmf(n, i, p);
  return Math.min(1, total);
}
