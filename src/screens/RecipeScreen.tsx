import { useEffect, useRef, useState } from 'react';
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

/** バーで境界をドラッグするときに、隣の投との間に必ず残す湯量。 */
const MIN_SEGMENT_G = 1;

type RatioPreset = 'even' | 'front' | 'back';

/** 配分プリセットの重み。前多め＝先の投を厚く、後多め＝後の投を厚く。 */
function presetWeights(preset: RatioPreset, count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    if (preset === 'even') return 1;
    return preset === 'front' ? count - index : index + 1;
  });
}

/** 重みと総湯量から累計湯量の列を作る。最後は必ず総湯量に一致させる。 */
function cumulativeFromWeights(weights: readonly number[], totalG: number): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  let running = 0;
  return weights.map((weight, index) => {
    running += weight;
    return index === weights.length - 1 ? totalG : Math.round((totalG * running) / sum);
  });
}

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
  const [draggingBoundary, setDraggingBoundary] = useState<number | undefined>(undefined);
  const barRef = useRef<HTMLDivElement | null>(null);
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

  /** 追加した投にも配分を分けるため、最後の投を半分に割ってから足す（総湯量は保つ）。 */
  function addPour() {
    const pours = draft.pours;
    const last = pours[pours.length - 1];
    const previous = pours.length >= 2 ? pours[pours.length - 2]?.targetG : 0;
    const splitG =
      last?.targetG === undefined || previous === undefined ? undefined : Math.round((previous + last.targetG) / 2);
    const appended: DraftPour = {
      targetG: last?.targetG,
      atSec: last?.atSec === undefined ? undefined : last.atSec + PRESET_INTERVAL_SEC,
      waterTempC: draft.waterTempC,
    };
    setDraft({
      ...draft,
      pours: [
        ...pours.map((pour, index) =>
          index === pours.length - 1 && splitG !== undefined ? { ...pour, targetG: splitG } : pour,
        ),
        appended,
      ],
    });
  }

  function removePour(index: number) {
    setDraft({ ...draft, pours: draft.pours.filter((_, i) => i !== index) });
  }

  /** 総湯量を変えたら、いまの配分比率を保ったまま各投の累計湯量を伸縮させる。 */
  function setTotalWater(next: number | undefined) {
    const pours = draft.pours;
    const lastIndex = pours.length - 1;
    if (lastIndex < 0) return;
    if (next === undefined) {
      setPour(lastIndex, { targetG: undefined });
      return;
    }
    const scalable = totalWaterG > 0 && pours.every((pour) => pour.targetG !== undefined);
    setDraft({
      ...draft,
      pours: pours.map((pour, index) => {
        if (index === lastIndex) return { ...pour, targetG: next };
        const scaled = scalable
          ? Math.round(((pour.targetG ?? 0) * next) / totalWaterG)
          : Math.round((next * (index + 1)) / pours.length);
        return { ...pour, targetG: scaled };
      }),
    });
  }

  /** プリセット比率をいまの投数に当てて、総湯量はそのままで配分だけ作り直す。 */
  function applyPreset(preset: RatioPreset) {
    if (totalWaterG <= 0) return;
    const applied = cumulativeFromWeights(presetWeights(preset, draft.pours.length), totalWaterG);
    setDraft({ ...draft, pours: draft.pours.map((pour, index) => ({ ...pour, targetG: applied[index] })) });
  }

  /** バーの境界（index 投目と index+1 投目の間）を動かす。隣を追い越さないように丸める。 */
  function moveBoundary(index: number, targetG: number) {
    const lower = (index === 0 ? 0 : draft.pours[index - 1]?.targetG ?? 0) + MIN_SEGMENT_G;
    const upper = (draft.pours[index + 1]?.targetG ?? totalWaterG) - MIN_SEGMENT_G;
    if (upper < lower) return;
    setPour(index, { targetG: Math.min(Math.max(Math.round(targetG), lower), upper) });
  }

  function boundaryFromClientX(index: number, clientX: number) {
    const rect = barRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0) return;
    moveBoundary(index, ((clientX - rect.left) / rect.width) * totalWaterG);
  }

  const cumulative = draft.pours.map((pour) => pour.targetG);
  // 累計湯量がすべて入っていて単調増加のときだけ、バーで配分を編集できる。
  const barReady =
    totalWaterG > 0 &&
    cumulative.length > 0 &&
    cumulative.every(
      (value, index) => value !== undefined && value >= (index === 0 ? 0 : cumulative[index - 1] ?? 0),
    ) &&
    cumulative[cumulative.length - 1] === totalWaterG;
  const deltas = draft.pours.map((pour, index) => (pour.targetG ?? 0) - (index === 0 ? 0 : cumulative[index - 1] ?? 0));

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
          <fieldset className="pour-ratio">
            <legend>注湯（バーで配分・カードで微調整）</legend>
            <div className="pour-ratio-head">
              <NumberField
                label="総湯量"
                suffix="g"
                step={5}
                min={0}
                value={draft.pours[draft.pours.length - 1]?.targetG}
                onChange={setTotalWater}
              />
              <div className="pour-ratio-presets" role="group" aria-label="配分プリセット">
                {(
                  [
                    ['even', '均等'],
                    ['front', '前多め'],
                    ['back', '後多め'],
                  ] as const
                ).map(([preset, label]) => (
                  <button key={preset} type="button" disabled={totalWaterG <= 0} onClick={() => applyPreset(preset)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {barReady ? (
              <div className="pour-ratio-bar-wrap">
                <div className="pour-ratio-bar" ref={barRef}>
                  {draft.pours.map((_pour, index) => (
                    <div className="pour-ratio-seg" key={index} style={{ flexGrow: Math.max(deltas[index] ?? 0, 0) }}>
                      {/* 細いセグメントに番号を書くとつまみと重なるので、下の凡例に任せる。 */}
                      {(deltas[index] ?? 0) / totalWaterG >= 0.12 ? (
                        <span className="pour-ratio-seg-label mono">{index + 1}</span>
                      ) : null}
                    </div>
                  ))}
                  {draft.pours.slice(0, -1).map((pour, index) => (
                    <div
                      className={`pour-ratio-handle${draggingBoundary === index ? ' dragging' : ''}`}
                      key={index}
                      role="slider"
                      tabIndex={0}
                      aria-label={`${index + 1}投目と${index + 2}投目の境界（累計湯量）`}
                      aria-valuemin={0}
                      aria-valuemax={totalWaterG}
                      aria-valuenow={pour.targetG ?? 0}
                      aria-valuetext={`${pour.targetG ?? 0}g`}
                      style={{ left: `${((pour.targetG ?? 0) / totalWaterG) * 100}%` }}
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setDraggingBoundary(index);
                      }}
                      onPointerMove={(event) => {
                        if (draggingBoundary !== index) return;
                        boundaryFromClientX(index, event.clientX);
                      }}
                      onPointerUp={() => setDraggingBoundary(undefined)}
                      onPointerCancel={() => setDraggingBoundary(undefined)}
                      onKeyDown={(event) => {
                        const step = event.key === 'PageUp' || event.key === 'PageDown' ? 5 : 1;
                        const sign =
                          event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown'
                            ? -1
                            : event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp'
                              ? 1
                              : 0;
                        if (sign === 0) return;
                        event.preventDefault();
                        moveBoundary(index, (pour.targetG ?? 0) + sign * step);
                      }}
                    >
                      <span className="pour-ratio-handle-grip" aria-hidden="true" />
                    </div>
                  ))}
                </div>
                <ol className="pour-ratio-legend">
                  {draft.pours.map((_pour, index) => (
                    <li key={index}>
                      <span className="pour-ratio-legend-no mono">{index + 1}</span>
                      <span className="mono">{deltaOf(index) === undefined ? '—' : `${deltaOf(index)}g`}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="pour-ratio-hint">
                累計湯量を小さい順にすべて入れると、バーで配分を編集できます。総湯量は最後の投の累計湯量です。
              </p>
            )}

            <ol className="pour-ratio-list">
              {draft.pours.map((pour, index) => (
                <li className="pour-ratio-card" key={index}>
                  <div className="pour-ratio-card-head">
                    <span className="pour-ratio-card-badge mono">{index + 1}</span>
                    <span className="pour-ratio-card-delta mono">
                      {pour.atSec === undefined ? '—' : formatSeconds(pour.atSec)} / この投{' '}
                      {deltaOf(index) === undefined ? '—' : `${deltaOf(index)}g`}
                    </span>
                    <button
                      className="pour-ratio-remove"
                      type="button"
                      aria-label={`${index + 1}投目を削除`}
                      disabled={draft.pours.length <= 1}
                      onClick={() => removePour(index)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="pour-ratio-card-body">
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
                  </div>
                </li>
              ))}
            </ol>
            <button className="pour-ratio-add" type="button" onClick={addPour}>
              ＋ 投を追加
            </button>
            <p className="pour-ratio-total">
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
