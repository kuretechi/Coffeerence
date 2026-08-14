import type { Competition, CriterionKey, ExternalLabel, ScoreWeights, Session } from '../domain/types';
import { CRITERION_ORDER } from '../domain/defaults';
import { composeScores } from './scoring';
import { mean } from './stats';

export const MIN_EXTERNAL_LABELS = 3;

export interface AffineMap {
  a: number;
  b: number;
  n: number;
}

export interface CalibrationResult {
  calibrated: boolean;
  /** θ（潜在スコア）→ 大会スコアへのアフィン変換。項目別 */
  maps: Partial<Record<CriterionKey, AffineMap>>;
  /** 自己採点 − 外部採点。正なら自分を高く見積もっている */
  bias: Partial<Record<CriterionKey, { value: number; n: number }>>;
}

function leastSquares(points: readonly { x: number; y: number }[]): AffineMap | undefined {
  if (points.length < MIN_EXTERNAL_LABELS) return undefined;
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  if (sxx === 0) return { a: 0, b: my, n: points.length };
  const a = sxy / sxx;
  return { a, b: my - a * mx, n: points.length };
}

/**
 * F-12 外部ラベルによるキャリブレーション。
 * 外部ラベルが3件未満の項目は写像を行わず「校正未実施」とする。
 */
export function calibrate(
  labels: readonly ExternalLabel[],
  thetaByRecipe: Partial<Record<CriterionKey, Map<string, number>>>,
  sessions: readonly Session[],
  competition: Competition,
  weights: ScoreWeights,
): CalibrationResult {
  const maps: CalibrationResult['maps'] = {};
  const bias: CalibrationResult['bias'] = {};

  const selfScoresByRecipe = new Map<string, Partial<Record<CriterionKey, number[]>>>();
  for (const session of sessions) {
    for (const cup of session.cups) {
      if (!cup.score) continue;
      const composed = composeScores(cup.score, competition, weights);
      const bucket = selfScoresByRecipe.get(cup.recipeId) ?? {};
      for (const criterion of CRITERION_ORDER) {
        const value = composed[criterion];
        if (value === undefined) continue;
        bucket[criterion] = [...(bucket[criterion] ?? []), value];
      }
      selfScoresByRecipe.set(cup.recipeId, bucket);
    }
  }

  for (const criterion of CRITERION_ORDER) {
    const theta = thetaByRecipe[criterion];
    const points: { x: number; y: number }[] = [];
    const biasSamples: number[] = [];

    for (const label of labels) {
      const external = label.scores[criterion];
      if (external === undefined || Number.isNaN(external)) continue;
      const t = theta?.get(label.recipeId);
      if (t !== undefined) points.push({ x: t, y: external });
      const selfValues = selfScoresByRecipe.get(label.recipeId)?.[criterion];
      if (selfValues && selfValues.length > 0) biasSamples.push(mean(selfValues) - external);
    }

    const map = leastSquares(points);
    if (map) maps[criterion] = map;
    if (biasSamples.length > 0) bias[criterion] = { value: mean(biasSamples), n: biasSamples.length };
  }

  return {
    calibrated: labels.length >= MIN_EXTERNAL_LABELS,
    maps,
    bias,
  };
}

export function applyAffine(map: AffineMap | undefined, theta: number): number | undefined {
  if (!map) return undefined;
  return map.a * theta + map.b;
}
