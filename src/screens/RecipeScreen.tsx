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

/** 1投を丸めて表示する。未入力なら「—」。 */
const showG = (value: number | undefined) => (value === undefined ? '—' : `${value}g`);

/** 直前の投との差分＝その投で実際に注ぐ量。 */
function pourDeltaG(pours: DraftPour[], index: number): number | undefined {
  const current = pours[index]?.targetG;
  if (current === undefined) return undefined;
  const previous = pours
    .slice(0, index)
    .map((pour) => pour.targetG)
    .filter((value): value is number => value !== undefined)
    .pop();
  return Math.max(0, current - (previous ?? 0));
}

/** 総湯量に対する各投の比率を示す横バー。 */
function PourBar({ pours, totalWaterG }: { pours: DraftPour[]; totalWaterG: number }) {
  const segments = pours.map((_, index) => pourDeltaG(pours, index) ?? 0);
  const sum = segments.reduce((acc, value) => acc + value, 0);
  const label =
    sum === 0
      ? '注湯の配分はまだありません'
      : `総湯量${totalWaterG}gの配分: ${segments.map((value, index) => `${index + 1}投目${value}g`).join('、')}`;
  return (
    <div className="pour-bar" role="img" aria-label={label}>
      {sum === 0 ? (
        <span className="pour-bar-empty" />
      ) : (
        segments.map((value, index) => (
          <span
            key={index}
            className="pour-bar-seg"
            style={{ flexGrow: value, opacity: 1 - Math.min(index, 4) * 0.15 }}
          />
        ))
      )}
    </div>
  );
}

/** 1投の詳細をまとめて編集するボトムシート。 */
function PourSheet({
  index,
  pour,
  deltaG,
  canRemove,
  onChange,
  onRemove,
  onClose,
}: {
  index: number;
  pour: DraftPour;
  deltaG: number | undefined;
  canRemove: boolean;
  onChange: (patch: Partial<DraftPour>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="pour-sheet-backdrop" onClick={onClose}>
      <div
        className="pour-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${index + 1}投目の設定`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="row between">
          <strong>{index + 1}投目</strong>
          <button className="pour-sheet-close" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted pour-sheet-note">
          この投で注ぐ量 <span className="mono">{showG(deltaG)}</span>（累計から自動計算）
        </p>
        <div className="stack">
          <NumberField
            label="累計"
            suffix="g"
            step={1}
            min={0}
            value={pour.targetG}
            onChange={(targetG) => onChange({ targetG })}
          />
          <NumberField
            label="開始"
            suffix="秒"
            step={5}
            min={0}
            value={pour.atSec}
            onChange={(atSec) => onChange({ atSec })}
          />
          <NumberField
            label="湯温"
            suffix="℃"
            step={1}
            min={0}
            value={pour.waterTempC}
            onChange={(waterTempC) => onChange({ waterTempC })}
          />
        </div>
        <div className="row pour-sheet-actions">
          <button className="primary" type="button" onClick={onClose}>
            完了
          </button>
          <button className="danger" type="button" disabled={!canRemove} onClick={onRemove}>
            この投を削除
          </button>
        </div>
      </div>
    </div>
  );
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
  const [sheetIndex, setSheetIndex] = useState<number | undefined>(undefined);
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
    setSheetIndex(undefined);
  }

  /** 追加した投はそのままシートで詳細を詰められるようにする。 */
  function addPourAndEdit() {
    addPour();
    setSheetIndex(draft.pours.length);
  }

  function startEdit(recipe: Recipe) {
    setEditingId(recipe.id);
    setSheetIndex(undefined);
    setDraft(draftOf(recipe));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(undefined);
    setSheetIndex(undefined);
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
    setSheetIndex(undefined);
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
          <fieldset className="pour-editor">
            <legend>注湯（タップして1投ずつ編集）</legend>
            <div className="stack">
              <PourBar pours={draft.pours} totalWaterG={totalWaterG} />
              <ul className="pour-list">
                {draft.pours.map((pour, index) => (
                  <li className="pour-card" key={index}>
                    <button
                      className="pour-card-open"
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setSheetIndex(index)}
                    >
                      <span className="pour-card-no">{index + 1}</span>
                      <span className="pour-card-time mono">
                        {pour.atSec === undefined ? '—' : formatSeconds(pour.atSec)}
                      </span>
                      <span className="pour-card-delta mono">
                        {pourDeltaG(draft.pours, index) === undefined ? '—' : `+${pourDeltaG(draft.pours, index)}g`}
                      </span>
                      <span className="pour-card-meta mono">
                        累計 {showG(pour.targetG)} / {pour.waterTempC ?? '—'}℃
                      </span>
                    </button>
                    <button
                      className="pour-card-remove"
                      type="button"
                      aria-label={`${index + 1}投目を削除`}
                      disabled={draft.pours.length <= 1}
                      onClick={() => removePour(index)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="row between">
                <button type="button" onClick={addPourAndEdit}>
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

      {sheetIndex !== undefined && draft.pours[sheetIndex] ? (
        <PourSheet
          index={sheetIndex}
          pour={draft.pours[sheetIndex]}
          deltaG={pourDeltaG(draft.pours, sheetIndex)}
          canRemove={draft.pours.length > 1}
          onChange={(patch) => setPour(sheetIndex, patch)}
          onRemove={() => removePour(sheetIndex)}
          onClose={() => setSheetIndex(undefined)}
        />
      ) : null}
    </>
  );
}
