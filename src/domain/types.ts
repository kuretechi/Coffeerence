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
  /** 抽出終了（落ち切り）までの秒数。未設定のレシピは自動停止しない。 */
  finishSec?: number;
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

export const THEME_NAMES = ['classic', 'light', 'paper', 'midnight', 'matcha'] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

// ─── 機材 ─────────────────────────────────
export type GearKind = 'kettle' | 'mill';

/** 設定画面で登録するケトル・ミル。レシピの挽き目メモなどと紐づけて使う。 */
export interface Gear {
  id: string;
  kind: GearKind;
  name: string;
  note?: string;
}

/** レシピ登録フォームの初期値。 */
export interface RecipeDefaults {
  doseG: number;
  waterTempC: number;
  totalWaterG: number;
  grindSetting: string;
  brewer: string;
}

// ─── 豆友（投稿と自動判定）───────────────
/** 端末内に保存する投稿。サーバーができたら同期対象にする。 */
/** 投稿に添付するレシピ。元のレシピを消しても読めるよう写しで持つ。 */
export interface SharedRecipe {
  name: string;
  doseG: number;
  totalWaterG: number;
  grindSetting: string;
  brewer: string;
  waterTempC: number;
  pours: Pour[];
  finishSec?: number;
}

export interface Post {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  /** 添付されたレシピ。無い投稿もある。 */
  recipe?: SharedRecipe;
  /** 直近の判定結果。再判定で上書きする。 */
  moderation: ModerationVerdict;
  /** Supabase から読んだ投稿は 'remote'。端末内だけの投稿は undefined。 */
  source?: 'remote';
  /** 投稿者の Supabase ユーザー ID（remote のみ）。削除可否の判定に使う。 */
  userId?: string;
}

/** 性別。未回答は undefined で表す。 */
export type Gender = 'male' | 'female' | 'other';

/** Supabase の profiles テーブル。表示名・画像・自己紹介などを持つ。 */
export interface Profile {
  id: string;
  displayName: string;
  /** プロフィール画像（128px 角の JPEG data URL）。未設定なら頭文字を表示する。 */
  avatarUrl?: string;
  bio?: string;
  age?: number;
  gender?: Gender;
}

/** ユーザー同士の DM 1通。Supabase の messages テーブルに対応する。 */
export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  /** 受け取った側が開いた時刻。未読なら undefined。 */
  readAt?: string;
}

/** DM の相手ごとのまとめ。一覧画面に出す。 */
export interface DmThread {
  /** 相手のユーザー ID。 */
  userId: string;
  latest: DirectMessage;
  /** 自分宛の未読の数。 */
  unread: number;
}

/** 不適切判定の結果。`allowed` が false の投稿は保存せず削除する。 */
export interface ModerationVerdict {
  allowed: boolean;
  categories: string[];
  reason?: string;
  provider: 'local' | 'remote';
}

export interface Settings {
  id: 'settings';
  recipeDefaults: RecipeDefaults;
  theme: ThemeName;
  activeCompetitionId: string;
  weights: ScoreWeights;
  detectableEffect: number; // δ（既定 0.5点）
  prepChecklist: string[];
  /** 端末内のプロフィール（Supabase 未設定でも使う）。 */
  avatarUrl?: string;
  bio?: string;
  age?: number;
  gender?: Gender;
  soundEnabled: boolean;
  /** 合図音の種類。既定音の ID か、アップロードした音を指す 'custom'。 */
  soundId: string;
  /** アップロードした音のファイル名（表示用）。 */
  customSoundName?: string;
  /** 合図音のピッチ（半音、未設定なら 0）。 */
  soundPitch?: number;
  /** 合図音にかける効果（未設定なら 'none'）。 */
  soundEffect?: SoundEffect;
  /** 合図音の残響量（未設定なら効果ごとの既定値）。 */
  soundReverb?: ReverbAmount;
  /** 抽出終了（2回鳴らし）だけに使う音。'same' なら合図音と同じ。 */
  finishSoundId?: string;
  /** 終了用にアップロードした音のファイル名（表示用）。 */
  finishCustomSoundName?: string;
  /** 抽出終了の音のピッチ（半音、未設定なら 0）。 */
  finishSoundPitch?: number;
  /** 抽出終了の音にかける効果（未設定なら 'none'）。 */
  finishSoundEffect?: SoundEffect;
  /** 抽出終了の音の残響量（未設定なら効果ごとの既定値）。 */
  finishSoundReverb?: ReverbAmount;
  targetLine: number; // F-13 目標ライン（合計点）
  /** 裏モード。コーヒーに関係ない機能（ビート・MIDI）を出すかどうか。 */
  secretMode?: boolean;
}

// ─── ビート（タイルを叩いて組む）───────
/** アップロードした音素材。音源は Blob のまま端末内に置く。 */
export interface LoopSound {
  id: string;
  name: string;
  blob: Blob;
  /** 読み込み時に測った長さ（秒）。表示と BPM 合わせに使う。 */
  durationSec: number;
  createdAt: string;
}

/** 1トラックの状態。素材が入っていないトラックは soundId を持たない。 */
export interface BeatTrack {
  soundId?: string;
  /** タイルの入り切り。長さは 16 × 小節数。 */
  steps: boolean[];
  muted: boolean;
}

/** ビートの盤面。端末内に1つだけ持つ。 */
export interface BeatPattern {
  id: 'pattern';
  bpm: number;
  bars: number;
  tracks: BeatTrack[];
  /** 全体音量（0〜1）。 */
  volume: number;
}

/** アップロード音の置き場。合図音と終了音で別のファイルを持てる。 */
export type SoundSlot = 'custom' | 'custom-finish';

/** 合図音にかける効果。 */
export type SoundEffect = 'none' | 'room' | 'hall' | 'echo' | 'muffled' | 'radio';

/** 残響（room / hall）の程度。原音に混ぜる割合と残響の長さで指定する。 */
export interface ReverbAmount {
  /** 原音に混ぜる残響の割合（%）。 */
  mix: number;
  /** 残響が消えるまでの長さ（秒）。 */
  seconds: number;
}

/** アップロードした合図音。音源は Blob のまま端末内に置く。 */
export interface StoredSound {
  id: SoundSlot;
  name: string;
  blob: Blob;
}

/** アップロードした MIDI。中身は端末内にそのまま持つ。 */
export interface StoredMidi {
  id: string;
  name: string;
  createdAt: string;
  blob: Blob;
}

// ─── 監査ログ（NF-07 / R-2）───────────────
export interface AuditEntry {
  id: string;
  at: string;
  kind: 'delete' | 'plan_modified' | 'reveal' | 'abandon_trial' | 'score_edit' | 'moderation';
  subject: string;
  detail: string;
}
