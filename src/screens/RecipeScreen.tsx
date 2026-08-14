import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, Card, Field, NumberField } from '../ui/components';
import { useBeans, useRecipes } from '../ui/data';
import { saveRecipe } from '../db/repo';
import { uid } from '../lib/random';
import { TARGET_BEVERAGE_G } from '../domain/defaults';
import type { Recipe } from '../domain/types';

interface Draft {
  name: string;
  grindSetting: string;
  doseG: number | undefined;
  totalWaterG: number | undefined;
  waterTempC: number | undefined;
  brewer: string;
}

const emptyDraft = (): Draft => ({
  name: '',
  grindSetting: '',
  doseG: 20,
  totalWaterG: 320,
  waterTempC: 92,
  brewer: 'V60 02',
});

export function RecipeScreen() {
  const recipes = useRecipes();
  const beans = useBeans();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const beanId = beans[0]?.id ?? 'bean_default';
  const canSave = draft.name.trim() !== '' && draft.doseG !== undefined && draft.totalWaterG !== undefined;

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
      totalWaterG: draft.totalWaterG ?? 0,
      targetBeverageG: TARGET_BEVERAGE_G,
      brewer: draft.brewer,
      filter: '',
      pours: [],
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
              label="湯量"
              suffix="g"
              step={1}
              min={0}
              value={draft.totalWaterG}
              onChange={(totalWaterG) => setDraft({ ...draft, totalWaterG })}
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
                <th>湯温</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((recipe) => (
                <tr key={recipe.id}>
                  <td>{recipe.name}</td>
                  <td className="mono">{recipe.doseG}g</td>
                  <td className="mono">{recipe.totalWaterG}g</td>
                  <td className="mono">{recipe.waterTempC}℃</td>
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
