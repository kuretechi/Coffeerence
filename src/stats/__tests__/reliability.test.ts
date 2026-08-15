import { describe, expect, it } from 'vitest';
import { estimateSigma, type DuplicatePair } from '../reliability';

/** 差 d のリストからペアを作る補助（scoreA - scoreB = d になる）。 */
function pairsFromDiffs(diffs: number[]): DuplicatePair[] {
  return diffs.map((d) => ({ scoreA: 3 + d, scoreB: 3 }));
}

describe('estimateSigma', () => {
  it('仕様書の検証ケース d = [1,-1,1,-1] を厳密値で再現する', () => {
    const result = estimateSigma(pairsFromDiffs([1, -1, 1, -1]));
    // σ̂_obs = √(Σd² / 2n) = √(4/8) = √0.5
    expect(result.sigmaRaw).toBeCloseTo(Math.SQRT1_2, 12);
    // σ̂_final = (4√0.5 + 3×1.0) / 7 = 0.83263245...
    expect(result.sigma).toBeCloseTo((4 * Math.SQRT1_2 + 3) / 7, 12);
    expect(result.sigma).toBeCloseTo(0.83263245, 7);
    expect(result.nPairs).toBe(4);
    expect(result.shrinkageApplied).toBe(true);
    // 0.8326 は 5 × 0.15 = 0.75 より大きく 5 × 0.30 = 1.5 以下
    expect(result.interpretation).toBe('caution');
  });

  it('sd(d)/√2 ではなく Σd²/(2n) を使う（平均を引かない）', () => {
    // d = [2, 2] は標本分散ゼロだが測定誤差はゼロではない
    const result = estimateSigma(pairsFromDiffs([2, 2]), { k: 0 });
    expect(result.sigmaRaw).toBeCloseTo(Math.sqrt(8 / 4), 12);
    expect(result.sigma).toBeCloseTo(Math.SQRT2, 12);
  });

  it('空配列では σ = σ0、nPairs = 0、unreliable', () => {
    const result = estimateSigma([]);
    expect(result.sigma).toBe(1.0);
    expect(result.nPairs).toBe(0);
    expect(result.interpretation).toBe('unreliable');

    const custom = estimateSigma([], { sigma0: 0.4 });
    expect(custom.sigma).toBe(0.4);
    expect(custom.interpretation).toBe('unreliable');
  });

  it('1件のペアでも縮小して推定できる', () => {
    const result = estimateSigma(pairsFromDiffs([1]));
    // σ̂_obs = √(1/2), σ̂_final = (√0.5 + 3) / 4
    expect(result.sigmaRaw).toBeCloseTo(Math.SQRT1_2, 12);
    expect(result.sigma).toBeCloseTo((Math.SQRT1_2 + 3) / 4, 12);
    expect(result.nPairs).toBe(1);
  });

  it('すべての差がゼロなら sigmaRaw = 0 だが縮小後は正になる', () => {
    const result = estimateSigma(pairsFromDiffs([0, 0, 0]));
    expect(result.sigmaRaw).toBe(0);
    expect(result.sigma).toBeCloseTo(3 / 6, 12);
    expect(result.sigma).toBeGreaterThan(0);
    expect(result.interpretation).toBe('reliable');
  });

  it('k を大きくすると σ0 に近づき、k = 0 なら縮小しない', () => {
    const diffs = [1, -1, 1, -1];
    const strong = estimateSigma(pairsFromDiffs(diffs), { k: 1000, sigma0: 2 });
    expect(strong.sigma).toBeCloseTo(2, 1);
    const none = estimateSigma(pairsFromDiffs(diffs), { k: 0 });
    expect(none.sigma).toBe(none.sigmaRaw);
    expect(none.shrinkageApplied).toBe(false);
  });

  it('interpretation は scaleMax に対する相対値で決まる', () => {
    // σ̂_obs = 0, k = 0 で σ を直接作る
    const zero = estimateSigma(pairsFromDiffs([0]), { k: 0 });
    expect(zero.interpretation).toBe('reliable');
    // σ = 1.0（境界 5×0.15=0.75 超、5×0.30=1.5 以下）
    const mid = estimateSigma(pairsFromDiffs([Math.SQRT2]), { k: 0 });
    expect(mid.sigma).toBeCloseTo(1, 12);
    expect(mid.interpretation).toBe('caution');
    // 同じ σ = 1.0 でも 10 点満点なら reliable
    expect(estimateSigma(pairsFromDiffs([Math.SQRT2]), { k: 0, scaleMax: 10 }).interpretation).toBe('reliable');
    // 大きなブレは unreliable
    const big = estimateSigma(pairsFromDiffs([4, -4]), { k: 0 });
    expect(big.sigma).toBeCloseTo(2.828427124746, 9);
    expect(big.interpretation).toBe('unreliable');
    // 境界ちょうど（σ = 0.75）は reliable 側
    const boundary = estimateSigma(pairsFromDiffs([0.75 * Math.SQRT2]), { k: 0 });
    expect(boundary.sigma).toBeCloseTo(0.75, 12);
    expect(boundary.interpretation).toBe('reliable');
  });

  it('極端な値でも有限の推定値を返す', () => {
    const result = estimateSigma(pairsFromDiffs([1e6, -1e6]), { k: 0 });
    expect(Number.isFinite(result.sigma)).toBe(true);
    // Σd² = 2e12, n = 2 → σ = √(5e11)
    expect(result.sigma).toBeCloseTo(Math.sqrt(5e11), 3);
    const tiny = estimateSigma(pairsFromDiffs([1e-9]), { k: 0 });
    expect(tiny.sigma).toBeGreaterThan(0);
    expect(tiny.sigma).toBeLessThan(1e-8);
  });

  it('NaN / Infinity / 不正なオプションは例外', () => {
    expect(() => estimateSigma([{ scoreA: NaN, scoreB: 1 }])).toThrow();
    expect(() => estimateSigma([{ scoreA: 1, scoreB: Infinity }])).toThrow();
    expect(() => estimateSigma(pairsFromDiffs([1]), { k: NaN })).toThrow();
    expect(() => estimateSigma(pairsFromDiffs([1]), { sigma0: Infinity })).toThrow();
    expect(() => estimateSigma(pairsFromDiffs([1]), { k: -1 })).toThrow();
    expect(() => estimateSigma(pairsFromDiffs([1]), { scaleMax: 0 })).toThrow();
  });

  it('同じ入力なら同じ結果（決定論性）', () => {
    const pairs = pairsFromDiffs([0.5, -1.5, 2, 0]);
    expect(estimateSigma(pairs)).toEqual(estimateSigma(pairs));
  });

  it('ペア数が増えると観測値に近づく（縮小の単調性）', () => {
    const one = estimateSigma(pairsFromDiffs([1]));
    const many = estimateSigma(pairsFromDiffs(Array.from({ length: 50 }, () => 1)));
    expect(Math.abs(many.sigma - many.sigmaRaw)).toBeLessThan(Math.abs(one.sigma - one.sigmaRaw));
  });
});
