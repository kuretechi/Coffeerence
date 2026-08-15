import { Fragment, useEffect, useState } from 'react';
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

/** 投カードの高さ（px）。時間軸の縮尺を決めるのに使うので CSS 側と揃える。 */
const CARD_H = 132;
const CARD_GAP = 8;
const MIN_PX_PER_SEC = 1.1;
const MAX_PX_PER_SEC = 4;
/** ドラッグでの開始秒のスナップ幅。 */
const DRAG_SNAP_SEC = 5;
const TICK_STEPS_SEC = [15, 30, 60, 120, 300];

interface Scale {
  /** 1秒あたりの表示px。 */
  pxPerSec: number;
  /** 軸の終端（秒）。 */
  endSec: number;
  /** 目盛りの間隔（秒）。 */
  tickSec: number;
  /** 各投の「実時間の位置」（秒）。未入力なら直前から推定する。 */
  atSecs: number[];
  /** 各投カードの実際の表示位置（px）。重なるときだけ下にずらす。 */
  tops: number[];
  height: number;
}

/**
 * 投の開始秒から時間軸の縮尺とカード位置を決める。
 * 投が詰まっていてカードが重なる場合だけ、カードを下へ逃がす（軸のドットは実時間のまま）。
 */
function scaleOf(pours: DraftPour[], finishSec: number | undefined): Scale {
  const atSecs: number[] = [];
  pours.forEach((pour, index) => {
    const previous = index === 0 ? 0 : atSecs[index - 1];
    atSecs.push(pour.atSec ?? previous + PRESET_INTERVAL_SEC);
  });
  const lastSec = atSecs[atSecs.length - 1] ?? 0;
  const endSec = Math.max(finishSec ?? 0, lastSec + 30, 60);

  let needed = MIN_PX_PER_SEC;
  atSecs.forEach((sec, index) => {
    if (index === 0) return;
    const gap = sec - atSecs[index - 1];
    if (gap > 0) needed = Math.max(needed, (CARD_H + CARD_GAP) / gap);
  });
  const pxPerSec = Math.min(MAX_PX_PER_SEC, needed);

  const tops: number[] = [];
  atSecs.forEach((sec, index) => {
    const ideal = sec * pxPerSec;
    const floor = index === 0 ? 0 : tops[index - 1] + CARD_H + CARD_GAP;
    tops.push(Math.max(ideal, floor));
  });

  const tickSec = TICK_STEPS_SEC.find((step) => step * pxPerSec >= 44) ?? TICK_STEPS_SEC[TICK_STEPS_SEC.length - 1];
  const lastBottom = (tops[tops.length - 1] ?? 0) + CARD_H;
  return { pxPerSec, endSec, tickSec, atSecs, tops, height: Math.max(endSec * pxPerSec, lastBottom) + 16 };
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
  const [drag, setDrag] = useState<{ index: number; startY: number; startSec: number; pxPerSec: number } | undefined>(
    undefined,
  );
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
  const scale = scaleOf(draft.pours, draft.finishSec);
  const lastPourSec = scale.atSecs[scale.atSecs.length - 1] ?? 0;
  const ticks: number[] = [];
  for (let sec = 0; sec <= scale.endSec; sec += scale.tickSec) ticks.push(sec);
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

  /** 軸上のドラッグ量を秒に換算して開始秒を動かす。縮尺はドラッグ中固定して手元が跳ねないようにする。 */
  function dragTo(clientY: number) {
    if (drag === undefined) return;
    const moved = (clientY - drag.startY) / drag.pxPerSec;
    const sec = Math.max(0, Math.round((drag.startSec + moved) / DRAG_SNAP_SEC) * DRAG_SNAP_SEC);
    setPour(drag.index, { atSec: sec });
  }

  function nudgePour(index: number, deltaSec: number) {
    const current = draft.pours[index]?.atSec ?? scale.atSecs[index];
    setPour(index, { atSec: Math.max(0, current + deltaSec) });
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
          <fieldset className="pour-scale">
            <legend>注湯（左の目盛りは実際の経過時間）</legend>
            <p className="pour-scale-hint">カード左の握りを上下にドラッグ、または ± で開始時刻を動かせます。</p>
            <div
              className={drag === undefined ? 'pour-scale-track' : 'pour-scale-track dragging'}
              style={{ height: `${Math.round(scale.height)}px` }}
              onPointerMove={(event) => dragTo(event.clientY)}
              onPointerUp={() => setDrag(undefined)}
              onPointerCancel={() => setDrag(undefined)}
            >
              <div className="pour-scale-ruler" aria-hidden="true">
                {ticks.map((sec) => (
                  <span className="pour-scale-tick mono" key={sec} style={{ top: `${sec * scale.pxPerSec}px` }}>
                    {formatSeconds(sec)}
                  </span>
                ))}
              </div>
              {draft.finishSec === undefined || draft.finishSec <= lastPourSec ? null : (
                <div
                  className="pour-scale-drawdown"
                  aria-hidden="true"
                  style={{
                    top: `${lastPourSec * scale.pxPerSec}px`,
                    height: `${(draft.finishSec - lastPourSec) * scale.pxPerSec}px`,
                  }}
                >
                  <span>落ち切り待ち</span>
                </div>
              )}
              {draft.finishSec === undefined ? null : (
                <div className="pour-scale-finish" style={{ top: `${draft.finishSec * scale.pxPerSec}px` }}>
                  <span className="mono">落ち切り {formatSeconds(draft.finishSec)}</span>
                </div>
              )}
              {draft.pours.map((pour, index) => {
                const atSec = scale.atSecs[index];
                const dotTop = atSec * scale.pxPerSec;
                const top = scale.tops[index];
                const shifted = top - dotTop > 1;
                return (
                  <Fragment key={index}>
                    <span className="pour-scale-dot" style={{ top: `${dotTop}px` }}>
                      {index + 1}
                    </span>
                    {shifted ? (
                      <span
                        className="pour-scale-leader"
                        aria-hidden="true"
                        style={{ top: `${dotTop}px`, height: `${top - dotTop}px` }}
                      />
                    ) : null}
                    <div className="pour-scale-card" style={{ top: `${top}px` }}>
                      <button
                        className="pour-scale-grip"
                        type="button"
                        aria-label={`${index + 1}投目の開始時刻をドラッグで変える（現在 ${formatSeconds(atSec)}）`}
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          setDrag({ index, startY: event.clientY, startSec: atSec, pxPerSec: scale.pxPerSec });
                        }}
                        onPointerMove={(event) => dragTo(event.clientY)}
                        onPointerUp={() => setDrag(undefined)}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowUp') nudgePour(index, -DRAG_SNAP_SEC);
                          if (event.key === 'ArrowDown') nudgePour(index, DRAG_SNAP_SEC);
                        }}
                      />
                      <button
                        className="pour-scale-remove"
                        type="button"
                        aria-label={`${index + 1}投目を削除`}
                        disabled={draft.pours.length <= 1}
                        onClick={() => removePour(index)}
                      >
                        ×
                      </button>
                      <div className="pour-scale-head">
                        <label className="pour-scale-total">
                          <span className="pour-scale-label">累計湯量</span>
                          <span className="pour-scale-total-input">
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
                            <span className="pour-scale-unit">g</span>
                          </span>
                        </label>
                        <NumberField
                          label="湯温"
                          suffix="℃"
                          step={1}
                          min={0}
                          value={pour.waterTempC}
                          onChange={(waterTempC) => setPour(index, { waterTempC })}
                        />
                      </div>
                      <div className="pour-scale-time">
                        <button
                          className="pour-scale-nudge"
                          type="button"
                          aria-label={`${index + 1}投目を5秒早める`}
                          onClick={() => nudgePour(index, -DRAG_SNAP_SEC)}
                        >
                          −
                        </button>
                        <label className="pour-scale-sec">
                          <span className="pour-scale-label">開始</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            step={5}
                            min={0}
                            value={pour.atSec ?? ''}
                            onChange={(event) => {
                              const raw = event.target.value;
                              setPour(index, { atSec: raw === '' ? undefined : Number(raw) });
                            }}
                          />
                        </label>
                        <button
                          className="pour-scale-nudge"
                          type="button"
                          aria-label={`${index + 1}投目を5秒遅らせる`}
                          onClick={() => nudgePour(index, DRAG_SNAP_SEC)}
                        >
                          ＋
                        </button>
                        <span className="pour-scale-delta mono">
                          {deltaOf(index) === undefined ? '—' : `${deltaOf(index)}g`}
                        </span>
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <button className="pour-scale-add" type="button" onClick={addPour}>
              ＋ この投を追加
            </button>
            <p className="pour-scale-total-row">
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
