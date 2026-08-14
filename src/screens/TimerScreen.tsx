import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Card, Field, NumberField, formatSeconds } from '../ui/components';
import { useRecipes, useSettings } from '../ui/data';
import { SevenSegment } from '../ui/SevenSegment';
import { useStopwatch } from '../ui/useTimer';
import { saveBrew } from '../db/repo';
import { uid } from '../lib/random';
import type { BrewRecord } from '../domain/types';

export function TimerScreen() {
  const recipes = useRecipes();
  const settings = useSettings();
  const navigate = useNavigate();
  const stopwatch = useStopwatch();
  const [recipeId, setRecipeId] = useState('');
  const [beverageG, setBeverageG] = useState<number | undefined>(undefined);

  const selectedId = recipeId || recipes[0]?.id || '';

  async function finish() {
    if (!selectedId) return;
    const record: BrewRecord = {
      id: uid('brew'),
      date: new Date().toISOString(),
      recipeId: selectedId,
      totalTimeSec: Math.round(stopwatch.elapsed),
      beverageG,
    };
    await saveBrew(record);
    stopwatch.reset();
    setBeverageG(undefined);
    navigate('/log');
  }

  return (
    <>
      <Card title="抽出タイマー" hint="レシピを選んで計測します。止めて記録すると味評価に進めます。">
        <div className="timer-panel">
          <div className="timer-panel-label">
            <span>{stopwatch.running ? '抽出中' : '待機'}</span>
            <span className="en">BREW TIME</span>
          </div>
          <SevenSegment className="timer" value={formatSeconds(stopwatch.elapsed)} />
        </div>

        <div className="row">
          {stopwatch.running ? (
            <button type="button" onClick={stopwatch.pause}>
              停止
            </button>
          ) : (
            <button className="primary" type="button" onClick={stopwatch.start}>
              開始
            </button>
          )}
          <button type="button" onClick={stopwatch.reset}>
            リセット
          </button>
        </div>
      </Card>

      <Card title="この抽出を記録">
        {recipes.length === 0 ? (
          <Banner>先にレシピを登録してください。</Banner>
        ) : (
          <div className="stack">
            <Field label="レシピ">
              <select value={selectedId} onChange={(event) => setRecipeId(event.target.value)}>
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </option>
                ))}
              </select>
            </Field>
            <NumberField label="抽出量" suffix="g" step={1} min={0} value={beverageG} onChange={setBeverageG} />
            <button
              className="primary"
              type="button"
              disabled={stopwatch.elapsed === 0}
              onClick={() => void finish()}
            >
              記録して味評価へ
            </button>
            {settings.soundEnabled ? null : <Banner>設定でタイマー音をオフにしています。</Banner>}
          </div>
        )}
      </Card>
    </>
  );
}
