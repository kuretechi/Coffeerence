import { describe, expect, it } from 'vitest';
import { requiredSampleSize } from '../power';
import { normalInvCdf } from '../normal';

describe('requiredSampleSize', () => {
  it('仕様書の厳密値: σ=0.7, δ=0.5 で 31', () => {
    // 手計算: (1.959964 + 0.841621)² = 7.848878、2 × 7.848878 × 0.49 / 0.25 = 30.767… → 31
    const r = requiredSampleSize(0.7, 0.5);
    expect(r.requiredN).toBe(31);
    expect(r.totalRequired).toBe(62);
    expect(r.currentN).toBe(0);
    expect(r.additionalNeeded).toBe(31);
    expect(r.assumptions).toEqual({ sigma: 0.7, mde: 0.5, alpha: 0.05, power: 0.8 });
  });

  it('仕様書の厳密値: σ=1.6, δ=0.5 で 161', () => {
    // 2 × 7.848878 × 2.56 / 0.25 = 160.75… → 161
    expect(requiredSampleSize(1.6, 0.5).requiredN).toBe(161);
  });

  it('切り上げ前の理論値と一致する（許容誤差 1e-6）', () => {
    const z = normalInvCdf(0.975) + normalInvCdf(0.8);
    const exact = (2 * z * z * 0.49) / 0.25;
    expect(exact).toBeCloseTo(30.7676, 4);
    expect(requiredSampleSize(0.7, 0.5).requiredN).toBe(Math.ceil(exact));
    expect(Math.abs(requiredSampleSize(0.7, 0.5).requiredN - Math.ceil(exact))).toBeLessThan(1e-6);
  });

  it('実効σ（σ/√k）を渡すと必要数が下がる', () => {
    const single = requiredSampleSize(1.4, 0.5).requiredN;
    const averagedOfFour = requiredSampleSize(1.4 / Math.sqrt(4), 0.5).requiredN;
    // σ が半分になれば必要数は約4分の1
    expect(averagedOfFour).toBeLessThan(single);
    expect(Math.abs(averagedOfFour - single / 4)).toBeLessThanOrEqual(1);
  });

  it('σ について単調増加・δ について単調減少', () => {
    expect(requiredSampleSize(1.0, 0.5).requiredN).toBeGreaterThan(requiredSampleSize(0.7, 0.5).requiredN);
    expect(requiredSampleSize(0.7, 0.3).requiredN).toBeGreaterThan(requiredSampleSize(0.7, 0.5).requiredN);
  });

  it('検出力を上げると必要数が増え、α を緩めると減る', () => {
    const base = requiredSampleSize(0.7, 0.5).requiredN;
    expect(requiredSampleSize(0.7, 0.5, { power: 0.9 }).requiredN).toBeGreaterThan(base);
    expect(requiredSampleSize(0.7, 0.5, { alpha: 0.1 }).requiredN).toBeLessThan(base);
  });

  it('currentN が足りていれば additionalNeeded は 0', () => {
    const r = requiredSampleSize(0.7, 0.5, { currentN: 40 });
    expect(r.requiredN).toBe(31);
    expect(r.additionalNeeded).toBe(0);
    expect(requiredSampleSize(0.7, 0.5, { currentN: 10 }).additionalNeeded).toBe(21);
  });

  it('極端な入力でも有限の整数を返す', () => {
    expect(requiredSampleSize(1e-6, 10).requiredN).toBe(1);
    const huge = requiredSampleSize(1e3, 1e-3).requiredN;
    expect(Number.isFinite(huge)).toBe(true);
    expect(Number.isInteger(huge)).toBe(true);
  });

  it('不正な入力は例外', () => {
    expect(() => requiredSampleSize(NaN, 0.5)).toThrow();
    expect(() => requiredSampleSize(Infinity, 0.5)).toThrow();
    expect(() => requiredSampleSize(0.7, NaN)).toThrow();
    expect(() => requiredSampleSize(0.7, Infinity)).toThrow();
    expect(() => requiredSampleSize(0, 0.5)).toThrow();
    expect(() => requiredSampleSize(-1, 0.5)).toThrow();
    expect(() => requiredSampleSize(0.7, 0)).toThrow();
    expect(() => requiredSampleSize(0.7, -0.5)).toThrow();
    expect(() => requiredSampleSize(0.7, 0.5, { alpha: 0 })).toThrow();
    expect(() => requiredSampleSize(0.7, 0.5, { alpha: 1 })).toThrow();
    expect(() => requiredSampleSize(0.7, 0.5, { power: 0 })).toThrow();
    expect(() => requiredSampleSize(0.7, 0.5, { power: 1 })).toThrow();
    expect(() => requiredSampleSize(0.7, 0.5, { power: NaN })).toThrow();
    expect(() => requiredSampleSize(0.7, 0.5, { currentN: -1 })).toThrow();
    expect(() => requiredSampleSize(0.7, 0.5, { currentN: 1.5 })).toThrow();
  });

  it('同じ入力なら同じ結果（決定論性）', () => {
    expect(requiredSampleSize(0.9, 0.4, { currentN: 5 })).toEqual(requiredSampleSize(0.9, 0.4, { currentN: 5 }));
  });
});
