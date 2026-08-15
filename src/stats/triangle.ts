import { binomialUpperTail } from './binomial';
import { assertFinite, normalInvCdf } from './normal';

/** 三点識別テストの評価結果。 */
export interface TriangleTestResult {
  trials: number;
  correct: number;
  /** 当てずっぽうの正解率 1 / cupsPerTrial。 */
  chanceLevel: number;
  pValue: number;
  nSigma: number;
  verdict: 'discriminable' | 'inconclusive';
  /** inconclusive のとき、同じ正解率が続いた場合に閾値へ達する総試行数（100試行以内で見つからなければ undefined）。 */
  trialsNeededForSignificance?: number;
}

const DEFAULT_CUPS_PER_TRIAL = 3;
const DEFAULT_SIGMA_THRESHOLD = 2.0;
const MAX_SEARCH_TRIALS = 100;
/** 分位点変換の裾で ±Infinity にならないよう p 値を丸める幅。 */
const TAIL_EPS = 1e-16;

/**
 * 三点識別テストの成績が当てずっぽう（p = 1 / cupsPerTrial）で説明できるかを判定する。
 * p 値は片側二項検定の上側確率 Σ_{i=k}^{n} C(n,i) p^i (1-p)^(n-i) を厳密に計算し、
 * それを標準正規の分位点へ変換して N-sigma とする（二項分布の正規近似は使わない）。
 */
export function evaluateTriangleTests(
  trials: number,
  correct: number,
  opts?: { cupsPerTrial?: number; sigmaThreshold?: number },
): TriangleTestResult {
  assertFinite(trials, 'trials');
  assertFinite(correct, 'correct');
  if (!Number.isInteger(trials) || !Number.isInteger(correct)) throw new Error('trials and correct must be integers');
  if (trials < 0) throw new Error('trials must be >= 0');
  if (correct < 0 || correct > trials) throw new Error('require 0 <= correct <= trials');

  const cupsPerTrial = opts?.cupsPerTrial ?? DEFAULT_CUPS_PER_TRIAL;
  const sigmaThreshold = opts?.sigmaThreshold ?? DEFAULT_SIGMA_THRESHOLD;
  assertFinite(cupsPerTrial, 'cupsPerTrial');
  assertFinite(sigmaThreshold, 'sigmaThreshold');
  if (!Number.isInteger(cupsPerTrial) || cupsPerTrial < 2) throw new Error('cupsPerTrial must be an integer >= 2');

  const chanceLevel = 1 / cupsPerTrial;
  const pValue = binomialUpperTail(trials, correct, chanceLevel);
  const nSigma = toNSigma(pValue);
  const discriminable = nSigma >= sigmaThreshold;

  const result: TriangleTestResult = {
    trials,
    correct,
    chanceLevel,
    pValue,
    nSigma,
    verdict: discriminable ? 'discriminable' : 'inconclusive',
  };
  if (!discriminable) {
    const needed = searchTrialsNeeded(trials, correct, chanceLevel, sigmaThreshold);
    if (needed !== undefined) result.trialsNeededForSignificance = needed;
  }
  return result;
}

/** p 値を標準正規の分位点 Φ⁻¹(1 − p) に変換する。極端な裾は丸めて有限値に保つ。 */
function toNSigma(pValue: number): number {
  const upper = Math.min(1 - TAIL_EPS, Math.max(TAIL_EPS, 1 - pValue));
  return normalInvCdf(upper);
}

/**
 * 現在の正解率が維持されると仮定し、閾値に達する総試行数を線形探索する。
 * 正解数は rate × n の四捨五入（達成可能な整数）として評価する。
 */
function searchTrialsNeeded(
  trials: number,
  correct: number,
  chanceLevel: number,
  sigmaThreshold: number,
): number | undefined {
  if (trials === 0) return undefined;
  const rate = correct / trials;
  if (rate <= chanceLevel) return undefined;
  for (let n = trials + 1; n <= MAX_SEARCH_TRIALS; n += 1) {
    const k = Math.min(n, Math.round(rate * n));
    if (toNSigma(binomialUpperTail(n, k, chanceLevel)) >= sigmaThreshold) return n;
  }
  return undefined;
}
