import { useEffect, useState } from 'react';
import { Banner, Card, Field, NumberField, formatSeconds } from '../ui/components';
import { useBeans, useRecipes, useSettings } from '../ui/data';
import { deleteRecipe, saveRecipe } from '../db/repo';
import { uid } from '../lib/random';
import { DEFAULT_SETTINGS, TARGET_BEVERAGE_G } from '../domain/defaults';
import type { Recipe, RecipeDefaults } from '../domain/types';

interface DraftPour {
  /** その投を終えた時点の累計湯量。 */
  targetG: number | undefined;
  atSec: number | undefined;
  waterTempC: number | undefined;
}

interface Draft {
  name: string;
  grindSetting: string;
  doseG: number | undefined;
  waterTempC: number | undefined;
  brewer: string;
  pours: DraftPour[];
}

const PRESET_INTERVAL_SEC = 45;

/** 総湯量と粉量から「蒸らし→中間→全量」の3投を作る。 */
function presetPours(defaults: RecipeDefaults): DraftPour[] {
  const bloomG = Math.min(Math.round(defaults.doseG * 3), defaults.totalWaterG);
  const midG = Math.round((bloomG + defaults.totalWaterG) / 2);
  return [
    { targetG: bloomG, atSec: 0, waterTempC: defaults.waterTempC },
    { targetG: midG, atSec: PRESET_INTERVAL_SEC, waterTempC: defaults.waterTempC },
    { targetG: defaults.totalWaterG, atSec: PRESET_INTERVAL_SEC * 2, waterTempC: defaults.waterTempC },
  ];
}

const emptyDraft = (defaults: RecipeDefaults): Draft => ({
  name: '',
  grindSetting: defaults.grindSetting,
  doseG: defaults.doseG,
  waterTempC: defaults.waterTempC,
  brewer: defaults.brewer,
  pours: presetPours(defaults),
});

export function RecipeScreen() {
  const recipes = useRecipes();
  const beans = useBeans();
  const defaults = useSettings().recipeDefaults;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(DEFAULT_SETTINGS.recipeDefaults));

  // 設定の初期値が読み込まれた（または変えられた）ら、未入力のフォームに反映させる。
  useEffect(() => {
    setDraft((current) => (current.name.trim() === '' ? emptyDraft(defaults) : current));
  }, [defaults.doseG, defaults.waterTempC, defaults.totalWaterG, defaults.grindSetting, defaults.brewer]);

  const beanId = beans[0]?.id ?? 'bean_default';
  const filledPours = draft.pours.filter(
    (pour): pour is DraftPour & { targetG: number; atSec: number } =>
      pour.targetG !== undefined && pour.atSec !== undefined,
  );
  const totalWaterG = filledPours[filledPours.length - 1]?.targetG ?? 0;
  const canSave = draft.name.trim() !== '' && draft.doseG !== undefined && filledPours.length > 0;

  function setPour(index: number, patch: Partial<DraftPour>) {
    setDraft({
      ...draft,
      pours: draft.pours.map((pour, i) => (i === index ? { ...pour, ...patch } : pour)),
    });
  }

  /** 初期湯温を変えたら、個別に触っていない投の湯温も追従させる。 */
  function setInitialTemp(waterTempC: number | undefined) {
    setDraft({
      ...draft,
      waterTempC,
      pours: draft.pours.map((pour) => (pour.waterTempC === draft.waterTempC ? { ...pour, waterTempC } : pour)),
    });
  }

  function addPour() {
    const last = draft.pours[draft.pours.length - 1];
    setDraft({
      ...draft,
      pours: [
        ...draft.pours,
        {
          targetG: last?.targetG,
          atSec: last?.atSec === undefined ? undefined : last.atSec + PRESET_INTERVAL_SEC,
          waterTempC: draft.waterTempC,
        },
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
      pours: filledPours.map((pour, index) => ({
        index: index + 1,
        targetG: pour.targetG,
        startSec: pour.atSec,
        waterTempC: pour.waterTempC ?? draft.waterTempC,
      })),
      createdAt: new Date().toISOString(),
    };
    await saveRecipe(recipe);
    setDraft(emptyDraft(defaults));
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
              label="初期湯温"
              suffix="℃"
              step={1}
              min={0}
              value={draft.waterTempC}
              onChange={setInitialTemp}
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
            <legend>注湯（累計湯量・開始からの秒数・湯温）</legend>
            <div className="stack">
              {draft.pours.map((pour, index) => (
                <div className="row pour-row" key={index}>
                  <span className="pour-index">{index + 1}投目</span>
                  <NumberField
                    label="累計"
                    suffix="g"
                    step={1}
                    min={0}
                    value={pour.targetG}
                    onChange={(targetG) => setPour(index, { targetG })}
                  />
                  <NumberField
                    label="開始"
                    suffix="秒"
                    step={5}
                    min={0}
                    value={pour.atSec}
                    onChange={(atSec) => setPour(index, { atSec })}
                  />
                  <NumberField
                    label="湯温"
                    suffix="℃"
                    step={1}
                    min={0}
                    value={pour.waterTempC}
                    onChange={(waterTempC) => setPour(index, { waterTempC })}
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
                <span className="muted mono">総湯量 {totalWaterG}g</span>
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
                <th aria-label="操作" />
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
                      : recipe.pours
                          .map(
                            (pour) =>
                              `${formatSeconds(pour.startSec)} 累計${pour.targetG}g ${pour.waterTempC ?? recipe.waterTempC}℃`,
                          )
                          .join(' / ')}
                  </td>
                  <td>
                    <button className="danger" type="button" onClick={() => void deleteRecipe(recipe.id)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
