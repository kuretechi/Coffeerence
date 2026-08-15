import { describe, expect, it } from 'vitest';
import { type Observation, estimateEffect } from '../effect';

/** セッションごとに (fromLevel の点, toLevel の点) を1杯ずつ作る。 */
function pairedSessions(pairs: readonly [number, number][]): Observation[] {
  return pairs.flatMap(([from, to], i) => [
    { sessionId: `s${i}`, level: 'coarse', score: from },
    { sessionId: `s${i}`, level: 'fine', score: to },
  ]);
}

describe('estimateEffect', () => {
  it('セッション差が一定なら推定値はその差そのもので、有意と判定される', () => {
    // dₛ = 7 − 6 = 1 が3セッション。どのリサンプルでも平均は 1 なので CI は退化する。
    const result = estimateEffect(pairedSessions([
      [6, 7],
      [6, 7],
      [6, 7],
    ]), 'coarse', 'fine', { seed: 1 });
    expect(result.estimate).toBeCloseTo(1, 12);
    expect(result.ciLow).toBeCloseTo(1, 12);
    expect(result.ciHigh).toBeCloseTo(1, 12);
    expect(result.nSessions).toBe(3);
    expect(result.nObservations).toBe(6);
    expect(result.verdict).toBe('significant');
    expect(result.lowConfidence).toBe(false);
  });

  it('セッション内で平均を取ってから差を取る', () => {
    // d = mean(8, 6) − mean(5, 5) = 7 − 5 = 2
    const observations: Observation[] = [
      { sessionId: 's0', level: 'coarse', score: 5 },
      { sessionId: 's0', level: 'coarse', score: 5 },
      { sessionId: 's0', level: 'fine', score: 8 },
      { sessionId: 's0', level: 'fine', score: 6 },
      { sessionId: 's1', level: 'coarse', score: 5 },
      { sessionId: 's1', level: 'fine', score: 7 },
      { sessionId: 's2', level: 'coarse', score: 5 },
      { sessionId: 's2', level: 'fine', score: 6 },
    ];
    // dₛ = 2, 2, 1 なので平均は 5/3
    const result = estimateEffect(observations, 'coarse', 'fine', { seed: 3 });
    expect(result.estimate).toBeCloseTo(5 / 3, 12);
  });

  it('符号は toLevel − fromLevel の向き', () => {
    const observations = pairedSessions([
      [7, 6],
      [7, 6],
      [7, 6],
    ]);
    expect(estimateEffect(observations, 'coarse', 'fine', { seed: 1 }).estimate).toBeCloseTo(-1, 12);
    expect(estimateEffect(observations, 'fine', 'coarse', { seed: 1 }).estimate).toBeCloseTo(1, 12);
  });

  it('全観測が同一値なら推定値0・CI幅0で no_effect', () => {
    const result = estimateEffect(pairedSessions([
      [7, 7],
      [7, 7],
      [7, 7],
      [7, 7],
    ]), 'coarse', 'fine', { seed: 2 });
    expect(result.estimate).toBeCloseTo(0, 12);
    expect(result.ciHigh - result.ciLow).toBeCloseTo(0, 12);
    expect(result.verdict).toBe('no_effect');
  });

  it('CI が0をまたぎ、かつ広いときは no_effect ではなく inconclusive', () => {
    // dₛ = ±3 がばらついているので区間幅は 2*mde=1 を大きく超える。
    const result = estimateEffect(pairedSessions([
      [6, 9],
      [6, 3],
      [6, 9],
      [6, 3],
      [6, 9],
      [6, 3],
    ]), 'coarse', 'fine', { seed: 5, mde: 0.5 });
    expect(result.ciLow).toBeLessThan(0);
    expect(result.ciHigh).toBeGreaterThan(0);
    expect(result.ciHigh - result.ciLow).toBeGreaterThan(1);
    expect(result.verdict).toBe('inconclusive');
  });

  it('mde を大きくすると同じデータが inconclusive から no_effect になる', () => {
    const observations = pairedSessions([
      [6, 9],
      [6, 3],
      [6, 9],
      [6, 3],
      [6, 9],
      [6, 3],
    ]);
    const strict = estimateEffect(observations, 'coarse', 'fine', { seed: 5, mde: 0.5 });
    const loose = estimateEffect(observations, 'coarse', 'fine', { seed: 5, mde: 100 });
    expect(strict.verdict).toBe('inconclusive');
    expect(loose.verdict).toBe('no_effect');
  });

  it('セッションが2件以下ならカップ単位にフォールバックして lowConfidence', () => {
    const observations: Observation[] = [
      { sessionId: 's0', level: 'coarse', score: 5 },
      { sessionId: 's0', level: 'coarse', score: 6 },
      { sessionId: 's0', level: 'fine', score: 7 },
      { sessionId: 's0', level: 'fine', score: 8 },
    ];
    const result = estimateEffect(observations, 'coarse', 'fine', { seed: 9 });
    expect(result.nSessions).toBe(1);
    expect(result.lowConfidence).toBe(true);
    expect(result.estimate).toBeCloseTo(2, 12);
    expect(Number.isFinite(result.ciLow)).toBe(true);
    expect(result.ciLow).toBeLessThanOrEqual(result.ciHigh);
  });

  it('セッションごとに片方の水準しかない場合は対応がとれず lowConfidence', () => {
    const observations: Observation[] = [
      { sessionId: 's0', level: 'coarse', score: 5 },
      { sessionId: 's1', level: 'fine', score: 7 },
      { sessionId: 's2', level: 'coarse', score: 5 },
      { sessionId: 's2', level: 'fine', score: 7 },
      { sessionId: 's3', level: 'coarse', score: 5 },
      { sessionId: 's3', level: 'fine', score: 7 },
      { sessionId: 's4', level: 'coarse', score: 5 },
      { sessionId: 's4', level: 'fine', score: 7 },
    ];
    const result = estimateEffect(observations, 'coarse', 'fine', { seed: 4 });
    expect(result.nSessions).toBe(3);
    expect(result.nObservations).toBe(8);
    expect(result.lowConfidence).toBe(true);
  });

  it('両水準が揃うセッションが1つもなければ insufficient_data', () => {
    const observations: Observation[] = [
      { sessionId: 's0', level: 'coarse', score: 5 },
      { sessionId: 's1', level: 'fine', score: 7 },
    ];
    const result = estimateEffect(observations, 'coarse', 'fine', { seed: 1 });
    expect(result.verdict).toBe('insufficient_data');
    expect(result.nSessions).toBe(0);
    expect(result.estimate).toBeNaN();
    expect(result.ciLow).toBeNaN();
    expect(result.ciHigh).toBeNaN();
    expect(result.lowConfidence).toBe(true);
  });

  it('空配列・1要素・片方の水準0件は insufficient_data', () => {
    expect(estimateEffect([], 'coarse', 'fine', { seed: 1 }).verdict).toBe('insufficient_data');
    expect(
      estimateEffect([{ sessionId: 's0', level: 'coarse', score: 5 }], 'coarse', 'fine', { seed: 1 }).verdict,
    ).toBe('insufficient_data');
    const onlyFrom: Observation[] = [
      { sessionId: 's0', level: 'coarse', score: 5 },
      { sessionId: 's1', level: 'coarse', score: 6 },
      { sessionId: 's2', level: 'coarse', score: 7 },
    ];
    const result = estimateEffect(onlyFrom, 'coarse', 'fine', { seed: 1 });
    expect(result.verdict).toBe('insufficient_data');
    expect(result.nObservations).toBe(3);
  });

  it('対象外の水準は無視する', () => {
    const observations: Observation[] = [
      ...pairedSessions([
        [6, 7],
        [6, 7],
        [6, 7],
      ]),
      { sessionId: 's0', level: 'medium', score: 100 },
      { sessionId: 's1', level: 'medium', score: -100 },
    ];
    const result = estimateEffect(observations, 'coarse', 'fine', { seed: 1 });
    expect(result.nObservations).toBe(6);
    expect(result.estimate).toBeCloseTo(1, 12);
  });

  it('極端な値でも有限の推定値を返す', () => {
    const result = estimateEffect(pairedSessions([
      [1e-9, 1e9],
      [1e-9, 1e9],
      [1e-9, 1e9],
    ]), 'coarse', 'fine', { seed: 1 });
    expect(Number.isFinite(result.estimate)).toBe(true);
    expect(result.estimate).toBeCloseTo(1e9 - 1e-9, 0);
    expect(result.verdict).toBe('significant');
  });

  it('同じ入力・同じシードなら結果が完全に一致し、別シードでも推定値は変わらない', () => {
    const observations = pairedSessions([
      [6, 9],
      [6, 3],
      [6, 8],
      [6, 4],
      [6, 7],
    ]);
    const a = estimateEffect(observations, 'coarse', 'fine', { seed: 123 });
    const b = estimateEffect(observations, 'coarse', 'fine', { seed: 123 });
    expect(a).toEqual(b);
    const other = estimateEffect(observations, 'coarse', 'fine', { seed: 456 });
    expect(other.estimate).toBeCloseTo(a.estimate, 12);
  });

  it('NaN / Infinity / 不正な引数は例外', () => {
    const bad: Observation[] = [
      { sessionId: 's0', level: 'coarse', score: NaN },
      { sessionId: 's0', level: 'fine', score: 7 },
    ];
    expect(() => estimateEffect(bad, 'coarse', 'fine', { seed: 1 })).toThrow();
    expect(() =>
      estimateEffect([{ sessionId: 's0', level: 'coarse', score: Infinity }], 'coarse', 'fine', { seed: 1 }),
    ).toThrow();
    expect(() => estimateEffect([], 'coarse', 'fine', { seed: NaN })).toThrow();
    expect(() => estimateEffect([], 'coarse', 'coarse', { seed: 1 })).toThrow();
    expect(() => estimateEffect([], '', 'fine', { seed: 1 })).toThrow();
    expect(() => estimateEffect([], 'coarse', 'fine', { seed: 1, mde: -1 })).toThrow();
    expect(() => estimateEffect([], 'coarse', 'fine', { seed: 1, replicates: 0 })).toThrow();
    expect(() =>
      estimateEffect([{ sessionId: '', level: 'coarse', score: 5 }], 'coarse', 'fine', { seed: 1 }),
    ).toThrow();
  });
});
