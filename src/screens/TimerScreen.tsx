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

const VIEW = 360;
const CENTER = VIEW / 2;
const RING_R = 156;
const RING_C = 2 * Math.PI * RING_R;
const LABEL_R = 114;
/** 文字盤は真上に隙間を残した 0.9 周ぶんで一杯ぶんを表す。始点と終点が重ならない。 */
const SWEEP = 0.9;
const TICK_INNER = RING_R - 14;
const TICK_OUTER = RING_R + 14;
const RESET_HOLD_MS = 700;

/** 文字盤上の位置（0＝真上、1＝一杯ぶんの終点）から座標を出す。 */
function pointAt(ratio: number, radius: number): { x: number; y: number } {
  const angle = ratio * SWEEP * 2 * Math.PI - Math.PI / 2;
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

export function TimerScreen() {
  const recipes = useRecipes();
  const settings = useSettings();
  const navigate = useNavigate();
  const stopwatch = useStopwatch();
  const [recipeId, setRecipeId] = useState('');
  const [resetHint, setResetHint] = useState(false);
  // 抽出終了ごとに増やし、キャラを出し直す。
  const [cheerRun, setCheerRun] = useState(0);
  const hideCheer = useCallback(() => setCheerRun(0), []);

  const selectedId = recipeId || recipes[0]?.id || '';
  const recipe = recipes.find((item) => item.id === selectedId);
  const pours = recipe?.pours ?? [];
  const steps = toSteps(pours);
  const progress = pourProgress(pours, stopwatch.elapsed);
  const announcedIndex = useRef(0);
  const holdTimer = useRef<number>(0);
  const finishSec = recipe?.finishSec;
  const finished = finishSec !== undefined && stopwatch.elapsed >= finishSec;
  /** 終了の2回鳴らしだけ別の音にできる。未設定なら合図音と同じ。 */
  const finishSoundId = settings.finishSoundId ?? settings.soundId;

  // 文字盤は抽出全体（0秒〜終了）を一周に対応させ、各投を時計の目盛りとして置く。
  const totalSec = Math.max(finishSec ?? pours[pours.length - 1]?.startSec ?? 0, 1);
  const ratio = Math.min(Math.max(stopwatch.elapsed / totalSec, 0), 1);
  const head = pointAt(ratio, RING_R);

  const segmentEnd = progress.next?.startSec ?? finishSec ?? stopwatch.elapsed;
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

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  function start() {
    primeAudio(settings.soundEnabled, settings.soundId);
    primeAudio(settings.soundEnabled, finishSoundId);
    // 開始時点で達している投（通常は1投目）はこの合図をそのまま使う。
    announcedIndex.current = progress.current?.index ?? 0;
    chime(settings.soundEnabled, settings.soundId);
    stopwatch.start();
  }

  function reset() {
    holdTimer.current = 0;
    announcedIndex.current = 0;
    stopwatch.reset();
    setResetHint(false);
  }

  // 大会中の誤タップで計測が消えないよう、リセットは長押しでのみ確定させる。
  function holdStart() {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(reset, RESET_HOLD_MS);
  }

  function holdEnd() {
    if (holdTimer.current) setResetHint(true);
    window.clearTimeout(holdTimer.current);
    holdTimer.current = 0;
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
    <div className={stopwatch.running ? 'timer-hud running' : 'timer-hud'}>
      {recipes.length === 0 ? (
        <Banner>先にレシピを登録してください。</Banner>
      ) : (
        <select
          className="timer-hud-recipe"
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

      <div className="timer-hud-dial">
        <svg viewBox={`0 0 ${VIEW} ${VIEW}`} role="timer" aria-label={formatSeconds(stopwatch.elapsed)}>
          <circle
            className="ring-track"
            cx={CENTER}
            cy={CENTER}
            r={RING_R}
            strokeDasharray={`${RING_C * SWEEP} ${RING_C}`}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
          <circle
            className="ring-value"
            cx={CENTER}
            cy={CENTER}
            r={RING_R}
            strokeDasharray={`${RING_C * SWEEP * ratio} ${RING_C}`}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
          {pours.map((pour, index) => {
            const at = Math.min(pour.startSec / totalSec, 1);
            const inner = pointAt(at, TICK_INNER);
            const outer = pointAt(at, TICK_OUTER);
            const label = pointAt(at, LABEL_R);
            const state =
              progress.current?.index === pour.index && !finished
                ? 'current'
                : pour.startSec <= stopwatch.elapsed
                ? 'done'
                : 'ahead';
            return (
              <g key={pour.index} className={`dial-mark ${state}`}>
                <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
                <text x={label.x} y={label.y} textAnchor="middle" className="dial-index">
                  {pour.index}
                </text>
                <text x={label.x} y={label.y + 16} textAnchor="middle" className="dial-target">
                  {steps[index]?.waterG ?? 0}g
                </text>
              </g>
            );
          })}
          {finishSec === undefined ? null : (
            <g className={finished ? 'dial-mark current' : 'dial-mark ahead'}>
              <line
                x1={pointAt(1, TICK_INNER).x}
                y1={pointAt(1, TICK_INNER).y}
                x2={pointAt(1, TICK_OUTER).x}
                y2={pointAt(1, TICK_OUTER).y}
              />
              <text x={pointAt(1, LABEL_R).x} y={pointAt(1, LABEL_R).y} textAnchor="middle" className="dial-target">
                終了
              </text>
            </g>
          )}
          {stopwatch.elapsed === 0 ? null : <circle className="dial-head" cx={head.x} cy={head.y} r={10} />}
        </svg>
        <div className="timer-hud-center">
          <span className="timer-hud-elapsed mono">{formatSeconds(stopwatch.elapsed)}</span>
          <span className="timer-hud-headline">{headline}</span>
          <span className="timer-hud-remain">
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

      {pours.length === 0 && recipe ? (
        <Banner>このレシピには注湯の内訳が未登録です。レシピ画面で何投目に何g注ぐかを登録できます。</Banner>
      ) : null}

      <p className="timer-hud-legend mono">
        {progress.current
          ? `湯温 ${tempOf(progress.current)}℃ ／ 全 ${pours.length}投 ／ 終了 ${formatSeconds(totalSec)}`
          : `全 ${pours.length}投 ／ 終了 ${formatSeconds(totalSec)}`}
      </p>

      <div className="timer-hud-actions">
        {stopwatch.running ? (
          <button className="timer-hud-main" type="button" onClick={stopwatch.pause}>
            停止
          </button>
        ) : (
          <button className="timer-hud-main primary" type="button" disabled={finished} onClick={start}>
            開始
          </button>
        )}
        <div className="timer-hud-sub">
          <button
            type="button"
            aria-label="リセット（長押し）"
            onPointerDown={holdStart}
            onPointerUp={holdEnd}
            onPointerLeave={holdEnd}
            onPointerCancel={holdEnd}
          >
            リセット（長押し）
          </button>
          {recipes.length === 0 ? null : (
            <button type="button" disabled={stopwatch.elapsed === 0} onClick={() => void finish()}>
              記録して味評価へ
            </button>
          )}
        </div>
      </div>
      {resetHint ? <p className="timer-hud-note muted">リセットは長押しで確定します。</p> : null}
      {settings.soundEnabled ? null : <Banner>設定でタイマー音をオフにしています。</Banner>}
      {cheerRun === 0 ? null : <FinishCharacter key={cheerRun} onDone={hideCheer} />}
    </div>
  );
}
