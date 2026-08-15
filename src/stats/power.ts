import { assertFinite, normalInvCdf } from './normal';

export interface PowerResult {
  requiredN: number; // 各水準あたりの必要ペア数
  totalRequired: number; // 両水準合計
  currentN: number;
  additionalNeeded: number;
  assumptions: { sigma: number; mde: number; alpha: number; power: number };
}

/**
 * 対応のある2群比較で、指定した効果量 mde を検出するために必要な観測数を求める。
 * n ≈ 2 (z_{α/2} + z_β)² σ² / δ² を切り上げて返す（n は各水準あたりのペア数）。
 * sigma には「同一カップを k 回採点して平均する」等で下がった実効 σ（σ/√k）を渡してよい。
 * 数字を小さく見せるための細工はしない。
 */
export function requiredSampleSize(
  sigma: number,
  mde: number,
  opts?: { alpha?: number; power?: number; currentN?: number },
): PowerResult {
  assertFinite(sigma, 'sigma');
  assertFinite(mde, 'mde');
  if (sigma <= 0) throw new Error('sigma must be positive');
  if (mde <= 0) throw new Error('mde must be positive');

  const alpha = opts?.alpha ?? 0.05;
  const power = opts?.power ?? 0.8;
  const currentN = opts?.currentN ?? 0;
  assertFinite(alpha, 'alpha');
  assertFinite(power, 'power');
  assertFinite(currentN, 'currentN');
  if (alpha <= 0 || alpha >= 1) throw new Error('alpha must be in (0, 1)');
  if (power <= 0 || power >= 1) throw new Error('power must be in (0, 1)');
  if (currentN < 0 || !Number.isInteger(currentN)) throw new Error('currentN must be a non-negative integer');

  const zAlpha = normalInvCdf(1 - alpha / 2);
  const zBeta = normalInvCdf(power);
  const requiredN = Math.ceil((2 * (zAlpha + zBeta) ** 2 * sigma ** 2) / mde ** 2);

  return {
    requiredN,
    totalRequired: requiredN * 2,
    currentN,
    additionalNeeded: Math.max(0, requiredN - currentN),
    assumptions: { sigma, mde, alpha, power },
  };
}
