import type {
  Competition,
  CriterionKey,
  DefectKey,
  FactorKey,
  Settings,
} from './types';

// F-01 大会定義。Q1・Q2 が確定したらここの値を差し替えるだけでよい。
export const DEFAULT_COMPETITION: Competition = {
  id: 'competition-default',
  name: 'ブリューワーズ競技（暫定定義 v0.1）',
  criteria: [
    { key: 'clean', label: 'クリーンカップ', max: 10, step: 0.25 },
    { key: 'flavor', label: 'フレーバー', max: 10, step: 0.25 },
    { key: 'volume_finish', label: '量感と余韻', max: 10, step: 0.25 },
    { key: 'texture', label: '質感', max: 10, step: 0.25 },
    { key: 'balance', label: 'バランス・総合', max: 10, step: 0.25 },
  ],
  attempts: 2,
  aggregation: 'sum',
  prepSeconds: 420,
  brewSeconds: 420,
  judgeSeconds: 180,
  minVolumeMl: 150,
  judgeCount: 3,
  judgeAggregation: 'mean',
};

export const CRITERION_ORDER: CriterionKey[] = [
  'clean',
  'flavor',
  'volume_finish',
  'texture',
  'balance',
];

// F-04 層1: ネガティブ・チェックリスト
export const DEFECTS: { key: DefectKey; label: string }[] = [
  { key: 'astringent', label: '渋み' },
  { key: 'harsh', label: 'えぐみ・雑味' },
  { key: 'burnt', label: '焦げ・煙っぽさ' },
  { key: 'papery', label: '紙・段ボール' },
  { key: 'metallic', label: '金属っぽさ' },
  { key: 'grassy', label: '生っぽさ・青臭さ' },
  { key: 'overbitter', label: '過度な苦味' },
  { key: 'muddy', label: '濁った感じ' },
];

export const DEFECT_LEVEL_LABELS = ['なし', 'わずかに', 'はっきり'];

// F-04 層2: 言語アンカー
export const TEXTURE_ANCHORS = ['水っぽい', 'やや薄い', '中庸', 'やや厚い', 'とろみを感じる'];
export const FINISH_LENGTH_ANCHORS = ['すぐ消える', '短い', '中庸', '長い', '飲み込んだ後も残る'];
export const FINISH_QUALITY_ANCHORS = ['不快', 'やや不快', '中立', '快い', 'とても快い'];
export const CONFIDENCE_ANCHORS = ['まったく自信がない', 'ふつう', '自信がある'];

export const FACTORS: { key: FactorKey; label: string; unit?: string }[] = [
  { key: 'grind', label: '挽き目' },
  { key: 'waterTemp', label: '湯温', unit: '℃' },
  { key: 'dose', label: '豆量', unit: 'g' },
  { key: 'ratio', label: '比率' },
  { key: 'pourCount', label: '注湯回数', unit: '投' },
  { key: 'bloomWater', label: '蒸らし湯量', unit: 'g' },
  { key: 'bloomTime', label: '蒸らし時間', unit: '秒' },
  { key: 'flowRate', label: '注湯速度' },
  { key: 'water', label: '水' },
  { key: 'filter', label: 'フィルター' },
  { key: 'brewer', label: 'ドリッパー' },
];

export const COMPARISON_LABELS: Record<-2 | -1 | 0 | 1 | 2, string> = {
  2: 'A が明らかに上',
  1: 'A がやや上',
  0: 'ほぼ同じ',
  [-1]: 'B がやや上',
  [-2]: 'B が明らかに上',
};

// F-03 提出量: 90℃ で密度 0.965 g/mL。150mL 確保には重量 150g で足りるが安全域を取る。
export const HOT_WATER_DENSITY = 0.965;
export const TARGET_BEVERAGE_G = 158;

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  recipeDefaults: {
    doseG: 20,
    waterTempC: 92,
    totalWaterG: 320,
    grindSetting: '',
    brewer: 'V60 02',
  },
  theme: 'classic',
  activeCompetitionId: DEFAULT_COMPETITION.id,
  weights: {
    defect: {
      astringent: 1,
      harsh: 1,
      burnt: 1,
      papery: 1,
      metallic: 1,
      grassy: 1,
      overbitter: 1,
      muddy: 1,
    },
    finishLength: 1,
    finishQuality: 1,
    flavorPickWeight: 1,
    flavorDummyPenalty: 1,
  },
  detectableEffect: 0.5,
  prepChecklist: [
    '豆を計量する',
    'グラインダーの設定を確認する',
    '湯を沸かす・温度を合わせる',
    'ドリッパーとフィルターをリンスする',
    'サーバー・カッピングボウルを温める',
    'タイマーとスケールをゼロにする',
  ],
  soundEnabled: true,
  targetLine: 168,
};

export const SIGMA_TRUST_THRESHOLD = 1.0; // これ以下なら「信頼できる」
export const SIGMA_WARN_THRESHOLD = 1.5; // これを超えると「要改善」
