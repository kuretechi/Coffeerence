import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, formatSeconds } from '../ui/components';
import { useRecipes, useSettings } from '../ui/data';
import { chime, doubleChime, primeAudio, useStopwatch } from '../ui/useTimer';
import { saveBrew } from '../db/repo';
import { uid } from '../lib/random';
import { pourProgress, toSteps } from '../lib/pours';
import type { BrewRecord, Pour } from '../domain/types';

const OUTER_R = 132;
const OUTER_C = 2 * Math.PI * OUTER_R;
const INNER_R = 104;
const INNER_C = 2 * Math.PI * INNER_R;
const TICK_INNER_R = OUTER_R - 11;
const TICK_OUTER_R = OUTER_R + 11;

/** 円周上の点。0秒を真上に置き、時計回りに進める。 */
function pointAt(ratio: number, radius: number): { x: number; y: number } {
  const angle = (ratio * 2 - 0.5) * Math.PI;
  return { x: 150 + radius * Math.cos(angle), y: 150 + radius * Math.sin(angle) };
}

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

  // 内周リングは「次の合図まで」の進みを表す。次がなければ抽出終了までを使う。
  const segmentStart = progress.current?.startSec ?? 0;
  const segmentEnd = progress.next?.startSec ?? finishSec ?? segmentStart;
  const segmentLength = Math.max(segmentEnd - segmentStart, 1);
  const segmentRatio = Math.min(Math.max((stopwatch.elapsed - segmentStart) / segmentLength, 0), 1);
  const remainSec = Math.max(segmentEnd - stopwatch.elapsed, 0);

  // 外周リングは抽出全体（0秒 → 落ち切り）の進みを表す。
  // 落ち切り時間が未登録なら、最後の投のあとに直前の間隔ぶんだけ足した時間を全体とみなす。
  const lastStart = pours[pours.length - 1]?.startSec ?? 0;
  const lastGap = pours.length >= 2 ? lastStart - pours[pours.length - 2].startSec : 30;
  const totalSec = Math.max(finishSec ?? lastStart + lastGap, 1);
  const totalRatio = Math.min(Math.max(stopwatch.elapsed / totalSec, 0), 1);

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

  return (
    <div className="timer-stage">
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

      <div className="timer-stage-ring">
        <svg viewBox="0 0 300 300" role="timer" aria-label={formatSeconds(stopwatch.elapsed)}>
          <circle className="ring-track" cx="150" cy="150" r={OUTER_R} />
          <circle
            className="ring-value"
            cx="150"
            cy="150"
            r={OUTER_R}
            strokeDasharray={OUTER_C}
            strokeDashoffset={OUTER_C * (1 - totalRatio)}
            transform="rotate(-90 150 150)"
          />
          {pours.map((pour) => {
            const at = Math.min(pour.startSec / totalSec, 1);
            const from = pointAt(at, TICK_INNER_R);
            const to = pointAt(at, TICK_OUTER_R);
            return (
              <line
                key={pour.index}
                className={progress.current?.index === pour.index ? 'ring-tick current' : 'ring-tick'}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          })}
          <circle className="ring-track inner" cx="150" cy="150" r={INNER_R} />
          <circle
            className="ring-value inner"
            cx="150"
            cy="150"
            r={INNER_R}
            strokeDasharray={INNER_C}
            strokeDashoffset={INNER_C * (1 - segmentRatio)}
            transform="rotate(-90 150 150)"
          />
        </svg>
        <div className="timer-stage-center">
          <span className="timer-stage-elapsed mono">{formatSeconds(stopwatch.elapsed)}</span>
          <span className="timer-stage-remain muted">
            {finished
              ? '抽出終了です'
              : progress.next
              ? `次まで ${formatSeconds(remainSec)}`
              : finishSec === undefined
              ? '注湯完了'
              : `終了まで ${formatSeconds(remainSec)}`}
          </span>
        </div>
      </div>

      {pours.length === 0 ? (
        recipe ? <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner> : null
      ) : (
        <ol className="timer-stage-steps">
          {pours.map((pour, index) => {
            const current = progress.current?.index === pour.index && !finished;
            const done = !current && stopwatch.elapsed >= pour.startSec && stopwatch.elapsed > 0;
            return (
              <li key={pour.index} className={current ? 'current' : done ? 'done' : ''}>
                <span className="step-time mono">{formatSeconds(pour.startSec)}</span>
                <span className="step-main">{pour.index}投目 {steps[index]?.waterG ?? 0}g</span>
                <span className="step-sub mono">累計 {pour.targetG}g / {tempOf(pour)}℃</span>
              </li>
            );
          })}
          {finishSec === undefined ? null : (
            <li className={finished ? 'current' : ''}>
              <span className="step-time mono">{formatSeconds(finishSec)}</span>
              <span className="step-main">落ち切り</span>
              <span className="step-sub mono">—</span>
            </li>
          )}
        </ol>
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
