import type { BrewRecord, ExternalLabel, Recipe, Session, TasteRating, TriangleTrial } from '../domain/types';
import type {
  CalibrationPoint,
  DuplicatePair,
  Observation,
  PairwiseComparison,
  RecipeProjection,
  ThresholdResult,
} from '../stats';
import { estimateThreshold, initStaircase, updateStaircase } from '../stats';

/** 差の梯子（段数）。細かいほど識別が難しい。 */
export const DELTA_LEVELS = [2, 1, 0.5, 0.25];

/** 味評価5項目の平均。1〜5点の自己採点スケールに揃える。 */
export function overallScore(taste: TasteRating): number {
  return (taste.aroma + taste.acidity + taste.sweetness + taste.body + taste.overall) / 5;
}

/** 味評価済みの記録だけを、日付の古い順に並べて返す。 */
export function scoredBrews(brews: readonly BrewRecord[]): { brew: BrewRecord; taste: TasteRating; score: number }[] {
  return brews
    .filter((b): b is BrewRecord & { taste: TasteRating } => b.taste !== undefined)
    .map((brew) => ({ brew, taste: brew.taste, score: overallScore(brew.taste) }))
    .sort((a, b) => a.brew.date.localeCompare(b.brew.date));
}

/** 記録日（YYYY-MM-DD）。同じ日に淹れた分を1セッションとして扱うために使う。 */
export function brewDay(date: string): string {
  return date.slice(0, 10);
}

/**
 * σ推定に使う重複ペア。同じ日に同じレシピを2杯以上淹れて採点した記録を、
 * 「同一のものへの2回の採点」として取り出す（隣り合う2件ずつ）。
 */
export function duplicatePairsFromBrews(brews: readonly BrewRecord[]): DuplicatePair[] {
  const groups = new Map<string, number[]>();
  for (const { brew, score } of scoredBrews(brews)) {
    const key = `${brewDay(brew.date)}|${brew.recipeId}`;
    const list = groups.get(key);
    if (list) list.push(score);
    else groups.set(key, [score]);
  }
  const pairs: DuplicatePair[] = [];
  for (const [key, scores] of groups) {
    for (let i = 0; i + 1 < scores.length; i += 2) {
      pairs.push({ scoreA: scores[i], scoreB: scores[i + 1], sessionId: key });
    }
  }
  return pairs;
}

/** レシピの変数（要因）。効果量推定で「何を変えたか」の水準として使う。 */
export const STATS_FACTORS = [
  { key: 'grind', label: '挽き目' },
  { key: 'waterTemp', label: '湯温' },
  { key: 'dose', label: '粉量' },
  { key: 'ratio', label: '湯量比' },
] as const;

export type StatsFactorKey = (typeof STATS_FACTORS)[number]['key'];

/** レシピからその要因の水準ラベルを取り出す。 */
export function factorLevel(recipe: Recipe, factor: StatsFactorKey): string {
  switch (factor) {
    case 'grind':
      return recipe.grindSetting === '' ? '未設定' : recipe.grindSetting;
    case 'waterTemp':
      return `${Math.round(recipe.waterTempC)}℃`;
    case 'dose':
      return `${Math.round(recipe.doseG)}g`;
    case 'ratio':
      return `1:${(recipe.totalWaterG / recipe.doseG).toFixed(1)}`;
  }
}

/** 効果量推定への入力。同じ日の記録を1セッションとしてまとめる。 */
export function observationsFor(
  brews: readonly BrewRecord[],
  recipes: readonly Recipe[],
  factor: StatsFactorKey,
): Observation[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const observations: Observation[] = [];
  for (const { brew, score } of scoredBrews(brews)) {
    const recipe = byId.get(brew.recipeId);
    if (!recipe) continue;
    observations.push({ sessionId: brewDay(brew.date), level: factorLevel(recipe, factor), score });
  }
  return observations;
}

/** 同一セッション内に両方の水準が揃っている水準ペアを、記録数の多い順に返す。 */
export function comparableLevelPairs(observations: readonly Observation[]): { from: string; to: string; n: number }[] {
  const bySession = new Map<string, Set<string>>();
  for (const o of observations) {
    const set = bySession.get(o.sessionId) ?? new Set<string>();
    set.add(o.level);
    bySession.set(o.sessionId, set);
  }
  const counts = new Map<string, number>();
  for (const levels of bySession.values()) {
    const sorted = [...levels].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const key = `${sorted[i]}\u0000${sorted[j]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([key, n]) => {
      const [from, to] = key.split('\u0000');
      return { from, to, n };
    })
    .sort((a, b) => b.n - a.n || a.from.localeCompare(b.from));
}

/** 総合点の差を対比較の5段階（-2〜+2）に写す。 */
export function diffToResult(diff: number): PairwiseComparison['result'] {
  if (diff >= 1) return 2;
  if (diff >= 0.25) return 1;
  if (diff <= -1) return -2;
  if (diff <= -0.25) return -1;
  return 0;
}

/**
 * 潜在スコア推定への入力。
 * セッションの対比較があればそれを使い、無い場合は同じ日に淹れた別レシピどうしの
 * 総合点の差から対比較を作る（絶対点そのものではなく相対比較として扱う）。
 */
export function comparisonsFromData(
  sessions: readonly Session[],
  brews: readonly BrewRecord[],
): PairwiseComparison[] {
  const comparisons: PairwiseComparison[] = [];
  for (const session of sessions) {
    const recipeOf = new Map(session.cups.map((c) => [c.id, c.recipeId]));
    for (const c of session.comparisons) {
      const a = recipeOf.get(c.cupAId);
      const b = recipeOf.get(c.cupBId);
      if (a === undefined || b === undefined || a === b) continue;
      comparisons.push({ itemA: a, itemB: b, result: c.result, sessionId: session.id });
    }
  }
  const byDay = new Map<string, { recipeId: string; score: number }[]>();
  for (const { brew, score } of scoredBrews(brews)) {
    const day = brewDay(brew.date);
    const list = byDay.get(day) ?? [];
    list.push({ recipeId: brew.recipeId, score });
    byDay.set(day, list);
  }
  for (const [day, entries] of byDay) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        if (entries[i].recipeId === entries[j].recipeId) continue;
        comparisons.push({
          itemA: entries[i].recipeId,
          itemB: entries[j].recipeId,
          result: diffToResult(entries[i].score - entries[j].score),
          sessionId: day,
        });
      }
    }
  }
  return comparisons;
}

/** 三点識別の集計。中断した試行も試行数に数える（都合の悪い試行を除外しない）。 */
export function triangleSummary(trials: readonly TriangleTrial[]): { trials: number; correct: number } {
  const done = trials.filter((t) => t.answer !== undefined || t.abandoned);
  return { trials: done.length, correct: done.filter((t) => t.correct === true).length };
}

/** 差の梯子ラベル（'0.5段'）を数値に直す。 */
export function ladderValue(label: string): number {
  const value = Number.parseFloat(label);
  return Number.isFinite(value) ? value : NaN;
}

/** 三点識別の履歴を古い順の正誤列にする。ステアケースの再生に使う。 */
export function triangleOutcomes(trials: readonly TriangleTrial[]): boolean[] {
  return trials
    .filter((t) => t.answer !== undefined || t.abandoned)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => t.correct === true);
}

/** 三点識別の正誤列をステアケース法で再生し、識別できる差の閾値を推定する。 */
export function estimateThresholdFromOutcomes(outcomes: readonly boolean[]): ThresholdResult {
  let state = initStaircase(DELTA_LEVELS);
  for (const correct of outcomes) state = updateStaircase(state, correct);
  return estimateThreshold(state);
}

/** 2回試技の戦略評価への入力。レシピごとの自己採点の平均と標準偏差。 */
export function projectionsFromBrews(
  brews: readonly BrewRecord[],
  recipes: readonly Recipe[],
): { projections: RecipeProjection[]; nByRecipe: Map<string, number> } {
  const scores = new Map<string, number[]>();
  for (const { brew, score } of scoredBrews(brews)) {
    const list = scores.get(brew.recipeId) ?? [];
    list.push(score);
    scores.set(brew.recipeId, list);
  }
  const nByRecipe = new Map<string, number>();
  const projections: RecipeProjection[] = [];
  for (const recipe of recipes) {
    const list = scores.get(recipe.id);
    if (!list || list.length === 0) continue;
    nByRecipe.set(recipe.id, list.length);
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    const variance = list.length < 2 ? 0 : list.reduce((a, b) => a + (b - mean) ** 2, 0) / (list.length - 1);
    projections.push({ recipeId: recipe.id, label: recipe.name, expectedScore: mean, sd: Math.sqrt(variance) });
  }
  return { projections, nByRecipe };
}

/** 外部スコアへの校正の入力。潜在スコアθと第三者採点を、レシピ単位で突き合わせる。 */
export function calibrationPointsFrom(
  labels: readonly ExternalLabel[],
  thetaByRecipe: ReadonlyMap<string, number>,
  selfScoreByRecipe: ReadonlyMap<string, number>,
): CalibrationPoint[] {
  const external = new Map<string, number[]>();
  for (const label of labels) {
    const values = Object.values(label.scores).filter((v) => Number.isFinite(v));
    if (values.length === 0) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const list = external.get(label.recipeId) ?? [];
    list.push(mean);
    external.set(label.recipeId, list);
  }
  const points: CalibrationPoint[] = [];
  for (const [recipeId, values] of external) {
    const theta = thetaByRecipe.get(recipeId);
    if (theta === undefined) continue;
    points.push({
      theta,
      externalScore: values.reduce((a, b) => a + b, 0) / values.length,
      selfScore: selfScoreByRecipe.get(recipeId),
    });
  }
  return points;
}
