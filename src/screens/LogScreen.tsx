import { useState } from 'react';
import { Banner, Card, Field, Segmented, formatSeconds } from '../ui/components';
import { useBrews, useRecipes } from '../ui/data';
import { deleteBrew, saveBrew } from '../db/repo';
import type { BrewRecord, Likert5, Recipe, TasteRating } from '../domain/types';

const AXES: { key: keyof Omit<TasteRating, 'note'>; label: string }[] = [
  { key: 'aroma', label: '香り' },
  { key: 'acidity', label: '酸味' },
  { key: 'sweetness', label: '甘さ' },
  { key: 'body', label: 'ボディ' },
  { key: 'overall', label: '総合' },
];

const LIKERT: { value: Likert5; label: string }[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
];

const emptyTaste = (): TasteRating => ({ aroma: 3, acidity: 3, sweetness: 3, body: 3, overall: 3 });

/** 記録をタップしたときに開く、抽出条件と評価の内訳。 */
function BrewDetail({ brew, recipe }: { brew: BrewRecord; recipe: Recipe | undefined }) {
  const taste = brew.taste;
  const ratio = recipe && brew.beverageG !== undefined ? (brew.beverageG / recipe.doseG).toFixed(1) : undefined;
  return (
    <dl className="brew-detail">
      <dt>抽出時間</dt>
      <dd className="mono">{formatSeconds(brew.totalTimeSec)}</dd>
      <dt>抽出量</dt>
      <dd className="mono">{brew.beverageG === undefined ? '—' : `${brew.beverageG}g${ratio ? `（1:${ratio}）` : ''}`}</dd>
      {recipe ? (
        <>
          <dt>粉量 / 初期湯温</dt>
          <dd className="mono">
            {recipe.doseG}g / {recipe.waterTempC}℃
          </dd>
          <dt>挽き目 / ドリッパー</dt>
          <dd>
            {recipe.grindSetting || '—'} / {recipe.brewer || '—'}
          </dd>
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
        </>
      ) : null}
      <dt>味評価</dt>
      <dd>
        {taste ? AXES.map((axis) => `${axis.label} ${taste[axis.key]}`).join(' / ') : 'まだ評価していません。'}
      </dd>
      {taste?.note ? (
        <>
          <dt>メモ</dt>
          <dd>{taste.note}</dd>
        </>
      ) : null}
    </dl>
  );
}

export function LogScreen() {
  const brews = useBrews();
  const recipes = useRecipes();
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<TasteRating>(emptyTaste);

  const recipeName = (recipeId: string) => recipes.find((r) => r.id === recipeId)?.name ?? '（削除済みレシピ）';

  function edit(brew: BrewRecord) {
    setOpenId(brew.id);
    setEditingId(brew.id);
    setDraft(brew.taste ?? emptyTaste());
  }

  async function save(brew: BrewRecord) {
    await saveBrew({ ...brew, taste: draft });
    setEditingId(undefined);
  }

  return (
    <>
      <Card title="味評価と記録" hint="記録をタップすると詳細が見られます。評価は後から編集できます。">
        {brews.length === 0 ? <Banner>まだ抽出記録がありません。タイマーから記録してください。</Banner> : null}
        <div className="stack">
          {brews.map((brew) => (
            <div key={brew.id} className="todo-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <button
                className="log-summary"
                type="button"
                aria-expanded={openId === brew.id}
                onClick={() => setOpenId(openId === brew.id ? undefined : brew.id)}
              >
                <span className="row between">
                  <strong>{recipeName(brew.recipeId)}</strong>
                  <span className="mono">{formatSeconds(brew.totalTimeSec)}</span>
                </span>
                <span className="muted">
                  {new Date(brew.date).toLocaleString('ja-JP')}
                  {brew.beverageG === undefined ? '' : ` / ${brew.beverageG}g`}
                  {brew.taste ? ` / 総合 ${brew.taste.overall}` : ' / 未評価'}
                </span>
              </button>

              {openId === brew.id ? <BrewDetail brew={brew} recipe={recipes.find((r) => r.id === brew.recipeId)} /> : null}

              {editingId === brew.id ? (
                <div className="stack">
                  {AXES.map((axis) => (
                    <Field key={axis.key} label={axis.label}>
                      <Segmented
                        compact
                        options={LIKERT}
                        value={draft[axis.key]}
                        onChange={(value) => setDraft({ ...draft, [axis.key]: value })}
                      />
                    </Field>
                  ))}
                  <Field label="メモ">
                    <textarea
                      value={draft.note ?? ''}
                      onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                    />
                  </Field>
                  <div className="row">
                    <button className="primary" type="button" onClick={() => void save(brew)}>
                      評価を保存
                    </button>
                    <button type="button" onClick={() => setEditingId(undefined)}>
                      やめる
                    </button>
                  </div>
                </div>
              ) : openId === brew.id ? (
                <div className="row">
                  <button type="button" onClick={() => edit(brew)}>
                    {brew.taste ? '評価を編集' : '味を評価'}
                  </button>
                  <button className="danger" type="button" onClick={() => void deleteBrew(brew.id)}>
                    削除
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
