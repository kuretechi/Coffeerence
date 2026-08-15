import { bootstrap } from './bootstrap';
import { assertFinite } from './normal';

/** 1杯の観測。因子の水準とスコアだけを持つ素のデータ。 */
export interface Observation {
  sessionId: string;
  /** 因子の水準（例: 挽き目 "medium"）。 */
  level: string;
  score: number;
}

export interface EffectResult {
  fromLevel: string;
  toLevel: string;
  /** toLevel − fromLevel のスコア差の推定値。判定不能なら NaN。 */
  estimate: number;
  ciLow: number;
  ciHigh: number;
  /** 両水準が揃っている（対応のとれる）セッション数。 */
  nSessions: number;
  /** 両水準あわせた観測数。 */
  nObservations: number;
  verdict: 'significant' | 'no_effect' | 'inconclusive' | 'insufficient_data';
  /** セッション数が足りずカップ単位の推定に落とした、または対応がとれていない。 */
  lowConfidence: boolean;
  /** inconclusive のとき、上位層（M-5）が追加試行数を埋めるための欄。 */
  additionalTrialsNeeded?: number;
}

/** 最小検出したい効果量の既定値（点数）。 */
const DEFAULT_MDE = 0.5;

function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

interface SessionGroup {
  from: number[];
  to: number[];
}

function groupBySession(observations: readonly Observation[], fromLevel: string, toLevel: string): Map<string, SessionGroup> {
  const groups = new Map<string, SessionGroup>();
  for (const o of observations) {
    if (o.level !== fromLevel && o.level !== toLevel) continue;
    let group = groups.get(o.sessionId);
    if (group === undefined) {
      group = { from: [], to: [] };
      groups.set(o.sessionId, group);
    }
    if (o.level === fromLevel) group.from.push(o.score);
    else group.to.push(o.score);
  }
  return groups;
}

/**
 * 「水準 fromLevel から toLevel に変えたらスコアが何点変わるか」を
 * 信頼区間つきで推定する。
 *
 * 同一セッション内の差 dₛ = mean(toLevel) − mean(fromLevel) を基本単位とし、
 * セッション単位のクラスタブートストラップで区間を出す（セッション内のカップは
 * 相関しているため、カップ単位でリサンプルすると区間が不当に狭くなる）。
 * セッションが 2 件以下のときのみカップ単位にフォールバックし lowConfidence を立てる。
 * 判定は significant / no_effect / inconclusive / insufficient_data の4値で、
 * 「効果が無い」と「まだ分からない」を潰さない。
 */
export function estimateEffect(
  observations: readonly Observation[],
  fromLevel: string,
  toLevel: string,
  opts?: { mde?: number; seed: number; replicates?: number },
): EffectResult {
  if (!Array.isArray(observations)) throw new Error('observations must be an array');
  if (typeof fromLevel !== 'string' || fromLevel.length === 0) throw new Error('fromLevel must be a non-empty string');
  if (typeof toLevel !== 'string' || toLevel.length === 0) throw new Error('toLevel must be a non-empty string');
  if (fromLevel === toLevel) throw new Error('fromLevel and toLevel must differ');
  const seed = opts?.seed;
  if (seed === undefined || !Number.isFinite(seed)) throw new Error('seed must be a finite number');
  const mde = opts?.mde ?? DEFAULT_MDE;
  if (!Number.isFinite(mde) || mde < 0) throw new Error('mde must be a finite non-negative number');
  const replicates = opts?.replicates;
  if (replicates !== undefined && (!Number.isInteger(replicates) || replicates <= 0)) {
    throw new Error('replicates must be a positive integer');
  }
  for (const o of observations) {
    if (typeof o.sessionId !== 'string' || o.sessionId.length === 0) throw new Error('sessionId must be a non-empty string');
    if (typeof o.level !== 'string' || o.level.length === 0) throw new Error('level must be a non-empty string');
    assertFinite(o.score, 'score');
  }

  const groups = groupBySession(observations, fromLevel, toLevel);
  let nFrom = 0;
  let nTo = 0;
  const sessionDiffs: number[] = [];
  let unpairedSessions = 0;
  for (const group of groups.values()) {
    nFrom += group.from.length;
    nTo += group.to.length;
    if (group.from.length > 0 && group.to.length > 0) sessionDiffs.push(mean(group.to) - mean(group.from));
    else unpairedSessions += 1;
  }
  const nObservations = nFrom + nTo;
  const nSessions = sessionDiffs.length;

  const base = { fromLevel, toLevel, nSessions, nObservations };
  if (nSessions === 0 || nObservations < 2 || nFrom === 0 || nTo === 0) {
    return {
      ...base,
      estimate: NaN,
      ciLow: NaN,
      ciHigh: NaN,
      verdict: 'insufficient_data',
      lowConfidence: true,
    };
  }

  let lowConfidence = unpairedSessions > 0;
  let estimate: number;
  let ciLow: number;
  let ciHigh: number;

  if (nSessions >= 3) {
    // 通常経路: セッション単位のクラスタブートストラップ。
    const result = bootstrap(sessionDiffs, mean, { seed, replicates });
    estimate = result.estimate;
    ciLow = result.ciLow;
    ciHigh = result.ciHigh;
  } else {
    // セッションが 1〜2 件しかない場合はカップ単位にフォールバックする。
    lowConfidence = true;
    const cups = observations.filter((o) => o.level === fromLevel || o.level === toLevel);
    const diffOfMeans = (sample: readonly Observation[]): number => {
      const from: number[] = [];
      const to: number[] = [];
      for (const o of sample) {
        if (o.level === fromLevel) from.push(o.score);
        else to.push(o.score);
      }
      // 片方の水準が引かれなかったリサンプルは差が定義できないので NaN（基盤側で除外される）。
      if (from.length === 0 || to.length === 0) return NaN;
      return mean(to) - mean(from);
    };
    const result = bootstrap(cups, diffOfMeans, { seed, replicates });
    estimate = result.estimate;
    ciLow = result.ciLow;
    ciHigh = result.ciHigh;
  }

  let verdict: EffectResult['verdict'];
  if (ciLow > 0 || ciHigh < 0) verdict = 'significant';
  else if (ciHigh - ciLow <= 2 * mde) verdict = 'no_effect';
  else verdict = 'inconclusive';

  return { ...base, estimate, ciLow, ciHigh, verdict, lowConfidence };
}
