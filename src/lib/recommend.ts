import type { CriterionKey, EffectEstimate, FactorKey } from '../domain/types';
import { FACTORS } from '../domain/defaults';
import { cupsAffordable } from './plan';
import { requiredTrials } from './stats';
import type { ExplorationVerdict } from './effects';

export interface RecommendationInput {
  remainingBeanG: number;
  doseG: number;
  daysUntilCompetition: number;
  estimates: readonly EffectEstimate[];
  verdicts: readonly ExplorationVerdict[];
  sigmaByCriterion: Partial<Record<CriterionKey, number>>;
  detectableEffect: number;
  /** 三点識別で識別できないと分かっている因子（実験に使わない） */
  undiscriminableFactors?: readonly FactorKey[];
}

export interface RecommendedDay {
  day: number;
  factor: FactorKey;
  headline: string;
  reason: string;
  cups: number;
}

export interface Recommendation {
  cupsRemaining: number;
  days: RecommendedDay[];
  note: string;
}

const labelOf = (factor: FactorKey) => FACTORS.find((f) => f.key === factor)?.label ?? factor;

/** 因子の「不確実性」= 区間幅の最大値。データがない因子は最大の不確実性として扱う。 */
function uncertaintyByFactor(estimates: readonly EffectEstimate[]): Map<FactorKey, number> {
  const out = new Map<FactorKey, number>();
  for (const e of estimates) {
    const width = e.ciHigh - e.ciLow;
    out.set(e.factor, Math.max(out.get(e.factor) ?? 0, width));
  }
  return out;
}

/**
 * F-10 次セッションの推奨。
 * 情報利得（不確実性の減少幅）と残り試行回数のトレードオフで、試す順を決める。
 */
export function recommendNextSessions(input: RecommendationInput): Recommendation {
  const cupsRemaining = cupsAffordable(input.remainingBeanG, input.doseG);
  const uncertainty = uncertaintyByFactor(input.estimates);
  const stopped = new Set(input.verdicts.filter((v) => v.stopRecommended).map((v) => v.factor));
  const blocked = new Set(input.undiscriminableFactors ?? []);

  const candidates = FACTORS.map((f) => f.key)
    .filter((key) => !stopped.has(key) && !blocked.has(key))
    .sort((a, b) => (uncertainty.get(b) ?? Infinity) - (uncertainty.get(a) ?? Infinity));

  const worstSigma = Math.max(
    ...Object.values(input.sigmaByCriterion).filter((v): v is number => typeof v === 'number'),
    0.5,
  );
  const perFactorCups = Math.max(4, Math.min(8, requiredTrials(worstSigma, input.detectableEffect)));

  const days: RecommendedDay[] = [];
  let budget = cupsRemaining;
  const dayCount = Math.max(1, Math.min(input.daysUntilCompetition, 3));

  for (let d = 0; d < dayCount && budget > 0; d++) {
    const isLastDay = d === dayCount - 1;
    const cups = Math.min(budget, perFactorCups);
    if (isLastDay && input.daysUntilCompetition <= 3) {
      days.push({
        day: d + 1,
        factor: candidates[0] ?? 'grind',
        headline: '確定レシピの反復のみ',
        reason: '本番再現性の確認に残り全量を投入します',
        cups: budget,
      });
      budget = 0;
      break;
    }
    const factor = candidates[d % Math.max(1, candidates.length)] ?? 'grind';
    const known = uncertainty.get(factor);
    days.push({
      day: d + 1,
      factor,
      headline: `${labelOf(factor)} の2水準比較`,
      reason:
        known === undefined
          ? 'まだデータがなく、効果量の不確実性が最大です'
          : `効果量の区間幅が ${known.toFixed(2)} 点と大きく、情報利得が見込めます`,
      cups,
    });
    budget -= cups;
  }

  const note =
    cupsRemaining === 0
      ? '残り豆が足りません。豆量を追加するか、1杯あたりの豆量を見直してください。'
      : `残り ${input.remainingBeanG.toFixed(0)}g（約${cupsRemaining}杯）／大会まで ${input.daysUntilCompetition} 日`;

  return { cupsRemaining, days, note };
}
