import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, formatSeconds } from '../ui/components';
import { StepSlider } from './StepSlider';
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

type PourFieldKey = 'targetG' | 'atSec' | 'waterTempC';

interface DialSpec {
  label: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  format: (value: number) => string;
}

const DIALS: Record<PourFieldKey, DialSpec> = {
  targetG: { label: '累計湯量', unit: 'g', step: 1, min: 0, max: 800, format: (v) => String(v) },
  atSec: { label: '開始', unit: '秒', step: 1, min: 0, max: 900, format: formatSeconds },
  waterTempC: { label: '湯温', unit: '℃', step: 1, min: 60, max: 100, format: (v) => String(v) },
};

const POUR_FIELDS: PourFieldKey[] = ['targetG', 'atSec', 'waterTempC'];

const STEPS = ['基本', '注湯', '確認'] as const;

/**
 * 1投カードの中の1項目。
 * 畳んでいるときは「ラベル＋値」の1行、開くと1刻みスライダーになる。
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
  onChange: (value: number | undefined) => void;
}) {
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

  return (
    <div className="pour-dial">
      <StepSlider
        label={spec.label}
        unit={spec.unit}
        value={value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        format={spec.format}
        onChange={onChange}
      />
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

/**
 * 作成・編集の段階ウィザード（全画面シート）。
 * 開いている間だけマウントする。
 */
export function RecipeWizard({ recipe: editing, onClose }: { recipe?: Recipe; onClose: () => void }) {
  const beans = useBeans();
  const defaults = useSettings().recipeDefaults;
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftOf(editing) : emptyDraft(DEFAULT_SETTINGS.recipeDefaults)));
  const [step, setStep] = useState(0);
  // カードをまたいで 1 つだけ拡大しているフィールド。
  const [focus, setFocus] = useState<{ index: number; field: PourFieldKey }>({ index: 0, field: 'targetG' });
  const editingId = editing?.id;

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
  const baseReady = draft.name.trim() !== '' && draft.doseG !== undefined;
  const canSave = baseReady && filledPours.length > 0;

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
    onClose();
  }

  const nextDisabled = step === 0 && !baseReady;

  return (
        <div className="modal-backdrop" onClick={onClose}>
          <div
            className="modal recipe-wizard"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? 'レシピ編集' : 'レシピ追加'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="wizard-head">
              <strong>{editing ? `編集: ${editing.name}` : 'レシピ追加'}</strong>
              <button className="wizard-close" type="button" aria-label="閉じる" onClick={onClose}>
                ×
              </button>
            </div>

            <ol className="wizard-steps">
              {STEPS.map((label, index) => (
                <li
                  key={label}
                  className={index === step ? 'wizard-step current' : index < (step ?? 0) ? 'wizard-step done' : 'wizard-step'}
                  aria-current={index === step ? 'step' : undefined}
                >
                  <span className="wizard-step-num mono">{index + 1}</span>
                  <span className="wizard-step-label">{label}</span>
                </li>
              ))}
            </ol>

            <div className="wizard-body">
              {step === 0 ? (
                <div className="stack">
                  <Field label="レシピ名">
                    <input
                      value={draft.name}
                      placeholder="例: 中細 92℃ 1:16"
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </Field>
                  <StepSlider
                    label="粉量"
                    unit="g"
                    value={draft.doseG}
                    min={0}
                    max={60}
                    step={1}
                    inputStep={0.1}
                    onChange={(doseG) => setDraft({ ...draft, doseG })}
                  />
                  <StepSlider
                    label="初期湯温"
                    unit="℃"
                    value={draft.waterTempC}
                    min={60}
                    max={100}
                    step={1}
                    onChange={setInitialTemp}
                  />
                  <div className="row">
                    <Field label="挽き目">
                      <input
                        value={draft.grindSetting}
                        placeholder="中細 / 18"
                        onChange={(event) => setDraft({ ...draft, grindSetting: event.target.value })}
                      />
                    </Field>
                    <Field label="ドリッパー">
                      <input
                        value={draft.brewer}
                        onChange={(event) => setDraft({ ...draft, brewer: event.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              ) : null}

              {step === 1 ? (
                <div className="stack">
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
                        ＋ 投を追加
                      </button>
                    </li>
                  </ol>
                  <p className="pour-timeline-total">
                    <span className="muted">総湯量</span>
                    <strong className="mono">{totalWaterG}g</strong>
                  </p>
                  <StepSlider
                    label="抽出終了"
                    unit="秒"
                    value={draft.finishSec}
                    min={0}
                    max={900}
                    step={1}
                    format={formatSeconds}
                    onChange={(finishSec) => setDraft({ ...draft, finishSec })}
                  />
                </div>
              ) : null}

              {step === 2 ? (
                <div className="stack">
                  <dl className="wizard-review">
                    <dt>名前</dt>
                    <dd>{draft.name.trim() || '—'}</dd>
                    <dt>粉量 / 総湯量</dt>
                    <dd className="mono">
                      {draft.doseG ?? '—'}g / {totalWaterG}g
                    </dd>
                    <dt>比率</dt>
                    <dd className="mono">
                      {draft.doseG === undefined || draft.doseG === 0
                        ? '—'
                        : `1:${(totalWaterG / draft.doseG).toFixed(1)}`}
                    </dd>
                    <dt>湯温</dt>
                    <dd className="mono">{draft.waterTempC ?? '—'}℃</dd>
                    <dt>挽き目 / ドリッパー</dt>
                    <dd>
                      {draft.grindSetting || '—'} / {draft.brewer || '—'}
                    </dd>
                    <dt>抽出終了</dt>
                    <dd className="mono">
                      {draft.finishSec === undefined ? '—' : formatSeconds(draft.finishSec)}
                    </dd>
                  </dl>
                  <table className="wizard-review-table">
                    <thead>
                      <tr>
                        <th>投</th>
                        <th>時間</th>
                        <th>累計g</th>
                        <th>差分g</th>
                        <th>℃</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.pours.map((pour, index) => (
                        <tr key={index}>
                          <td className="mono">{index + 1}</td>
                          <td className="mono">{pour.atSec === undefined ? '—' : formatSeconds(pour.atSec)}</td>
                          <td className="mono">{pour.targetG ?? '—'}</td>
                          <td className="mono">{deltaOf(index) ?? '—'}</td>
                          <td className="mono">{pour.waterTempC ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="wizard-foot">
              <button type="button" disabled={step === 0} onClick={() => setStep((current) => (current ?? 0) - 1)}>
                戻る
              </button>
              {step === STEPS.length - 1 ? (
                <button className="primary" type="button" disabled={!canSave} onClick={() => void save()}>
                  {editing ? '更新' : '保存'}
                </button>
              ) : (
                <button
                  className="primary"
                  type="button"
                  disabled={nextDisabled}
                  onClick={() => setStep((current) => (current ?? 0) + 1)}
                >
                  次へ
                </button>
              )}
            </div>
          </div>
        </div>
  );
}

/**
 * レシピ一覧。見出し行の右端の ＋ から作成ウィザードを開き、
 * 行のタップで閲覧＋演習の画面へ移る。
 */
export function RecipeScreen() {
  const recipes = useRecipes();
  const [creating, setCreating] = useState(false);

  function remove(recipe: Recipe) {
    if (!window.confirm(`「${recipe.name}」を削除しますか？`)) return;
    void deleteRecipe(recipe.id);
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>レシピ</h2>
          <button className="head-add" type="button" aria-label="レシピを追加" onClick={() => setCreating(true)}>
            ＋
          </button>
        </div>

        {recipes.length === 0 ? (
          <div className="recipe-empty">
            <span className="muted">レシピなし</span>
            <button className="primary" type="button" onClick={() => setCreating(true)}>
              ＋ 追加
            </button>
          </div>
        ) : (
          <ul className="recipe-rows">
            {recipes.map((recipe) => (
              <li className="recipe-row" key={recipe.id}>
                <Link className="recipe-row-main" to={`/recipes/${recipe.id}`}>
                  <strong>{recipe.name}</strong>
                  <span className="mono muted">
                    {recipe.doseG}g / {recipe.totalWaterG}g / {recipe.waterTempC}℃
                  </span>
                </Link>
                <button
                  className="recipe-row-delete"
                  type="button"
                  aria-label={`${recipe.name}を削除`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    remove(recipe);
                  }}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating ? <RecipeWizard onClose={() => setCreating(false)} /> : null}
    </>
  );
}
