import { describe, expect, it } from 'vitest';
import { type PairwiseComparison, RESULT_WIN_SHARE_A, fitBradleyTerry } from '../bradleyTerry';

const REPLICATES = 60;

function repeat(comparison: PairwiseComparison, times: number): PairwiseComparison[] {
  return Array.from({ length: times }, () => ({ ...comparison }));
}

function thetaOf(result: ReturnType<typeof fitBradleyTerry>, itemId: string): number {
  const score = result.scores.find((s) => s.itemId === itemId);
  if (score === undefined) throw new Error(`missing ${itemId}`);
  return score.theta;
}

describe('RESULT_WIN_SHARE_A', () => {
  it('5段階の写像は仕様表どおり（和は常に1）', () => {
    expect(RESULT_WIN_SHARE_A.get(2)).toBe(1);
    expect(RESULT_WIN_SHARE_A.get(1)).toBe(0.75);
    expect(RESULT_WIN_SHARE_A.get(0)).toBe(0.5);
    expect(RESULT_WIN_SHARE_A.get(-1)).toBe(0.25);
    expect(RESULT_WIN_SHARE_A.get(-2)).toBe(0);
  });
});

describe('fitBradleyTerry', () => {
  it('#1 全て引き分けなら θ が等しい', () => {
    const result = fitBradleyTerry(repeat({ itemA: 'A', itemB: 'B', result: 0 }, 5), {
      seed: 1,
      bootstrapReplicates: REPLICATES,
    });
    expect(thetaOf(result, 'A')).toBeCloseTo(0, 9);
    expect(thetaOf(result, 'B')).toBeCloseTo(0, 9);
    expect(result.converged).toBe(true);
    expect(result.components).toBe(1);
    // 有効比較（result ≠ 0）が無いので破れの割合は 0
    expect(result.transitivityViolationRate).toBe(0);
  });

  it('#2 10連勝でも θ は有限で、勝った側が上', () => {
    const result = fitBradleyTerry(repeat({ itemA: 'A', itemB: 'B', result: 2 }, 10), {
      seed: 2,
      bootstrapReplicates: REPLICATES,
    });
    const a = thetaOf(result, 'A');
    const b = thetaOf(result, 'B');
    expect(a).toBeGreaterThan(b);
    expect(Number.isFinite(a)).toBe(true);
    expect(Number.isFinite(b)).toBe(true);
    // 正規化により成分内の θ の和は 0
    expect(a + b).toBeCloseTo(0, 9);
    expect(result.transitivityViolationRate).toBe(0);
  });

  it('平滑化 α を 0 にすると全勝側の θ が発散に向かう（α が効いていることの確認）', () => {
    const comparisons = repeat({ itemA: 'A', itemB: 'B', result: 2 }, 10);
    const smoothed = fitBradleyTerry(comparisons, { seed: 2, bootstrapReplicates: 2 });
    const raw = fitBradleyTerry(comparisons, { seed: 2, alpha: 0, bootstrapReplicates: 2 });
    expect(thetaOf(raw, 'A')).toBeGreaterThan(thetaOf(smoothed, 'A'));
    expect(raw.converged).toBe(false);
  });

  it('#3 A>B, B>C だけなら θ_A > θ_B > θ_C', () => {
    const comparisons = [
      ...repeat({ itemA: 'A', itemB: 'B', result: 2 }, 3),
      ...repeat({ itemA: 'B', itemB: 'C', result: 2 }, 3),
    ];
    const result = fitBradleyTerry(comparisons, { seed: 3, bootstrapReplicates: REPLICATES });
    expect(thetaOf(result, 'A')).toBeGreaterThan(thetaOf(result, 'B'));
    expect(thetaOf(result, 'B')).toBeGreaterThan(thetaOf(result, 'C'));
    expect(result.components).toBe(1);
    expect(result.transitivityViolationRate).toBe(0);
  });

  it('#4 スケール不変: 比較を丸ごと2倍に増やしても順序は変わらず、θ の和は0', () => {
    const comparisons = [
      ...repeat({ itemA: 'A', itemB: 'B', result: 2 }, 3),
      ...repeat({ itemA: 'B', itemB: 'C', result: 1 }, 4),
      ...repeat({ itemA: 'A', itemB: 'C', result: 2 }, 2),
    ];
    const single = fitBradleyTerry(comparisons, { seed: 4, bootstrapReplicates: 2 });
    const doubled = fitBradleyTerry([...comparisons, ...comparisons], { seed: 4, bootstrapReplicates: 2 });
    const order = (r: ReturnType<typeof fitBradleyTerry>) =>
      [...r.scores].sort((x, y) => y.theta - x.theta).map((s) => s.itemId);
    expect(order(single)).toEqual(['A', 'B', 'C']);
    expect(order(doubled)).toEqual(['A', 'B', 'C']);
    const sum = single.scores.reduce((acc, s) => acc + s.theta, 0);
    expect(sum).toBeCloseTo(0, 9);
  });

  it('入力順を入れ替えても結果は変わらない', () => {
    const comparisons = [
      { itemA: 'A', itemB: 'B', result: 2 as const },
      { itemA: 'B', itemB: 'C', result: 1 as const },
      { itemA: 'A', itemB: 'C', result: 2 as const },
    ];
    const forward = fitBradleyTerry(comparisons, { seed: 7, bootstrapReplicates: 2 });
    const reversed = fitBradleyTerry([...comparisons].reverse(), { seed: 7, bootstrapReplicates: 2 });
    for (const id of ['A', 'B', 'C']) {
      expect(thetaOf(forward, id)).toBeCloseTo(thetaOf(reversed, id), 9);
    }
  });

  it('A と B を入れ替えて符号を反転した比較は同じ推定になる', () => {
    const asA = fitBradleyTerry(repeat({ itemA: 'A', itemB: 'B', result: 1 }, 4), {
      seed: 8,
      bootstrapReplicates: 2,
    });
    const asB = fitBradleyTerry(repeat({ itemA: 'B', itemB: 'A', result: -1 }, 4), {
      seed: 8,
      bootstrapReplicates: 2,
    });
    expect(thetaOf(asA, 'A')).toBeCloseTo(thetaOf(asB, 'A'), 9);
    expect(thetaOf(asA, 'B')).toBeCloseTo(thetaOf(asB, 'B'), 9);
  });

  it('#5 5勝5敗なら θ は等しく、推移律の破れは約0.5', () => {
    const comparisons = [
      ...repeat({ itemA: 'A', itemB: 'B', result: 2 }, 5),
      ...repeat({ itemA: 'A', itemB: 'B', result: -2 }, 5),
    ];
    const result = fitBradleyTerry(comparisons, { seed: 5, bootstrapReplicates: REPLICATES });
    expect(thetaOf(result, 'A')).toBeCloseTo(thetaOf(result, 'B'), 6);
    expect(result.transitivityViolationRate).toBeCloseTo(0.5, 6);
  });

  it('推移律の破れは θ の順序と食い違う比較の割合', () => {
    // A が B に 3 勝 1 敗。θ_A > θ_B なので食い違うのは 1 件 / 4 件 = 0.25
    const comparisons = [
      ...repeat({ itemA: 'A', itemB: 'B', result: 2 }, 3),
      { itemA: 'A', itemB: 'B', result: -2 as const },
    ];
    const result = fitBradleyTerry(comparisons, { seed: 6, bootstrapReplicates: 2 });
    expect(result.transitivityViolationRate).toBeCloseTo(0.25, 9);
  });

  it('引き分けは有効比較に数えない', () => {
    const comparisons = [
      ...repeat({ itemA: 'A', itemB: 'B', result: 2 }, 3),
      { itemA: 'A', itemB: 'B', result: -2 as const },
      ...repeat({ itemA: 'A', itemB: 'B', result: 0 }, 10),
    ];
    const result = fitBradleyTerry(comparisons, { seed: 6, bootstrapReplicates: 2 });
    expect(result.transitivityViolationRate).toBeCloseTo(0.25, 9);
  });

  it('#6 群間の比較が無ければ連結成分は2つになり、成分IDが分かれる', () => {
    const comparisons = [
      ...repeat({ itemA: 'A', itemB: 'B', result: 2 }, 3),
      ...repeat({ itemA: 'C', itemB: 'D', result: 2 }, 3),
    ];
    const result = fitBradleyTerry(comparisons, { seed: 10, bootstrapReplicates: 2 });
    expect(result.components).toBe(2);
    const componentOf = new Map(result.scores.map((s) => [s.itemId, s.componentId]));
    expect(componentOf.get('A')).toBe(componentOf.get('B'));
    expect(componentOf.get('C')).toBe(componentOf.get('D'));
    expect(componentOf.get('A')).not.toBe(componentOf.get('C'));
    // 成分ごとに正規化するので、両群の勝者の θ は同じ値になる（成分間比較は不能）
    expect(thetaOf(result, 'A')).toBeCloseTo(thetaOf(result, 'C'), 9);
  });

  it('群をつなぐ比較を1件足すと連結成分は1つになる', () => {
    const comparisons = [
      ...repeat({ itemA: 'A', itemB: 'B', result: 2 }, 3),
      ...repeat({ itemA: 'C', itemB: 'D', result: 2 }, 3),
      { itemA: 'B', itemB: 'C', result: 0 as const },
    ];
    const result = fitBradleyTerry(comparisons, { seed: 10, bootstrapReplicates: 2 });
    expect(result.components).toBe(1);
  });

  it('#7 比較0件なら scores は空で converged', () => {
    const result = fitBradleyTerry([]);
    expect(result.scores).toEqual([]);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(0);
    expect(result.components).toBe(0);
    expect(result.transitivityViolationRate).toBe(0);
  });

  it('比較1件では信頼区間を出せないので CI は NaN', () => {
    const result = fitBradleyTerry([{ itemA: 'A', itemB: 'B', result: 2 }], { seed: 11 });
    expect(result.scores).toHaveLength(2);
    for (const score of result.scores) {
      expect(score.ciLow).toBeNaN();
      expect(score.ciHigh).toBeNaN();
      expect(score.nComparisons).toBe(1);
    }
  });

  it('信頼区間は有限で ciLow <= ciHigh、比較数も数えている', () => {
    const comparisons = [
      ...repeat({ itemA: 'A', itemB: 'B', result: 2 }, 4),
      ...repeat({ itemA: 'B', itemB: 'C', result: 1 }, 4),
      ...repeat({ itemA: 'A', itemB: 'C', result: 2 }, 4),
    ];
    const result = fitBradleyTerry(comparisons, { seed: 12, bootstrapReplicates: REPLICATES });
    for (const score of result.scores) {
      expect(Number.isFinite(score.ciLow)).toBe(true);
      expect(Number.isFinite(score.ciHigh)).toBe(true);
      expect(score.ciLow).toBeLessThanOrEqual(score.ciHigh);
      expect(score.nComparisons).toBe(8);
    }
  });

  it('同じ入力・同じシードなら結果が完全に一致する', () => {
    const comparisons = [
      ...repeat({ itemA: 'A', itemB: 'B', result: 2 }, 4),
      ...repeat({ itemA: 'B', itemB: 'C', result: -1 }, 3),
      ...repeat({ itemA: 'A', itemB: 'C', result: 0 }, 2),
    ];
    const a = fitBradleyTerry(comparisons, { seed: 99, bootstrapReplicates: REPLICATES });
    const b = fitBradleyTerry(comparisons, { seed: 99, bootstrapReplicates: REPLICATES });
    expect(a).toEqual(b);
  });

  it('多数のアイテムでも収束し、強さの順序を復元する', () => {
    // A > B > C > D の総当たり
    const ids = ['A', 'B', 'C', 'D'];
    const comparisons: PairwiseComparison[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        comparisons.push(...repeat({ itemA: ids[i], itemB: ids[j], result: 1 }, 3));
      }
    }
    const result = fitBradleyTerry(comparisons, { seed: 13, bootstrapReplicates: 2 });
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(200);
    const ordered = [...result.scores].sort((x, y) => y.theta - x.theta).map((s) => s.itemId);
    expect(ordered).toEqual(ids);
  });

  it('不正な入力は例外', () => {
    expect(() => fitBradleyTerry([{ itemA: 'A', itemB: 'B', result: 3 as unknown as 2 }], { seed: 1 })).toThrow();
    expect(() => fitBradleyTerry([{ itemA: 'A', itemB: 'A', result: 1 }], { seed: 1 })).toThrow();
    expect(() => fitBradleyTerry([{ itemA: '', itemB: 'B', result: 1 }], { seed: 1 })).toThrow();
    expect(() => fitBradleyTerry([{ itemA: 'A', itemB: 'B', result: 1 }], { seed: NaN })).toThrow();
    expect(() => fitBradleyTerry([{ itemA: 'A', itemB: 'B', result: 1 }])).toThrow();
    expect(() => fitBradleyTerry([{ itemA: 'A', itemB: 'B', result: 1 }], { seed: 1, alpha: NaN })).toThrow();
    expect(() => fitBradleyTerry([{ itemA: 'A', itemB: 'B', result: 1 }], { seed: 1, alpha: -1 })).toThrow();
    expect(() => fitBradleyTerry([{ itemA: 'A', itemB: 'B', result: 1 }], { seed: 1, maxIter: 0 })).toThrow();
    expect(() =>
      fitBradleyTerry([{ itemA: 'A', itemB: 'B', result: 1 }], { seed: 1, bootstrapReplicates: 1.5 }),
    ).toThrow();
    expect(() => fitBradleyTerry([{ itemA: 'A', itemB: 'B', result: Infinity as unknown as 2 }], { seed: 1 })).toThrow();
  });
});
