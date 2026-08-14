// 仕様書 §5 データモデル

// ─── 大会定義 ─────────────────────────────
export type CriterionKey = 'clean' | 'flavor' | 'volume_finish' | 'texture' | 'balance';

export interface Criterion {
  key: CriterionKey;
  label: string;
  max: number; // Q1
  step: number; // Q1
}

export interface Competition {
  id: string;
  name: string;
  criteria: Criterion[];
  attempts: number; // 2
  aggregation: 'sum';
  prepSeconds: number; // 420
  brewSeconds: number; // 420
  judgeSeconds: number; // 180
  minVolumeMl: number; // 150
  judgeCount: number; // Q2
  judgeAggregation: 'mean' | 'sum';
}

// ─── 豆・記述子 ───────────────────────────
export interface Bean {
  id: string;
  name: string;
  roaster?: string;
  remainingG: number;
  note?: string;
}

export interface FlavorDescriptorSet {
  id: string;
  beanId: string;
  real: string[]; // 候補記述子
  dummies: string[]; // ダミー（2個）
}

// ─── レシピ ───────────────────────────────
export interface Pour {
  index: number;
  targetG: number; // 累積目標重量
  startSec: number;
  waterTempC?: number; // 省略時は Recipe.waterTempC（初期湯温）
  note?: string;
}

export interface Recipe {
  id: string;
  name: string;
  beanId: string;
  doseG: number;
  grindSetting: string;
  waterTempC: number;
  waterId: string;
  totalWaterG: number;
  targetBeverageG: number; // 既定 158（=150ml以上の安全域）
  brewer: string;
  filter: string;
  pours: Pour[];
  createdAt: string;
}

// ─── 実験計画 ─────────────────────────────
export type FactorKey =
  | 'grind'
  | 'waterTemp'
  | 'dose'
  | 'ratio'
  | 'pourCount'
  | 'bloomWater'
  | 'bloomTime'
  | 'flowRate'
  | 'water'
  | 'filter'
  | 'brewer';

export interface PlanLevel {
  label: string;
  recipeId: string;
}

export interface ExperimentPlan {
  factor: FactorKey;
  levels: PlanLevel[];
  replicates: number;
  hiddenDuplicates: number; // 既定 1
  servingOrder: string[]; // cupId の配列（ランダム化済み）
  generatedAt: string;
  modifiedByUser: boolean; // 計画変更の有無（信頼度に反映）
}

// ─── 抽出ログ ─────────────────────────────
export interface FlowSample {
  t: number;
  w: number;
}

export interface BrewLog {
  actualDoseG?: number;
  actualTotalWaterG?: number;
  beverageG?: number; // 提出量（重量）
  serveTempC?: number;
  totalTimeSec?: number;
  firstDripSec?: number;
  drawdownSec?: number;
  tds?: number;
  extractionYield?: number; // 導出
  flowProfile?: FlowSample[]; // BTスケール（v2）
  deviations?: string[]; // 計画からの逸脱メモ
}

// ─── 採点 ─────────────────────────────────
export type DefectKey =
  | 'astringent'
  | 'harsh'
  | 'burnt'
  | 'papery'
  | 'metallic'
  | 'grassy'
  | 'overbitter'
  | 'muddy';

export interface DefectRating {
  key: DefectKey;
  level: 0 | 1 | 2;
}

export interface FlavorPick {
  descriptorId: string;
  intensity: 1 | 2 | 3;
  isDummy: boolean; // 集計時に参照。UIには出さない
}

export type Likert5 = 1 | 2 | 3 | 4 | 5;

export interface Score {
  cupId: string;
  ratedAt: string;
  defects: DefectRating[];
  texture: Likert5;
  finishLength: Likert5;
  finishQuality: Likert5;
  flavors: FlavorPick[];
  confidence: 1 | 2 | 3;
}

// ─── 簡易記録（レシピ→タイマー→味評価）─────
export interface TasteRating {
  aroma: Likert5;
  acidity: Likert5;
  sweetness: Likert5;
  body: Likert5;
  overall: Likert5;
  note?: string;
}

export interface BrewRecord {
  id: string;
  date: string;
  recipeId: string;
  totalTimeSec: number;
  beverageG?: number;
  taste?: TasteRating;
}

// ─── セッション ───────────────────────────
export interface Cup {
  id: string;
  code: string; // 'KTM'
  recipeId: string;
  isHiddenDuplicate: boolean;
  duplicateOfCupId?: string;
  brewLog: BrewLog;
  score?: Score;
}

export type SessionStatus = 'planned' | 'brewing' | 'scoring' | 'comparing' | 'revealed';

export interface Comparison {
  id: string;
  sessionId: string;
  criterion: CriterionKey;
  cupAId: string;
  cupBId: string;
  result: -2 | -1 | 0 | 1 | 2; // 正 = A が上
  comparedAt: string;
}

export interface Session {
  id: string;
  competitionId: string;
  beanId: string;
  date: string;
  goal: string;
  plan: ExperimentPlan;
  cups: Cup[];
  comparisons: Comparison[];
  status: SessionStatus;
  revealedAt?: string;
  note?: string;
}

// ─── 外部ラベル ───────────────────────────
export interface ExternalLabel {
  id: string;
  recipeId: string;
  source: 'peer' | 'coach' | 'competition';
  raterName?: string;
  scores: Record<CriterionKey, number>;
  date: string;
  note?: string;
}

// ─── 三点識別 ─────────────────────────────
export interface TriangleTrial {
  id: string;
  date: string;
  factor: FactorKey;
  levelDelta: string; // '1段' '0.5段' など
  positions: [string, string, string]; // 各カップの正体
  oddPosition: 0 | 1 | 2;
  answer?: 0 | 1 | 2;
  correct?: boolean;
  abandoned: boolean; // 中断も記録（削除禁止）
}

// ─── 競技リハーサル ───────────────────────
export type RehearsalPhase = 'idle' | 'prep' | 'brew' | 'judge' | 'done';

export interface RehearsalRecord {
  id: string;
  date: string;
  competitionId: string;
  prepActualSec: number;
  brewActualSec: number;
  judgeActualSec: number;
  marks: { label: string; atSec: number; phase: RehearsalPhase }[];
  note?: string;
}

// ─── 導出・推定結果 ───────────────────────
export interface RaterReliability {
  criterion: CriterionKey;
  sigma: number;
  nPairs: number;
  dummyPickRate: number;
  transitivityViolationRate: number;
  updatedAt: string;
}

export interface EffectEstimate {
  factor: FactorKey;
  fromLevel: string;
  toLevel: string;
  criterion: CriterionKey;
  estimate: number;
  ciLow: number;
  ciHigh: number;
  n: number;
  verdict: 'significant' | 'inconclusive' | 'no_effect';
  additionalTrialsNeeded?: number;
}

export interface RecipeProjection {
  recipeId: string;
  expectedScore: number; // 1回あたり
  sd: number;
  calibrated: boolean; // 外部ラベル3件以上か
}

export interface StrategyOption {
  label: string; // 'A×2' 'A+B' など
  recipeIds: [string, string];
  expectedTotal: number;
  sdTotal: number;
  probExceedTarget: number;
  recommended: boolean;
}

// ─── 設定 ─────────────────────────────────
export interface ScoreWeights {
  defect: Record<DefectKey, number>;
  finishLength: number; // w1
  finishQuality: number; // w2
  flavorPickWeight: number;
  flavorDummyPenalty: number;
}

export type ThemeName = 'classic' | 'hud';

/** レシピ登録フォームの初期値。 */
export interface RecipeDefaults {
  doseG: number;
  waterTempC: number;
  totalWaterG: number;
  grindSetting: string;
  brewer: string;
}

export interface Settings {
  id: 'settings';
  recipeDefaults: RecipeDefaults;
  theme: ThemeName;
  activeCompetitionId: string;
  weights: ScoreWeights;
  detectableEffect: number; // δ（既定 0.5点）
  prepChecklist: string[];
  soundEnabled: boolean;
  targetLine: number; // F-13 目標ライン（合計点）
}

// ─── 監査ログ（NF-07 / R-2）───────────────
export interface AuditEntry {
  id: string;
  at: string;
  kind: 'delete' | 'plan_modified' | 'reveal' | 'abandon_trial' | 'score_edit';
  subject: string;
  detail: string;
}
