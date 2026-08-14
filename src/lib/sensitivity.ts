import type { Competition, CriterionKey, Recipe, ScoreWeights, Session } from '../domain/types';
import { CRITERION_ORDER } from '../domain/defaults';
import { composeScores } from './scoring';
import { mean } from './stats';

export interface SensitivityVariable {
  key: string;
  label: string;
  unit: string;
  /** 本番で現実的に起こりうるブレ幅（±） */
  tolerance: number;
}

export const SENSITIVITY_VARIABLES: SensitivityVariable[] = [
  { key: 'dose', label: '豆量', unit: 'g', tolerance: 0.3 },
  { key: 'water', label: '総湯量', unit: 'g', tolerance: 5 },
  { key: 'beverage', label: '提出量', unit: 'g', tolerance: 5 },
  { key: 'totalTime', label: '総抽出時間', unit: '秒', tolerance: 15 },
  { key: 'drawdown', label: '落ちきり時間', unit: '秒', tolerance: 10 },
];

export interface SensitivityRow {
  variable: SensitivityVariable;
  criterion: CriterionKey;
  slopePerUnit: number;
  impactAtTolerance: number;
  n: number;
  verdict: 'insufficient' | 'negligible' | 'watch' | 'critical';
}

const observedDeviation = (session: Session, recipes: Map<string, Recipe>, variableKey: string) => {
  const points: { x: number; cupId: string }[] = [];
  for (const cup of session.cups) {
    const recipe = recipes.get(cup.recipeId);
    const log = cup.brewLog;
    if (!recipe) continue;
    let x: number | undefined;
    switch (variableKey) {
      case 'dose':
        x = log.actualDoseG === undefined ? undefined : log.actualDoseG - recipe.doseG;
        break;
      case 'water':
        x = log.actualTotalWaterG === undefined ? undefined : log.actualTotalWaterG - recipe.totalWaterG;
        break;
      case 'beverage':
        x = log.beverageG === undefined ? undefined : log.beverageG - recipe.targetBeverageG;
        break;
      case 'totalTime':
        x = log.totalTimeSec;
        break;
      case 'drawdown':
        x = log.drawdownSec;
        break;
      default:
        x = undefined;
    }
    if (x === undefined) continue;
    points.push({ x, cupId: cup.id });
  }
  return points;
};

/** 最小二乗の傾き。分散が 0 なら undefined。 */
export function slope(xs: readonly number[], ys: readonly number[]): number | undefined {
  if (xs.length < 3) return undefined;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return undefined;
  return sxy / sxx;
}

/** F-11 感度マップ。実測値のブレと採点の関係から、本番で死守すべき変数を割り出す。 */
export function sensitivityMap(
  sessions: readonly Session[],
  recipes: readonly Recipe[],
  competition: Competition,
  weights: ScoreWeights,
): SensitivityRow[] {
  const recipeMap = new Map(recipes.map((r) => [r.id, r]));
  const rows: SensitivityRow[] = [];

  for (const variable of SENSITIVITY_VARIABLES) {
    for (const criterion of CRITERION_ORDER) {
      if (criterion === 'balance') continue; // 絶対値を持たない
      const xs: number[] = [];
      const ys: number[] = [];
      for (const session of sessions) {
        const points = observedDeviation(session, recipeMap, variable.key);
        if (points.length === 0) continue;
        const centre = mean(points.map((p) => p.x));
        for (const point of points) {
          const cup = session.cups.find((c) => c.id === point.cupId);
          if (!cup?.score) continue;
          const value = composeScores(cup.score, competition, weights)[criterion];
          if (value === undefined) continue;
          xs.push(point.x - centre);
          ys.push(value);
        }
      }
      const s = slope(xs, ys);
      if (s === undefined) {
        rows.push({
          variable,
          criterion,
          slopePerUnit: 0,
          impactAtTolerance: 0,
          n: xs.length,
          verdict: 'insufficient',
        });
        continue;
      }
      const impact = s * variable.tolerance;
      rows.push({
        variable,
        criterion,
        slopePerUnit: s,
        impactAtTolerance: impact,
        n: xs.length,
        verdict: Math.abs(impact) < 0.2 ? 'negligible' : Math.abs(impact) < 0.5 ? 'watch' : 'critical',
      });
    }
  }

  return rows;
}

export const SENSITIVITY_VERDICT_LABEL: Record<SensitivityRow['verdict'], string> = {
  insufficient: 'データ不足',
  negligible: '影響なし',
  watch: '要注意',
  critical: '最優先で死守',
};
