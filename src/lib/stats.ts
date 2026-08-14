import { type Rng, defaultRng } from './random';

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 標本標準偏差（n-1）。n<2 のときは 0 を返す。 */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 標準正規分布の累積分布関数（Abramowitz & Stegun 7.1.26 の erf 近似）。 */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** 標準正規分布の分位点（Acklam の有理近似）。 */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

function logFactorial(n: number): number {
  let acc = 0;
  for (let i = 2; i <= n; i++) acc += Math.log(i);
  return acc;
}

export function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  const logC = logFactorial(n) - logFactorial(k) - logFactorial(n - k);
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** 上側片側二項検定の p 値: P(X >= k | n, p)。 */
export function binomialTailP(k: number, n: number, p: number): number {
  let acc = 0;
  for (let i = k; i <= n; i++) acc += binomialPmf(i, n, p);
  return Math.min(1, acc);
}

/** p 値を N シグマ相当に換算する（片側）。 */
export function pToSigma(p: number): number {
  if (p <= 0) return Infinity;
  if (p >= 1) return 0;
  return Math.max(0, normalQuantile(1 - p));
}

export function bootstrapCi(
  samples: readonly number[],
  statistic: (resample: number[]) => number,
  iterations = 1000,
  rng: Rng = defaultRng,
): { low: number; high: number } {
  if (samples.length === 0) return { low: NaN, high: NaN };
  const stats: number[] = [];
  for (let it = 0; it < iterations; it++) {
    const resample: number[] = new Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      resample[i] = samples[Math.floor(rng() * samples.length)];
    }
    stats.push(statistic(resample));
  }
  stats.sort((a, b) => a - b);
  return { low: quantile(stats, 0.025), high: quantile(stats, 0.975) };
}

/** 6.5 必要試行回数 n ≈ 2(z_{α/2}+z_β)²σ²/δ² */
export function requiredTrials(sigma: number, delta: number, alpha = 0.05, power = 0.8): number {
  if (!(delta > 0) || !(sigma > 0)) return 0;
  const z = normalQuantile(1 - alpha / 2) + normalQuantile(power);
  return Math.ceil((2 * z * z * sigma * sigma) / (delta * delta));
}

/** 与えられた n における両側検定の検出力。 */
export function achievedPower(n: number, sigma: number, delta: number, alpha = 0.05): number {
  if (n <= 0 || sigma <= 0) return 0;
  const z = normalQuantile(1 - alpha / 2);
  const lambda = delta / (sigma * Math.sqrt(2 / n));
  return 1 - normalCdf(z - lambda) + normalCdf(-z - lambda);
}
