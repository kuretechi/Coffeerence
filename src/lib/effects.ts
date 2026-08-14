import type {
  Competition,
  CriterionKey,
  EffectEstimate,
  FactorKey,
  ScoreWeights,
  Session,
} from '../domain/types';
import { CRITERION_ORDER } from '../domain/defaults';
import { composeScores } from './scoring';
import { achievedPower, bootstrapCi, mean, requiredTrials } from './stats';
import { type Rng, defaultRng } from './random';

export interface EffectContext {
  competition: Competition;
  weights: ScoreWeights;
  /** F-06 で推定した項目別σ */
  sigmaByCriterion: Partial<Record<CriterionKey, number>>;
  /** 検出したい効果量 δ */
  detectableEffect: number;
  bootstrapIterations?: number;
}

interface LevelDiffSample {
  criterion: CriterionKey;
  diff: number;
  observations: number;
}

/**
 * F-08 効果量の推定。
 * 同一セッション内の差分を基本単位とし（日差・豆の劣化をキャンセル）、
 * セッション間はブートストラップで区間推定する（6.4 の v1 実装）。
 */
export function estimateEffects(sessions: readonly Session[], context: EffectContext, rng: Rng = defaultRng): EffectEstimate[] {
  const grouped = new Map<string, { factor: FactorKey; from: string; to: string; samples: LevelDiffSample[] }>();

  for (const session of sessions) {
    const { factor, levels } = session.plan;
    if (levels.length < 2) continue;

    for (let i = 0; i < levels.length; i++) {
      for (let j = 0; j < levels.length; j++) {
        if (i === j) continue;
        const from = levels[i];
        const to = levels[j];
        if (from.label >= to.label) continue; // 片方向のみ（from < to）

        for (const criterion of CRITERION_ORDER) {
          const sample =
            criterion === 'balance'
              ? balanceDiff(session, from.recipeId, to.recipeId)
              : absoluteDiff(session, from.recipeId, to.recipeId, criterion, context);
          if (!sample) continue;
          const key = `${factor}|${from.label}|${to.label}`;
          const bucket = grouped.get(key) ?? { factor, from: from.label, to: to.label, samples: [] };
          bucket.samples.push({ criterion, ...sample });
          grouped.set(key, bucket);
        }
      }
    }
  }

  const iterations = context.bootstrapIterations ?? 1000;
  const estimates: EffectEstimate[] = [];

  for (const bucket of grouped.values()) {
    for (const criterion of CRITERION_ORDER) {
      const samples = bucket.samples.filter((s) => s.criterion === criterion);
      if (samples.length === 0) continue;
      const diffs = samples.map((s) => s.diff);
      const n = samples.reduce((a, s) => a + s.observations, 0);
      const estimate = mean(diffs);
      const ci =
        diffs.length >= 2
          ? bootstrapCi(diffs, (resample) => mean(resample), iterations, rng)
          : widenWithSigma(estimate, context.sigmaByCriterion[criterion] ?? 1);

      const sigma = context.sigmaByCriterion[criterion] ?? 1;
      const delta = context.detectableEffect;
      const crossesZero = ci.low <= 0 && ci.high >= 0;
      const width = ci.high - ci.low;

      let verdict: EffectEstimate['verdict'];
      if (!crossesZero) verdict = 'significant';
      else if (width > delta) verdict = 'inconclusive';
      else verdict = 'no_effect';

      const needed = requiredTrials(sigma, delta);
      estimates.push({
        factor: bucket.factor,
        fromLevel: bucket.from,
        toLevel: bucket.to,
        criterion,
        estimate,
        ciLow: ci.low,
        ciHigh: ci.high,
        n,
        verdict,
        additionalTrialsNeeded: verdict === 'inconclusive' ? Math.max(0, needed - n) : undefined,
      });
    }
  }

  return estimates;
}

function absoluteDiff(
  session: Session,
  fromRecipeId: string,
  toRecipeId: string,
  criterion: CriterionKey,
  context: EffectContext,
): { diff: number; observations: number } | undefined {
  const valuesFor = (recipeId: string) =>
    session.cups
      .filter((c) => c.recipeId === recipeId && c.score)
      .map((c) => composeScores(c.score!, context.competition, context.weights)[criterion])
      .filter((v): v is number => v !== undefined);

  const from = valuesFor(fromRecipeId);
  const to = valuesFor(toRecipeId);
  if (from.length === 0 || to.length === 0) return undefined;
  return { diff: mean(to) - mean(from), observations: from.length + to.length };
}

/** バランス・総合は絶対値を持たないため、対比較のマージン平均を効果とみなす。 */
function balanceDiff(
  session: Session,
  fromRecipeId: string,
  toRecipeId: string,
): { diff: number; observations: number } | undefined {
  const recipeOf = new Map(session.cups.map((c) => [c.id, c.recipeId]));
  const margins: number[] = [];
  for (const comparison of session.comparisons) {
    if (comparison.criterion !== 'balance') continue;
    const a = recipeOf.get(comparison.cupAId);
    const b = recipeOf.get(comparison.cupBId);
    if (a === fromRecipeId && b === toRecipeId) margins.push(-comparison.result);
    else if (a === toRecipeId && b === fromRecipeId) margins.push(comparison.result);
  }
  if (margins.length === 0) return undefined;
  return { diff: mean(margins), observations: margins.length };
}

/** セッションが1件しかない場合は、測定誤差から素朴な区間を作る（正直に広く出す）。 */
function widenWithSigma(estimate: number, sigma: number): { low: number; high: number } {
  const halfWidth = 1.96 * sigma * Math.SQRT2;
  return { low: estimate - halfWidth, high: estimate + halfWidth };
}

export interface ExplorationVerdict {
  factor: FactorKey;
  stopRecommended: boolean;
  reason: string;
  power: number;
  n: number;
}

/** F-09 探索の打ち切り判定。 */
export function explorationVerdicts(
  estimates: readonly EffectEstimate[],
  sigmaByCriterion: Partial<Record<CriterionKey, number>>,
  detectableEffect: number,
): ExplorationVerdict[] {
  const byFactor = new Map<FactorKey, EffectEstimate[]>();
  for (const e of estimates) {
    byFactor.set(e.factor, [...(byFactor.get(e.factor) ?? []), e]);
  }

  const out: ExplorationVerdict[] = [];
  for (const [factor, list] of byFactor) {
    const n = Math.max(...list.map((e) => e.n));
    const worstSigma = Math.max(...list.map((e) => sigmaByCriterion[e.criterion] ?? 1));
    const power = achievedPower(Math.max(1, Math.round(n / 2)), worstSigma, detectableEffect);
    const anySignificant = list.some((e) => e.verdict === 'significant');
    const allNoEffect = list.every((e) => e.verdict === 'no_effect');

    if (anySignificant) {
      out.push({ factor, stopRecommended: false, reason: '有意な効果が出ています。水準を詰める価値があります', power, n });
    } else if (allNoEffect) {
      out.push({
        factor,
        stopRecommended: true,
        reason: '全項目で効果が検出限界以下です。この因子は確定し、他の因子に豆を回してください',
        power,
        n,
      });
    } else if (power >= 0.8) {
      out.push({
        factor,
        stopRecommended: true,
        reason: `十分な検出力（${(power * 100).toFixed(0)}%）がありながら差が出ていません`,
        power,
        n,
      });
    } else {
      out.push({
        factor,
        stopRecommended: false,
        reason: `判定不能。検出力が不足しています（現在 ${(power * 100).toFixed(0)}%）`,
        power,
        n,
      });
    }
  }
  return out;
}
