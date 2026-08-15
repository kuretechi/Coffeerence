import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, formatSeconds } from '../ui/components';
import { useRecipes, useSettings } from '../ui/data';
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

  // 進捗バーは「次の合図まで」の進みを表す。次がなければ抽出終了までを使う。
  const segmentStart = progress.current?.startSec ?? 0;
  const segmentEnd = progress.next?.startSec ?? finishSec ?? segmentStart;
  const segmentLength = Math.max(segmentEnd - segmentStart, 1);
  const ratio = Math.min(Math.max((stopwatch.elapsed - segmentStart) / segmentLength, 0), 1);
  const remainSec = Math.max(segmentEnd - stopwatch.elapsed, 0);

  /** 投ごとの湯温。未登録の古いレシピは初期湯温を使う。 */
  function tempOf(pour: Pour | undefined): number {
    return pour?.waterTempC ?? recipe?.waterTempC ?? 0;
  }

  // 注ぐ時刻に達した投だけ一度鳴らす。リセットで先頭に戻す。
  useEffect(() => {
    const index = progress.current?.index ?? 0;
    if (index === announcedIndex.current) return;
    if (index > announcedIndex.current && stopwatch.running) chime(settings.soundEnabled);
    announcedIndex.current = index;
  }, [progress.current?.index, stopwatch.running, settings.soundEnabled]);

  // 抽出終了時間に達したら計測を止めて知らせる。
  useEffect(() => {
    if (!finished || !stopwatch.running) return;
    stopwatch.pause();
    doubleChime(settings.soundEnabled);
  }, [finished, stopwatch, settings.soundEnabled]);

  function start() {
    primeAudio(settings.soundEnabled);
    // 開始時点で達している投（通常は1投目）はこの合図をそのまま使う。
    announcedIndex.current = progress.current?.index ?? 0;
    chime(settings.soundEnabled);
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

  // 主役のカードは「いま注ぐ投」。開始前は1投目、注ぎ終えたら終了の案内に切り替える。
  const focus = progress.current ?? pours[0];
  const focusIndex = pours.findIndex((pour) => pour.index === focus?.index);
  const focusWaterG = focusIndex < 0 ? 0 : steps[focusIndex]?.waterG ?? 0;
  const focusDone = finished || (progress.current !== undefined && progress.next === undefined);
  const preview = focusIndex < 0 ? undefined : pours[focusIndex + 1];
  const previewWaterG = focusIndex < 0 ? 0 : steps[focusIndex + 1]?.waterG ?? 0;
  const restCount = focusIndex < 0 ? 0 : Math.max(pours.length - focusIndex - 2, 0);

  return (
    <div className="timer-focus">
      <header className="timer-focus-top">
        {recipes.length === 0 ? (
          <span className="timer-focus-recipe muted">レシピ未登録</span>
        ) : (
          <select
            className="timer-focus-recipe"
            aria-label="レシピ"
            value={selectedId}
            onChange={(event) => setRecipeId(event.target.value)}
          >
            {recipes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <span className="timer-focus-elapsed mono" role="timer" aria-label={formatSeconds(stopwatch.elapsed)}>
          {formatSeconds(stopwatch.elapsed)}
        </span>
      </header>

      <div
        className="timer-focus-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <span className="timer-focus-bar-value" style={{ width: `${ratio * 100}%` }} />
      </div>

      {recipes.length === 0 ? <Banner>先にレシピを登録してください。</Banner> : null}

      {pours.length === 0 ? (
        recipe ? (
          <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner>
        ) : null
      ) : (
        <>
          {focus === undefined ? null : (
            <section className={`timer-focus-card${focusDone ? ' done' : ''}`} aria-live="polite">
              {focusDone ? (
                <>
                  <span className="timer-focus-step">{finished ? '抽出終了' : '注湯完了'}</span>
                  <p className="timer-focus-done">
                    {finished ? 'ドリッパーを外してください。' : '落ち切りを待ちます。'}
                  </p>
                  {finished || finishSec === undefined ? null : (
                    <p className="timer-focus-countdown mono">終了まで {formatSeconds(remainSec)}</p>
                  )}
                </>
              ) : (
                <>
                  <span className="timer-focus-step">{focus.index}投目</span>
                  <p className="timer-focus-amount">
                    <strong className="mono">{focusWaterG}</strong>
                    <span className="timer-focus-unit">g</span>
                  </p>
                  <p className="timer-focus-scale mono muted">スケール {focus.targetG}g まで</p>
                  <p className="timer-focus-countdown mono">
                    {progress.next ? '次まで' : '終了まで'} {formatSeconds(remainSec)} ・ {tempOf(focus)}℃
                  </p>
                </>
              )}
            </section>
          )}

          {preview === undefined ? null : (
            <section className="timer-focus-preview">
              <span className="timer-focus-preview-label muted">次</span>
              <span className="timer-focus-preview-main">
                {preview.index}投目 <strong className="mono">{previewWaterG}g</strong>
              </span>
              <span className="timer-focus-preview-sub mono muted">
                {formatSeconds(preview.startSec)}〜 / {preview.targetG}g
              </span>
            </section>
          )}

          {restCount === 0 ? null : (
            <p className="timer-focus-rest muted">このあと 残り {restCount}投</p>
          )}
        </>
      )}

      <div className="timer-focus-actions">
        {stopwatch.running ? (
          <button className="timer-focus-main" type="button" onClick={stopwatch.pause}>
            停止
          </button>
        ) : (
          <button className="timer-focus-main primary" type="button" disabled={finished} onClick={start}>
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
        {recipes.length === 0 ? null : (
          <button
            className="primary"
            type="button"
            disabled={stopwatch.elapsed === 0}
            onClick={() => void finish()}
          >
            記録して味評価へ
          </button>
        )}
      </div>
      {settings.soundEnabled ? null : <Banner>設定でタイマー音をオフにしています。</Banner>}
    </div>
  );
}
