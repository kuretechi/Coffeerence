import type { Competition, CriterionKey, Score, ScoreWeights } from '../domain/types';

export type ComposedScores = Partial<Record<CriterionKey, number>>;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 1〜5 のリッカート値を 0〜max に線形変換する。 */
export function likertToScale(value: number, max: number): number {
  return ((value - 1) / 4) * max;
}

/**
 * 6.1 項目スコアの合成。
 * balance（バランス・総合）は絶対値を持たない（対比較からのみ推定する）ため返さない。
 */
export function composeScores(score: Score, competition: Competition, weights: ScoreWeights): ComposedScores {
  const maxOf = (key: CriterionKey) => competition.criteria.find((c) => c.key === key)?.max ?? 10;

  const cleanMax = maxOf('clean');
  const defectPenalty = score.defects.reduce(
    (acc, d) => acc + d.level * (weights.defect[d.key] ?? 1),
    0,
  );
  const clean = clamp(cleanMax - defectPenalty, 0, cleanMax);

  const texture = clamp(likertToScale(score.texture, maxOf('texture')), 0, maxOf('texture'));

  const w1 = weights.finishLength;
  const w2 = weights.finishQuality;
  const wSum = w1 + w2 || 1;
  const blended = (w1 * score.finishLength + w2 * score.finishQuality) / wSum;
  const volumeFinish = clamp(likertToScale(blended, maxOf('volume_finish')), 0, maxOf('volume_finish'));

  const flavorMax = maxOf('flavor');
  const realIntensity = score.flavors.filter((f) => !f.isDummy).reduce((a, f) => a + f.intensity, 0);
  // 実記述子3つを強度3で拾えば満点になる正規化
  const coverage = clamp((weights.flavorPickWeight * realIntensity) / 9, 0, 1);
  const dummyCount = score.flavors.filter((f) => f.isDummy).length;
  const flavor = clamp(coverage * flavorMax - weights.flavorDummyPenalty * dummyCount, 0, flavorMax);

  return { clean, flavor, volume_finish: volumeFinish, texture };
}

export function dummyPickRate(scores: readonly Score[]): number {
  const withPicks = scores.filter((s) => s.flavors.length > 0);
  if (withPicks.length === 0) return 0;
  const dummyPicks = withPicks.reduce((a, s) => a + s.flavors.filter((f) => f.isDummy).length, 0);
  const totalPicks = withPicks.reduce((a, s) => a + s.flavors.length, 0);
  return totalPicks === 0 ? 0 : dummyPicks / totalPicks;
}

/** F-03 提出量の判定。熱い液体は密度<1 なので重量で確保する。 */
export function beverageVolumeMl(beverageG: number, density: number): number {
  return beverageG / density;
}

export function meetsMinimumVolume(beverageG: number, density: number, minVolumeMl: number): boolean {
  return beverageVolumeMl(beverageG, density) >= minVolumeMl;
}

/** 抽出収率（%）。TDS と液量から導出する。 */
export function extractionYield(tdsPercent: number, beverageG: number, doseG: number): number {
  if (doseG <= 0) return 0;
  return (tdsPercent * beverageG) / doseG;
}
