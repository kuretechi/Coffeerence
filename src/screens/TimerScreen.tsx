import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, formatSeconds } from '../ui/components';
import { useRecipes, useSettings } from '../ui/data';
import { FinishCharacter } from '../ui/FinishCharacter';
import { SevenSegment } from '../ui/SevenSegment';
import { SAME_AS_CHIME_ID, chime, primeAudio, useStopwatch } from '../ui/useTimer';
import { saveBrew } from '../db/repo';
import { uid } from '../lib/random';
import { pourProgress, toSteps } from '../lib/pours';
import type { BrewRecord, Pour } from '../domain/types';

/** 計器盤のセグメントバー1本ぶん。注湯の投と落ち切りを同じ形で並べる。 */
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
  // レシピ閲覧画面から ?recipe=<id> で開くと、そのレシピが選ばれた状態で始まる。
  const [params] = useSearchParams();
  const [recipeId, setRecipeId] = useState(() => params.get('recipe') ?? '');
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
  const effect = settings.soundEffect ?? 'none';
  const finishEffect = chosenFinishId === SAME_AS_CHIME_ID ? effect : settings.finishSoundEffect ?? 'none';

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
    if (index > announcedIndex.current && stopwatch.running)
      chime(settings.soundEnabled, settings.soundId, pitch, effect);
    announcedIndex.current = index;
  }, [progress.current?.index, stopwatch.running, settings.soundEnabled, settings.soundId, pitch, effect]);

  // 抽出終了時間に達したら計測を止めて知らせる。
  useEffect(() => {
    if (!finished || !stopwatch.running) return;
    stopwatch.pause();
    chime(settings.soundEnabled, finishSoundId, finishPitch, finishEffect);
    setCheerRun((run) => run + 1);
  }, [finished, stopwatch, settings.soundEnabled, finishSoundId, finishPitch, finishEffect]);

  function start() {
    primeAudio(settings.soundEnabled, settings.soundId);
    primeAudio(settings.soundEnabled, finishSoundId);
    // 開始時点で達している投（通常は1投目）はこの合図をそのまま使う。
    announcedIndex.current = progress.current?.index ?? 0;
    chime(settings.soundEnabled, settings.soundId, pitch, effect);
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

  const targetG = progress.current?.targetG ?? pours[0]?.targetG;

  return (
    <div className="timer-stage timer-stage-gauges">
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

      <div className="timer-gauge">
        <div className="timer-gauge-cell timer-gauge-cell-wide">
          <SevenSegment className="timer-gauge-seg" value={formatSeconds(stopwatch.elapsed)} />
        </div>
        <div className="timer-gauge-cell" aria-label="累計">
          <span className="timer-gauge-sym mono" aria-hidden="true">
            Σ
          </span>
          <span className="timer-gauge-value mono">
            {targetG ?? '--'}
            <i>g</i>
          </span>
        </div>
        <div className="timer-gauge-cell" aria-label={progress.next ? '次まで' : '終了まで'}>
          <span className="timer-gauge-sym mono" aria-hidden="true">
            →
          </span>
          <span className="timer-gauge-value mono">
            {segments.length === 0 ? '--:--' : formatSeconds(remainSec)}
          </span>
        </div>
      </div>

      {segments.length === 0 ? null : (
        <div className="timer-seg" aria-hidden="true">
          {segments.map((segment, position) => {
            const done = position < activeIndex;
            const now = position === activeIndex;
            return (
              <span
                key={segment.key}
                className={`timer-seg-cell${done ? ' done' : ''}${now ? ' now' : ''}${
                  segment.index === undefined ? ' finish' : ''
                }`}
              >
                <i style={{ transform: `scaleX(${done ? 1 : now ? ratio : 0})` }} />
              </span>
            );
          })}
        </div>
      )}

      {recipe && pours.length === 0 ? (
        <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner>
      ) : null}

      {active === undefined ? null : (
        <article className={`timer-now${active.index === undefined ? ' finish' : ''}`} aria-live="polite">
          <div className="timer-now-index">
            {active.index === undefined ? (
              <span className="timer-now-mark mono" aria-hidden="true">
                ▪
              </span>
            ) : (
              <>
                <strong className="mono">{active.index}</strong>
                <span className="timer-now-of mono muted">/{pours.length}</span>
              </>
            )}
          </div>
          <dl className="timer-now-grid">
            {active.index === undefined ? null : (
              <>
                <div>
                  <dt aria-label="この投">＋</dt>
                  <dd className="mono">{active.waterG}g</dd>
                </div>
                <div>
                  <dt aria-label="湯温">℃</dt>
                  <dd className="mono">{active.tempC}</dd>
                </div>
              </>
            )}
            <div>
              <dt aria-label="開始">▶</dt>
              <dd className="mono">{formatSeconds(active.startSec)}</dd>
            </div>
          </dl>
        </article>
      )}

      {segments.length === 0 ? null : (
        <ol className="timer-cells">
          {segments.map((segment, position) => {
            const done = position < activeIndex;
            const now = position === activeIndex;
            return (
              <li
                key={segment.key}
                className={`timer-cells-item${done ? ' done' : ''}${now ? ' now' : ''}${
                  segment.index === undefined ? ' finish' : ''
                }`}
              >
                <span className="timer-cells-at mono">{formatSeconds(segment.startSec)}</span>
                <span className="timer-cells-value mono">
                  {segment.targetG === undefined ? '▪' : `${segment.targetG}g`}
                </span>
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
