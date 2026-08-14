import type {
  Competition,
  RecipeProjection,
  ScoreWeights,
  Session,
  StrategyOption,
} from '../domain/types';
import { CRITERION_ORDER } from '../domain/defaults';
import { composeScores } from './scoring';
import { mean, normalCdf, sd } from './stats';

/**
 * 候補レシピごとの期待値 μ と、レシピ自体のブレ σ_recipe。
 * balance は絶対値を持たないため合計から除く（校正済みの場合のみ外部から加算する）。
 */
export function recipeProjections(
  sessions: readonly Session[],
  competition: Competition,
  weights: ScoreWeights,
  calibratedRecipeIds: ReadonlySet<string> = new Set(),
): RecipeProjection[] {
  const totalsByRecipe = new Map<string, number[]>();

  for (const session of sessions) {
    for (const cup of session.cups) {
      if (!cup.score) continue;
      const composed = composeScores(cup.score, competition, weights);
      let total = 0;
      let counted = 0;
      for (const criterion of CRITERION_ORDER) {
        const value = composed[criterion];
        if (value === undefined) continue;
        total += value;
        counted++;
      }
      if (counted === 0) continue;
      totalsByRecipe.set(cup.recipeId, [...(totalsByRecipe.get(cup.recipeId) ?? []), total]);
    }
  }

  return [...totalsByRecipe.entries()].map(([recipeId, totals]) => ({
    recipeId,
    expectedScore: mean(totals),
    sd: totals.length >= 2 ? sd(totals) : NaN,
    calibrated: calibratedRecipeIds.has(recipeId),
  }));
}

/** 6.8 2回試技の戦略評価。全候補ペア（同一レシピ2回を含む）を目標達成確率で降順に返す。 */
export function strategyOptions(
  projections: readonly RecipeProjection[],
  threshold: number,
  labelOf: (recipeId: string) => string,
): StrategyOption[] {
  const usable = projections.filter((p) => Number.isFinite(p.expectedScore));
  const options: StrategyOption[] = [];

  for (let i = 0; i < usable.length; i++) {
    for (let j = i; j < usable.length; j++) {
      const a = usable[i];
      const b = usable[j];
      const sdA = Number.isFinite(a.sd) ? a.sd : 0;
      const sdB = Number.isFinite(b.sd) ? b.sd : 0;
      const expectedTotal = a.expectedScore + b.expectedScore;
      const varianceTotal = sdA * sdA + sdB * sdB;
      const sdTotal = Math.sqrt(varianceTotal);
      const probExceedTarget =
        sdTotal === 0 ? (expectedTotal >= threshold ? 1 : 0) : 1 - normalCdf((threshold - expectedTotal) / sdTotal);
      options.push({
        label: i === j ? `${labelOf(a.recipeId)}×2` : `${labelOf(a.recipeId)}+${labelOf(b.recipeId)}`,
        recipeIds: [a.recipeId, b.recipeId],
        expectedTotal,
        sdTotal,
        probExceedTarget,
        recommended: false,
      });
    }
  }

  options.sort((x, y) => y.probExceedTarget - x.probExceedTarget || y.expectedTotal - x.expectedTotal);
  if (options.length > 0) options[0].recommended = true;
  return options;
}

export type StrategyStance = 'maximize_mean' | 'increase_variance' | 'reduce_variance';

/** F-13 判断ロジック: 目標ラインと期待値の関係から、攻めるか守るかを決める。 */
export function strategyStance(bestExpectedTotal: number, threshold: number): StrategyStance {
  if (!Number.isFinite(threshold)) return 'maximize_mean';
  if (threshold > bestExpectedTotal) return 'increase_variance';
  if (threshold < bestExpectedTotal) return 'reduce_variance';
  return 'maximize_mean';
}

export const STANCE_LABEL: Record<StrategyStance, string> = {
  maximize_mean: '期待値最大のレシピを2回。目標と期待値がほぼ一致しています',
  increase_variance: '目標ラインが期待値を上回ります。分散の大きい「攻める」レシピを選んでください',
  reduce_variance: '目標ラインが期待値を下回ります。分散の小さい「安定」レシピを2回投げてください',
};
