import { describe, expect, it } from 'vitest';
import { estimateThreshold, initStaircase, updateStaircase, type StaircaseState } from '../staircase';

const LEVELS = [0.1, 0.2, 0.3, 0.4, 0.5];

/** 正誤の列を順に適用する。 */
function run(state: StaircaseState, results: boolean[]): StaircaseState {
  return results.reduce((s, correct) => updateStaircase(s, correct), state);
}

describe('initStaircase', () => {
  it('既定では最易（最大の差）から始まる', () => {
    const s = initStaircase(LEVELS);
    expect(s.currentIndex).toBe(4);
    expect(s.consecutiveCorrect).toBe(0);
    expect(s.lastDirection).toBeNull();
    expect(s.reversals).toEqual([]);
    expect(s.history).toEqual([]);
  });

  it('startIndex を指定できる', () => {
    expect(initStaircase(LEVELS, 2).currentIndex).toBe(2);
  });

  it('不正な入力は例外', () => {
    expect(() => initStaircase([])).toThrow();
    expect(() => initStaircase([0.1, NaN])).toThrow();
    expect(() => initStaircase([0.1, Infinity])).toThrow();
    expect(() => initStaircase([0.3, 0.2, 0.1])).toThrow();
    expect(() => initStaircase([0.1, 0.1])).toThrow();
    expect(() => initStaircase(LEVELS, 5)).toThrow();
    expect(() => initStaircase(LEVELS, -1)).toThrow();
    expect(() => initStaircase(LEVELS, 1.5)).toThrow();
  });

  it('要素1件でも初期化できる', () => {
    const s = initStaircase([0.4]);
    expect(s.currentIndex).toBe(0);
  });
});

describe('updateStaircase', () => {
  it('検証1: 3回連続正解で1段難しくなり、連続正解カウントがリセットされる', () => {
    const start = initStaircase(LEVELS, 4);
    const afterTwo = run(start, [true, true]);
    expect(afterTwo.currentIndex).toBe(4);
    expect(afterTwo.consecutiveCorrect).toBe(2);
    const afterThree = updateStaircase(afterTwo, true);
    expect(afterThree.currentIndex).toBe(3);
    expect(afterThree.consecutiveCorrect).toBe(0);
    expect(afterThree.lastDirection).toBe('up');
    expect(afterThree.reversals).toEqual([]);
  });

  it('検証2: 2回正解して1回不正解なら易しい方へ移動する', () => {
    const s = run(initStaircase(LEVELS, 2), [true, true, false]);
    expect(s.currentIndex).toBe(3);
    expect(s.consecutiveCorrect).toBe(0);
    expect(s.lastDirection).toBe('down');
  });

  it('検証3: 方向が反転した地点が reversal として記録される', () => {
    // idx4 → (3正解) idx3 → (不正解) idx4 → (3正解) idx3
    const s = run(initStaircase(LEVELS, 4), [true, true, true, false, true, true, true]);
    expect(s.reversals).toEqual([0.4, 0.5]);
    expect(s.currentIndex).toBe(3);
    expect(s.history).toHaveLength(7);
  });

  it('正解・不正解が交互だと3連続正解にならず易しい方へ下がり続ける', () => {
    const s = run(initStaircase(LEVELS, 0), [true, false, true, false, true, false]);
    expect(s.currentIndex).toBe(3);
    expect(s.reversals).toEqual([]);
    expect(s.lastDirection).toBe('down');
  });

  it('検証5: 最難レベルで正解を続けても index が範囲外に出ない', () => {
    const s = run(initStaircase(LEVELS, 0), Array.from({ length: 20 }, () => true));
    expect(s.currentIndex).toBe(0);
    expect(s.history).toHaveLength(20);
    expect(s.history.every((h) => h.index === 0)).toBe(true);
  });

  it('最易レベルで不正解を続けても index が範囲外に出ない', () => {
    const s = run(initStaircase(LEVELS, 4), Array.from({ length: 10 }, () => false));
    expect(s.currentIndex).toBe(4);
    expect(s.reversals).toEqual([]);
  });

  it('要素1件なら常に同じ index に留まる', () => {
    const s = run(initStaircase([0.4]), [true, true, true, false, true]);
    expect(s.currentIndex).toBe(0);
    expect(s.reversals).toEqual([]);
  });

  it('イミュータブル: 元の状態を変更しない', () => {
    const start = initStaircase(LEVELS, 4);
    const snapshot = JSON.stringify(start);
    updateStaircase(start, true);
    updateStaircase(start, false);
    expect(JSON.stringify(start)).toBe(snapshot);
  });

  it('同じ正誤列なら同じ状態になる（決定論性）', () => {
    const seq = [true, true, true, false, true, true, true, false];
    expect(run(initStaircase(LEVELS, 4), seq)).toEqual(run(initStaircase(LEVELS, 4), seq));
  });

  it('boolean 以外は例外', () => {
    const s = initStaircase(LEVELS);
    // @ts-expect-error 実行時の防御を検証する
    expect(() => updateStaircase(s, 1)).toThrow();
    // @ts-expect-error 実行時の防御を検証する
    expect(() => updateStaircase(s, undefined)).toThrow();
  });
});

describe('estimateThreshold', () => {
  it('検証4: reversal が2回のみで discardFirst=2 なら判定不能', () => {
    // idx4 → (3正解) idx3 → (不正解, reversal 0.4) idx4 → (3正解, reversal 0.5) idx3
    const s = run(initStaircase(LEVELS, 4), [true, true, true, false, true, true, true]);
    expect(s.reversals).toHaveLength(2);
    const r = estimateThreshold(s, { discardFirst: 2 });
    expect(r.threshold).toBeNull();
    expect(r.converged).toBe(false);
    expect(r.reversalCount).toBe(2);
    expect(r.trialsUsed).toBe(7);
  });

  it('試行なしなら判定不能', () => {
    const r = estimateThreshold(initStaircase(LEVELS));
    expect(r.threshold).toBeNull();
    expect(r.converged).toBe(false);
    expect(r.reversalCount).toBe(0);
    expect(r.trialsUsed).toBe(0);
  });

  it('最初の2回を捨てた reversal の平均が閾値になる', () => {
    // reversals = [0.4, 0.5, 0.4, 0.5]、捨てた後は [0.4, 0.5] → 平均 0.45
    const seq = [true, true, true, false, true, true, true, false, true, true, true];
    const s = run(initStaircase(LEVELS, 4), seq);
    expect(s.reversals).toEqual([0.4, 0.5, 0.4, 0.5]);
    const r = estimateThreshold(s, { minReversals: 4 });
    expect(r.threshold).not.toBeNull();
    expect(r.threshold as number).toBeCloseTo(0.45, 12);
    expect(r.converged).toBe(true);
    expect(r.reversalCount).toBe(4);
    expect(r.trialsUsed).toBe(11);
  });

  it('reversal が minReversals に届かなければ converged=false（閾値は返せる）', () => {
    const seq = [true, true, true, false, true, true, true, false, true, true, true];
    const s = run(initStaircase(LEVELS, 4), seq);
    const r = estimateThreshold(s, { minReversals: 8 });
    expect(r.converged).toBe(false);
    expect(r.threshold as number).toBeCloseTo(0.45, 12);
  });

  it('すべての reversal が同値なら閾値もその値', () => {
    const s: StaircaseState = { ...initStaircase(LEVELS, 4), reversals: [0.3, 0.3, 0.3, 0.3, 0.3] };
    expect(estimateThreshold(s, { minReversals: 4 }).threshold).toBeCloseTo(0.3, 12);
  });

  it('discardFirst=0 なら全 reversal を使う', () => {
    const s: StaircaseState = { ...initStaircase(LEVELS, 4), reversals: [0.2, 0.4] };
    expect(estimateThreshold(s, { discardFirst: 0, minReversals: 2 }).threshold).toBeCloseTo(0.3, 12);
  });

  it('不正なオプションは例外', () => {
    const s = initStaircase(LEVELS);
    expect(() => estimateThreshold(s, { minReversals: NaN })).toThrow();
    expect(() => estimateThreshold(s, { minReversals: 0 })).toThrow();
    expect(() => estimateThreshold(s, { minReversals: 1.5 })).toThrow();
    expect(() => estimateThreshold(s, { discardFirst: -1 })).toThrow();
    expect(() => estimateThreshold(s, { discardFirst: Infinity })).toThrow();
  });

  it('同じ状態なら同じ結果（決定論性）', () => {
    const seq = [true, true, true, false, true, true, true, false, true, true, true];
    const s = run(initStaircase(LEVELS, 4), seq);
    expect(estimateThreshold(s)).toEqual(estimateThreshold(s));
  });
});
