import { db } from './db';
import type { BrewRecord, Competition, Recipe, ScoreWeights, Session } from '../domain/types';
import { CRITERION_ORDER } from '../domain/defaults';
import { composeScores } from '../lib/scoring';

export interface ExportBundle {
  format: 'coffeerence-export';
  version: 1;
  exportedAt: string;
  competitions: unknown[];
  beans: unknown[];
  descriptorSets: unknown[];
  recipes: unknown[];
  brews: unknown[];
  sessions: unknown[];
  externalLabels: unknown[];
  triangleTrials: unknown[];
  rehearsals: unknown[];
  settings: unknown[];
  audit: unknown[];
}

/** NF-03: データはユーザーのもの。全件を JSON で持ち出せる。 */
export async function exportAll(): Promise<ExportBundle> {
  const [
    competitions,
    beans,
    descriptorSets,
    recipes,
    brews,
    sessions,
    externalLabels,
    triangleTrials,
    rehearsals,
    settings,
    audit,
  ] = await Promise.all([
    db.competitions.toArray(),
    db.beans.toArray(),
    db.descriptorSets.toArray(),
    db.recipes.toArray(),
    db.brews.toArray(),
    db.sessions.toArray(),
    db.externalLabels.toArray(),
    db.triangleTrials.toArray(),
    db.rehearsals.toArray(),
    db.settings.toArray(),
    db.audit.toArray(),
  ]);
  return {
    format: 'coffeerence-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    competitions,
    beans,
    descriptorSets,
    recipes,
    brews,
    sessions,
    externalLabels,
    triangleTrials,
    rehearsals,
    settings,
    audit,
  };
}

export async function importAll(bundle: ExportBundle): Promise<void> {
  if (bundle.format !== 'coffeerence-export') throw new Error('対応していないファイル形式です');
  await db.transaction(
    'rw',
    [
      db.competitions,
      db.beans,
      db.descriptorSets,
      db.recipes,
      db.brews,
      db.sessions,
      db.externalLabels,
      db.triangleTrials,
      db.rehearsals,
      db.settings,
      db.audit,
    ],
    async () => {
      await db.competitions.bulkPut(bundle.competitions as never[]);
      await db.beans.bulkPut(bundle.beans as never[]);
      await db.descriptorSets.bulkPut(bundle.descriptorSets as never[]);
      await db.recipes.bulkPut(bundle.recipes as never[]);
      // brews は v2 で追加したため、古い書き出しには存在しない。
      await db.brews.bulkPut((bundle.brews ?? []) as never[]);
      await db.sessions.bulkPut(bundle.sessions as never[]);
      await db.externalLabels.bulkPut(bundle.externalLabels as never[]);
      await db.triangleTrials.bulkPut(bundle.triangleTrials as never[]);
      await db.rehearsals.bulkPut(bundle.rehearsals as never[]);
      await db.settings.bulkPut(bundle.settings as never[]);
      await db.audit.bulkPut(bundle.audit as never[]);
    },
  );
}

const escapeCsv = (value: string | number | undefined) => {
  const text = value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** 抽出記録単位の CSV。レシピの条件と味評価を同じ行に並べる。 */
export function brewsToCsv(brews: readonly BrewRecord[], recipes: readonly Recipe[]): string {
  const header = [
    'brew_id',
    'date',
    'recipe',
    'dose_g',
    'water_g',
    'water_temp_c',
    'grind',
    'total_time_sec',
    'beverage_g',
    'aroma',
    'acidity',
    'sweetness',
    'body',
    'overall',
    'note',
  ];

  const rows = brews.map((brew) => {
    const recipe = recipes.find((r) => r.id === brew.recipeId);
    return [
      brew.id,
      brew.date,
      recipe?.name,
      recipe?.doseG,
      recipe?.totalWaterG,
      recipe?.waterTempC,
      recipe?.grindSetting,
      brew.totalTimeSec,
      brew.beverageG,
      brew.taste?.aroma,
      brew.taste?.acidity,
      brew.taste?.sweetness,
      brew.taste?.body,
      brew.taste?.overall,
      brew.taste?.note,
    ]
      .map(escapeCsv)
      .join(',');
  });

  return [header.join(','), ...rows].join('\n');
}

/** カップ単位の CSV。表計算ソフトで自由に分析できる形にする。 */
export function sessionsToCsv(
  sessions: readonly Session[],
  competition: Competition,
  weights: ScoreWeights,
): string {
  const header = [
    'session_id',
    'date',
    'factor',
    'cup_id',
    'code',
    'recipe_id',
    'hidden_duplicate',
    'duplicate_of',
    'dose_g',
    'water_g',
    'beverage_g',
    'total_time_sec',
    'tds',
    'confidence',
    ...CRITERION_ORDER.map((c) => `score_${c}`),
  ];

  const rows = sessions.flatMap((session) =>
    session.cups.map((cup) => {
      const composed = cup.score ? composeScores(cup.score, competition, weights) : {};
      return [
        session.id,
        session.date,
        session.plan.factor,
        cup.id,
        cup.code,
        cup.recipeId,
        cup.isHiddenDuplicate ? '1' : '0',
        cup.duplicateOfCupId ?? '',
        cup.brewLog.actualDoseG,
        cup.brewLog.actualTotalWaterG,
        cup.brewLog.beverageG,
        cup.brewLog.totalTimeSec,
        cup.brewLog.tds,
        cup.score?.confidence,
        ...CRITERION_ORDER.map((c) => {
          const value = composed[c];
          return value === undefined ? '' : value.toFixed(3);
        }),
      ]
        .map(escapeCsv)
        .join(',');
    }),
  );

  return [header.join(','), ...rows].join('\n');
}

export function downloadFile(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
