import { describe, expect, it } from 'vitest';
import { evaluateStrategies, type RecipeProjection } from '../strategy';

const A: RecipeProjection = { recipeId: 'a', label: 'A', expectedScore: 82.1, sd: 1.2 };
const B: RecipeProjection = { recipeId: 'b', label: 'B', expectedScore: 83.4, sd: 3.8 };

describe('evaluateStrategies', () => {
  // 仕様書の検証テスト。期待値は python(statistics.NormalDist) で検算した値。
  it('仕様書の A/B・target=168 の厳密値を再現する', () => {
    const options = evaluateStrategies([A, B], 168);
    expect(options).toHaveLength(3);
    const byLabel = new Map(options.map((option) => [option.label, option]));

    const a2 = byLabel.get('A×2');
    expect(a2?.expectedTotal).toBeCloseTo(164.2, 9);
    expect(a2?.sdTotal).toBeCloseTo(1.697056274847714, 9); // √(2×1.44)
    expect(a2?.probExceedTarget).toBeCloseTo(0.012572380586678422, 9);

    const b2 = byLabel.get('B×2');
    expect(b2?.expectedTotal).toBeCloseTo(166.8, 9);
    expect(b2?.sdTotal).toBeCloseTo(5.374011537017761, 9); // √(2×14.44)
    expect(b2?.probExceedTarget).toBeCloseTo(0.411652228357803, 9);

    const ab = byLabel.get('A+B');
    expect(ab?.expectedTotal).toBeCloseTo(165.5, 9);
    expect(ab?.sdTotal).toBeCloseTo(3.984971769034255, 9); // √(1.44+14.44)
    expect(ab?.probExceedTarget).toBeCloseTo(0.2652126183761877, 9);
  });

  it('目標が期待値より高いので B×2 > A+B > A×2 の順になる', () => {
    const options = evaluateStrategies([A, B], 168);
    expect(options.map((option) => option.label)).toEqual(['B×2', 'A+B', 'A×2']);
    expect(options.map((option) => option.rank)).toEqual([1, 2, 3]);
    // 期待値が最も高い B×2 が首位だが、A+B は A×2 より期待値が高く分散も大きい。
    expect(options[0].expectedTotal).toBeGreaterThan(options[2].expectedTotal);
  });

  it('目標が期待値を下回るときは分散の小さいほうが有利になる', () => {
    // 同じ期待値・異なる分散のレシピで、目標を期待値より低く置く。
    const stable: RecipeProjection = { recipeId: 's', label: 'S', expectedScore: 82, sd: 1 };
    const wild: RecipeProjection = { recipeId: 'w', label: 'W', expectedScore: 82, sd: 5 };
    const low = evaluateStrategies([stable, wild], 160);
    expect(low[0].label).toBe('S×2');
    expect(low[low.length - 1].label).toBe('W×2');
    // 目標を期待値より上に置くと順序が反転する。
    const high = evaluateStrategies([stable, wild], 170);
    expect(high[0].label).toBe('W×2');
    expect(high[high.length - 1].label).toBe('S×2');
  });

  it('確率は 0..1 に収まり、target が ±∞ 相当に離れると 0 / 1 に近づく', () => {
    for (const option of evaluateStrategies([A, B], 1000)) {
      expect(option.probExceedTarget).toBeGreaterThanOrEqual(0);
      expect(option.probExceedTarget).toBeLessThan(1e-6);
    }
    for (const option of evaluateStrategies([A, B], -1000)) {
      expect(option.probExceedTarget).toBeGreaterThan(1 - 1e-6);
      expect(option.probExceedTarget).toBeLessThanOrEqual(1);
    }
  });

  it('レシピ1件でも2回使う候補を返す', () => {
    const options = evaluateStrategies([A], 164.2);
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('A×2');
    expect(options[0].recipeIds).toEqual(['a', 'a']);
    // 目標がちょうど期待値なら確率は 1/2。
    expect(options[0].probExceedTarget).toBeCloseTo(0.5, 12);
  });

  it('空配列なら候補なし', () => {
    expect(evaluateStrategies([], 168)).toEqual([]);
  });

  it('3件なら同一組み合わせを含む6通り', () => {
    const C: RecipeProjection = { recipeId: 'c', label: 'C', expectedScore: 80, sd: 2 };
    const options = evaluateStrategies([A, B, C], 168);
    expect(options).toHaveLength(6);
    expect(new Set(options.map((option) => option.label)).size).toBe(6);
  });

  it('sd=0（完全再現）は決定論的に判定する', () => {
    const perfect: RecipeProjection = { recipeId: 'p', label: 'P', expectedScore: 85, sd: 0 };
    expect(evaluateStrategies([perfect], 170)[0].probExceedTarget).toBe(1);
    expect(evaluateStrategies([perfect], 170.5)[0].probExceedTarget).toBe(0);
  });

  it('すべて同値のレシピでは全候補が同じ確率になる', () => {
    const x: RecipeProjection = { recipeId: 'x', label: 'X', expectedScore: 82, sd: 2 };
    const y: RecipeProjection = { recipeId: 'y', label: 'Y', expectedScore: 82, sd: 2 };
    const probs = evaluateStrategies([x, y], 165).map((option) => option.probExceedTarget);
    expect(probs).toHaveLength(3);
    for (const prob of probs) expect(prob).toBeCloseTo(probs[0], 12);
  });

  it('極端に大きい入力でも有限の確率を返す', () => {
    const huge: RecipeProjection = { recipeId: 'h', label: 'H', expectedScore: 1e12, sd: 1e6 };
    const option = evaluateStrategies([huge], 2e12)[0]; // 目標 = 期待合計なので確率は 1/2
    expect(Number.isFinite(option.expectedTotal)).toBe(true);
    expect(option.probExceedTarget).toBeCloseTo(0.5, 12);
  });

  it('NaN / Infinity は例外', () => {
    expect(() => evaluateStrategies([A], NaN)).toThrow();
    expect(() => evaluateStrategies([A], Infinity)).toThrow();
    expect(() => evaluateStrategies([{ ...A, expectedScore: NaN }], 168)).toThrow();
    expect(() => evaluateStrategies([{ ...A, sd: Infinity }], 168)).toThrow();
    expect(() => evaluateStrategies([{ ...A, sd: -1 }], 168)).toThrow();
    expect(() => evaluateStrategies([{ ...A, recipeId: '' }], 168)).toThrow();
  });

  it('同じ入力なら結果が完全に一致する（決定論）', () => {
    expect(evaluateStrategies([A, B], 168)).toEqual(evaluateStrategies([A, B], 168));
  });

  it('入力配列を書き換えない', () => {
    const input = [{ ...A }, { ...B }];
    const snapshot = JSON.stringify(input);
    evaluateStrategies(input, 168);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
