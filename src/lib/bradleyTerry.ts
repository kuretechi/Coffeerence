import type { Comparison } from '../domain/types';
import { type Rng, defaultRng } from './random';
import { quantile } from './stats';

export interface BtOutcome {
  /** 勝った側 / 負けた側。引き分けは tie=true */
  aId: string;
  bId: string;
  /** 正 = A が上、負 = B が上、0 = 引き分け */
  margin: -2 | -1 | 0 | 1 | 2;
}

export interface BtEstimate {
  theta: Map<string, number>;
  /** 比較グラフの連結成分（成分をまたぐ比較は不能） */
  components: string[][];
  iterations: number;
}

const MARGIN_WEIGHT: Record<1 | 2, number> = { 1: 1, 2: 2 };
/** Davidson の引き分けパラメータ。引き分けを両者への半勝として配分する。 */
const TIE_SHARE = 0.5;

export function toOutcomes(comparisons: readonly Comparison[]): BtOutcome[] {
  return comparisons.map((c) => ({ aId: c.cupAId, bId: c.cupBId, margin: c.result }));
}

/**
 * 6.3 Bradley-Terry の MM（Zermelo）反復。
 * 連結成分ごとに推定し、成分内で θ の平均を 0 に正規化する。
 */
export function estimateBradleyTerry(
  outcomes: readonly BtOutcome[],
  options: { tolerance?: number; maxIterations?: number } = {},
): BtEstimate {
  const tolerance = options.tolerance ?? 1e-6;
  const maxIterations = options.maxIterations ?? 200;

  const items = new Set<string>();
  for (const o of outcomes) {
    items.add(o.aId);
    items.add(o.bId);
  }
  const components = connectedComponents(items, outcomes);
  const theta = new Map<string, number>();
  let iterations = 0;

  for (const component of components) {
    const member = new Set(component);
    const inComponent = outcomes.filter((o) => member.has(o.aId) && member.has(o.bId));
    const { strengths, iterations: it } = zermelo(component, inComponent, tolerance, maxIterations);
    iterations = Math.max(iterations, it);
    const logs = component.map((id) => Math.log(strengths.get(id) ?? 1));
    const shift = logs.reduce((a, b) => a + b, 0) / (logs.length || 1);
    component.forEach((id, i) => theta.set(id, logs[i] - shift));
  }

  return { theta, components, iterations };
}

function zermelo(
  ids: readonly string[],
  outcomes: readonly BtOutcome[],
  tolerance: number,
  maxIterations: number,
): { strengths: Map<string, number>; iterations: number } {
  const wins = new Map<string, number>();
  const games = new Map<string, Map<string, number>>();
  for (const id of ids) {
    wins.set(id, 0);
    games.set(id, new Map());
  }

  const addGame = (x: string, y: string, weight: number) => {
    const row = games.get(x)!;
    row.set(y, (row.get(y) ?? 0) + weight);
  };

  for (const o of outcomes) {
    if (o.margin === 0) {
      wins.set(o.aId, (wins.get(o.aId) ?? 0) + TIE_SHARE);
      wins.set(o.bId, (wins.get(o.bId) ?? 0) + TIE_SHARE);
      addGame(o.aId, o.bId, 1);
      addGame(o.bId, o.aId, 1);
      continue;
    }
    const weight = MARGIN_WEIGHT[Math.abs(o.margin) as 1 | 2];
    const winner = o.margin > 0 ? o.aId : o.bId;
    wins.set(winner, (wins.get(winner) ?? 0) + weight);
    addGame(o.aId, o.bId, weight);
    addGame(o.bId, o.aId, weight);
  }

  const strengths = new Map<string, number>(ids.map((id) => [id, 1]));
  let iterations = 0;
  for (let it = 0; it < maxIterations; it++) {
    iterations = it + 1;
    let maxDelta = 0;
    for (const id of ids) {
      const w = wins.get(id) ?? 0;
      if (w === 0) {
        // 全敗の項目は強さが 0 に発散するため、下限でクリップする
        const next = 1e-6;
        maxDelta = Math.max(maxDelta, Math.abs(next - (strengths.get(id) ?? 1)));
        strengths.set(id, next);
        continue;
      }
      let denom = 0;
      for (const [other, n] of games.get(id)!) {
        denom += n / ((strengths.get(id) ?? 1) + (strengths.get(other) ?? 1));
      }
      if (denom === 0) continue;
      const next = w / denom;
      maxDelta = Math.max(maxDelta, Math.abs(next - (strengths.get(id) ?? 1)));
      strengths.set(id, next);
    }
    // 幾何平均で正規化（尺度不定性の除去）
    const logSum = ids.reduce((a, id) => a + Math.log(strengths.get(id) ?? 1), 0);
    const factor = Math.exp(-logSum / ids.length);
    for (const id of ids) strengths.set(id, (strengths.get(id) ?? 1) * factor);
    if (maxDelta < tolerance) break;
  }
  return { strengths, iterations };
}

function connectedComponents(items: ReadonlySet<string>, outcomes: readonly BtOutcome[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const id of items) adjacency.set(id, new Set());
  for (const o of outcomes) {
    adjacency.get(o.aId)?.add(o.bId);
    adjacency.get(o.bId)?.add(o.aId);
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of items) {
    if (seen.has(id)) continue;
    const stack = [id];
    const component: string[] = [];
    seen.add(id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    components.push(component.sort());
  }
  return components;
}

export function probabilityAWins(thetaA: number, thetaB: number): number {
  return Math.exp(thetaA) / (Math.exp(thetaA) + Math.exp(thetaB));
}

/** ノンパラメトリック・ブートストラップによる θ の信頼区間。 */
export function bootstrapTheta(
  outcomes: readonly BtOutcome[],
  iterations = 1000,
  rng: Rng = defaultRng,
): Map<string, { low: number; high: number }> {
  const collected = new Map<string, number[]>();
  for (let it = 0; it < iterations; it++) {
    const resample: BtOutcome[] = new Array(outcomes.length);
    for (let i = 0; i < outcomes.length; i++) resample[i] = outcomes[Math.floor(rng() * outcomes.length)];
    const { theta } = estimateBradleyTerry(resample);
    for (const [id, value] of theta) {
      const list = collected.get(id) ?? [];
      list.push(value);
      collected.set(id, list);
    }
  }
  const out = new Map<string, { low: number; high: number }>();
  for (const [id, values] of collected) {
    values.sort((a, b) => a - b);
    out.set(id, { low: quantile(values, 0.025), high: quantile(values, 0.975) });
  }
  return out;
}

/** F-07 推移律の破れ（A>B, B>C, C>A）の割合。 */
export function transitivityViolationRate(comparisons: readonly Comparison[]): number {
  const preference = new Map<string, number>();
  const items = new Set<string>();
  for (const c of comparisons) {
    items.add(c.cupAId);
    items.add(c.cupBId);
    const key = `${c.cupAId}|${c.cupBId}`;
    preference.set(key, (preference.get(key) ?? 0) + c.result);
  }
  const sign = (a: string, b: string): number | undefined => {
    const forward = preference.get(`${a}|${b}`);
    const backward = preference.get(`${b}|${a}`);
    if (forward === undefined && backward === undefined) return undefined;
    const total = (forward ?? 0) - (backward ?? 0);
    if (total === 0) return 0;
    return total > 0 ? 1 : -1;
  };

  const ids = [...items];
  let triples = 0;
  let violations = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      for (let k = j + 1; k < ids.length; k++) {
        const ab = sign(ids[i], ids[j]);
        const bc = sign(ids[j], ids[k]);
        const ca = sign(ids[k], ids[i]);
        if (ab === undefined || bc === undefined || ca === undefined) continue;
        if (ab === 0 || bc === 0 || ca === 0) continue;
        triples++;
        if (ab === bc && bc === ca) violations++;
      }
    }
  }
  return triples === 0 ? 0 : violations / triples;
}

/**
 * F-05 情報量が最大になる比較ペアを選ぶ。
 * BT では θ が近いペアほど情報量が大きい。比較回数の少ないペアを優先する。
 */
export function nextComparisonPair(
  cupIds: readonly string[],
  existing: readonly Comparison[],
  theta: Map<string, number>,
): [string, string] | undefined {
  if (cupIds.length < 2) return undefined;
  const count = new Map<string, number>();
  for (const c of existing) {
    const key = pairKey(c.cupAId, c.cupBId);
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  let best: { pair: [string, string]; cost: number } | undefined;
  for (let i = 0; i < cupIds.length; i++) {
    for (let j = i + 1; j < cupIds.length; j++) {
      const a = cupIds[i];
      const b = cupIds[j];
      const done = count.get(pairKey(a, b)) ?? 0;
      const gap = Math.abs((theta.get(a) ?? 0) - (theta.get(b) ?? 0));
      const cost = done * 10 + gap;
      if (!best || cost < best.cost) best = { pair: [a, b], cost };
    }
  }
  return best?.pair;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
