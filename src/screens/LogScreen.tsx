import { useState } from 'react';
import { Banner, Card, Field, Segmented, formatSeconds } from '../ui/components';
import { useBrews, useRecipes } from '../ui/data';
import { deleteBrew, saveBrew } from '../db/repo';
import type { BrewRecord, Likert5, TasteRating } from '../domain/types';

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

export function LogScreen() {
  const brews = useBrews();
  const recipes = useRecipes();
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<TasteRating>(emptyTaste);

  const recipeName = (recipeId: string) => recipes.find((r) => r.id === recipeId)?.name ?? '（削除済みレシピ）';

  function edit(brew: BrewRecord) {
    setEditingId(brew.id);
    setDraft(brew.taste ?? emptyTaste());
  }

  async function save(brew: BrewRecord) {
    await saveBrew({ ...brew, taste: draft });
    setEditingId(undefined);
  }

  return (
    <>
      <Card title="味評価と記録" hint="抽出ごとに 5 段階で評価します。評価は後から編集できます。">
        {brews.length === 0 ? <Banner>まだ抽出記録がありません。タイマーから記録してください。</Banner> : null}
        <div className="stack">
          {brews.map((brew) => (
            <div key={brew.id} className="todo-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row between">
                <strong>{recipeName(brew.recipeId)}</strong>
                <span className="mono">{formatSeconds(brew.totalTimeSec)}</span>
              </div>
              <span className="muted">
                {new Date(brew.date).toLocaleString('ja-JP')}
                {brew.beverageG === undefined ? '' : ` / ${brew.beverageG}g`}
                {brew.taste ? ` / 総合 ${brew.taste.overall}` : ' / 未評価'}
              </span>

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
              ) : (
                <div className="row">
                  <button type="button" onClick={() => edit(brew)}>
                    {brew.taste ? '評価を編集' : '味を評価'}
                  </button>
                  <button className="danger" type="button" onClick={() => void deleteBrew(brew.id)}>
                    削除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
