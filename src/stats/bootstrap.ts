import { createRNG } from './rng';

export interface BootstrapResult {
  /** 元データでの推定値。 */
  estimate: number;
  /** 下側パーセンタイル（既定 2.5%）。データ不足なら NaN。 */
  ciLow: number;
  /** 上側パーセンタイル（既定 97.5%）。データ不足なら NaN。 */
  ciHigh: number;
  replicates: number;
}

/** 昇順に並んだ配列の分位点（線形補間）。 */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 復元抽出のブートストラップ。要素の型は任意なので、
 * セッションなどのクラスタをそのまま渡せばクラスタブートストラップになる。
 * data.length < 2 のときは区間を NaN にして、呼び出し側が判定できるようにする。
 */
export function bootstrap<T>(
  data: readonly T[],
  statistic: (sample: T[]) => number,
  opts: { replicates?: number; seed: number; alpha?: number },
): BootstrapResult {
  const replicates = opts.replicates ?? 2000;
  const alpha = opts.alpha ?? 0.05;
  if (!Number.isFinite(opts.seed)) throw new Error('seed must be a finite number');
  if (!Number.isInteger(replicates) || replicates <= 0) throw new Error('replicates must be a positive integer');
  if (!(alpha > 0 && alpha < 1)) throw new Error('alpha must be in (0, 1)');

  const estimate = data.length === 0 ? NaN : statistic([...data]);
  if (data.length < 2) return { estimate, ciLow: NaN, ciHigh: NaN, replicates: 0 };

  const rng = createRNG(opts.seed);
  const draws: number[] = [];
  const sample: T[] = new Array(data.length);
  for (let r = 0; r < replicates; r += 1) {
    for (let i = 0; i < data.length; i += 1) sample[i] = data[rng.nextInt(data.length)];
    const value = statistic([...sample]);
    if (Number.isFinite(value)) draws.push(value);
  }
  if (draws.length < 2) return { estimate, ciLow: NaN, ciHigh: NaN, replicates: draws.length };
  draws.sort((a, b) => a - b);
  return {
    estimate,
    ciLow: quantileSorted(draws, alpha / 2),
    ciHigh: quantileSorted(draws, 1 - alpha / 2),
    replicates: draws.length,
  };
}
