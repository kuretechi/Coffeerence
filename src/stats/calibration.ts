import { assertFinite, normalInvCdf } from './normal';

export interface CalibrationPoint {
  /** 潜在スコア θ（相対尺度）。 */
  theta: number;
  /** 第三者による絶対採点。 */
  externalScore: number;
  /** 自己採点（個人バイアス推定用、任意）。 */
  selfScore?: number;
}

export interface CalibrationResult {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  /** 校正できたか（点数が足りない・θ が同一値なら false）。 */
  calibrated: boolean;
  /** 自己採点 − 外部採点 の平均。自己採点が1件も無ければ undefined。 */
  selfBias?: number;
  predict: (theta: number) => { estimate: number; piLow: number; piHigh: number };
}

/** θ のばらつきがゼロかどうかの判定に使う許容誤差（浮動小数の === 比較を避ける）。 */
const EPS = 1e-12;

/** 校正できないときの predict。点推定も区間も NaN を返し、自信ありげな予測をしない。 */
function nanPredict(theta: number): { estimate: number; piLow: number; piHigh: number } {
  assertFinite(theta, 'theta');
  return { estimate: NaN, piLow: NaN, piHigh: NaN };
}

/**
 * 潜在スコア θ から大会スコアへの変換式（大会スコア ≈ a×θ + b）を最小二乗法で推定する。
 * 併せて自己採点と外部採点のズレ（個人バイアス）も推定する。
 *
 * 点数が minPoints（既定 3）未満、または全点の θ が同一値で傾きが定義できない場合は
 * calibrated = false とし、predict は必ず NaN の区間を返す。
 * predict は回帰の残差標準誤差から 95% 予測区間を返す:
 *   ŷ ± z₀.₉₇₅ · s · √(1 + 1/n + (θ − θ̄)² / Sxx)
 */
export function calibrate(points: CalibrationPoint[], opts?: { minPoints?: number }): CalibrationResult {
  if (!Array.isArray(points)) throw new Error('points must be an array');
  const minPoints = opts?.minPoints ?? 3;
  if (!Number.isInteger(minPoints) || minPoints < 3) throw new Error('minPoints must be an integer >= 3');
  points.forEach((point, index) => {
    assertFinite(point.theta, `points[${index}].theta`);
    assertFinite(point.externalScore, `points[${index}].externalScore`);
    if (point.selfScore !== undefined) assertFinite(point.selfScore, `points[${index}].selfScore`);
  });

  const n = points.length;
  const selfPoints = points.filter((point) => point.selfScore !== undefined);
  const selfBias =
    selfPoints.length === 0
      ? undefined
      : selfPoints.reduce((sum, point) => sum + ((point.selfScore as number) - point.externalScore), 0) /
        selfPoints.length;

  const notCalibrated: CalibrationResult = {
    slope: NaN,
    intercept: NaN,
    r2: NaN,
    n,
    calibrated: false,
    predict: nanPredict,
  };
  if (selfBias !== undefined) notCalibrated.selfBias = selfBias;
  if (n < minPoints) return notCalibrated;

  const meanTheta = points.reduce((sum, point) => sum + point.theta, 0) / n;
  const meanExternal = points.reduce((sum, point) => sum + point.externalScore, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const point of points) {
    const dx = point.theta - meanTheta;
    const dy = point.externalScore - meanExternal;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx <= EPS) return notCalibrated;

  const slope = sxy / sxx;
  const intercept = meanExternal - slope * meanTheta;
  const ssRes = Math.max(0, syy - slope * sxy);
  // 外部採点が全て同値（Syy≈0）だと決定係数は定義できないので、残差もゼロなら完全適合の 1 とする。
  const r2 = syy <= EPS ? (ssRes <= EPS ? 1 : 0) : 1 - ssRes / syy;
  const residualSd = Math.sqrt(ssRes / (n - 2));
  const z = normalInvCdf(0.975);

  return {
    slope,
    intercept,
    r2,
    n,
    calibrated: true,
    ...(selfBias === undefined ? {} : { selfBias }),
    predict: (theta: number) => {
      assertFinite(theta, 'theta');
      const estimate = slope * theta + intercept;
      const dx = theta - meanTheta;
      const half = z * residualSd * Math.sqrt(1 + 1 / n + (dx * dx) / sxx);
      return { estimate, piLow: estimate - half, piHigh: estimate + half };
    },
  };
}
