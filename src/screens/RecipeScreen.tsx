import { useEffect, useState } from 'react';
import { Banner, Card, Field, formatSeconds } from '../ui/components';
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
  // ウィザードを開いているときだけ 0〜2 のステップを持つ。
  const [step, setStep] = useState<number | undefined>(undefined);
  // カードをまたいで 1 つだけ拡大しているフィールド。
  const [focus, setFocus] = useState<{ index: number; field: PourFieldKey }>({ index: 0, field: 'targetG' });
  const editing = recipes.find((recipe) => recipe.id === editingId);
  const open = step !== undefined;

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

  function openCreate() {
    setEditingId(undefined);
    setDraft(emptyDraft(defaults));
    setFocus({ index: 0, field: 'targetG' });
    setStep(0);
  }

  function openEdit(recipe: Recipe) {
    setEditingId(recipe.id);
    setDraft(draftOf(recipe));
    setFocus({ index: 0, field: 'targetG' });
    setStep(0);
  }

  function close() {
    setStep(undefined);
    setEditingId(undefined);
    setDraft(emptyDraft(defaults));
    setFocus({ index: 0, field: 'targetG' });
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
    close();
  }

  const nextDisabled = step === 0 && !baseReady;

  return (
    <>
      <Card title="レシピ">
        <div className="stack">
          <button className="primary" type="button" onClick={openCreate}>
            ＋ 追加
          </button>
          {recipes.length === 0 ? (
            <Banner>まだレシピがありません。</Banner>
          ) : (
            recipes.map((recipe) => (
              <div key={recipe.id} className="todo-item recipe-item">
                <button
                  className="log-summary"
                  type="button"
                  aria-expanded={openId === recipe.id}
                  onClick={() => setOpenId(openId === recipe.id ? undefined : recipe.id)}
                >
                  <strong>{recipe.name}</strong>
                  <span className="mono muted">
                    {recipe.doseG}g / {recipe.totalWaterG}g / {recipe.waterTempC}℃
                  </span>
                </button>

                {openId === recipe.id ? (
                  <>
                    <RecipeDetail recipe={recipe} />
                    <div className="row">
                      <button type="button" onClick={() => openEdit(recipe)}>
                        編集
                      </button>
                      <button className="danger" type="button" onClick={() => void deleteRecipe(recipe.id)}>
                        削除
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      {open ? (
        <div className="modal-backdrop" onClick={close}>
          <div
            className="modal recipe-wizard"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? 'レシピ編集' : 'レシピ追加'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="wizard-head">
              <strong>{editing ? `編集: ${editing.name}` : 'レシピ追加'}</strong>
              <button className="wizard-close" type="button" aria-label="閉じる" onClick={close}>
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
      ) : null}
    </>
  );
}
