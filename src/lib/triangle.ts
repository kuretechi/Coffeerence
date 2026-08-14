import type { FactorKey, TriangleTrial } from '../domain/types';
import { type Rng, defaultRng, shuffle, uid } from './random';
import { binomialTailP, mean, pToSigma } from './stats';

export const GUESS_RATE = 1 / 3;
/** 6.6 まぐれ排除のしきい値（N シグマ換算） */
export const SIGNIFICANCE_SIGMA = 2.0;

/** 差の大きさの梯子（ステアケース法で上下する） */
export const DELTA_LADDER = ['2段', '1段', '0.5段', '0.25段'];

export function createTriangleTrial(
  factor: FactorKey,
  levelDelta: string,
  rng: Rng = defaultRng,
): TriangleTrial {
  // 配置はアプリが決定する。2杯が base、1杯だけが odd。
  const layout = shuffle([0, 1, 2], rng);
  const oddPosition = layout[0] as 0 | 1 | 2;
  const positions: [string, string, string] = ['base', 'base', 'base'];
  positions[oddPosition] = 'odd';
  return {
    id: uid('trial', rng),
    date: new Date().toISOString(),
    factor,
    levelDelta,
    positions,
    oddPosition,
    abandoned: false,
  };
}

export function answerTriangleTrial(trial: TriangleTrial, answer: 0 | 1 | 2): TriangleTrial {
  return { ...trial, answer, correct: answer === trial.oddPosition, abandoned: false };
}

/** NF-08: 中断した試行も削除できない。中断として記録する。 */
export function abandonTriangleTrial(trial: TriangleTrial): TriangleTrial {
  return { ...trial, abandoned: true };
}

export interface TriangleSummary {
  factor: FactorKey;
  levelDelta: string;
  correct: number;
  total: number;
  pValue: number;
  nSigma: number;
  discriminable: boolean;
}

/** 6.6 二項検定（帰無仮説 p=1/3）。中断試行は分母から除く（ただし記録は残す）。 */
export function summarizeTriangleTrials(trials: readonly TriangleTrial[]): TriangleSummary[] {
  const groups = new Map<string, TriangleTrial[]>();
  for (const trial of trials) {
    if (trial.abandoned || trial.correct === undefined) continue;
    const key = `${trial.factor}|${trial.levelDelta}`;
    groups.set(key, [...(groups.get(key) ?? []), trial]);
  }

  return [...groups.entries()].map(([key, list]) => {
    const [factor, levelDelta] = key.split('|');
    const correct = list.filter((t) => t.correct).length;
    const total = list.length;
    const pValue = binomialTailP(correct, total, GUESS_RATE);
    const nSigma = pToSigma(pValue);
    return {
      factor: factor as FactorKey,
      levelDelta,
      correct,
      total,
      pValue,
      nSigma,
      discriminable: nSigma >= SIGNIFICANCE_SIGMA,
    };
  });
}

export interface StaircaseState {
  /** 現在の梯子インデックス（大きいほど差が小さい） */
  index: number;
  consecutiveCorrect: number;
  reversals: number[];
  lastDirection: 'down' | 'up' | undefined;
}

export function initialStaircase(startIndex = 1): StaircaseState {
  return { index: startIndex, consecutiveCorrect: 0, reversals: [], lastDirection: undefined };
}

/**
 * 6.7 3-up/1-down ステアケース法。
 * 3回連続正解で差を1段階小さくし、1回不正解で差を1段階大きくする。
 */
export function advanceStaircase(state: StaircaseState, correct: boolean, ladderSize = DELTA_LADDER.length): StaircaseState {
  const next: StaircaseState = { ...state, reversals: [...state.reversals] };
  if (correct) {
    next.consecutiveCorrect = state.consecutiveCorrect + 1;
    if (next.consecutiveCorrect >= 3) {
      next.consecutiveCorrect = 0;
      const proposed = Math.min(ladderSize - 1, state.index + 1);
      if (proposed !== state.index) {
        if (state.lastDirection === 'up') next.reversals = [...next.reversals, state.index];
        next.lastDirection = 'down';
        next.index = proposed;
      }
    }
  } else {
    next.consecutiveCorrect = 0;
    const proposed = Math.max(0, state.index - 1);
    if (proposed !== state.index) {
      if (state.lastDirection === 'down') next.reversals = [...next.reversals, state.index];
      next.lastDirection = 'up';
      next.index = proposed;
    }
  }
  return next;
}

/** 反転6回以降の平均を閾値推定値とする（梯子インデックスの平均）。 */
export function staircaseThreshold(state: StaircaseState, ladder: readonly string[] = DELTA_LADDER): string | undefined {
  if (state.reversals.length < 6) return undefined;
  const used = state.reversals.slice(5);
  const index = Math.round(mean(used));
  return ladder[Math.min(ladder.length - 1, Math.max(0, index))];
}

/** F-15 用途2: 識別できない差を実験計画に使わせない。 */
export function minimumUsefulDelta(summaries: readonly TriangleSummary[], factor: FactorKey): string | undefined {
  const discriminable = summaries.filter((s) => s.factor === factor && s.discriminable);
  if (discriminable.length === 0) return undefined;
  return discriminable.reduce((smallest, s) =>
    DELTA_LADDER.indexOf(s.levelDelta) > DELTA_LADDER.indexOf(smallest.levelDelta) ? s : smallest,
  ).levelDelta;
}
