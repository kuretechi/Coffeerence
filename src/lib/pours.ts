import type { Pour } from '../domain/types';

/** 1投ぶんの入力値。`waterG` はその回に注ぐ量（累積ではない）。 */
export interface PourStep {
  waterG: number;
  atSec: number;
}

/** 各投の注湯量を、データモデルの累積目標重量（`Pour.targetG`）に変換する。 */
export function toPours(steps: readonly PourStep[]): Pour[] {
  let cumulative = 0;
  return steps.map((step, i) => {
    cumulative += step.waterG;
    return {
      index: i + 1,
      targetG: Math.round(cumulative * 10) / 10,
      startSec: step.atSec,
      note: i === 0 ? '蒸らし' : undefined,
    };
  });
}

/** 累積目標重量から、各投の注湯量を復元する。 */
export function toSteps(pours: readonly Pour[]): PourStep[] {
  let previous = 0;
  return pours.map((pour) => {
    const waterG = Math.round((pour.targetG - previous) * 10) / 10;
    previous = pour.targetG;
    return { waterG, atSec: pour.startSec };
  });
}

export interface PourProgress {
  /** 注ぐ時刻を過ぎた最後の投。 */
  current?: Pour;
  /** 次に注ぐ投。 */
  next?: Pour;
  /** `current` を注ぐ時刻からの経過秒。 */
  sinceCurrentSec: number;
  /** `next` を注ぐまでの残り秒。 */
  untilNextSec: number;
}

export function pourProgress(pours: readonly Pour[], elapsed: number): PourProgress {
  const ordered = [...pours].sort((a, b) => a.startSec - b.startSec);
  const current = [...ordered].reverse().find((pour) => pour.startSec <= elapsed);
  const next = ordered.find((pour) => pour.startSec > elapsed);
  return {
    current,
    next,
    sinceCurrentSec: current ? elapsed - current.startSec : 0,
    untilNextSec: next ? next.startSec - elapsed : 0,
  };
}
