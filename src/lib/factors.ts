import type { FactorKey, Pour, Recipe } from '../domain/types';

/** 因子の現在値を、レシピから文字列として取り出す。 */
export function factorValue(recipe: Recipe, factor: FactorKey): string {
  switch (factor) {
    case 'grind':
      return recipe.grindSetting;
    case 'waterTemp':
      return String(recipe.waterTempC);
    case 'dose':
      return String(recipe.doseG);
    case 'ratio':
      return (recipe.totalWaterG / recipe.doseG).toFixed(1);
    case 'pourCount':
      return String(recipe.pours.length);
    case 'bloomWater':
      return String(recipe.pours[0]?.targetG ?? 0);
    case 'bloomTime':
      return String(recipe.pours[1]?.startSec ?? 0);
    case 'flowRate':
      return recipe.pours.map((p) => p.targetG).join('/');
    case 'water':
      return recipe.waterId;
    case 'filter':
      return recipe.filter;
    case 'brewer':
      return recipe.brewer;
    default:
      return '';
  }
}

/** OFAT: 指定した1因子だけを変えたレシピを作る。 */
export function applyFactor(recipe: Recipe, factor: FactorKey, value: string): Recipe {
  const numeric = Number(value);
  const next: Recipe = { ...recipe, pours: recipe.pours.map((p) => ({ ...p })) };

  switch (factor) {
    case 'grind':
      next.grindSetting = value;
      break;
    case 'waterTemp':
      if (Number.isFinite(numeric)) next.waterTempC = numeric;
      break;
    case 'dose':
      if (Number.isFinite(numeric)) next.doseG = numeric;
      break;
    case 'ratio':
      if (Number.isFinite(numeric) && numeric > 0) {
        next.totalWaterG = Math.round(next.doseG * numeric);
        next.pours = rescalePours(next.pours, recipe.totalWaterG, next.totalWaterG);
      }
      break;
    case 'pourCount':
      if (Number.isFinite(numeric) && numeric >= 1) next.pours = rebuildPours(next, Math.round(numeric));
      break;
    case 'bloomWater':
      if (Number.isFinite(numeric) && next.pours[0]) next.pours[0] = { ...next.pours[0], targetG: numeric };
      break;
    case 'bloomTime':
      if (Number.isFinite(numeric) && next.pours[1]) {
        const shift = numeric - next.pours[1].startSec;
        next.pours = next.pours.map((p, i) => (i === 0 ? p : { ...p, startSec: p.startSec + shift }));
      }
      break;
    case 'flowRate':
      next.pours = parsePourTargets(value, next);
      break;
    case 'water':
      next.waterId = value;
      break;
    case 'filter':
      next.filter = value;
      break;
    case 'brewer':
      next.brewer = value;
      break;
    default:
      break;
  }

  return next;
}

function rescalePours(pours: readonly Pour[], fromTotal: number, toTotal: number): Pour[] {
  if (fromTotal <= 0) return pours.map((p) => ({ ...p }));
  const scale = toTotal / fromTotal;
  return pours.map((p) => ({ ...p, targetG: Math.round(p.targetG * scale) }));
}

function rebuildPours(recipe: Recipe, count: number): Pour[] {
  const bloom = recipe.pours[0]?.targetG ?? Math.round(recipe.doseG * 3);
  const bloomStart = recipe.pours[0]?.startSec ?? 0;
  const interval = recipe.pours[1] ? recipe.pours[1].startSec - bloomStart : 45;
  const remaining = recipe.totalWaterG - bloom;
  const perPour = count > 1 ? remaining / (count - 1) : 0;
  const pours: Pour[] = [{ index: 1, targetG: bloom, startSec: bloomStart, note: '蒸らし' }];
  for (let i = 1; i < count; i++) {
    pours.push({
      index: i + 1,
      targetG: Math.round(bloom + perPour * i),
      startSec: bloomStart + interval * i,
    });
  }
  return pours;
}

function parsePourTargets(value: string, recipe: Recipe): Pour[] {
  const targets = value
    .split('/')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));
  if (targets.length === 0) return recipe.pours;
  return targets.map((targetG, i) => ({
    index: i + 1,
    targetG,
    startSec: recipe.pours[i]?.startSec ?? i * 45,
    note: recipe.pours[i]?.note,
  }));
}
