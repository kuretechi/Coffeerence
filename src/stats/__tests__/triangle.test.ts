import { describe, expect, it } from 'vitest';
import { normalInvCdf } from '../normal';
import { evaluateTriangleTests } from '../triangle';

describe('evaluateTriangleTests', () => {
  // 仕様書の厳密値（3択なので帰無仮説は p = 1/3）
  it.each([
    [3, 3, 1 / 27],
    [6, 5, 13 / 729],
    [6, 6, 1 / 729],
    [8, 8, 1 / 6561],
    // 1 - (2/3)^6 - 6(1/3)(2/3)^5 = 1 - 64/729 - 192/729 = 473/729
    [6, 2, 473 / 729],
    [1, 1, 1 / 3],
    [4, 0, 1],
  ])('p値: n=%i, k=%i', (trials, correct, expected) => {
    expect(evaluateTriangleTests(trials, correct).pValue).toBeCloseTo(expected, 12);
  });

  it('n=6, k=5 の nSigma は Φ⁻¹(1 − 13/729) ≈ 2.10', () => {
    const result = evaluateTriangleTests(6, 5);
    expect(result.nSigma).toBeCloseTo(normalInvCdf(1 - 13 / 729), 9);
    expect(result.nSigma).toBeCloseTo(2.1007, 3);
    expect(result.verdict).toBe('discriminable');
    expect(result.trialsNeededForSignificance).toBeUndefined();
  });

  it('3回中3回正解（p = 1/27）は閾値 2σ に届かない', () => {
    const result = evaluateTriangleTests(3, 3);
    expect(result.nSigma).toBeCloseTo(normalInvCdf(1 - 1 / 27), 9);
    expect(result.nSigma).toBeLessThan(2);
    expect(result.verdict).toBe('inconclusive');
    // 全問正解のペースなら追加試行で有意になるはず
    expect(result.trialsNeededForSignificance).toBeGreaterThan(3);
    expect(result.trialsNeededForSignificance).toBeLessThanOrEqual(100);
  });

  it('期待値ちょうど（6回中2回）は有意でなく、伸びしろも示せない', () => {
    const result = evaluateTriangleTests(6, 2);
    expect(result.pValue).toBeLessThan(1);
    expect(result.pValue).toBeGreaterThan(0.5);
    expect(result.verdict).toBe('inconclusive');
    expect(result.trialsNeededForSignificance).toBeUndefined();
  });

  it('chanceLevel は 1 / cupsPerTrial', () => {
    expect(evaluateTriangleTests(5, 3).chanceLevel).toBeCloseTo(1 / 3, 12);
    expect(evaluateTriangleTests(5, 3, { cupsPerTrial: 2 }).chanceLevel).toBe(0.5);
    // 2択なら 5回中5回正解の p値 = (1/2)^5 = 1/32
    expect(evaluateTriangleTests(5, 5, { cupsPerTrial: 2 }).pValue).toBeCloseTo(1 / 32, 12);
    // 4択なら 3回中3回正解の p値 = (1/4)^3 = 1/64
    expect(evaluateTriangleTests(3, 3, { cupsPerTrial: 4 }).pValue).toBeCloseTo(1 / 64, 12);
  });

  it('p値は k に対して単調非増加、nSigma は単調非減少', () => {
    let prevP = Number.POSITIVE_INFINITY;
    let prevSigma = Number.NEGATIVE_INFINITY;
    for (let k = 0; k <= 10; k += 1) {
      const { pValue, nSigma } = evaluateTriangleTests(10, k);
      expect(pValue).toBeLessThanOrEqual(prevP);
      expect(nSigma).toBeGreaterThanOrEqual(prevSigma);
      prevP = pValue;
      prevSigma = nSigma;
    }
  });

  it('sigmaThreshold を変えると判定が変わる', () => {
    expect(evaluateTriangleTests(3, 3, { sigmaThreshold: 1.5 }).verdict).toBe('discriminable');
    expect(evaluateTriangleTests(6, 5, { sigmaThreshold: 3 }).verdict).toBe('inconclusive');
  });

  it('試行ゼロ・正解ゼロなどの端は判定不能として扱う', () => {
    const none = evaluateTriangleTests(0, 0);
    expect(none.pValue).toBe(1);
    expect(none.verdict).toBe('inconclusive');
    expect(none.trialsNeededForSignificance).toBeUndefined();
    expect(Number.isFinite(none.nSigma)).toBe(true);

    const zero = evaluateTriangleTests(10, 0);
    expect(zero.pValue).toBe(1);
    expect(zero.verdict).toBe('inconclusive');
    expect(zero.trialsNeededForSignificance).toBeUndefined();
  });

  it('大きな n でも有限値を返す', () => {
    const result = evaluateTriangleTests(100, 100);
    expect(result.pValue).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(1e-40);
    expect(Number.isFinite(result.nSigma)).toBe(true);
    expect(result.verdict).toBe('discriminable');
  });

  it('不正な入力は例外', () => {
    expect(() => evaluateTriangleTests(NaN, 1)).toThrow();
    expect(() => evaluateTriangleTests(3, Infinity)).toThrow();
    expect(() => evaluateTriangleTests(2.5, 1)).toThrow();
    expect(() => evaluateTriangleTests(3, 1.5)).toThrow();
    expect(() => evaluateTriangleTests(-1, 0)).toThrow();
    expect(() => evaluateTriangleTests(3, 4)).toThrow();
    expect(() => evaluateTriangleTests(3, -1)).toThrow();
    expect(() => evaluateTriangleTests(3, 2, { cupsPerTrial: 1 })).toThrow();
    expect(() => evaluateTriangleTests(3, 2, { cupsPerTrial: 2.5 })).toThrow();
    expect(() => evaluateTriangleTests(3, 2, { sigmaThreshold: NaN })).toThrow();
  });

  it('同じ入力なら同じ結果（決定論性）', () => {
    expect(evaluateTriangleTests(9, 6)).toEqual(evaluateTriangleTests(9, 6));
    expect(evaluateTriangleTests(3, 3)).toEqual(evaluateTriangleTests(3, 3));
  });
});
