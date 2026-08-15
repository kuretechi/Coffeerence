// 統計エンジンの公開API。実装の詳細（乱数の方式や近似式）は公開しない。
export type { BootstrapResult } from './bootstrap';
export { bootstrap } from './bootstrap';
export type { PowerResult } from './power';
export { requiredSampleSize } from './power';
export type { StaircaseState, ThresholdResult } from './staircase';
export { estimateThreshold, initStaircase, updateStaircase } from './staircase';
