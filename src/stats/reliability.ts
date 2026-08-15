import { assertFinite } from './normal';

/** 隠し重複ペア（同じレシピを別カップとして採点したときの2つの点数）。 */
export interface DuplicatePair {
  scoreA: number;
  scoreB: number;
  /** 将来の拡張用。v1では未使用。 */
  sessionId?: string;
}

/** σ推定の結果。縮小前後の値と解釈を併せて返す。 */
export interface ReliabilityResult {
  sigma: number;
  sigmaRaw: number;
  nPairs: number;
  shrinkageApplied: boolean;
  interpretation: 'reliable' | 'caution' | 'unreliable';
}

const DEFAULT_K = 3;
const DEFAULT_SIGMA0 = 1.0;
const DEFAULT_SCALE_MAX = 5;

/**
 * 採点者の測定誤差 σ を隠し重複ペアから推定する。
 * 真の差はゼロなので d = scoreA - scoreB ~ N(0, 2σ²) と見て σ̂² = Σd² / (2n)。
 * 標本平均を引かないため自由度を1つ節約できる（sd(d)/√2 は使わない）。
 * ペアが少ないうちは事前値 σ₀ に向けて (n·σ̂ + k·σ₀) / (n + k) で縮小する。
 */
export function estimateSigma(
  pairs: DuplicatePair[],
  opts?: { k?: number; sigma0?: number; scaleMax?: number },
): ReliabilityResult {
  if (!Array.isArray(pairs)) throw new Error('pairs must be an array');
  const k = opts?.k ?? DEFAULT_K;
  const sigma0 = opts?.sigma0 ?? DEFAULT_SIGMA0;
  const scaleMax = opts?.scaleMax ?? DEFAULT_SCALE_MAX;
  assertFinite(k, 'k');
  assertFinite(sigma0, 'sigma0');
  assertFinite(scaleMax, 'scaleMax');
  if (k < 0) throw new Error('k must be >= 0');
  if (sigma0 < 0) throw new Error('sigma0 must be >= 0');
  if (scaleMax <= 0) throw new Error('scaleMax must be > 0');

  for (const [i, pair] of pairs.entries()) {
    assertFinite(pair.scoreA, `pairs[${i}].scoreA`);
    assertFinite(pair.scoreB, `pairs[${i}].scoreB`);
  }

  const n = pairs.length;
  if (n === 0) {
    return {
      sigma: sigma0,
      sigmaRaw: NaN,
      nPairs: 0,
      shrinkageApplied: true,
      interpretation: 'unreliable',
    };
  }

  let sumSquares = 0;
  for (const pair of pairs) {
    const d = pair.scoreA - pair.scoreB;
    sumSquares += d * d;
  }
  const sigmaRaw = Math.sqrt(sumSquares / (2 * n));
  const shrinkageApplied = k > 0;
  const sigma = shrinkageApplied ? (n * sigmaRaw + k * sigma0) / (n + k) : sigmaRaw;

  return {
    sigma,
    sigmaRaw,
    nPairs: n,
    shrinkageApplied,
    interpretation: interpretSigma(sigma, scaleMax),
  };
}

/** σ をスケール上限に対する相対値で解釈する。 */
function interpretSigma(sigma: number, scaleMax: number): ReliabilityResult['interpretation'] {
  if (sigma <= scaleMax * 0.15) return 'reliable';
  if (sigma <= scaleMax * 0.3) return 'caution';
  return 'unreliable';
}
