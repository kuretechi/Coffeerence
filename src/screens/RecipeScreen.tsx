import { useEffect, useState } from 'react';
import { Banner, Field, NumberField, formatSeconds } from '../ui/components';
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

/** ツールバーを固定する位置。上に重なっているアプリヘッダーの高さぶん下げる。 */
function useStickyHeaderHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const header = document.querySelector('.app-header');
    if (header === null) return;
    const observer = new ResizeObserver(() => setHeight(header.getBoundingClientRect().height));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return height;
}

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const headerHeight = useStickyHeaderHeight();
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
    setSheetOpen(true);
  }

  function cancelEdit() {
    setEditingId(undefined);
    setDraft(emptyDraft(defaults));
    setSheetOpen(false);
  }

  function startCreate() {
    setEditingId(undefined);
    setDraft(emptyDraft(defaults));
    setSheetOpen(true);
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
    setSheetOpen(false);
  }

  const form = (
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
  );

  return (
    <div className="recipe-dense">
      <div className="recipe-dense-toolbar" style={{ top: headerHeight }}>
        <button className="primary" type="button" onClick={startCreate}>
          新規レシピ
        </button>
        <span className="muted mono">{recipes.length}件</span>
      </div>

      {recipes.length === 0 ? (
        <Banner>まだレシピがありません。</Banner>
      ) : (
        <div className="recipe-dense-list">
          <div className="recipe-dense-line recipe-dense-head" aria-hidden="true">
            <span>レシピ名</span>
            <span>粉量</span>
            <span>湯温</span>
            <span>総湯量</span>
            <span>時間</span>
          </div>
          {recipes.map((recipe) => (
            <div
              key={recipe.id}
              className={openId === recipe.id ? 'recipe-dense-row selected' : 'recipe-dense-row'}
            >
              <button
                className="recipe-dense-line"
                type="button"
                aria-expanded={openId === recipe.id}
                onClick={() => setOpenId(openId === recipe.id ? undefined : recipe.id)}
              >
                <span className="recipe-dense-name">{recipe.name}</span>
                <span className="mono">{recipe.doseG}g</span>
                <span className="mono">{recipe.waterTempC}℃</span>
                <span className="mono">{recipe.totalWaterG}g</span>
                <span className="mono">
                  {recipe.finishSec === undefined ? '—' : formatSeconds(recipe.finishSec)}
                </span>
              </button>

              {openId === recipe.id ? (
                <div className="recipe-dense-detail">
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
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {sheetOpen ? (
        <>
          <button className="recipe-dense-scrim" type="button" aria-label="閉じる" onClick={cancelEdit} />
          <div
            className="recipe-dense-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? `レシピ編集: ${editing.name}` : 'レシピ登録'}
          >
            <div className="recipe-dense-sheet-head">
              <strong>{editing ? `レシピ編集: ${editing.name}` : 'レシピ登録'}</strong>
              <button className="recipe-dense-close" type="button" aria-label="閉じる" onClick={cancelEdit}>
                ×
              </button>
            </div>
            <p className="recipe-dense-hint">淹れる条件を登録します。タイマーで計測するときにここから選びます。</p>
            {form}
          </div>
        </>
      ) : null}
    </div>
  );
}
