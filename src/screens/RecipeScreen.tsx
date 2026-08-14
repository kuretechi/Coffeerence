import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, Card, Field, NumberField, formatSeconds } from '../ui/components';
import { useBeans, useRecipes } from '../ui/data';
import { saveRecipe } from '../db/repo';
import { uid } from '../lib/random';
import { toPours, toSteps } from '../lib/pours';
import { TARGET_BEVERAGE_G } from '../domain/defaults';
import type { Recipe } from '../domain/types';

interface DraftPour {
  waterG: number | undefined;
  atSec: number | undefined;
}

interface Draft {
  name: string;
  grindSetting: string;
  doseG: number | undefined;
  waterTempC: number | undefined;
  brewer: string;
  pours: DraftPour[];
}

const emptyDraft = (): Draft => ({
  name: '',
  grindSetting: '',
  doseG: 20,
  waterTempC: 92,
  brewer: 'V60 02',
  pours: [
    { waterG: 60, atSec: 0 },
    { waterG: 130, atSec: 45 },
    { waterG: 130, atSec: 90 },
  ],
});

const PRESET_INTERVAL_SEC = 45;

export function RecipeScreen() {
  const recipes = useRecipes();
  const beans = useBeans();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const beanId = beans[0]?.id ?? 'bean_default';
  const filledPours = draft.pours.filter(
    (pour): pour is { waterG: number; atSec: number } => pour.waterG !== undefined && pour.atSec !== undefined,
  );
  const totalWaterG = filledPours.reduce((sum, pour) => sum + pour.waterG, 0);
  const canSave = draft.name.trim() !== '' && draft.doseG !== undefined && filledPours.length > 0;

  function setPour(index: number, patch: Partial<DraftPour>) {
    setDraft({
      ...draft,
      pours: draft.pours.map((pour, i) => (i === index ? { ...pour, ...patch } : pour)),
    });
  }

  function addPour() {
    const last = draft.pours[draft.pours.length - 1];
    setDraft({
      ...draft,
      pours: [
        ...draft.pours,
        { waterG: last?.waterG, atSec: last?.atSec === undefined ? undefined : last.atSec + PRESET_INTERVAL_SEC },
      ],
    });
  }

  function removePour(index: number) {
    setDraft({ ...draft, pours: draft.pours.filter((_, i) => i !== index) });
  }

  async function add() {
    if (!canSave) return;
    const recipe: Recipe = {
      id: uid('recipe'),
      name: draft.name.trim(),
      beanId,
      doseG: draft.doseG ?? 0,
      grindSetting: draft.grindSetting,
      waterTempC: draft.waterTempC ?? 0,
      waterId: '',
      totalWaterG,
      targetBeverageG: TARGET_BEVERAGE_G,
      brewer: draft.brewer,
      filter: '',
      pours: toPours(filledPours),
      createdAt: new Date().toISOString(),
    };
    await saveRecipe(recipe);
    setDraft(emptyDraft());
  }

  return (
    <>
      <Card title="レシピ登録" hint="淹れる条件を登録します。タイマーで計測するときにここから選びます。">
        <div className="stack">
          <Field label="レシピ名">
            <input
              value={draft.name}
              placeholder="例: 中細 92℃ 1:16"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <div className="row">
            <NumberField
              label="粉量"
              suffix="g"
              step={0.1}
              min={0}
              value={draft.doseG}
              onChange={(doseG) => setDraft({ ...draft, doseG })}
            />
            <NumberField
              label="湯温"
              suffix="℃"
              step={1}
              min={0}
              value={draft.waterTempC}
              onChange={(waterTempC) => setDraft({ ...draft, waterTempC })}
            />
          </div>
          <div className="row">
            <Field label="挽き目">
              <input
                value={draft.grindSetting}
                placeholder="例: 中細 / ダイヤル 18"
                onChange={(event) => setDraft({ ...draft, grindSetting: event.target.value })}
              />
            </Field>
            <Field label="ドリッパー">
              <input value={draft.brewer} onChange={(event) => setDraft({ ...draft, brewer: event.target.value })} />
            </Field>
          </div>
          <fieldset className="pour-editor">
            <legend>注湯（何投目に何g・開始からの秒数）</legend>
            <div className="stack">
              {draft.pours.map((pour, index) => (
                <div className="row pour-row" key={index}>
                  <span className="pour-index">{index + 1}投目</span>
                  <NumberField
                    label="湯量"
                    suffix="g"
                    step={1}
                    min={0}
                    value={pour.waterG}
                    onChange={(waterG) => setPour(index, { waterG })}
                  />
                  <NumberField
                    label="開始"
                    suffix="秒"
                    step={5}
                    min={0}
                    value={pour.atSec}
                    onChange={(atSec) => setPour(index, { atSec })}
                  />
                  <button type="button" disabled={draft.pours.length <= 1} onClick={() => removePour(index)}>
                    削除
                  </button>
                </div>
              ))}
              <div className="row between">
                <button type="button" onClick={addPour}>
                  投を追加
                </button>
                <span className="muted mono">合計 {totalWaterG}g</span>
              </div>
            </div>
          </fieldset>
          <button className="primary" type="button" disabled={!canSave} onClick={() => void add()}>
            レシピを登録
          </button>
        </div>
      </Card>

      <Card title="登録済みレシピ">
        {recipes.length === 0 ? (
          <Banner>まだレシピがありません。</Banner>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>粉量</th>
                <th>湯量</th>
                <th>注湯</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((recipe) => (
                <tr key={recipe.id}>
                  <td>{recipe.name}</td>
                  <td className="mono">{recipe.doseG}g</td>
                  <td className="mono">{recipe.totalWaterG}g</td>
                  <td className="mono">
                    {recipe.pours.length === 0
                      ? '—'
                      : toSteps(recipe.pours)
                          .map((step) => `${formatSeconds(step.atSec)} ${step.waterG}g`)
                          .join(' / ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Link className="button" to="/timer">
          タイマーへ
        </Link>
      </Card>
    </>
  );
}
