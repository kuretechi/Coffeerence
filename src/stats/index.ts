// 統計エンジンの公開API。実装の詳細（乱数の方式や近似式）は公開しない。
export type { BootstrapResult } from './bootstrap';
export { bootstrap } from './bootstrap';
export type { RecipeProjection, StrategyOption } from './strategy';
export { evaluateStrategies } from './strategy';
export type { CalibrationPoint, CalibrationResult } from './calibration';
export { calibrate } from './calibration';
