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

  const segmentEnd = progress.next?.startSec ?? finishSec ?? stopwatch.elapsed;
  const remainSec = Math.max(segmentEnd - stopwatch.elapsed, 0);

  /** タイムラインの右端。抽出終了があればそこ、なければ最後の投。 */
  const timelineEnd = Math.max(finishSec ?? pours[pours.length - 1]?.startSec ?? 0, 1);
  const timelineRatio = Math.min(stopwatch.elapsed / timelineEnd, 1);

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

  // 重量ファースト。中心は「いま何gまで注ぐか」で、時間は補助情報に降格する。
  const focus = progress.current ?? pours[0];
  const focusIndex = pours.findIndex((pour) => pour.index === focus?.index);
  const focusWaterG = focusIndex < 0 ? 0 : steps[focusIndex]?.waterG ?? 0;
  const focusDone = finished || (progress.current !== undefined && progress.next === undefined);
  const totalG = Math.max(pours[pours.length - 1]?.targetG ?? 0, 1);
  const targetG = focus?.targetG ?? 0;
  const baseG = Math.round((targetG - focusWaterG) * 10) / 10;
  const basePct = Math.min((baseG / totalG) * 100, 100);
  const addPct = Math.min((focusWaterG / totalG) * 100, 100 - basePct);

  return (
    <div className="timer-scale-stage">
      {recipes.length === 0 ? (
        <Banner>先にレシピを登録してください。</Banner>
      ) : (
        <select
          className="timer-stage-recipe"
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

      <div className="timer-line" role="timer" aria-label={formatSeconds(stopwatch.elapsed)}>
        <span className="timer-line-elapsed mono">{formatSeconds(stopwatch.elapsed)}</span>
        <div className="timer-line-track">
          <div className="timer-line-value" style={{ width: `${timelineRatio * 100}%` }} />
          {pours.map((pour) => (
            <span
              key={pour.index}
              className={`timer-line-tick${stopwatch.elapsed >= pour.startSec ? ' past' : ''}`}
              style={{ left: `${Math.min((pour.startSec / timelineEnd) * 100, 100)}%` }}
            />
          ))}
        </div>
        <span className="timer-line-end mono muted">{formatSeconds(timelineEnd)}</span>
      </div>

      {pours.length === 0 ? (
        recipe ? (
          <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner>
        ) : null
      ) : (
        <>
          <div className="timer-scale-main" aria-live="polite">
            <div
              className="timer-scale-gauge"
              role="img"
              aria-label={`累計 ${totalG}g のうち ${targetG}g まで`}
            >
              <div className="timer-scale-base" style={{ height: `${basePct}%` }} />
              {focusDone ? null : (
                <div className="timer-scale-add" style={{ bottom: `${basePct}%`, height: `${addPct}%` }} />
              )}
              {pours.map((pour) => (
                <span
                  key={pour.index}
                  className="timer-scale-mark"
                  style={{ bottom: `${Math.min((pour.targetG / totalG) * 100, 100)}%` }}
                />
              ))}
            </div>
            <div className="timer-scale-read">
              {focusDone ? (
                <>
                  <span className="timer-scale-label">注湯完了</span>
                  <span className="timer-scale-target mono">
                    {totalG}
                    <small>g</small>
                  </span>
                  <span className="timer-scale-note">
                    {finished
                      ? '抽出終了です。ドリッパーを外してください。'
                      : finishSec === undefined
                      ? '落ち切りを待ちます。'
                      : `落ち切りまで あと ${formatSeconds(remainSec)}`}
                  </span>
                </>
              ) : (
                <>
                  <span className="timer-scale-label">スケールを {focus?.index}投目 の目標まで</span>
                  <span className="timer-scale-target mono">
                    {targetG}
                    <small>g</small>
                  </span>
                  <span className="timer-scale-delta mono">
                    {baseG}g から +{focusWaterG}g
                  </span>
                </>
              )}
            </div>
          </div>

          <ol className="timer-scale-steps">
            {pours.map((pour, index) => {
              const state = focus && pour.index === focus.index && !focusDone
                ? ' current'
                : stopwatch.elapsed >= pour.startSec
                ? ' past'
                : '';
              return (
                <li key={pour.index} className={`timer-scale-step${state}`}>
                  <span className="timer-scale-step-index">{pour.index}</span>
                  <span className="timer-scale-step-g mono">{pour.targetG}g</span>
                  <span className="timer-scale-step-add mono muted">+{steps[index]?.waterG ?? 0}</span>
                </li>
              );
            })}
          </ol>

          {focus === undefined || focusDone ? null : (
            <section className="timer-scale-detail">
              <dl className="timer-scale-detail-grid">
                <div>
                  <dt>湯温</dt>
                  <dd className="mono">{tempOf(focus)}℃</dd>
                </div>
                <div>
                  <dt>この投の開始</dt>
                  <dd className="mono">{formatSeconds(focus.startSec)}</dd>
                </div>
                <div>
                  <dt>{progress.next ? '次の投まで' : '終了まで'}</dt>
                  <dd className="mono">{formatSeconds(remainSec)}</dd>
                </div>
                <div>
                  <dt>{progress.next ? '次の目標' : '最終累計'}</dt>
                  <dd className="mono">{(progress.next ?? focus).targetG}g</dd>
                </div>
              </dl>
            </section>
          )}
        </>
      )}

      <div className="timer-stage-actions">
        {stopwatch.running ? (
          <button className="timer-stage-main" type="button" onClick={stopwatch.pause}>
            停止
          </button>
        ) : (
          <button className="timer-stage-main primary" type="button" disabled={finished} onClick={start}>
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
