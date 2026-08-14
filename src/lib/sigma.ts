import type { Competition, CriterionKey, RaterReliability, ScoreWeights, Session } from '../domain/types';
import { CRITERION_ORDER } from '../domain/defaults';
import { composeScores, dummyPickRate } from './scoring';
import { sd } from './stats';
import { transitivityViolationRate } from './bradleyTerry';

export const PRIOR_SIGMA = 1.0;
export const SHRINKAGE_K = 3;

export interface DuplicatePairDiff {
  sessionId: string;
  criterion: CriterionKey;
  diff: number;
  at: string;
}

/** 隠し重複ペアの採点差 d = x1 − x2 を項目別に集める。 */
export function duplicatePairDiffs(
  sessions: readonly Session[],
  competition: Competition,
  weights: ScoreWeights,
): DuplicatePairDiff[] {
  const diffs: DuplicatePairDiff[] = [];
  for (const session of sessions) {
    const byId = new Map(session.cups.map((c) => [c.id, c]));
    for (const cup of session.cups) {
      if (!cup.isHiddenDuplicate || !cup.duplicateOfCupId) continue;
      const donor = byId.get(cup.duplicateOfCupId);
      if (!donor?.score || !cup.score) continue;
      const a = composeScores(cup.score, competition, weights);
      const b = composeScores(donor.score, competition, weights);
      for (const criterion of CRITERION_ORDER) {
        const x1 = a[criterion];
        const x2 = b[criterion];
        if (x1 === undefined || x2 === undefined) continue;
        diffs.push({ sessionId: session.id, criterion, diff: x1 - x2, at: cup.score.ratedAt });
      }
    }
  }
  return diffs.sort((x, y) => x.at.localeCompare(y.at));
}

/**
 * 6.2 σ推定。
 * Var(d) = 2σ² より σ̂ = sd(d)/√2。ペアが少ない間は事前分布へ縮小する。
 */
export function estimateSigma(diffs: readonly number[]): { sigma: number; nPairs: number } {
  const n = diffs.length;
  if (n === 0) return { sigma: PRIOR_SIGMA, nPairs: 0 };
  const observed = n === 1 ? Math.abs(diffs[0]) / Math.SQRT2 : sd(diffs) / Math.SQRT2;
  if (n >= 5) return { sigma: observed, nPairs: n };
  const shrunk = (n * observed + SHRINKAGE_K * PRIOR_SIGMA) / (n + SHRINKAGE_K);
  return { sigma: shrunk, nPairs: n };
}

/** F-06 項目別の採点信頼度。直近 recentPairs 件のみを使い、上達を反映する。 */
export function raterReliability(
  sessions: readonly Session[],
  competition: Competition,
  weights: ScoreWeights,
  recentPairs = 20,
): RaterReliability[] {
  const all = duplicatePairDiffs(sessions, competition, weights);
  const scores = sessions.flatMap((s) => s.cups.map((c) => c.score).filter((x) => x !== undefined));
  const dummyRate = dummyPickRate(scores);
  const comparisons = sessions.flatMap((s) => s.comparisons);
  const updatedAt = new Date().toISOString();

  return CRITERION_ORDER.map((criterion) => {
    const diffs = all
      .filter((d) => d.criterion === criterion)
      .slice(-recentPairs)
      .map((d) => d.diff);
    const { sigma, nPairs } = estimateSigma(diffs);
    return {
      criterion,
      sigma,
      nPairs,
      dummyPickRate: criterion === 'flavor' ? dummyRate : 0,
      transitivityViolationRate: transitivityViolationRate(
        comparisons.filter((c) => c.criterion === criterion),
      ),
      updatedAt,
    };
  });
}

export type SigmaVerdict = 'trustworthy' | 'caution' | 'unreliable';

export function sigmaVerdict(sigma: number, trust: number, warn: number): SigmaVerdict {
  if (sigma <= trust) return 'trustworthy';
  if (sigma <= warn) return 'caution';
  return 'unreliable';
}

export const SIGMA_VERDICT_LABEL: Record<SigmaVerdict, string> = {
  trustworthy: '信頼できる',
  caution: '注意',
  unreliable: '要改善',
};
