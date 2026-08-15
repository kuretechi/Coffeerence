import { assertFinite } from './normal';

export interface StaircaseState {
  levels: number[]; // 難易度の候補（差の大きさ。昇順。小さいほど難しい）
  currentIndex: number;
  consecutiveCorrect: number;
  lastDirection: 'up' | 'down' | null; // 難易度の変化方向（up = より難しく＝差を小さく）
  reversals: number[]; // reversal が起きた地点の levels の値
  history: { index: number; correct: boolean }[];
}

/**
 * 3-up/1-down ステアケースの初期状態を作る。
 * levels は差の大きさの昇順リストで、index が小さいほど差が小さく（難しく）なる。
 */
export function initStaircase(levels: number[], startIndex?: number): StaircaseState {
  if (levels.length === 0) throw new Error('levels must not be empty');
  levels.forEach((v, i) => {
    assertFinite(v, `levels[${i}]`);
    if (i > 0 && v <= levels[i - 1]) throw new Error('levels must be strictly ascending');
  });
  const index = startIndex ?? levels.length - 1;
  assertFinite(index, 'startIndex');
  if (!Number.isInteger(index) || index < 0 || index >= levels.length) {
    throw new Error('startIndex must be an integer within levels range');
  }
  return {
    levels: [...levels],
    currentIndex: index,
    consecutiveCorrect: 0,
    lastDirection: null,
    reversals: [],
    history: [],
  };
}

/**
 * 1試行の結果を反映した新しい状態を返す（元の状態は変更しない）。
 * 3回連続正解で難易度を1段上げ（差を小さく）、1回の不正解で1段下げる（差を大きく）。
 * 方向が反転した地点の難易度を reversal として記録する。端に達した場合は動かさない。
 */
export function updateStaircase(state: StaircaseState, correct: boolean): StaircaseState {
  if (typeof correct !== 'boolean') throw new Error('correct must be a boolean');
  const next: StaircaseState = {
    levels: [...state.levels],
    currentIndex: state.currentIndex,
    consecutiveCorrect: state.consecutiveCorrect,
    lastDirection: state.lastDirection,
    reversals: [...state.reversals],
    history: [...state.history, { index: state.currentIndex, correct }],
  };

  // 移動方向を決める。正解が3回そろうまでは動かさない。
  let direction: 'up' | 'down' | null = null;
  if (correct) {
    next.consecutiveCorrect = state.consecutiveCorrect + 1;
    if (next.consecutiveCorrect >= 3) {
      direction = 'up';
      next.consecutiveCorrect = 0;
    }
  } else {
    next.consecutiveCorrect = 0;
    direction = 'down';
  }
  if (direction === null) return next;

  const target = direction === 'up' ? state.currentIndex - 1 : state.currentIndex + 1;
  // 端を越える移動は行わない（履歴には同じ index が残る）。
  if (target < 0 || target >= state.levels.length) return next;

  if (state.lastDirection !== null && state.lastDirection !== direction) {
    next.reversals.push(state.levels[state.currentIndex]);
  }
  next.currentIndex = target;
  next.lastDirection = direction;
  return next;
}

export interface ThresholdResult {
  threshold: number | null; // 推定閾値。データ不足なら null
  reversalCount: number;
  converged: boolean;
  trialsUsed: number;
}

/**
 * reversal 地点の平均から識別閾値を推定する。
 * 最初の discardFirst 回の reversal は捨て、残りがなければ「データ不足」として null を返す。
 * reversal が minReversals 回に達していなければ converged = false。
 */
export function estimateThreshold(
  state: StaircaseState,
  opts?: { minReversals?: number; discardFirst?: number },
): ThresholdResult {
  const minReversals = opts?.minReversals ?? 8;
  const discardFirst = opts?.discardFirst ?? 2;
  assertFinite(minReversals, 'minReversals');
  assertFinite(discardFirst, 'discardFirst');
  if (!Number.isInteger(minReversals) || minReversals < 1) throw new Error('minReversals must be a positive integer');
  if (!Number.isInteger(discardFirst) || discardFirst < 0) {
    throw new Error('discardFirst must be a non-negative integer');
  }

  const used = state.reversals.slice(discardFirst);
  const converged = state.reversals.length >= minReversals;
  const threshold = used.length === 0 ? null : used.reduce((a, b) => a + b, 0) / used.length;
  return {
    threshold,
    reversalCount: state.reversals.length,
    converged,
    trialsUsed: state.history.length,
  };
}
