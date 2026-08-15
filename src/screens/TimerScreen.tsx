import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, formatSeconds } from '../ui/components';
import { useRecipes, useSettings } from '../ui/data';
import { FinishCharacter } from '../ui/FinishCharacter';
import { SevenSegment } from '../ui/SevenSegment';
import { SAME_AS_CHIME_ID, chime, primeAudio, useStopwatch } from '../ui/useTimer';
import { saveBrew } from '../db/repo';
import { uid } from '../lib/random';
import { pourProgress, toSteps } from '../lib/pours';
import type { BrewRecord, Pour } from '../domain/types';

/** 進捗リスト1行ぶん。注湯の投と落ち切りを同じ形で並べる。 */
interface Segment {
  key: string;
  startSec: number;
  index?: number;
  waterG?: number;
  targetG?: number;
  tempC?: number;
}

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
  /** 終了の合図だけ別の音にできる。 */
  const chosenFinishId = settings.finishSoundId ?? SAME_AS_CHIME_ID;
  const finishSoundId = chosenFinishId === SAME_AS_CHIME_ID ? settings.soundId : chosenFinishId;
  const pitch = settings.soundPitch ?? 0;
  const finishPitch = chosenFinishId === SAME_AS_CHIME_ID ? pitch : settings.finishSoundPitch ?? 0;

  // 「次の合図まで」の進み。次がなければ抽出終了までを使う。
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
    if (index > announcedIndex.current && stopwatch.running) chime(settings.soundEnabled, settings.soundId, pitch);
    announcedIndex.current = index;
  }, [progress.current?.index, stopwatch.running, settings.soundEnabled, settings.soundId, pitch]);

  // 抽出終了時間に達したら計測を止めて知らせる。
  useEffect(() => {
    if (!finished || !stopwatch.running) return;
    stopwatch.pause();
    chime(settings.soundEnabled, finishSoundId, finishPitch);
    setCheerRun((run) => run + 1);
  }, [finished, stopwatch, settings.soundEnabled, finishSoundId, finishPitch]);

  function start() {
    primeAudio(settings.soundEnabled, settings.soundId);
    primeAudio(settings.soundEnabled, finishSoundId);
    // 開始時点で達している投（通常は1投目）はこの合図をそのまま使う。
    announcedIndex.current = progress.current?.index ?? 0;
    chime(settings.soundEnabled, settings.soundId, pitch);
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

  // 投＋落ち切りを時系列に並べ、各1セグメントとして扱う。
  const segments: Segment[] = pours.map((pour, position) => ({
    key: `pour-${pour.index}`,
    startSec: pour.startSec,
    index: pour.index,
    waterG: steps[position]?.waterG ?? 0,
    targetG: pour.targetG,
    tempC: tempOf(pour),
  }));
  if (finishSec !== undefined) {
    segments.push({ key: 'finish', startSec: finishSec });
  }

  // 進んでいるセグメント。注ぎ切ったら落ち切りのセグメントに移る。
  const focusIndex = progress.current
    ? pours.findIndex((pour) => pour.index === progress.current?.index)
    : 0;
  const poured = progress.current !== undefined && progress.next === undefined;
  const activeIndex =
    segments.length === 0
      ? 0
      : finishSec !== undefined && (finished || poured)
      ? segments.length - 1
      : Math.max(focusIndex, 0);

  // いま何gまで注ぐか。まだ1投目に達していなければ1投目の目標を出す。
  const targetG = progress.current?.targetG ?? pours[0]?.targetG;
  const remainLabel = finished
    ? '終了'
    : progress.next
    ? '次まで'
    : finishSec !== undefined
    ? '落ち切りまで'
    : '終了まで';

  return (
    <div className="timer-stage timer-stage-z">
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

      <div className="timer-z-time">
        <span className="timer-z-time-label">経過</span>
        <SevenSegment className="timer-z-seg" value={formatSeconds(stopwatch.elapsed)} />
      </div>

      <div className="timer-z-pour" aria-live="polite">
        <p className="timer-z-pour-main">
          <span className="timer-z-pour-label">{poured ? '注いだ' : '注ぐ'}</span>
          <span className="timer-z-pour-value mono">
            {targetG ?? '--'}
            <i>g</i>
          </span>
          {poured ? null : <span className="timer-z-pour-upto">まで</span>}
        </p>
        <p className="timer-z-pour-side">
          <span className="timer-z-pour-label">{remainLabel}</span>
          <span className="timer-z-pour-remain mono">
            {segments.length === 0 ? '--:--' : formatSeconds(remainSec)}
          </span>
        </p>
      </div>

      {recipe && pours.length === 0 ? (
        <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner>
      ) : null}

      {segments.length === 0 ? null : (
        <ol className="timer-z-steps">
          {segments.map((segment, position) => {
            const done = position < activeIndex;
            const now = position === activeIndex;
            return (
              <li
                key={segment.key}
                className={`timer-z-step${done ? ' done' : ''}${now ? ' now' : ''}${
                  segment.index === undefined ? ' finish' : ''
                }`}
              >
                <i
                  className="timer-z-step-fill"
                  aria-hidden="true"
                  style={{ transform: `scaleX(${done ? 1 : now ? ratio : 0})` }}
                />
                <span className="timer-z-step-at mono">{formatSeconds(segment.startSec)}</span>
                <span className="timer-z-step-name">
                  {segment.index === undefined ? '落ち切り' : `${segment.index}投目`}
                </span>
                <span className="timer-z-step-target mono">
                  {segment.targetG === undefined ? '' : `${segment.targetG}g`}
                </span>
                {now && segment.index !== undefined ? (
                  <span className="timer-z-step-detail mono">
                    <b>＋{segment.waterG}g</b>
                    <em>{segment.tempC}℃</em>
                  </span>
                ) : null}
              </li>
            );
          })}
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
