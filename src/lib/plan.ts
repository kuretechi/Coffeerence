import type { Cup, ExperimentPlan, FactorKey, PlanLevel } from '../domain/types';
import { generateBlindCodes } from './blindCode';
import { type Rng, defaultRng, randomInt, shuffle, uid } from './random';

export interface PlanInput {
  factor: FactorKey;
  levels: PlanLevel[];
  replicates: number;
  /** 未指定なら 0〜2 からランダムに決める（R-3: 重複数を毎回変える） */
  hiddenDuplicates?: number;
  /** 残り豆量から淹れられる上限杯数 */
  maxCups?: number;
}

export interface GeneratedPlan {
  plan: ExperimentPlan;
  cups: Cup[];
}

/**
 * F-02 実験計画の自動生成。
 * 1因子のみを変化させ（OFAT）、各水準をレプリケートし、隠し重複を挿入し、提供順をランダム化する。
 */
export function generatePlan(input: PlanInput, rng: Rng = defaultRng): GeneratedPlan {
  const { factor, levels } = input;
  if (levels.length < 2) throw new Error('水準は2つ以上必要です');

  const replicates = Math.max(1, Math.floor(input.replicates));
  const requestedDuplicates = input.hiddenDuplicates ?? randomInt(0, 2, rng);

  const base: Cup[] = [];
  for (const level of levels) {
    for (let r = 0; r < replicates; r++) {
      base.push(newCup(level.recipeId, false, undefined, rng));
    }
  }

  const budget = input.maxCups ?? Infinity;
  const duplicates: Cup[] = [];
  const duplicateCount = Math.max(0, Math.min(requestedDuplicates, Math.floor(budget) - base.length));
  const donors = shuffle(base, rng);
  for (let i = 0; i < duplicateCount; i++) {
    const donor = donors[i % donors.length];
    duplicates.push(newCup(donor.recipeId, true, donor.id, rng));
  }

  const cups = [...base, ...duplicates];
  const codes = generateBlindCodes(cups.length, rng);
  cups.forEach((cup, i) => {
    cup.code = codes[i];
  });

  const servingOrder = shuffle(cups, rng).map((c) => c.id);

  const plan: ExperimentPlan = {
    factor,
    levels,
    replicates,
    hiddenDuplicates: duplicateCount,
    servingOrder,
    generatedAt: new Date().toISOString(),
    modifiedByUser: false,
  };

  return { plan, cups };
}

function newCup(recipeId: string, isHiddenDuplicate: boolean, duplicateOfCupId: string | undefined, rng: Rng): Cup {
  return {
    id: uid('cup', rng),
    code: '',
    recipeId,
    isHiddenDuplicate,
    duplicateOfCupId,
    brewLog: {},
  };
}

/** 残り豆量から淹れられる杯数 */
export function cupsAffordable(remainingG: number, doseG: number): number {
  if (doseG <= 0) return 0;
  return Math.floor(remainingG / doseG);
}

/** 提供順に並べたカップ列（S-03 抽出モードの表示順） */
export function cupsInServingOrder(cups: readonly Cup[], servingOrder: readonly string[]): Cup[] {
  const byId = new Map(cups.map((c) => [c.id, c]));
  const ordered = servingOrder.map((id) => byId.get(id)).filter((c): c is Cup => Boolean(c));
  const missing = cups.filter((c) => !servingOrder.includes(c.id));
  return [...ordered, ...missing];
}
