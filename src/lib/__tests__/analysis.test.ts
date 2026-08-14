import { describe, expect, it } from 'vitest';
import { PRIOR_SIGMA, estimateSigma } from '../sigma';
import { estimateBradleyTerry, probabilityAWins, transitivityViolationRate } from '../bradleyTerry';
import { binomialTailP, normalCdf, pToSigma, requiredTrials } from '../stats';
import { advanceStaircase, answerTriangleTrial, createTriangleTrial, initialStaircase, summarizeTriangleTrials } from '../triangle';
import { generatePlan } from '../plan';
import { generateBlindCodes } from '../blindCode';
import { mulberry32 } from '../random';
import { beverageVolumeMl, extractionYield, meetsMinimumVolume } from '../scoring';
import { strategyOptions, strategyStance } from '../strategy';
import { HOT_WATER_DENSITY } from '../../domain/defaults';
import type { Comparison } from '../../domain/types';

const cmp = (a: string, b: string, result: Comparison['result']): Comparison => ({
  id: `${a}-${b}-${result}`,
  sessionId: 's',
  criterion: 'balance',
  cupAId: a,
  cupBId: b,
  result,
  comparedAt: '2026-01-01T00:00:00.000Z',
});

describe('σ推定', () => {
  it('ペアがなければ事前分布を返す', () => {
    expect(estimateSigma([]).sigma).toBe(PRIOR_SIGMA);
  });

  it('ペアが十分あれば sd/√2 になる', () => {
    const diffs = [1, -1, 1, -1, 1, -1];
    const { sigma, nPairs } = estimateSigma(diffs);
    expect(nPairs).toBe(6);
    expect(sigma).toBeCloseTo(Math.sqrt(1.2) / Math.SQRT2, 6);
  });

  it('ペアが少ないときは事前分布へ縮小する', () => {
    const big = estimateSigma([4, -4]).sigma;
    const raw = Math.abs(4 - -4) / 2 / Math.SQRT2; // 参考値
    expect(big).toBeLessThan(raw * 2);
    expect(big).toBeGreaterThan(PRIOR_SIGMA * 0.5);
  });
});

describe('Bradley-Terry', () => {
  it('一貫した勝敗から順序を復元する', () => {
    const { theta } = estimateBradleyTerry([
      { aId: 'a', bId: 'b', margin: 1 },
      { aId: 'a', bId: 'b', margin: 1 },
      { aId: 'b', bId: 'c', margin: 1 },
      { aId: 'b', bId: 'c', margin: 1 },
      { aId: 'a', bId: 'c', margin: 2 },
    ]);
    expect(theta.get('a')!).toBeGreaterThan(theta.get('b')!);
    expect(theta.get('b')!).toBeGreaterThan(theta.get('c')!);
  });

  it('θ が等しければ勝率は 0.5', () => {
    expect(probabilityAWins(0.3, 0.3)).toBeCloseTo(0.5, 10);
  });

  it('循環する比較で推移律の破れを検出する', () => {
    const rate = transitivityViolationRate([cmp('a', 'b', 1), cmp('b', 'c', 1), cmp('c', 'a', 1)]);
    expect(rate).toBe(1);
  });
});

describe('統計', () => {
  it('正規分布の累積確率', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });

  it('必要試行回数は σ が大きいほど増える', () => {
    expect(requiredTrials(1.5, 0.5)).toBeGreaterThan(requiredTrials(0.5, 0.5));
  });

  it('二項検定は全問正解で有意になる', () => {
    expect(pToSigma(binomialTailP(10, 10, 1 / 3))).toBeGreaterThan(2);
    expect(pToSigma(binomialTailP(3, 9, 1 / 3))).toBeLessThan(2);
  });
});

describe('三点識別', () => {
  it('正解位置を保持し、答えを判定する', () => {
    const trial = createTriangleTrial('grind', '1段', mulberry32(7));
    const wrong = ((trial.oddPosition + 1) % 3) as 0 | 1 | 2;
    expect(answerTriangleTrial(trial, trial.oddPosition).correct).toBe(true);
    expect(answerTriangleTrial(trial, wrong).correct).toBe(false);
  });

  it('中断した試行は集計から除かれる', () => {
    const trial = createTriangleTrial('grind', '1段', mulberry32(3));
    expect(summarizeTriangleTrials([{ ...trial, abandoned: true }])).toHaveLength(0);
  });

  it('3-up/1-down で差が変化する', () => {
    let state = initialStaircase(0);
    state = advanceStaircase(state, true);
    state = advanceStaircase(state, true);
    expect(state.index).toBe(0);
    state = advanceStaircase(state, true);
    expect(state.index).toBe(1);
    state = advanceStaircase(state, false);
    expect(state.index).toBe(0);
  });
});

describe('実験計画', () => {
  it('水準×レプリケートと隠し重複を作り、提供順をランダム化する', () => {
    const plan = generatePlan(
      {
        factor: 'grind',
        levels: [
          { label: '細', recipeId: 'r1' },
          { label: '粗', recipeId: 'r2' },
        ],
        replicates: 2,
        hiddenDuplicates: 1,
      },
      mulberry32(42),
    );
    expect(plan.cups).toHaveLength(5);
    expect(plan.cups.filter((c) => c.isHiddenDuplicate)).toHaveLength(1);
    expect(new Set(plan.plan.servingOrder)).toEqual(new Set(plan.cups.map((c) => c.id)));
    expect(plan.plan.modifiedByUser).toBe(false);
    const duplicate = plan.cups.find((c) => c.isHiddenDuplicate)!;
    const donor = plan.cups.find((c) => c.id === duplicate.duplicateOfCupId)!;
    expect(donor.recipeId).toBe(duplicate.recipeId);
  });

  it('ブラインドコードは重複しない3文字', () => {
    const codes = generateBlindCodes(30, mulberry32(1));
    expect(new Set(codes).size).toBe(30);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{3}$/);
  });
});

describe('提出量と収率', () => {
  it('150mL に満たない重量を弾く', () => {
    expect(beverageVolumeMl(158, HOT_WATER_DENSITY)).toBeCloseTo(163.7, 1);
    expect(meetsMinimumVolume(158, HOT_WATER_DENSITY, 150)).toBe(true);
    expect(meetsMinimumVolume(140, HOT_WATER_DENSITY, 150)).toBe(false);
  });

  it('抽出収率を求める', () => {
    expect(extractionYield(1.4, 250, 15)).toBeCloseTo(23.33, 2);
  });
});

describe('2回試技の戦略', () => {
  const projections = [
    { recipeId: 'safe', expectedScore: 30, sd: 0.5, calibrated: false },
    { recipeId: 'risky', expectedScore: 29, sd: 4, calibrated: false },
  ];

  it('目標が高いときは分散の大きい選択肢が上位に来る', () => {
    const options = strategyOptions(projections, 70, (id) => id);
    expect(options[0].recipeIds).toContain('risky');
    expect(strategyStance(options[0].expectedTotal, 70)).toBe('increase_variance');
  });

  it('目標が低いときは安定した選択肢を選ぶ', () => {
    const options = strategyOptions(projections, 50, (id) => id);
    expect(options[0].label).toBe('safe×2');
    expect(strategyStance(options[0].expectedTotal, 50)).toBe('reduce_variance');
  });
});
