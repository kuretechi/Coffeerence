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

/** アークは下側を 60° 空けた 300° 分だけ描き、空けた側に数字ラベルを置く。 */
const ARC_SWEEP = 300 / 360;
/** 0° = 真上、時計回り。300° 分の開始角。 */
const ARC_START_DEG = 210;
/** 数字ラベルを置く角度（下の切れ目の中）。 */
const ARC_LABEL_DEG = 164;
/** 内側（1投目）のアーク半径と、外側へ向かう間隔。 */
const ARC_INNER_R = 72;
const ARC_GAP = 16;
/** アークを円内に収める外側の限界。 */
const ARC_OUTER_R = 138;

/** 同心アーク1本ぶん。半径は投の順番で決まる。 */
interface DialArc {
  key: string;
  radius: number;
  /** 0=未着手、1=塗り切り。 */
  fill: number;
  done: boolean;
  active: boolean;
  label: string;
}

/** 中心 (150,150) から見た点。0° = 真上、時計回り。 */
function polar(radius: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: 150 + radius * Math.sin(rad), y: 150 - radius * Math.cos(rad) };
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

  // いま見せる投。開始前は1投目、注ぎ切ったあとも最後の投の数値を残す。
  const activeIndex = progress.current
    ? Math.max(
        pours.findIndex((pour) => pour.index === progress.current?.index),
        0,
      )
    : 0;
  const activePour = pours[activeIndex];
  const activeStep = steps[activeIndex];

  // 内側=1投目、外側=最後の投。本数が多いときは間隔を詰めて円内に収める。
  const gap =
    pours.length > 1 ? Math.min(ARC_GAP, (ARC_OUTER_R - ARC_INNER_R) / (pours.length - 1)) : ARC_GAP;
  const arcs: DialArc[] = pours.map((pour, position) => {
    const startSec = pour.startSec;
    const endSec = pours[position + 1]?.startSec ?? finishSec ?? startSec;
    const span = Math.max(endSec - startSec, 1);
    const done = finished || stopwatch.elapsed >= endSec;
    return {
      key: `arc-${pour.index}`,
      radius: ARC_INNER_R + gap * position,
      fill: done ? 1 : Math.min(Math.max((stopwatch.elapsed - startSec) / span, 0), 1),
      done,
      active: !done && position === activeIndex && progress.current !== undefined,
      label: `${pour.targetG}`,
    };
  });

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

      <div className="timer-dial">
        <svg viewBox="0 0 300 300" role="timer" aria-label={formatSeconds(stopwatch.elapsed)}>
          {arcs.map((arc) => {
            const circumference = 2 * Math.PI * arc.radius;
            const visible = circumference * ARC_SWEEP;
            const rotate = `rotate(${ARC_START_DEG - 90} 150 150)`;
            return (
              <g key={arc.key}>
                <circle
                  className="dial-arc-track"
                  cx="150"
                  cy="150"
                  r={arc.radius}
                  strokeDasharray={`${visible} ${circumference}`}
                  transform={rotate}
                />
                {arc.fill > 0 ? (
                  <circle
                    className={`dial-arc-value${arc.done ? ' done' : ''}${arc.active ? ' active' : ''}`}
                    cx="150"
                    cy="150"
                    r={arc.radius}
                    strokeDasharray={`${visible * arc.fill} ${circumference}`}
                    transform={rotate}
                  />
                ) : null}
              </g>
            );
          })}
          {arcs.map((arc) => {
            const at = polar(arc.radius, ARC_LABEL_DEG);
            return (
              <text
                key={`${arc.key}-label`}
                className={`dial-arc-label${arc.done ? ' done' : ''}${arc.active ? ' active' : ''}`}
                x={at.x}
                y={at.y}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {arc.label}
              </text>
            );
          })}
        </svg>
        <div className="timer-dial-center">
          <span className="timer-dial-elapsed mono">{formatSeconds(stopwatch.elapsed)}</span>
          <span className="timer-dial-target mono">{activePour ? `${activePour.targetG}g` : '—'}</span>
        </div>
      </div>

      {recipe && pours.length === 0 ? (
        <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner>
      ) : null}

      {activePour ? (
        <article className="timer-now" aria-live="polite">
          <span className="timer-now-edge" style={{ transform: `scaleX(${finished ? 1 : ratio})` }} />
          <header className="timer-now-head">
            <span className="timer-now-index mono">
              <strong>{activePour.index}</strong>
              <span className="timer-now-slash">/</span>
              {pours.length}
            </span>
            <span className="timer-now-mark mono muted">
              {finished ? '済' : progress.current ? formatSeconds(activePour.startSec) : '予定'}
            </span>
          </header>
          <dl className="timer-now-grid">
            <div>
              <dt>この投</dt>
              <dd className="mono">{activeStep?.waterG ?? 0}g</dd>
            </div>
            <div>
              <dt>累計</dt>
              <dd className="mono">{activePour.targetG}g</dd>
            </div>
            <div>
              <dt>湯温</dt>
              <dd className="mono">{tempOf(activePour)}℃</dd>
            </div>
            <div>
              <dt>{finished ? '終了' : progress.next ? '次まで' : '終了まで'}</dt>
              <dd className="mono">{finished ? formatSeconds(finishSec ?? 0) : formatSeconds(remainSec)}</dd>
            </div>
          </dl>
        </article>
      ) : null}

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
