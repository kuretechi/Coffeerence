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

/** ホイールの目盛り1つ分の幅（px）。CSS の .pour-dial-tick と揃える。 */
const TICK_WIDTH = 32;

type PourFieldKey = 'targetG' | 'atSec' | 'waterTempC';

interface DialSpec {
  label: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  /** 目盛りに数字を出す間隔。 */
  major: number;
  format: (value: number) => string;
}

const DIALS: Record<PourFieldKey, DialSpec> = {
  targetG: { label: '累計湯量', unit: 'g', step: 5, min: 0, max: 600, major: 10, format: (v) => String(v) },
  atSec: { label: '開始', unit: '秒', step: 5, min: 0, max: 600, major: 15, format: formatSeconds },
  waterTempC: { label: '湯温', unit: '℃', step: 1, min: 60, max: 100, major: 5, format: (v) => String(v) },
};

const POUR_FIELDS: PourFieldKey[] = ['targetG', 'atSec', 'waterTempC'];

const clampToDial = (spec: DialSpec, value: number) => Math.min(spec.max, Math.max(spec.min, value));

/** 目盛りの並びを作る。 */
function ticksOf(spec: DialSpec): number[] {
  const ticks: number[] = [];
  for (let value = spec.min; value <= spec.max; value += spec.step) ticks.push(Math.round(value * 100) / 100);
  return ticks;
}

/**
 * 1つの数値をダイヤルで詰めるための行。
 * 畳んでいるときは「ラベル＋値」の1行サマリー、開くと大きな数字＋横ホイール＋−/＋になる。
 */
function PourDial({
  spec,
  value,
  active,
  onActivate,
  onChange,
}: {
  spec: DialSpec;
  value: number | undefined;
  active: boolean;
  onActivate: () => void;
  onChange: (value: number) => void;
}) {
  const wheelRef = useRef<HTMLDivElement | null>(null);
  // ホイールを弾いて出した値。自分が出した値でスクロール位置を戻して指と喧嘩しないようにする。
  const scrolledTo = useRef<number | undefined>(undefined);

  useEffect(() => {
    const wheel = wheelRef.current;
    if (!active || wheel === null || value === undefined) return;
    if (scrolledTo.current === value) return;
    wheel.scrollLeft = ((clampToDial(spec, value) - spec.min) / spec.step) * TICK_WIDTH;
    scrolledTo.current = value;
  }, [active, value, spec]);

  if (!active) {
    return (
      <button className="pour-dial-row" type="button" onClick={onActivate}>
        <span className="pour-dial-row-label">{spec.label}</span>
        <span className="pour-dial-row-value mono">
          {value === undefined ? '—' : `${spec.format(value)}${spec.unit}`}
        </span>
      </button>
    );
  }

  const shown = value ?? spec.min;
  const nudge = (direction: 1 | -1) => onChange(clampToDial(spec, shown + direction * spec.step));

  return (
    <div className="pour-dial">
      <p className="pour-dial-label">{spec.label}</p>
      <div className="pour-dial-head">
        <p className="pour-dial-value mono">
          {value === undefined ? '—' : spec.format(value)}
          <span className="pour-dial-unit">{spec.unit}</span>
        </p>
        <div className="pour-dial-steppers">
          <button
            className="pour-dial-step"
            type="button"
            aria-label={`${spec.label}を減らす`}
            disabled={shown <= spec.min}
            onClick={() => nudge(-1)}
          >
            −
          </button>
          <button
            className="pour-dial-step"
            type="button"
            aria-label={`${spec.label}を増やす`}
            disabled={shown >= spec.max}
            onClick={() => nudge(1)}
          >
            ＋
          </button>
        </div>
      </div>
      <div className="pour-dial-track">
        <div
          className="pour-dial-wheel"
          ref={wheelRef}
          role="slider"
          tabIndex={0}
          aria-label={`${spec.label}（${spec.unit}）`}
          aria-valuemin={spec.min}
          aria-valuemax={spec.max}
          aria-valuenow={value}
          onScroll={(event) => {
            const index = Math.round(event.currentTarget.scrollLeft / TICK_WIDTH);
            const next = clampToDial(spec, spec.min + index * spec.step);
            if (next === value) return;
            scrolledTo.current = next;
            onChange(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault();
              nudge(1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault();
              nudge(-1);
            }
          }}
        >
          {ticksOf(spec).map((tick) => (
            <span
              key={tick}
              className={tick % spec.major === 0 ? 'pour-dial-tick major' : 'pour-dial-tick'}
              aria-hidden="true"
            >
              {tick % spec.major === 0 ? <em className="mono">{spec.format(tick)}</em> : null}
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
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  // カードをまたいで 1 つだけ拡大しているフィールド。
  const [focus, setFocus] = useState<{ index: number; field: PourFieldKey }>({ index: 0, field: 'targetG' });
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
    setFocus({ index: draft.pours.length, field: 'targetG' });
  }

  function removePour(index: number) {
    setDraft({ ...draft, pours: draft.pours.filter((_, i) => i !== index) });
    setFocus((current) => ({
      index: Math.max(0, Math.min(current.index > index ? current.index - 1 : current.index, draft.pours.length - 2)),
      field: current.field,
    }));
  }

  function startEdit(recipe: Recipe) {
    setEditingId(recipe.id);
    setDraft(draftOf(recipe));
    setFocus({ index: 0, field: 'targetG' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(undefined);
    setDraft(emptyDraft(defaults));
    setFocus({ index: 0, field: 'targetG' });
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
    setFocus({ index: 0, field: 'targetG' });
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
                  <div className={focus.index === index ? 'pour-node-card focused' : 'pour-node-card'}>
                    <button
                      className="pour-node-remove"
                      type="button"
                      aria-label={`${index + 1}投目を削除`}
                      disabled={draft.pours.length <= 1}
                      onClick={() => removePour(index)}
                    >
                      ×
                    </button>
                    <div className="pour-dial-stack">
                      {POUR_FIELDS.map((key) => (
                        <PourDial
                          key={key}
                          spec={DIALS[key]}
                          value={pour[key]}
                          active={focus.index === index && focus.field === key}
                          onActivate={() => setFocus({ index, field: key })}
                          onChange={(value) => setPour(index, { [key]: value })}
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
