import { describe, expect, it } from 'vitest';
import { createRNG } from '../rng';
import { normalCdf, normalInvCdf } from '../normal';
import { binomialPmf, binomialUpperTail, logChoose } from '../binomial';
import { bootstrap } from '../bootstrap';

describe('createRNG', () => {
  it('同じシードなら同じ列を返す', () => {
    const a = createRNG(42);
    const b = createRNG(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('別のシードなら別の列を返す', () => {
    const a = createRNG(1);
    const b = createRNG(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('next は [0,1)、nextInt は [0,n) に収まる', () => {
    const rng = createRNG(7);
    for (let i = 0; i < 500; i += 1) {
      const u = rng.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      const k = rng.nextInt(5);
      expect(Number.isInteger(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(5);
    }
  });

  it('不正な入力は例外', () => {
    expect(() => createRNG(NaN)).toThrow();
    expect(() => createRNG(1).nextInt(0)).toThrow();
    expect(() => createRNG(1).nextInt(2.5)).toThrow();
  });
});

describe('normalCdf / normalInvCdf', () => {
  // 標準正規分布表の値（絶対誤差 1e-7 以内で一致すること）
  it.each([
    [0, 0.5],
    [1.96, 0.9750021048517795],
    [2.1, 0.9821355794371722],
    [-1.96, 0.02499789514822043],
    [3, 0.9986501019683699],
  ])('normalCdf(%s)', (z, expected) => {
    expect(normalCdf(z)).toBeCloseTo(expected, 9);
  });

  it.each([
    [0.975, 1.959963984540054],
    [0.8, 0.8416212335729143],
    [0.5, 0],
    [0.025, -1.959963984540054],
  ])('normalInvCdf(%s)', (p, expected) => {
    expect(normalInvCdf(p)).toBeCloseTo(expected, 7);
  });

  it('CDF と 逆CDF は互いに逆関数', () => {
    for (const p of [0.001, 0.05, 0.3, 0.62, 0.94, 0.999]) {
      expect(normalCdf(normalInvCdf(p))).toBeCloseTo(p, 10);
    }
  });

  it('範囲外・非有限は例外', () => {
    expect(() => normalInvCdf(0)).toThrow();
    expect(() => normalInvCdf(1)).toThrow();
    expect(() => normalInvCdf(NaN)).toThrow();
    expect(() => normalCdf(Infinity)).toThrow();
  });
});

describe('binomial', () => {
  it('logChoose は厳密値と一致する', () => {
    expect(Math.exp(logChoose(6, 5))).toBeCloseTo(6, 9);
    expect(Math.exp(logChoose(10, 5))).toBeCloseTo(252, 8);
    // 素朴な階乗では溢れる大きさでも計算できる
    const exact100c50 = 1.0089134454556417e29;
    expect(Math.abs(Math.exp(logChoose(100, 50)) / exact100c50 - 1)).toBeLessThan(1e-9);
  });

  it('pmf の総和は1', () => {
    const total = Array.from({ length: 9 }, (_, k) => binomialPmf(8, k, 1 / 3)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 12);
  });

  // 手計算した厳密値（3択の三点識別）
  it.each([
    [3, 3, 1 / 27],
    [6, 5, 13 / 729],
    [6, 6, 1 / 729],
    [8, 8, (1 / 3) ** 8],
  ])('binomialUpperTail(%i, %i, 1/3)', (n, k, expected) => {
    expect(binomialUpperTail(n, k, 1 / 3)).toBeCloseTo(expected, 12);
  });

  it('k<=0 は1、k>n は0', () => {
    expect(binomialUpperTail(5, 0, 1 / 3)).toBe(1);
    expect(binomialUpperTail(5, 6, 1 / 3)).toBe(0);
  });
});

describe('bootstrap', () => {
  const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('同じシードなら同じ区間を返す', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = bootstrap(data, meanOf, { seed: 1, replicates: 500 });
    const b = bootstrap(data, meanOf, { seed: 1, replicates: 500 });
    expect(a).toEqual(b);
  });

  it('区間は推定値を挟む', () => {
    const data = [4, 5, 6, 5, 4, 6, 5, 5, 7, 3];
    const result = bootstrap(data, meanOf, { seed: 3 });
    expect(result.estimate).toBeCloseTo(5, 10);
    expect(result.ciLow).toBeLessThanOrEqual(result.estimate);
    expect(result.ciHigh).toBeGreaterThanOrEqual(result.estimate);
  });

  it('全て同一値なら区間幅0', () => {
    const result = bootstrap([2, 2, 2, 2], meanOf, { seed: 5 });
    expect(result.ciLow).toBeCloseTo(2, 12);
    expect(result.ciHigh).toBeCloseTo(2, 12);
  });

  it('要素が2件未満なら区間は NaN', () => {
    expect(bootstrap([1], meanOf, { seed: 1 }).ciLow).toBeNaN();
    expect(bootstrap([], meanOf, { seed: 1 }).estimate).toBeNaN();
  });

  it('不正な引数は例外', () => {
    expect(() => bootstrap([1, 2], meanOf, { seed: NaN })).toThrow();
    expect(() => bootstrap([1, 2], meanOf, { seed: 1, replicates: 0 })).toThrow();
    expect(() => bootstrap([1, 2], meanOf, { seed: 1, alpha: 1 })).toThrow();
  });
});
