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

/** 時間軸に並ぶ節点1つぶん。注湯の投と落ち切りを同じ形で並べる。 */
interface Segment {
  key: string;
  startSec: number;
  index?: number;
  waterG?: number;
  targetG?: number;
  tempC?: number;
}

/** 節点に達してからこの秒数のあいだは「注ぐ」局面として見せる。 */
const POUR_WINDOW_SEC = 10;

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
  const active = segments[activeIndex];

  // 軸の先頭に出す「いま何をする局面か」。単語だけで示す。
  const started = stopwatch.running || stopwatch.elapsed > 0;
  const phase =
    segments.length === 0
      ? '待機'
      : finished
      ? '完了'
      : !started
      ? '開始待ち'
      : active === undefined || active.index === undefined
      ? '落ち切り'
      : stopwatch.elapsed - active.startSec < POUR_WINDOW_SEC
      ? '注ぐ'
      : '待つ';
  // 終わったあとは残りでなくかかった全体の時間を見せる。
  const remainLabel = finished ? '総時間' : progress.next ? '次まで' : '落ち切りまで';
  const remainValue = finished ? stopwatch.elapsed : remainSec;

  return (
    <div className="timer-stage timer-stage-axis">
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

      <div className="timer-axis-head">
        <SevenSegment className="timer-axis-seg" value={formatSeconds(stopwatch.elapsed)} />
      </div>

      <p className="timer-axis-state" aria-live="polite">
        <span className="timer-axis-phase">{phase}</span>
        <span className="timer-axis-remain">
          <i>{remainLabel}</i>
          <b className="mono">{segments.length === 0 ? '--:--' : formatSeconds(remainValue)}</b>
        </span>
      </p>

      {recipe && pours.length === 0 ? (
        <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner>
      ) : null}

      {segments.length === 0 ? null : (
        <ol className="timer-axis">
          {segments.map((segment, position) => {
            const done = position < activeIndex;
            const now = position === activeIndex;
            return (
              <li
                key={segment.key}
                className={`timer-axis-node${done ? ' done' : ''}${now ? ' now' : ''}${
                  segment.index === undefined ? ' finish' : ''
                }`}
              >
                <span className="timer-axis-rail" aria-hidden="true">
                  <i style={{ transform: `scaleY(${done ? 1 : now ? ratio : 0})` }} />
                  <b />
                </span>
                <span className="timer-axis-at mono">{formatSeconds(segment.startSec)}</span>
                <span className="timer-axis-name">
                  {segment.index === undefined ? (
                    '落ち切り'
                  ) : (
                    <>
                      {segment.index}投目<i className="mono">/{pours.length}</i>
                    </>
                  )}
                </span>
                {segment.targetG === undefined ? (
                  <span className="timer-axis-target" />
                ) : (
                  <span className="timer-axis-target mono">
                    {segment.targetG}
                    <i>gまで</i>
                  </span>
                )}
                {now && segment.index !== undefined ? (
                  <dl className="timer-axis-detail">
                    <div>
                      <dt>この投</dt>
                      <dd className="mono">
                        {segment.waterG}
                        <i>g</i>
                      </dd>
                    </div>
                    <div>
                      <dt>湯温</dt>
                      <dd className="mono">
                        {segment.tempC}
                        <i>℃</i>
                      </dd>
                    </div>
                  </dl>
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
