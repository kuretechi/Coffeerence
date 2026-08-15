import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, formatSeconds } from '../ui/components';
import { useRecipes, useSettings } from '../ui/data';
import { FinishCharacter } from '../ui/FinishCharacter';
import { SAME_AS_CHIME_ID, chime, doubleChime, primeAudio, useStopwatch } from '../ui/useTimer';
import { saveBrew } from '../db/repo';
import { uid } from '../lib/random';
import { pourProgress, toSteps } from '../lib/pours';
import type { BrewRecord, Pour } from '../domain/types';

const RING_R = 132;
const RING_C = 2 * Math.PI * RING_R;
/** デッキで背面に覗かせる枚数。これより奥のカードは描かない。 */
const DECK_PEEK = 2;
/** スワイプと見なす横移動量(px)。 */
const SWIPE_PX = 40;

/** デッキ1枚ぶんの表示内容。注湯の投と、落ち切りの終了札を同じ形で扱う。 */
interface DeckCard {
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
  /** 終了の2回鳴らしだけ別の音にできる。 */
  const chosenFinishId = settings.finishSoundId ?? SAME_AS_CHIME_ID;
  const finishSoundId = chosenFinishId === SAME_AS_CHIME_ID ? settings.soundId : chosenFinishId;
  const pitch = settings.soundPitch ?? 0;
  const finishPitch = chosenFinishId === SAME_AS_CHIME_ID ? pitch : settings.finishSoundPitch ?? 0;

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
    if (index > announcedIndex.current && stopwatch.running) chime(settings.soundEnabled, settings.soundId, pitch);
    announcedIndex.current = index;
  }, [progress.current?.index, stopwatch.running, settings.soundEnabled, settings.soundId, pitch]);

  // 抽出終了時間に達したら計測を止めて知らせる。
  useEffect(() => {
    if (!finished || !stopwatch.running) return;
    stopwatch.pause();
    doubleChime(settings.soundEnabled, finishSoundId, finishPitch);
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

  const headline = finished
    ? '終了'
    : pours.length === 0
    ? ''
    : progress.current
    ? `${progress.current.index}投目 ${progress.current.targetG}g`
    : `1投目 ${pours[0]?.targetG ?? 0}g`;

  // 投カードに落ち切りの終了札を足したものがデッキ。並びはそのまま時系列。
  const deck: DeckCard[] = pours.map((pour, position) => ({
    key: `pour-${pour.index}`,
    startSec: pour.startSec,
    index: pour.index,
    waterG: steps[position]?.waterG ?? 0,
    targetG: pour.targetG,
    tempC: tempOf(pour),
  }));
  if (finishSec !== undefined) deck.push({ key: 'finish', startSec: finishSec });

  // 前面に来るのは「いま注ぐ投」。注ぎ切ったら終了札が前面に出る。
  const focusIndex = progress.current
    ? pours.findIndex((pour) => pour.index === progress.current?.index)
    : 0;
  const poured = progress.current !== undefined && progress.next === undefined;
  const activeIndex =
    deck.length === 0 ? 0 : finishSec !== undefined && (finished || poured) ? deck.length - 1 : Math.max(focusIndex, 0);

  // 手前/奥を手で覗くためのずれ。計測が次の投に進んだら自動で解除する。
  const [peek, setPeek] = useState(0);
  useEffect(() => {
    setPeek(0);
  }, [activeIndex]);
  const viewIndex = Math.min(Math.max(activeIndex + peek, 0), Math.max(deck.length - 1, 0));
  const peeking = viewIndex !== activeIndex;
  const touchX = useRef<number | undefined>(undefined);

  function movePeek(delta: number) {
    const next = Math.min(Math.max(viewIndex + delta, 0), Math.max(deck.length - 1, 0));
    setPeek(next - activeIndex);
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

      <div className="timer-stage-ring timer-deck-ring">
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
        </div>
      </div>

      {recipe && pours.length === 0 ? (
        <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner>
      ) : null}

      {deck.length === 0 ? null : (
        <>
          <div
            className="timer-deck"
            onTouchStart={(event) => {
              touchX.current = event.touches[0]?.clientX;
            }}
            onTouchEnd={(event) => {
              const from = touchX.current;
              const to = event.changedTouches[0]?.clientX;
              touchX.current = undefined;
              if (from === undefined || to === undefined) return;
              if (Math.abs(to - from) < SWIPE_PX) return;
              movePeek(to > from ? -1 : 1);
            }}
          >
            {deck.map((card, position) => {
              const depth = position - viewIndex;
              if (depth < 0 || depth > DECK_PEEK) return null;
              const front = depth === 0;
              const isActive = position === activeIndex;
              const done = position < activeIndex;
              return (
                <article
                  key={card.key}
                  className={`timer-deck-card${front ? ' front' : ''}${done ? ' done' : ''}${
                    front && !isActive ? ' peek' : ''
                  }`}
                  data-depth={depth}
                  aria-hidden={front ? undefined : true}
                  aria-live={front ? 'polite' : undefined}
                >
                  {front ? (
                    <span
                      className="timer-deck-edge"
                      style={{ transform: `scaleX(${isActive ? ratio : 0})` }}
                    />
                  ) : null}
                  <header className="timer-deck-head">
                    <span className="timer-deck-label">
                      {card.index === undefined
                        ? finished
                          ? '終了'
                          : '落ち切り'
                        : done
                        ? '済'
                        : isActive
                        ? ''
                        : '予定'}
                    </span>
                    <span className="timer-deck-at mono muted">{formatSeconds(card.startSec)}〜</span>
                  </header>
                  {card.index === undefined ? (
                    <p className="timer-deck-done mono">
                      {finished ? formatSeconds(card.startSec) : formatSeconds(isActive ? remainSec : card.startSec)}
                    </p>
                  ) : (
                    <>
                      <p className="timer-deck-title">
                        <strong className="timer-deck-index">{card.index}</strong>投目
                      </p>
                      <dl className="timer-deck-grid">
                        <div>
                          <dt>この投</dt>
                          <dd className="mono">{card.waterG}g</dd>
                        </div>
                        <div>
                          <dt>累計まで</dt>
                          <dd className="mono">{card.targetG}g</dd>
                        </div>
                        <div>
                          <dt>湯温</dt>
                          <dd className="mono">{card.tempC}℃</dd>
                        </div>
                        <div>
                          <dt>{isActive ? (progress.next ? '次まで' : '終了まで') : '開始'}</dt>
                          <dd className="mono">
                            {isActive ? formatSeconds(remainSec) : formatSeconds(card.startSec)}
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                </article>
              );
            })}
          </div>

          <div className="timer-deck-nav">
            <button
              type="button"
              className="timer-deck-arrow"
              aria-label="1枚前を見る"
              disabled={viewIndex === 0}
              onClick={() => movePeek(-1)}
            >
              ‹
            </button>
            <span className="timer-deck-count mono muted">
              {peeking ? (
                <button type="button" className="timer-deck-back" onClick={() => setPeek(0)}>
                  現在
                </button>
              ) : (
                `${viewIndex + 1} / ${deck.length}`
              )}
            </span>
            <button
              type="button"
              className="timer-deck-arrow"
              aria-label="1枚先を見る"
              disabled={viewIndex >= deck.length - 1}
              onClick={() => movePeek(1)}
            >
              ›
            </button>
          </div>
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
      {cheerRun === 0 ? null : <FinishCharacter key={cheerRun} onDone={hideCheer} />}
    </div>
  );
}
