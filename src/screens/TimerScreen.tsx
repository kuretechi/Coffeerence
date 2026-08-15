import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, formatSeconds } from '../ui/components';
import { useRecipes, useSettings } from '../ui/data';
import { FinishCharacter } from '../ui/FinishCharacter';
import { chime, doubleChime, primeAudio, useStopwatch } from '../ui/useTimer';
import { saveBrew } from '../db/repo';
import { uid } from '../lib/random';
import { pourProgress, toSteps } from '../lib/pours';
import type { BrewRecord, Pour } from '../domain/types';

const RING_R = 132;
const RING_C = 2 * Math.PI * RING_R;

export function TimerScreen() {
  const recipes = useRecipes();
  const settings = useSettings();
  const navigate = useNavigate();
  const stopwatch = useStopwatch();
  const [recipeId, setRecipeId] = useState('');
  // 抽出終了ごとに増やし、キャラを出し直す。
  const [cheerRun, setCheerRun] = useState(0);
  const hideCheer = useCallback(() => setCheerRun(0), []);

  const selectedId = recipeId || recipes[0]?.id || '';
  const recipe = recipes.find((item) => item.id === selectedId);
  const pours = recipe?.pours ?? [];
  const steps = toSteps(pours);
  const progress = pourProgress(pours, stopwatch.elapsed);
  const announcedIndex = useRef(0);
  const finishSec = recipe?.finishSec;
  const finished = finishSec !== undefined && stopwatch.elapsed >= finishSec;
  /** 終了の2回鳴らしだけ別の音にできる。未設定なら合図音と同じ。 */
  const finishSoundId = settings.finishSoundId ?? settings.soundId;

  // リングは「次の合図まで」の進みを表す。次がなければ抽出終了までを使う。
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
    if (index > announcedIndex.current && stopwatch.running) chime(settings.soundEnabled, settings.soundId);
    announcedIndex.current = index;
  }, [progress.current?.index, stopwatch.running, settings.soundEnabled, settings.soundId]);

  // 抽出終了時間に達したら計測を止めて知らせる。
  useEffect(() => {
    if (!finished || !stopwatch.running) return;
    stopwatch.pause();
    doubleChime(settings.soundEnabled, finishSoundId);
    setCheerRun((run) => run + 1);
  }, [finished, stopwatch, settings.soundEnabled, finishSoundId]);

  function start() {
    primeAudio(settings.soundEnabled, settings.soundId);
    primeAudio(settings.soundEnabled, finishSoundId);
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

  const headline = finished
    ? '抽出終了'
    : pours.length === 0
    ? '注湯の内訳なし'
    : !stopwatch.running && stopwatch.elapsed === 0
    ? `1投目 ${pours[0]?.targetG ?? 0}gまで`
    : progress.current
    ? `${progress.current.index}投目 ${progress.current.targetG}gまで`
    : `まもなく 1投目`;

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
          <circle className="ring-track" cx="150" cy="150" r={RING_R} />
          <circle
            className="ring-value"
            cx="150"
            cy="150"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - ratio)}
            transform="rotate(-90 150 150)"
          />
        </svg>
        <div className="timer-stage-center">
          <span className="timer-stage-elapsed mono">{formatSeconds(stopwatch.elapsed)}</span>
          <span className="timer-stage-headline">{headline}</span>
          <span className="timer-stage-remain muted">
            {finished
              ? '抽出終了です'
              : progress.next
              ? `次まで ${formatSeconds(remainSec)}`
              : finishSec === undefined
              ? '注湯完了'
              : `抽出終了まで ${formatSeconds(remainSec)}`}
          </span>
        </div>
      </div>

      {pours.length === 0 ? (
        recipe ? <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner> : null
      ) : (
        <ol className="timer-stage-chips">
          {pours.map((pour, index) => (
            <li key={pour.index} className={progress.current?.index === pour.index ? 'current' : ''}>
              <span className="chip-time mono">{formatSeconds(pour.startSec)}</span>
              <span className="chip-main">{pour.index}投目</span>
              <span className="chip-sub mono muted">
                {steps[index]?.waterG ?? 0}g / {tempOf(pour)}℃
              </span>
            </li>
          ))}
          {finishSec === undefined ? null : (
            <li className={finished ? 'current' : ''}>
              <span className="chip-time mono">{formatSeconds(finishSec)}</span>
              <span className="chip-main">終了</span>
              <span className="chip-sub mono muted">—</span>
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
      {cheerRun === 0 ? null : <FinishCharacter key={cheerRun} onDone={hideCheer} />}
    </div>
  );
}
