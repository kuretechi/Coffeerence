// 統計エンジンの公開API。実装の詳細（乱数の方式や近似式）は公開しない。
export type { BootstrapResult } from './bootstrap';
export { bootstrap } from './bootstrap';
export type { BradleyTerryResult, ComparisonResult, LatentScore, PairwiseComparison } from './bradleyTerry';
export { RESULT_WIN_SHARE_A, fitBradleyTerry } from './bradleyTerry';
export type { EffectResult, Observation } from './effect';
export { estimateEffect } from './effect';
