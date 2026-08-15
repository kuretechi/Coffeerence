import { describe, expect, it } from 'vitest';
import type { BrewRecord, Recipe, TasteRating, TriangleTrial } from '../../domain/types';
import {
  comparableLevelPairs,
  comparisonsFromData,
  diffToResult,
  duplicatePairsFromBrews,
  factorLevel,
  observationsFor,
  overallScore,
  projectionsFromBrews,
  triangleOutcomes,
  triangleSummary,
} from '../statsInputs';

const taste = (overall: number): TasteRating => ({
  aroma: 3,
  acidity: 3,
  sweetness: 3,
  body: 3,
  overall: overall as TasteRating['overall'],
});

function brew(id: string, date: string, recipeId: string, overall?: number): BrewRecord {
  return {
    id,
    date,
    recipeId,
    totalTimeSec: 180,
    taste: overall === undefined ? undefined : taste(overall),
  };
}

function recipe(id: string, over: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name: `レシピ${id}`,
    beanId: 'bean',
    doseG: 20,
    grindSetting: '中細',
    waterTempC: 92,
    waterId: 'water',
    totalWaterG: 300,
    targetBeverageG: 158,
    brewer: 'V60',
    filter: '純正',
    pours: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('overallScore', () => {
  it('5項目の平均を返す', () => {
    expect(overallScore(taste(5))).toBeCloseTo((3 * 4 + 5) / 5, 12);
  });
});

describe('duplicatePairsFromBrews', () => {
  it('同じ日・同じレシピの2件をペアにする', () => {
    const pairs = duplicatePairsFromBrews([
      brew('1', '2026-03-01T09:00:00.000Z', 'r1', 5),
      brew('2', '2026-03-01T10:00:00.000Z', 'r1', 3),
      brew('3', '2026-03-02T10:00:00.000Z', 'r1', 4),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].scoreA - pairs[0].scoreB).toBeCloseTo(0.4, 12);
  });

  it('未採点の記録とレシピ違いはペアにしない', () => {
    const pairs = duplicatePairsFromBrews([
      brew('1', '2026-03-01T09:00:00.000Z', 'r1', 5),
      brew('2', '2026-03-01T10:00:00.000Z', 'r2', 3),
      brew('3', '2026-03-01T11:00:00.000Z', 'r1'),
    ]);
    expect(pairs).toEqual([]);
  });
});

describe('factorLevel', () => {
  it('要因ごとの水準ラベルを作る', () => {
    expect(factorLevel(recipe('r'), 'grind')).toBe('中細');
    expect(factorLevel(recipe('r'), 'waterTemp')).toBe('92℃');
    expect(factorLevel(recipe('r'), 'dose')).toBe('20g');
    expect(factorLevel(recipe('r'), 'ratio')).toBe('1:15.0');
    expect(factorLevel(recipe('r', { grindSetting: '' }), 'grind')).toBe('未設定');
  });
});

describe('observationsFor / comparableLevelPairs', () => {
  const recipes = [recipe('r1', { waterTempC: 90 }), recipe('r2', { waterTempC: 95 })];
  const brews = [
    brew('1', '2026-03-01T09:00:00.000Z', 'r1', 3),
    brew('2', '2026-03-01T10:00:00.000Z', 'r2', 5),
    brew('3', '2026-03-02T09:00:00.000Z', 'r1', 4),
  ];

  it('同じ日の記録を1セッションにまとめる', () => {
    const observations = observationsFor(brews, recipes, 'waterTemp');
    expect(observations).toHaveLength(3);
    expect(observations.filter((o) => o.sessionId === '2026-03-01')).toHaveLength(2);
    expect(new Set(observations.map((o) => o.level))).toEqual(new Set(['90℃', '95℃']));
  });

  it('両方の水準が揃った日だけを比較可能なペアに数える', () => {
    const pairs = comparableLevelPairs(observationsFor(brews, recipes, 'waterTemp'));
    expect(pairs).toEqual([{ from: '90℃', to: '95℃', n: 1 }]);
  });

  it('水準が1種類だけならペアは無い', () => {
    const pairs = comparableLevelPairs(observationsFor(brews, [recipes[0]], 'waterTemp'));
    expect(pairs).toEqual([]);
  });
});

describe('diffToResult', () => {
  it('差の大きさを5段階に写す', () => {
    expect(diffToResult(1.5)).toBe(2);
    expect(diffToResult(0.4)).toBe(1);
    expect(diffToResult(0)).toBe(0);
    expect(diffToResult(-0.4)).toBe(-1);
    expect(diffToResult(-2)).toBe(-2);
  });

  it('符号を反転すると結果も反転する', () => {
    for (const d of [0.1, 0.3, 0.9, 1.2, 2.4]) {
      expect(diffToResult(-d) + diffToResult(d)).toBe(0);
    }
  });
});

describe('comparisonsFromData', () => {
  it('同じ日の別レシピどうしを対比較にする', () => {
    const comparisons = comparisonsFromData([], [
      brew('1', '2026-03-01T09:00:00.000Z', 'r1', 5),
      brew('2', '2026-03-01T10:00:00.000Z', 'r2', 3),
      brew('3', '2026-03-02T10:00:00.000Z', 'r2', 4),
    ]);
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]).toMatchObject({ itemA: 'r1', itemB: 'r2', result: 1 });
  });

  it('記録が空なら比較も空', () => {
    expect(comparisonsFromData([], [])).toEqual([]);
  });
});

describe('triangleSummary / triangleOutcomes', () => {
  const trial = (id: string, date: string, over: Partial<TriangleTrial>): TriangleTrial => ({
    id,
    date,
    factor: 'grind',
    levelDelta: '1段',
    positions: ['base', 'base', 'odd'],
    oddPosition: 2,
    abandoned: false,
    ...over,
  });

  it('中断した試行も試行数に数える', () => {
    const summary = triangleSummary([
      trial('1', '2026-03-01', { answer: 2, correct: true }),
      trial('2', '2026-03-02', { answer: 0, correct: false }),
      trial('3', '2026-03-03', { abandoned: true }),
    ]);
    expect(summary).toEqual({ trials: 3, correct: 1 });
  });

  it('未回答（開始前）の試行は数えない', () => {
    expect(triangleSummary([trial('1', '2026-03-01', {})])).toEqual({ trials: 0, correct: 0 });
  });

  it('正誤列は古い順に並ぶ', () => {
    expect(
      triangleOutcomes([
        trial('2', '2026-03-02', { answer: 2, correct: true }),
        trial('1', '2026-03-01', { answer: 0, correct: false }),
      ]),
    ).toEqual([false, true]);
  });
});

describe('projectionsFromBrews', () => {
  it('レシピごとの平均と標準偏差を出す', () => {
    const { projections, nByRecipe } = projectionsFromBrews(
      [
        brew('1', '2026-03-01T09:00:00.000Z', 'r1', 5),
        brew('2', '2026-03-02T09:00:00.000Z', 'r1', 3),
        brew('3', '2026-03-03T09:00:00.000Z', 'r2', 4),
      ],
      [recipe('r1'), recipe('r2'), recipe('r3')],
    );
    expect(projections.map((p) => p.recipeId)).toEqual(['r1', 'r2']);
    expect(projections[0].expectedScore).toBeCloseTo(3.2, 12);
    expect(projections[0].sd).toBeCloseTo(Math.SQRT2 * 0.2, 12);
    // 1件だけのレシピは、ばらつきを推定できないので 0 とする
    expect(projections[1].sd).toBe(0);
    expect(nByRecipe.get('r1')).toBe(2);
  });
});
