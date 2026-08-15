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

/** カード内の1項目。大きな数値と −/＋、まとめて動かすプリセットを並べる。 */
function PourMetric({
  label,
  suffix,
  value,
  step,
  presets,
  hint,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number | undefined;
  step: number;
  /** ラベルと、押したときの値（相対なら delta、絶対なら to）。 */
  presets: { label: string; delta?: number; to?: number }[];
  hint?: string;
  onChange: (value: number | undefined) => void;
}) {
  const bump = (delta: number) => onChange(Math.max(0, Math.round(((value ?? 0) + delta) * 10) / 10));
  return (
    <div className="pour-metric">
      <div className="pour-metric-head">
        <span className="pour-metric-label">{label}</span>
        {hint === undefined ? null : <span className="pour-metric-hint mono">{hint}</span>}
      </div>
      <div className="pour-stepper">
        <button type="button" aria-label={`${label}を${step}${suffix}減らす`} onClick={() => bump(-step)}>
          −
        </button>
        <label className="pour-value">
          <span className="visually-hidden">
            {label}（{suffix}）
          </span>
          <input
            type="number"
            inputMode="decimal"
            step={step}
            min={0}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
          />
          <span className="pour-value-suffix" aria-hidden="true">
            {suffix}
          </span>
        </label>
        <button type="button" aria-label={`${label}を${step}${suffix}増やす`} onClick={() => bump(step)}>
          ＋
        </button>
      </div>
      <div className="pour-presets">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => (preset.to === undefined ? bump(preset.delta ?? 0) : onChange(preset.to))}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 1投=1カードの横スワイプ式エディタ。画面には基本1枚だけ映す。 */
function PourDeck({
  pours,
  totalWaterG,
  onPatch,
  onAdd,
  onRemove,
}: {
  pours: DraftPour[];
  totalWaterG: number;
  onPatch: (index: number, patch: Partial<DraftPour>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const countRef = useRef(pours.length);

  function scrollToCard(index: number) {
    const track = trackRef.current;
    const card = track?.children[index];
    if (!track || !(card instanceof HTMLElement)) return;
    const left = track.scrollLeft + card.getBoundingClientRect().left - track.getBoundingClientRect().left;
    if (typeof track.scrollTo === 'function') track.scrollTo({ left, behavior: 'smooth' });
    else track.scrollLeft = left;
  }

  // 投が増えたら追加した1枚へ、減ったら残った範囲へ寄せる。
  useEffect(() => {
    if (pours.length > countRef.current) scrollToCard(pours.length - 1);
    countRef.current = pours.length;
    setActive((current) => Math.min(current, Math.max(pours.length - 1, 0)));
  }, [pours.length]);

  /** スクロール位置に一番近いカードを現在位置として扱う。 */
  function syncActive() {
    const track = trackRef.current;
    if (!track) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    Array.from(track.children).forEach((child, index) => {
      if (!(child instanceof HTMLElement)) return;
      const cardCenter = child.offsetLeft + child.offsetWidth / 2;
      const distance = Math.abs(cardCenter - center);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    setActive(nearest);
  }

  return (
    <fieldset className="pour-deck">
      <legend>注湯（1投ずつ横にスワイプ）</legend>
      <div className="pour-deck-track" ref={trackRef} onScroll={syncActive}>
        {pours.map((pour, index) => {
          const previousG = index === 0 ? 0 : pours[index - 1]?.targetG;
          const addedG =
            pour.targetG === undefined || previousG === undefined ? undefined : pour.targetG - previousG;
          return (
            <article className={`pour-card${index === active ? ' active' : ''}`} key={index}>
              <header className="pour-card-head">
                <span className="pour-card-no">
                  {index + 1}
                  <span className="pour-card-of mono">/{pours.length}</span> 投目
                </span>
                <button
                  className="pour-card-remove danger"
                  type="button"
                  disabled={pours.length <= 1}
                  onClick={() => onRemove(index)}
                >
                  削除
                </button>
              </header>
              <PourMetric
                label="累計湯量"
                suffix="g"
                step={10}
                value={pour.targetG}
                hint={addedG === undefined ? undefined : `この投 ${addedG >= 0 ? '+' : '−'}${Math.abs(addedG)}g`}
                presets={[
                  { label: '+25g', delta: 25 },
                  { label: '+50g', delta: 50 },
                ]}
                onChange={(targetG) => onPatch(index, { targetG })}
              />
              <PourMetric
                label="開始"
                suffix="秒"
                step={5}
                value={pour.atSec}
                hint={pour.atSec === undefined ? undefined : formatSeconds(pour.atSec)}
                presets={[
                  { label: '+15秒', delta: 15 },
                  { label: '+30秒', delta: 30 },
                ]}
                onChange={(atSec) => onPatch(index, { atSec })}
              />
              <PourMetric
                label="湯温"
                suffix="℃"
                step={1}
                value={pour.waterTempC}
                presets={[
                  { label: '88℃', to: 88 },
                  { label: '92℃', to: 92 },
                  { label: '96℃', to: 96 },
                ]}
                onChange={(waterTempC) => onPatch(index, { waterTempC })}
              />
            </article>
          );
        })}
      </div>
      <div className="pour-dots" aria-hidden="true">
        {pours.map((_, index) => (
          <button
            key={index}
            className={index === active ? 'active' : ''}
            type="button"
            tabIndex={-1}
            onClick={() => scrollToCard(index)}
          >
            <span className="visually-hidden">{index + 1}投目へ</span>
          </button>
        ))}
      </div>
      <div className="pour-deck-footer">
        <span className="pour-deck-position mono">
          {Math.min(active + 1, pours.length)} / {pours.length} 投
        </span>
        <span className="pour-deck-total mono">総湯量 {totalWaterG}g</span>
        <button className="pour-deck-add" type="button" onClick={onAdd}>
          投を追加
        </button>
      </div>
    </fieldset>
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
          <PourDeck
            pours={draft.pours}
            totalWaterG={totalWaterG}
            onPatch={setPour}
            onAdd={addPour}
            onRemove={removePour}
          />
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
