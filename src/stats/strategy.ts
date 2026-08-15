import { assertFinite, normalCdf } from './normal';

export interface RecipeProjection {
  recipeId: string;
  label: string;
  /** 1回あたりの期待得点。 */
  expectedScore: number;
  /** 1回あたりのレシピ自体の再現性のばらつき（採点誤差 σ とは別物）。 */
  sd: number;
}

export interface StrategyOption {
  /** 'A×2' 'A+B' のような表示用ラベル。 */
  label: string;
  recipeIds: [string, string];
  expectedTotal: number;
  sdTotal: number;
  probExceedTarget: number;
  /** probExceedTarget の降順での順位（1始まり）。 */
  rank: number;
}

/** 分散がゼロかどうかの判定に使う許容誤差（浮動小数の === 比較を避ける）。 */
const VARIANCE_EPS = 1e-12;

/**
 * 2回試技の合計点で目標ラインを超える確率を、組み合わせごとに評価する。
 *
 * 2回の得点を独立と仮定して正規近似する:
 *   E[T] = μ₁ + μ₂ 、 Var[T] = σ₁² + σ₂² 、 P(T ≥ target) = 1 − Φ((target − E[T]) / √Var[T])
 *
 * 同一レシピを2回使う組み合わせも必ず候補に含める。目標ラインが期待値より高い場合は
 * 分散が大きいレシピが有利になり、低い場合は分散が小さいレシピが有利になる（意図した挙動）。
 */
export function evaluateStrategies(recipes: RecipeProjection[], target: number): StrategyOption[] {
  if (!Array.isArray(recipes)) throw new Error('recipes must be an array');
  assertFinite(target, 'target');
  recipes.forEach((recipe, index) => {
    if (typeof recipe.recipeId !== 'string' || recipe.recipeId.length === 0) {
      throw new Error(`recipes[${index}].recipeId must be a non-empty string`);
    }
    if (typeof recipe.label !== 'string') throw new Error(`recipes[${index}].label must be a string`);
    assertFinite(recipe.expectedScore, `recipes[${index}].expectedScore`);
    assertFinite(recipe.sd, `recipes[${index}].sd`);
    if (recipe.sd < 0) throw new Error(`recipes[${index}].sd must be non-negative`);
  });

  const options: StrategyOption[] = [];
  for (let i = 0; i < recipes.length; i += 1) {
    for (let j = i; j < recipes.length; j += 1) {
      const first = recipes[i];
      const second = recipes[j];
      const expectedTotal = first.expectedScore + second.expectedScore;
      const varianceTotal = first.sd * first.sd + second.sd * second.sd;
      const sdTotal = Math.sqrt(varianceTotal);
      // 分散が実質ゼロなら合計点は決定論的なので、目標到達は 0/1 で判定する。
      const probExceedTarget =
        varianceTotal <= VARIANCE_EPS
          ? expectedTotal >= target
            ? 1
            : 0
          : 1 - normalCdf((target - expectedTotal) / sdTotal);
      options.push({
        label: i === j ? `${first.label}×2` : `${first.label}+${second.label}`,
        recipeIds: [first.recipeId, second.recipeId],
        expectedTotal,
        sdTotal,
        probExceedTarget,
        rank: 0,
      });
    }
  }

  options.sort((a, b) => b.probExceedTarget - a.probExceedTarget);
  return options.map((option, index) => ({ ...option, rank: index + 1 }));
}
