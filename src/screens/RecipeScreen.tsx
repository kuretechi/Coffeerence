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
  finishSec: number | undefined;
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

/** 既存レシピを編集フォームの下書きに変換する。 */
const draftOf = (recipe: Recipe): Draft => ({
  name: recipe.name,
  grindSetting: recipe.grindSetting,
  doseG: recipe.doseG,
  waterTempC: recipe.waterTempC,
  brewer: recipe.brewer,
  pours: recipe.pours.map((pour) => ({
    targetG: pour.targetG,
    atSec: pour.startSec,
    waterTempC: pour.waterTempC ?? recipe.waterTempC,
  })),
  finishSec: recipe.finishSec,
});

const emptyDraft = (defaults: RecipeDefaults): Draft => ({
  name: '',
  grindSetting: defaults.grindSetting,
  doseG: defaults.doseG,
  waterTempC: defaults.waterTempC,
  brewer: defaults.brewer,
  pours: presetPours(defaults),
  finishSec: PRESET_INTERVAL_SEC * 2 + 90,
});

/** レシピ名をタップしたときに開く抽出条件の内訳。 */
function RecipeDetail({ recipe }: { recipe: Recipe }) {
  return (
    <dl className="brew-detail">
      <dt>粉量 / 総湯量</dt>
      <dd className="mono">
        {recipe.doseG}g / {recipe.totalWaterG}g
      </dd>
      <dt>挽き目 / ドリッパー</dt>
      <dd>
        {recipe.grindSetting || '—'} / {recipe.brewer || '—'}
      </dd>
      <dt>初期湯温</dt>
      <dd className="mono">{recipe.waterTempC}℃</dd>
      <dt>注湯</dt>
      <dd className="mono">
        {recipe.pours.length === 0
          ? '—'
          : recipe.pours
              .map(
                (pour) =>
                  `${formatSeconds(pour.startSec)} 累計${pour.targetG}g ${pour.waterTempC ?? recipe.waterTempC}℃`,
              )
              .join(' / ')}
      </dd>
      <dt>抽出終了</dt>
      <dd className="mono">{recipe.finishSec === undefined ? '—' : formatSeconds(recipe.finishSec)}</dd>
    </dl>
  );
}

export function RecipeScreen() {
  const recipes = useRecipes();
  const beans = useBeans();
  const defaults = useSettings().recipeDefaults;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(DEFAULT_SETTINGS.recipeDefaults));
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const editing = recipes.find((recipe) => recipe.id === editingId);

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

  /** 累計湯量の差分＝その投で実際に注ぐ量。表示専用。 */
  function deltaOf(index: number): string | undefined {
    const current = draft.pours[index]?.targetG;
    const previous = index === 0 ? 0 : draft.pours[index - 1]?.targetG;
    if (current === undefined || previous === undefined) return undefined;
    const delta = Math.round((current - previous) * 10) / 10;
    return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}`;
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

  function startEdit(recipe: Recipe) {
    setEditingId(recipe.id);
    setDraft(draftOf(recipe));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(undefined);
    setDraft(emptyDraft(defaults));
  }

  async function add() {
    if (!canSave) return;
    const recipe: Recipe = {
      id: editingId ?? uid('recipe'),
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
      finishSec: draft.finishSec,
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };
    await saveRecipe(recipe);
    setEditingId(undefined);
    setDraft(emptyDraft(defaults));
  }

  return (
    <>
      <Card
        title={editing ? `レシピ編集: ${editing.name}` : 'レシピ登録'}
        hint="淹れる条件を登録します。タイマーで計測するときにここから選びます。"
      >
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
          <fieldset className="pour-timeline">
            <legend>注湯（上から下へ時間が流れます）</legend>
            <ol className="pour-timeline-list">
              {draft.pours.map((pour, index) => (
                <li className="pour-node" key={index}>
                  <div className="pour-node-axis">
                    <span className="pour-node-badge">{index + 1}</span>
                    <span className="pour-node-time mono">
                      {pour.atSec === undefined ? '—' : formatSeconds(pour.atSec)}
                    </span>
                  </div>
                  <div className="pour-node-card">
                    <button
                      className="pour-node-remove"
                      type="button"
                      aria-label={`${index + 1}投目を削除`}
                      disabled={draft.pours.length <= 1}
                      onClick={() => removePour(index)}
                    >
                      ×
                    </button>
                    <label className="pour-node-total">
                      <span className="pour-node-total-label">累計湯量</span>
                      <span className="pour-node-total-input">
                        <input
                          type="number"
                          inputMode="decimal"
                          step={1}
                          min={0}
                          value={pour.targetG ?? ''}
                          onChange={(event) => {
                            const raw = event.target.value;
                            setPour(index, { targetG: raw === '' ? undefined : Number(raw) });
                          }}
                        />
                        <span className="pour-node-unit">g</span>
                      </span>
                    </label>
                    <p className="pour-node-delta mono">
                      この投 {deltaOf(index) === undefined ? '—' : `${deltaOf(index)}g`}
                    </p>
                    <div className="pour-node-sub">
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
                    </div>
                  </div>
                </li>
              ))}
              <li className="pour-node pour-node-last">
                <div className="pour-node-axis">
                  <span className="pour-node-badge ghost">＋</span>
                </div>
                <button className="pour-node-add" type="button" onClick={addPour}>
                  ＋ この投を追加
                </button>
              </li>
            </ol>
            <p className="pour-timeline-total">
              <span className="muted">総湯量</span>
              <strong className="mono">{totalWaterG}g</strong>
            </p>
          </fieldset>
          <NumberField
            label="抽出終了（落ち切り）"
            suffix="秒"
            step={5}
            min={0}
            value={draft.finishSec}
            onChange={(finishSec) => setDraft({ ...draft, finishSec })}
          />
          <div className="row">
            <button className="primary" type="button" disabled={!canSave} onClick={() => void add()}>
              {editing ? 'レシピを更新' : 'レシピを登録'}
            </button>
            {editing ? (
              <button type="button" onClick={cancelEdit}>
                編集をやめる
              </button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card title="登録済みレシピ" hint="レシピ名をタップすると詳細が見られます。">
        {recipes.length === 0 ? (
          <Banner>まだレシピがありません。</Banner>
        ) : (
          <div className="stack">
            {recipes.map((recipe) => (
              <div key={recipe.id} className="todo-item recipe-item">
                <button
                  className="log-summary"
                  type="button"
                  aria-expanded={openId === recipe.id}
                  onClick={() => setOpenId(openId === recipe.id ? undefined : recipe.id)}
                >
                  <strong>{recipe.name}</strong>
                </button>

                {openId === recipe.id ? (
                  <>
                    <RecipeDetail recipe={recipe} />
                    <div className="row">
                      <button type="button" onClick={() => startEdit(recipe)}>
                        編集
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => {
                          if (recipe.id === editingId) cancelEdit();
                          void deleteRecipe(recipe.id);
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
