import { quantileSorted } from './bootstrap';
import { createRNG } from './rng';

/** 5段階の対比較。正 = A が上。 */
export type ComparisonResult = -2 | -1 | 0 | 1 | 2;

export interface PairwiseComparison {
  itemA: string;
  itemB: string;
  result: ComparisonResult;
  sessionId?: string;
}

export interface LatentScore {
  itemId: string;
  /** 潜在スコア θ = ln π。連結成分ごとに平均 0 に正規化してある。 */
  theta: number;
  ciLow: number;
  ciHigh: number;
  nComparisons: number;
  /** 連結成分ID。異なる成分の θ は比較できない。 */
  componentId: number;
}

export interface BradleyTerryResult {
  scores: LatentScore[];
  converged: boolean;
  iterations: number;
  /** 連結成分の数。2以上なら成分間の比較は不能。 */
  components: number;
  transitivityViolationRate: number;
}

/**
 * 5段階の入力を A の勝ち数に写す暫定の対応表。
 * 後から調整できるよう定数として切り出している。
 */
export const RESULT_WIN_SHARE_A: ReadonlyMap<ComparisonResult, number> = new Map<ComparisonResult, number>([
  [-2, 0],
  [-1, 0.25],
  [0, 0.5],
  [1, 0.75],
  [2, 1],
]);

/** 全ペアに加える仮想引き分けの重み（ベイズ的平滑化）の既定値。 */
const DEFAULT_ALPHA = 0.5;
const DEFAULT_MAX_ITER = 200;
const DEFAULT_BOOTSTRAP_REPLICATES = 200;
/** 収束判定・ゼロ判定の許容誤差（浮動小数を === で比較しない）。 */
const TOLERANCE = 1e-6;
const EPSILON = 1e-12;

interface Fit {
  theta: Map<string, number>;
  componentOf: Map<string, number>;
  components: number;
  converged: boolean;
  iterations: number;
}

/** 比較グラフの連結成分を Union-Find で求める。 */
function connectedComponents(items: readonly string[], comparisons: readonly PairwiseComparison[]): Map<string, number> {
  const index = new Map<string, number>();
  items.forEach((id, i) => index.set(id, i));
  const parent = items.map((_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    let cur = x;
    while (parent[cur] !== root) {
      const next = parent[cur];
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  for (const c of comparisons) {
    const a = find(index.get(c.itemA)!);
    const b = find(index.get(c.itemB)!);
    if (a !== b) parent[a] = b;
  }
  // items の順（ソート済み）に現れた順で成分IDを振り、決定論的にする。
  const idOfRoot = new Map<number, number>();
  const componentOf = new Map<string, number>();
  for (const id of items) {
    const root = find(index.get(id)!);
    let cid = idOfRoot.get(root);
    if (cid === undefined) {
      cid = idOfRoot.size;
      idOfRoot.set(root, cid);
    }
    componentOf.set(id, cid);
  }
  return componentOf;
}

/**
 * 1つの連結成分について MM（Zermelo）反復で強さ π を求め、
 * 幾何平均が 1 になるよう正規化した θ = ln π を返す。
 */
function fitComponent(
  ids: readonly string[],
  comparisons: readonly PairwiseComparison[],
  alpha: number,
  maxIter: number,
): { theta: number[]; converged: boolean; iterations: number } {
  const n = ids.length;
  if (n === 1) return { theta: [0], converged: true, iterations: 0 };

  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const wins = new Array<number>(n).fill(0);
  const games: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (const c of comparisons) {
    const i = index.get(c.itemA)!;
    const j = index.get(c.itemB)!;
    const shareA = RESULT_WIN_SHARE_A.get(c.result)!;
    wins[i] += shareA;
    wins[j] += 1 - shareA;
    games[i][j] += 1;
    games[j][i] += 1;
  }
  // 全勝・全敗で θ が ±∞ に飛ぶのを防ぐため、成分内の全ペアに仮想引き分けを入れる。
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      wins[i] += alpha / 2;
      wins[j] += alpha / 2;
      games[i][j] += alpha;
      games[j][i] += alpha;
    }
  }

  let pi = new Array<number>(n).fill(1);
  let converged = false;
  let iterations = 0;
  for (let iter = 1; iter <= maxIter; iter += 1) {
    iterations = iter;
    const next = new Array<number>(n).fill(1);
    for (let i = 0; i < n; i += 1) {
      let denom = 0;
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        if (games[i][j] > EPSILON) denom += games[i][j] / (pi[i] + pi[j]);
      }
      next[i] = denom > EPSILON && wins[i] > EPSILON ? wins[i] / denom : pi[i];
    }
    // 幾何平均を 1 にそろえる（Bradley-Terry はスケール不変なので基準を固定する）。
    let logSum = 0;
    for (const value of next) logSum += Math.log(value);
    const scale = Math.exp(logSum / n);
    for (let i = 0; i < n; i += 1) next[i] /= scale;

    let delta = 0;
    for (let i = 0; i < n; i += 1) delta = Math.max(delta, Math.abs(Math.log(next[i]) - Math.log(pi[i])));
    pi = next;
    if (delta < TOLERANCE) {
      converged = true;
      break;
    }
  }
  return { theta: pi.map((value) => Math.log(value)), converged, iterations };
}

/** 成分ごとに分けて推定する内部関数。ブートストラップからも呼ぶ。 */
function fit(comparisons: readonly PairwiseComparison[], alpha: number, maxIter: number): Fit {
  const itemSet = new Set<string>();
  for (const c of comparisons) {
    itemSet.add(c.itemA);
    itemSet.add(c.itemB);
  }
  const items = [...itemSet].sort();
  const componentOf = connectedComponents(items, comparisons);
  const componentCount = new Set(componentOf.values()).size;

  const theta = new Map<string, number>();
  let converged = true;
  let iterations = 0;
  for (let cid = 0; cid < componentCount; cid += 1) {
    const ids = items.filter((id) => componentOf.get(id) === cid);
    const inside = comparisons.filter((c) => componentOf.get(c.itemA) === cid);
    const result = fitComponent(ids, inside, alpha, maxIter);
    ids.forEach((id, i) => theta.set(id, result.theta[i]));
    converged = converged && result.converged;
    iterations = Math.max(iterations, result.iterations);
  }
  return { theta, componentOf, components: componentCount, converged, iterations };
}

/**
 * 推移律の破れの割合。θ の大小と比較結果の符号が食い違う比較の割合を返す。
 * θ の差が許容誤差以内で順序が決まらない比較は、半分だけ矛盾として数える。
 */
function transitivityViolationRate(comparisons: readonly PairwiseComparison[], theta: Map<string, number>): number {
  let effective = 0;
  let violations = 0;
  for (const c of comparisons) {
    if (c.result === 0) continue;
    effective += 1;
    const diff = (theta.get(c.itemA) ?? 0) - (theta.get(c.itemB) ?? 0);
    if (Math.abs(diff) <= TOLERANCE) violations += 0.5;
    else if (Math.sign(diff) !== Math.sign(c.result)) violations += 1;
  }
  return effective === 0 ? 0 : violations / effective;
}

/**
 * 対比較の集まりから各アイテムの潜在スコア θ = ln π を推定する（Bradley-Terry）。
 * 全勝・全敗で発散しないよう全ペアに仮想引き分け（α）を加え、
 * 比較グラフが非連結なら成分ごとに推定して「成分間は比較不能」を componentId で示す。
 * 信頼区間は比較レコード単位のブートストラップ（seed 必須・決定論的）。
 */
export function fitBradleyTerry(
  comparisons: readonly PairwiseComparison[],
  opts?: { alpha?: number; seed?: number; bootstrapReplicates?: number; maxIter?: number },
): BradleyTerryResult {
  if (!Array.isArray(comparisons)) throw new Error('comparisons must be an array');
  const alpha = opts?.alpha ?? DEFAULT_ALPHA;
  if (!Number.isFinite(alpha) || alpha < 0) throw new Error('alpha must be a finite non-negative number');
  const maxIter = opts?.maxIter ?? DEFAULT_MAX_ITER;
  if (!Number.isInteger(maxIter) || maxIter <= 0) throw new Error('maxIter must be a positive integer');
  const replicates = opts?.bootstrapReplicates ?? DEFAULT_BOOTSTRAP_REPLICATES;
  if (!Number.isInteger(replicates) || replicates <= 0) throw new Error('bootstrapReplicates must be a positive integer');
  for (const c of comparisons) {
    if (typeof c.itemA !== 'string' || c.itemA.length === 0) throw new Error('itemA must be a non-empty string');
    if (typeof c.itemB !== 'string' || c.itemB.length === 0) throw new Error('itemB must be a non-empty string');
    if (c.itemA === c.itemB) throw new Error('itemA and itemB must differ');
    if (!RESULT_WIN_SHARE_A.has(c.result)) throw new Error('result must be one of -2, -1, 0, 1, 2');
  }

  if (comparisons.length === 0) {
    return { scores: [], converged: true, iterations: 0, components: 0, transitivityViolationRate: 0 };
  }

  const seed = opts?.seed;
  if (seed === undefined || !Number.isFinite(seed)) throw new Error('seed must be a finite number');

  const point = fit(comparisons, alpha, maxIter);
  const items = [...point.theta.keys()].sort();

  const nComparisons = new Map<string, number>(items.map((id) => [id, 0]));
  for (const c of comparisons) {
    nComparisons.set(c.itemA, (nComparisons.get(c.itemA) ?? 0) + 1);
    nComparisons.set(c.itemB, (nComparisons.get(c.itemB) ?? 0) + 1);
  }

  // 比較レコード単位の復元抽出。リサンプルに現れなかったアイテムは単純に飛ばす。
  const draws = new Map<string, number[]>(items.map((id) => [id, []]));
  if (comparisons.length >= 2) {
    const rng = createRNG(seed);
    const sample: PairwiseComparison[] = new Array(comparisons.length);
    for (let r = 0; r < replicates; r += 1) {
      for (let i = 0; i < comparisons.length; i += 1) sample[i] = comparisons[rng.nextInt(comparisons.length)];
      const replicate = fit(sample, alpha, maxIter);
      for (const id of items) {
        const value = replicate.theta.get(id);
        if (value !== undefined && Number.isFinite(value)) draws.get(id)!.push(value);
      }
    }
  }

  const scores: LatentScore[] = items.map((id) => {
    const values = draws.get(id)!;
    values.sort((a, b) => a - b);
    const enough = values.length >= 2;
    return {
      itemId: id,
      theta: point.theta.get(id)!,
      ciLow: enough ? quantileSorted(values, 0.025) : NaN,
      ciHigh: enough ? quantileSorted(values, 0.975) : NaN,
      nComparisons: nComparisons.get(id) ?? 0,
      componentId: point.componentOf.get(id)!,
    };
  });

  return {
    scores,
    converged: point.converged,
    iterations: point.iterations,
    components: point.components,
    transitivityViolationRate: transitivityViolationRate(comparisons, point.theta),
  };
}
