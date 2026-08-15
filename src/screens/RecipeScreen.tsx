import { useEffect, useRef, useState } from 'react';
import { Banner, Card, Field, formatSeconds } from '../ui/components';
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

/** 長押しの連続増減が始まるまでの待ち時間と、その後の間隔（ms）。 */
const HOLD_DELAY_MS = 380;
const HOLD_INTERVAL_MS = 70;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** −/＋ を押しっぱなしにしたら連続で刻む。 */
function useHold(step: () => void) {
  const latest = useRef(step);
  latest.current = step;
  const timers = useRef<{ delay?: number; repeat?: number }>({});

  const stop = () => {
    if (timers.current.delay !== undefined) window.clearTimeout(timers.current.delay);
    if (timers.current.repeat !== undefined) window.clearInterval(timers.current.repeat);
    timers.current = {};
  };

  useEffect(() => stop, []);

  const start = () => {
    stop();
    latest.current();
    timers.current.delay = window.setTimeout(() => {
      timers.current.repeat = window.setInterval(() => latest.current(), HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  };

  return { start, stop };
}

function StepButton({
  label,
  glyph,
  disabled,
  onStep,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onStep: () => void;
}) {
  const hold = useHold(onStep);
  return (
    <button
      className="num-step"
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        hold.start();
      }}
      onPointerUp={hold.stop}
      onPointerLeave={hold.stop}
      onPointerCancel={hold.stop}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onStep();
      }}
    >
      {glyph}
    </button>
  );
}

/**
 * 大きな数値の左右に −/＋ を置いた1行。−/＋ は1刻み（長押しで連続）で、数値はキーボード直接入力もできる。
 */
function NumberStepper({
  label,
  unit,
  value,
  onChange,
  min = 0,
  max = 999,
  note,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  /** 数値の下に出す短い補足（差分など）。 */
  note?: string;
}) {
  const shown = value ?? min;
  const nudge = (direction: 1 | -1) => onChange(clamp(Math.round(shown) + direction, min, max));

  return (
    <div className="num-row">
      <div className="num-row-head">
        <span className="num-row-label">{label}</span>
        {note === undefined ? null : <span className="num-row-note mono">{note}</span>}
      </div>
      <div className="num-row-body">
        <StepButton label={`${label}を1${unit}減らす`} glyph="−" disabled={shown <= min} onStep={() => nudge(-1)} />
        <label className="num-row-input">
          <input
            className="mono"
            type="number"
            inputMode="numeric"
            step={1}
            min={min}
            max={max}
            value={value ?? ''}
            aria-label={`${label}（${unit}）`}
            onChange={(event) => {
              const raw = event.target.value;
              onChange(raw === '' ? undefined : clamp(Number(raw), min, max));
            }}
          />
          <span className="num-row-unit">{unit}</span>
        </label>
        <StepButton label={`${label}を1${unit}増やす`} glyph="＋" disabled={shown >= max} onStep={() => nudge(1)} />
      </div>
    </div>
  );
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

export function RecipeScreen() {
  const recipes = useRecipes();
  const beans = useBeans();
  const defaults = useSettings().recipeDefaults;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(DEFAULT_SETTINGS.recipeDefaults));
  const [sheet, setSheet] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | undefined>(undefined);
  const editing = sheet?.mode === 'edit' ? recipes.find((recipe) => recipe.id === sheet.id) : undefined;

  // シートを開いている間は背面をスクロールさせない。Esc でも閉じられるようにする。
  useEffect(() => {
    if (sheet === undefined) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheet(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [sheet]);

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
    return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}g`;
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

  function openCreate() {
    setDraft(emptyDraft(defaults));
    setSheet({ mode: 'create' });
  }

  function openEdit(recipe: Recipe) {
    setDraft(draftOf(recipe));
    setSheet({ mode: 'edit', id: recipe.id });
  }

  async function save() {
    if (!canSave) return;
    const recipe: Recipe = {
      id: editing?.id ?? uid('recipe'),
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
    setSheet(undefined);
  }

  return (
    <>
      <Card title="レシピ">
        {recipes.length === 0 ? (
          <Banner>まだレシピがありません。</Banner>
        ) : (
          <ul className="recipe-rows">
            <li className="recipe-rows-head" aria-hidden="true">
              <span />
              <span>豆</span>
              <span>湯</span>
              <span>落ち切り</span>
            </li>
            {recipes.map((recipe) => (
              <li key={recipe.id}>
                <button className="recipe-row" type="button" onClick={() => openEdit(recipe)}>
                  <span className="recipe-row-name">{recipe.name}</span>
                  <span className="mono">{recipe.doseG}g</span>
                  <span className="mono">{recipe.totalWaterG}g</span>
                  <span className="mono">{recipe.finishSec === undefined ? '—' : formatSeconds(recipe.finishSec)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <button className="fab" type="button" aria-label="レシピを追加" onClick={openCreate}>
        ＋
      </button>

      {sheet === undefined ? null : (
        <div className="sheet-scrim" onClick={() => setSheet(undefined)}>
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? 'レシピを編集' : 'レシピを追加'}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="sheet-head">
              <button className="sheet-head-cancel" type="button" onClick={() => setSheet(undefined)}>
                キャンセル
              </button>
              <h2>{editing ? '編集' : '新規'}</h2>
              <button className="sheet-head-save" type="button" disabled={!canSave} onClick={() => void save()}>
                保存
              </button>
            </header>

            <div className="sheet-body">
              <Field label="レシピ名">
                <input
                  value={draft.name}
                  placeholder="例: 中細 92℃ 1:16"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>

              <NumberStepper
                label="粉量"
                unit="g"
                min={0}
                max={200}
                value={draft.doseG}
                onChange={(doseG) => setDraft({ ...draft, doseG })}
              />
              <NumberStepper
                label="初期湯温"
                unit="℃"
                min={0}
                max={100}
                value={draft.waterTempC}
                onChange={setInitialTemp}
              />

              <div className="row">
                <Field label="挽き目">
                  <input
                    value={draft.grindSetting}
                    placeholder="例: 中細 / 18"
                    onChange={(event) => setDraft({ ...draft, grindSetting: event.target.value })}
                  />
                </Field>
                <Field label="ドリッパー">
                  <input value={draft.brewer} onChange={(event) => setDraft({ ...draft, brewer: event.target.value })} />
                </Field>
              </div>

              <div className="sheet-section">
                <p className="sheet-section-title">注湯</p>
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
                        <NumberStepper
                          label="累計湯量"
                          unit="g"
                          min={0}
                          max={2000}
                          note={deltaOf(index)}
                          value={pour.targetG}
                          onChange={(targetG) => setPour(index, { targetG })}
                        />
                        <NumberStepper
                          label="開始"
                          unit="秒"
                          min={0}
                          max={1800}
                          note={pour.atSec === undefined ? undefined : formatSeconds(pour.atSec)}
                          value={pour.atSec}
                          onChange={(atSec) => setPour(index, { atSec })}
                        />
                        <NumberStepper
                          label="湯温"
                          unit="℃"
                          min={0}
                          max={100}
                          value={pour.waterTempC}
                          onChange={(waterTempC) => setPour(index, { waterTempC })}
                        />
                      </div>
                    </li>
                  ))}
                  <li className="pour-node pour-node-last">
                    <div className="pour-node-axis">
                      <span className="pour-node-badge ghost">＋</span>
                    </div>
                    <button className="pour-node-add" type="button" onClick={addPour}>
                      ＋ 投を追加
                    </button>
                  </li>
                </ol>
                <p className="pour-timeline-total">
                  <span className="muted">総湯量</span>
                  <strong className="mono">{totalWaterG}g</strong>
                </p>
              </div>

              <NumberStepper
                label="抽出終了"
                unit="秒"
                min={0}
                max={1800}
                note={draft.finishSec === undefined ? undefined : formatSeconds(draft.finishSec)}
                value={draft.finishSec}
                onChange={(finishSec) => setDraft({ ...draft, finishSec })}
              />

              {editing === undefined ? null : (
                <button
                  className="danger sheet-delete"
                  type="button"
                  onClick={() => {
                    void deleteRecipe(editing.id);
                    setSheet(undefined);
                  }}
                >
                  このレシピを削除
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
