import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Card, Field, formatSeconds } from '../ui/components';
import { useRecipes, useSettings } from '../ui/data';
import { SevenSegment } from '../ui/SevenSegment';
import { chime, doubleChime, primeAudio, useStopwatch } from '../ui/useTimer';
import { saveBrew } from '../db/repo';
import { uid } from '../lib/random';
import { pourProgress, toSteps } from '../lib/pours';
import type { BrewRecord, Pour } from '../domain/types';

export function TimerScreen() {
  const recipes = useRecipes();
  const settings = useSettings();
  const navigate = useNavigate();
  const stopwatch = useStopwatch();
  const [recipeId, setRecipeId] = useState('');

  const selectedId = recipeId || recipes[0]?.id || '';
  const recipe = recipes.find((item) => item.id === selectedId);
  const pours = recipe?.pours ?? [];
  const steps = toSteps(pours);
  const progress = pourProgress(pours, stopwatch.elapsed);
  const announcedIndex = useRef(0);
  const finishSec = recipe?.finishSec;
  const finished = finishSec !== undefined && stopwatch.elapsed >= finishSec;

  /** 投ごとの湯温。未登録の古いレシピは初期湯温を使う。 */
  function tempOf(pour: Pour | undefined): number {
    return pour?.waterTempC ?? recipe?.waterTempC ?? 0;
  }

  // 注ぐ時刻に達した投だけ一度鳴らす。リセットで先頭に戻す。
  useEffect(() => {
    const index = progress.current?.index ?? 0;
    if (index === announcedIndex.current) return;
    if (index > announcedIndex.current && stopwatch.running) chime(settings.soundEnabled, settings.soundId);
    announcedIndex.current = index;
  }, [progress.current?.index, stopwatch.running, settings.soundEnabled, settings.soundId]);

  // 抽出終了時間に達したら計測を止めて知らせる。
  useEffect(() => {
    if (!finished || !stopwatch.running) return;
    stopwatch.pause();
    doubleChime(settings.soundEnabled, settings.soundId);
  }, [finished, stopwatch, settings.soundEnabled, settings.soundId]);

  function start() {
    primeAudio(settings.soundEnabled, settings.soundId);
    // 開始時点で達している投（通常は1投目）はこの合図をそのまま使う。
    announcedIndex.current = progress.current?.index ?? 0;
    chime(settings.soundEnabled, settings.soundId);
    stopwatch.start();
  }

  async function finish() {
    if (!selectedId) return;
    const record: BrewRecord = {
      id: uid('brew'),
      date: new Date().toISOString(),
      recipeId: selectedId,
      totalTimeSec: Math.round(stopwatch.elapsed),
    };
    await saveBrew(record);
    announcedIndex.current = 0;
    stopwatch.reset();
    navigate('/log');
  }

  return (
    <>
      <Card title="抽出タイマー" hint="先にレシピを決めてから計測します。注湯のタイミングはタイマーが知らせます。">
        {recipes.length === 0 ? (
          <Banner>先にレシピを登録してください。</Banner>
        ) : (
          <Field label="レシピ">
            <select value={selectedId} onChange={(event) => setRecipeId(event.target.value)}>
              {recipes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="timer-panel">
          <div className="timer-panel-label">
            <span>{stopwatch.running ? '抽出中' : '待機'}</span>
            <span className="en">BREW TIME</span>
          </div>
          <SevenSegment className="timer" value={formatSeconds(stopwatch.elapsed)} />
        </div>

        {pours.length === 0 ? (
          recipe ? <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner> : null
        ) : (
          <div className="pour-guide">
            <p className="pour-now">
              {finished
                ? '抽出終了'
                : !stopwatch.running && stopwatch.elapsed === 0
                ? `1投目 ${pours[0]?.targetG ?? 0}gまで`
                : progress.current
                ? `${progress.current.index}投目 ${progress.current.targetG}gまで`
                : `${formatSeconds(progress.untilNextSec)} 後に 1投目`}
            </p>
            <p className="pour-next muted">
              {finished
                ? '抽出終了です。'
                : progress.next
                ? `次: ${progress.next.index}投目 ${progress.next.targetG}gまで`
                : finishSec === undefined
                ? '注湯完了'
                : '次: 抽出終了'}
            </p>
            <ol className="pour-list">
              {pours.map((pour, index) => (
                <li key={pour.index} className={progress.current?.index === pour.index ? 'current' : ''}>
                  <span className="mono">{formatSeconds(pour.startSec)}</span>
                  <span>
                    {pour.index}投目 累計{pour.targetG}g
                  </span>
                  <span className="mono muted">
                    {steps[index]?.waterG ?? 0}g / {tempOf(pour)}℃
                  </span>
                </li>
              ))}
            </ol>
            {finishSec === undefined ? null : (
              <p className="pour-finish mono muted">抽出終了 {formatSeconds(finishSec)}</p>
            )}
          </div>
        )}

        <div className="row">
          {stopwatch.running ? (
            <button type="button" onClick={stopwatch.pause}>
              停止
            </button>
          ) : (
            <button className="primary" type="button" disabled={finished} onClick={start}>
              開始
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              announcedIndex.current = 0;
              stopwatch.reset();
            }}
          >
            リセット
          </button>
        </div>

        {recipes.length === 0 ? null : (
          <div className="row timer-record">
            <button
              className="primary"
              type="button"
              disabled={stopwatch.elapsed === 0}
              onClick={() => void finish()}
            >
              記録して味評価へ
            </button>
          </div>
        )}
        {settings.soundEnabled ? null : <Banner>設定でタイマー音をオフにしています。</Banner>}
      </Card>
    </>
  );
}
