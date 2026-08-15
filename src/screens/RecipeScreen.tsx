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

/** ホイールの1行分の高さ（px）。CSS の .wheel-item と揃える。 */
const ITEM_HEIGHT = 40;

/** ボトムシートを下に引いて閉じるしきい値（px）。 */
const CLOSE_DRAG_PX = 96;

type PourFieldKey = 'targetG' | 'atSec' | 'waterTempC';

interface WheelSpec {
  label: string;
  unit: string;
  /** ホイールの刻み。湯量・湯温は1刻み。 */
  step: number;
  min: number;
  max: number;
  format: (value: number) => string;
}

const POUR_SPECS: Record<PourFieldKey, WheelSpec> = {
  targetG: { label: '累計湯量', unit: 'g', step: 1, min: 0, max: 600, format: (v) => String(v) },
  atSec: { label: '開始', unit: '', step: 1, min: 0, max: 600, format: formatSeconds },
  waterTempC: { label: '湯温', unit: '℃', step: 1, min: 60, max: 100, format: (v) => String(v) },
};

const DOSE_SPEC: WheelSpec = { label: '粉量', unit: 'g', step: 1, min: 5, max: 80, format: (v) => String(v) };
const TEMP_SPEC: WheelSpec = { label: '初期湯温', unit: '℃', step: 1, min: 60, max: 100, format: (v) => String(v) };
const FINISH_SPEC: WheelSpec = { label: '抽出終了', unit: '', step: 1, min: 0, max: 900, format: formatSeconds };

const POUR_FIELDS: PourFieldKey[] = ['targetG', 'atSec', 'waterTempC'];

type Target =
  | { kind: 'doseG' }
  | { kind: 'waterTempC' }
  | { kind: 'finishSec' }
  | { kind: 'pour'; index: number; field: PourFieldKey };

const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind && (a.kind !== 'pour' || b.kind !== 'pour' || (a.index === b.index && a.field === b.field));

const clampToSpec = (spec: WheelSpec, value: number) => Math.min(spec.max, Math.max(spec.min, value));

const snapToSpec = (spec: WheelSpec, value: number) =>
  clampToSpec(spec, spec.min + Math.round((value - spec.min) / spec.step) * spec.step);

function valuesOf(spec: WheelSpec): number[] {
  const values: number[] = [];
  for (let value = spec.min; value <= spec.max; value += spec.step) values.push(Math.round(value * 100) / 100);
  return values;
}

/** ラベルと値を1行に並べたタップ領域。タップで下部ホイールの対象になる。 */
function ValueRow({
  label,
  value,
  unit,
  format,
  active,
  onSelect,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  format: (value: number) => string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={active ? 'value-row active' : 'value-row'} type="button" onClick={onSelect}>
      <span className="value-row-label">{label}</span>
      <span className="value-row-value mono">
        {value === undefined ? '—' : format(value)}
        {value === undefined || unit === '' ? null : <em className="value-row-unit">{unit}</em>}
      </span>
    </button>
  );
}

/**
 * シート下部に固定した iOS 風の縦ホイール。
 * 1刻みでスナップし、慣性スクロールで一気に送れる。−/＋ とキーボード入力も併置する。
 */
function WheelPicker({
  spec,
  value,
  onChange,
}: {
  spec: WheelSpec;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  // ホイールから出した値。自分が出した値でスクロール位置を戻して指と喧嘩しないようにする。
  const scrolledTo = useRef<number | undefined>(undefined);
  const [typed, setTyped] = useState<string | undefined>(undefined);

  useEffect(() => {
    const wheel = wheelRef.current;
    if (wheel === null || value === undefined) return;
    if (scrolledTo.current === value) return;
    wheel.scrollTop = ((clampToSpec(spec, value) - spec.min) / spec.step) * ITEM_HEIGHT;
    scrolledTo.current = value;
  }, [value, spec]);

  const shown = value ?? spec.min;
  const nudge = (direction: 1 | -1) => onChange(clampToSpec(spec, snapToSpec(spec, shown) + direction * spec.step));

  return (
    <div className="wheel">
      <div className="wheel-head">
        <span className="wheel-label">{spec.label}</span>
        <input
          className="wheel-input mono"
          type="number"
          inputMode="numeric"
          step={spec.step}
          min={spec.min}
          max={spec.max}
          aria-label={`${spec.label}を入力`}
          value={typed ?? (value === undefined ? '' : String(value))}
          onChange={(event) => {
            const raw = event.target.value;
            setTyped(raw);
            if (raw === '') return;
            const next = Number(raw);
            if (Number.isNaN(next)) return;
            onChange(clampToSpec(spec, next));
          }}
          onBlur={() => setTyped(undefined)}
        />
        <div className="wheel-steppers">
          <button
            className="wheel-step"
            type="button"
            aria-label={`${spec.label}を1${spec.unit || '秒'}減らす`}
            disabled={shown <= spec.min}
            onClick={() => nudge(-1)}
          >
            −
          </button>
          <button
            className="wheel-step"
            type="button"
            aria-label={`${spec.label}を1${spec.unit || '秒'}増やす`}
            disabled={shown >= spec.max}
            onClick={() => nudge(1)}
          >
            ＋
          </button>
        </div>
      </div>
      <div className="wheel-track">
        <div
          className="wheel-list"
          ref={wheelRef}
          role="slider"
          tabIndex={0}
          aria-label={spec.label}
          aria-valuemin={spec.min}
          aria-valuemax={spec.max}
          aria-valuenow={value}
          onScroll={(event) => {
            const index = Math.round(event.currentTarget.scrollTop / ITEM_HEIGHT);
            const next = clampToSpec(spec, spec.min + index * spec.step);
            if (next === value) return;
            scrolledTo.current = next;
            onChange(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
              event.preventDefault();
              nudge(1);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
              event.preventDefault();
              nudge(-1);
            }
          }}
        >
          {valuesOf(spec).map((item) => (
            <span className={item === value ? 'wheel-item current mono' : 'wheel-item mono'} key={item}>
              {spec.format(item)}
            </span>
          ))}
        </div>
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  // 下部ホイールがいま担当している数値。
  const [target, setTarget] = useState<Target>({ kind: 'pour', index: 0, field: 'targetG' });
  const [dragY, setDragY] = useState(0);
  const dragFrom = useRef<number | undefined>(undefined);
  const editing = recipes.find((recipe) => recipe.id === editingId);

  // 設定の初期値が読み込まれた（または変えられた）ら、閉じているフォームに反映させる。
  useEffect(() => {
    if (sheetOpen) return;
    setDraft(emptyDraft(defaults));
  }, [defaults.doseG, defaults.waterTempC, defaults.totalWaterG, defaults.grindSetting, defaults.brewer, sheetOpen]);

  const beanId = beans[0]?.id ?? 'bean_default';
  const filledPours = draft.pours.filter(
    (pour): pour is DraftPour & { targetG: number; atSec: number } =>
      pour.targetG !== undefined && pour.atSec !== undefined,
  );
  const totalWaterG = filledPours[filledPours.length - 1]?.targetG ?? 0;
  const canSave = draft.name.trim() !== '' && draft.doseG !== undefined && filledPours.length > 0;

  function setPour(index: number, patch: Partial<DraftPour>) {
    setDraft((current) => ({
      ...current,
      pours: current.pours.map((pour, i) => (i === index ? { ...pour, ...patch } : pour)),
    }));
  }

  /** 初期湯温を変えたら、個別に触っていない投の湯温も追従させる。 */
  function setInitialTemp(waterTempC: number) {
    setDraft((current) => ({
      ...current,
      waterTempC,
      pours: current.pours.map((pour) => (pour.waterTempC === current.waterTempC ? { ...pour, waterTempC } : pour)),
    }));
  }

  /** 累計湯量の差分＝その投で実際に注ぐ量。表示専用。 */
  function deltaOf(index: number): string | undefined {
    const current = draft.pours[index]?.targetG;
    const previous = index === 0 ? 0 : draft.pours[index - 1]?.targetG;
    if (current === undefined || previous === undefined) return undefined;
    const delta = Math.round((current - previous) * 10) / 10;
    return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}`;
  }

  /** 下部ホイールが担当する値と、その反映先。 */
  function wheelBinding(): { spec: WheelSpec; value: number | undefined; onChange: (value: number) => void } {
    if (target.kind === 'doseG') return { spec: DOSE_SPEC, value: draft.doseG, onChange: (doseG) => setDraft((c) => ({ ...c, doseG })) };
    if (target.kind === 'waterTempC') return { spec: TEMP_SPEC, value: draft.waterTempC, onChange: setInitialTemp };
    if (target.kind === 'finishSec')
      return { spec: FINISH_SPEC, value: draft.finishSec, onChange: (finishSec) => setDraft((c) => ({ ...c, finishSec })) };
    const index = Math.min(target.index, draft.pours.length - 1);
    return {
      spec: POUR_SPECS[target.field],
      value: draft.pours[index]?.[target.field],
      onChange: (value) => setPour(index, { [target.field]: value }),
    };
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
    setTarget({ kind: 'pour', index: draft.pours.length, field: 'targetG' });
  }

  function removePour(index: number) {
    setDraft({ ...draft, pours: draft.pours.filter((_, i) => i !== index) });
    setTarget({ kind: 'pour', index: Math.max(0, Math.min(index, draft.pours.length - 2)), field: 'targetG' });
  }

  function openSheet(recipe?: Recipe) {
    setDraft(recipe === undefined ? emptyDraft(defaults) : draftOf(recipe));
    setEditingId(recipe?.id);
    setTarget({ kind: 'pour', index: 0, field: 'targetG' });
    setDragY(0);
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditingId(undefined);
    setDragY(0);
  }

  async function save() {
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
    closeSheet();
  }

  const binding = wheelBinding();

  return (
    <>
      <Card title="レシピ">
        <div className="recipe-list-head">
          <span className="mono">{recipes.length}件</span>
          <button className="primary recipe-add" type="button" onClick={() => openSheet()}>
            ＋ 追加
          </button>
        </div>
        {recipes.length === 0 ? (
          <Banner>まだレシピがありません。</Banner>
        ) : (
          <ul className="recipe-rules">
            {recipes.map((recipe) => (
              <li className="recipe-rule" key={recipe.id}>
                <button
                  className="recipe-rule-main"
                  type="button"
                  aria-expanded={openId === recipe.id}
                  onClick={() => setOpenId(openId === recipe.id ? undefined : recipe.id)}
                >
                  <strong>{recipe.name}</strong>
                  <span className="recipe-rule-meta mono">
                    {recipe.doseG}g / {recipe.totalWaterG}g / {recipe.waterTempC}℃
                  </span>
                </button>
                {openId === recipe.id ? (
                  <>
                    <RecipeDetail recipe={recipe} />
                    <div className="row">
                      <button type="button" onClick={() => openSheet(recipe)}>
                        編集
                      </button>
                      <button className="danger" type="button" onClick={() => void deleteRecipe(recipe.id)}>
                        削除
                      </button>
                    </div>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sheetOpen ? (
        <div className="sheet-backdrop" role="presentation" onClick={closeSheet}>
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? 'レシピ編集' : 'レシピ登録'}
            style={dragY === 0 ? undefined : { transform: `translateY(${dragY}px)` }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="sheet-grip"
              role="presentation"
              onPointerDown={(event) => {
                dragFrom.current = event.clientY;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (dragFrom.current === undefined) return;
                setDragY(Math.max(0, event.clientY - dragFrom.current));
              }}
              onPointerUp={() => {
                const dragged = dragY;
                dragFrom.current = undefined;
                if (dragged > CLOSE_DRAG_PX) closeSheet();
                else setDragY(0);
              }}
            >
              <span className="sheet-grip-bar" />
            </div>
            <header className="sheet-head">
              <h2>{editing ? 'レシピ編集' : 'レシピ登録'}</h2>
              <button className="sheet-close" type="button" aria-label="閉じる" onClick={closeSheet}>
                ×
              </button>
            </header>

            <div className="sheet-body">
              <Field label="名前">
                <input
                  value={draft.name}
                  placeholder="中細 92℃ 1:16"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <div className="value-rows">
                <ValueRow
                  label="粉量"
                  value={draft.doseG}
                  unit="g"
                  format={(v) => String(v)}
                  active={target.kind === 'doseG'}
                  onSelect={() => setTarget({ kind: 'doseG' })}
                />
                <ValueRow
                  label="初期湯温"
                  value={draft.waterTempC}
                  unit="℃"
                  format={(v) => String(v)}
                  active={target.kind === 'waterTempC'}
                  onSelect={() => setTarget({ kind: 'waterTempC' })}
                />
                <ValueRow
                  label="抽出終了"
                  value={draft.finishSec}
                  unit=""
                  format={formatSeconds}
                  active={target.kind === 'finishSec'}
                  onSelect={() => setTarget({ kind: 'finishSec' })}
                />
              </div>
              <div className="row">
                <Field label="挽き目">
                  <input
                    value={draft.grindSetting}
                    placeholder="中細 / 18"
                    onChange={(event) => setDraft({ ...draft, grindSetting: event.target.value })}
                  />
                </Field>
                <Field label="ドリッパー">
                  <input value={draft.brewer} onChange={(event) => setDraft({ ...draft, brewer: event.target.value })} />
                </Field>
              </div>

              <fieldset className="pour-timeline">
                <legend>注湯</legend>
                <ol className="pour-timeline-list">
                  {draft.pours.map((pour, index) => (
                    <li className="pour-node" key={index}>
                      <div className="pour-node-axis">
                        <span className="pour-node-badge">{index + 1}</span>
                        <span className="pour-node-time mono">
                          {pour.atSec === undefined ? '—' : formatSeconds(pour.atSec)}
                        </span>
                      </div>
                      <div
                        className={
                          target.kind === 'pour' && target.index === index ? 'pour-node-card focused' : 'pour-node-card'
                        }
                      >
                        <button
                          className="pour-node-remove"
                          type="button"
                          aria-label={`${index + 1}投目を削除`}
                          disabled={draft.pours.length <= 1}
                          onClick={() => removePour(index)}
                        >
                          ×
                        </button>
                        <div className="value-rows">
                          {POUR_FIELDS.map((field) => (
                            <ValueRow
                              key={field}
                              label={POUR_SPECS[field].label}
                              value={pour[field]}
                              unit={POUR_SPECS[field].unit}
                              format={POUR_SPECS[field].format}
                              active={sameTarget(target, { kind: 'pour', index, field })}
                              onSelect={() => setTarget({ kind: 'pour', index, field })}
                            />
                          ))}
                        </div>
                        <p className="pour-node-delta mono">
                          この投 {deltaOf(index) === undefined ? '—' : `${deltaOf(index)}g`}
                        </p>
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
              </fieldset>
            </div>

            <div className="sheet-foot">
              <WheelPicker spec={binding.spec} value={binding.value} onChange={binding.onChange} />
              <button className="primary sheet-save" type="button" disabled={!canSave} onClick={() => void save()}>
                {editing ? '更新' : '登録'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
