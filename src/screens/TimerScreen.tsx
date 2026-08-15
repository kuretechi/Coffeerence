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

/** タイムライン1枚ぶんの表示内容。注湯の投と、落ち切りの終了札を同じ形で扱う。 */
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

  // 進捗ラインは「次の合図まで」の進みを表す。次がなければ抽出終了までを使う。
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

  // 投カードに落ち切りの終了札を足したものがタイムライン。並びはそのまま時系列。
  const deck: DeckCard[] = pours.map((pour, position) => ({
    key: `pour-${pour.index}`,
    startSec: pour.startSec,
    index: pour.index,
    waterG: steps[position]?.waterG ?? 0,
    targetG: pour.targetG,
    tempC: tempOf(pour),
  }));
  if (finishSec !== undefined) deck.push({ key: 'finish', startSec: finishSec });

  // 中央に来るのは「いま注ぐ投」。注ぎ切ったら終了札が中央に来る。
  const focusIndex = progress.current
    ? pours.findIndex((pour) => pour.index === progress.current?.index)
    : 0;
  const poured = progress.current !== undefined && progress.next === undefined;
  const activeIndex =
    deck.length === 0 ? 0 : finishSec !== undefined && (finished || poured) ? deck.length - 1 : Math.max(focusIndex, 0);

  // スクロール位置＝時間軸。進行に合わせて現在のカードを画面中央に寄せる。
  const laneRef = useRef<HTMLOListElement | null>(null);
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    const lane = laneRef.current;
    const card = cardRefs.current[activeIndex];
    if (!lane || !card) return;
    const top = card.offsetTop - (lane.clientHeight - card.offsetHeight) / 2;
    if (typeof lane.scrollTo === 'function') lane.scrollTo({ top, behavior: 'smooth' });
    else lane.scrollTop = top;
  }, [activeIndex, deck.length]);

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

      <div className="timer-line" role="timer" aria-label={formatSeconds(stopwatch.elapsed)}>
        <span className="timer-line-track">
          <span className="timer-line-value" style={{ transform: `scaleX(${ratio})` }} />
        </span>
        <span className="timer-line-elapsed mono">{formatSeconds(stopwatch.elapsed)}</span>
      </div>

      {recipe && pours.length === 0 ? (
        <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner>
      ) : null}

      {deck.length === 0 ? null : (
        <ol className="timer-lane" ref={laneRef}>
          {deck.map((card, position) => {
            const isActive = position === activeIndex;
            const done = position < activeIndex;
            return (
              <li
                key={card.key}
                ref={(node) => {
                  cardRefs.current[position] = node;
                }}
                className={`timer-lane-card${isActive ? ' now' : ''}${done ? ' done' : ''}`}
                aria-live={isActive ? 'polite' : undefined}
              >
                <span className="timer-lane-gauge" aria-hidden="true">
                  <span
                    className="timer-lane-gauge-fill"
                    style={{ transform: `scaleY(${isActive ? 1 - ratio : done ? 0 : 1})` }}
                  />
                </span>
                <div className="timer-lane-body">
                  <header className="timer-lane-head">
                    <span className="timer-lane-at mono">{formatSeconds(card.startSec)}</span>
                    {card.index === undefined ? (
                      <span className="timer-lane-mark">◆ 落ち切り</span>
                    ) : (
                      <span className="timer-lane-no mono">
                        {card.index}
                        <small>投</small>
                      </span>
                    )}
                    <span className="timer-lane-state mono muted">
                      {isActive ? formatSeconds(remainSec) : done ? '済' : '予定'}
                    </span>
                  </header>
                  {card.index === undefined ? null : (
                    <dl className="timer-lane-nums">
                      <div>
                        <dt>累計</dt>
                        <dd className="mono">{card.targetG}g</dd>
                      </div>
                      <div>
                        <dt>この投</dt>
                        <dd className="mono">{card.waterG}g</dd>
                      </div>
                      <div>
                        <dt>湯温</dt>
                        <dd className="mono">{card.tempC}℃</dd>
                      </div>
                    </dl>
                  )}
                </div>
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
