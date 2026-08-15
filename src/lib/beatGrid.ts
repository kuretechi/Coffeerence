import type { BeatPattern, BeatTrack } from '../domain/types';

/** トラック数。1画面に収まり、かつ組みごたえのある数にする。 */
export const TRACK_COUNT = 8;

/** 1小節の拍数。4拍固定（ビートメイカーの用途では拍子の指定まではしない）。 */
export const BEATS_PER_BAR = 4;

/** 1拍のタイル数。16分音符のグリッドにする。 */
export const STEPS_PER_BEAT = 4;

export const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;

export const BPM_RANGE = { min: 40, max: 240 } as const;
export const BARS_RANGE = { min: 1, max: 4 } as const;

/** トラックの見出し。素材を入れていない行でも役割がわかるようにする。 */
export const TRACK_LABELS = ['キック', 'スネア', 'ハット', 'パーカス', 'ベース', 'コード', '声', '効果'] as const;

/** タイルの総数（= 1周のステップ数）。 */
export function stepCount(bars: number): number {
  return bars * STEPS_PER_BAR;
}

export function emptyTrack(bars: number): BeatTrack {
  return { steps: Array.from({ length: stepCount(bars) }, () => false), muted: false };
}

export const DEFAULT_PATTERN: BeatPattern = {
  id: 'pattern',
  bpm: 100,
  bars: 1,
  tracks: Array.from({ length: TRACK_COUNT }, () => emptyTrack(1)),
  volume: 0.8,
};

/** タイル1つぶんの秒数（16分音符）。 */
export function stepSeconds(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('bpm must be a positive number');
  return 60 / bpm / STEPS_PER_BEAT;
}

/** BPM と小節数からループ1周の秒数を出す。 */
export function loopSeconds(bpm: number, bars: number): number {
  if (!Number.isFinite(bars) || bars <= 0) throw new Error('bars must be a positive number');
  return stepSeconds(bpm) * stepCount(bars);
}

/** 拍の頭のタイルか（4つごとに強調して数えやすくする）。 */
export function isBeatHead(step: number): boolean {
  return step % STEPS_PER_BEAT === 0;
}

/** 小節の頭のタイルか。 */
export function isBarHead(step: number): boolean {
  return step % STEPS_PER_BAR === 0;
}

/** 盤面を保存できる値に整える（範囲外の入力やタイル数の不一致を直す）。 */
export function normalizePattern(pattern: BeatPattern): BeatPattern {
  const bpm = clamp(Math.round(pattern.bpm), BPM_RANGE.min, BPM_RANGE.max);
  const bars = clamp(Math.round(pattern.bars), BARS_RANGE.min, BARS_RANGE.max);
  const length = stepCount(bars);
  const tracks = Array.from({ length: TRACK_COUNT }, (_unused, i) => {
    const track = pattern.tracks[i];
    if (!track) return emptyTrack(bars);
    // 小節数を変えたときは、足りない分を無音で足し、余った分は捨てる。
    return { ...track, steps: Array.from({ length }, (_unusedStep, s) => track.steps[s] === true) };
  });
  return { ...pattern, bpm, bars, tracks, volume: clamp(pattern.volume, 0, 1) };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** タイルの入り切りを反転する。 */
export function toggleStep(tracks: readonly BeatTrack[], track: number, step: number): BeatTrack[] {
  return tracks.map((current, i) =>
    i === track ? { ...current, steps: current.steps.map((on, s) => (s === step ? !on : on)) } : current,
  );
}

/** トラックに素材を入れる（同じ素材を複数のトラックに入れてもよい）。 */
export function assignTrack(tracks: readonly BeatTrack[], track: number, soundId: string): BeatTrack[] {
  return tracks.map((current, i) => (i === track ? { ...current, soundId, muted: false } : current));
}

/** トラックの素材を外す。組んだタイルは残す。 */
export function clearTrack(tracks: readonly BeatTrack[], track: number): BeatTrack[] {
  return tracks.map((current, i) => (i === track ? { steps: current.steps, muted: false } : current));
}

/** トラックのタイルを全部消す。 */
export function eraseTrack(tracks: readonly BeatTrack[], track: number): BeatTrack[] {
  return tracks.map((current, i) => (i === track ? { ...current, steps: current.steps.map(() => false) } : current));
}

/** 全トラックのタイルを消す（素材はそのまま）。 */
export function eraseAll(tracks: readonly BeatTrack[]): BeatTrack[] {
  return tracks.map((track) => ({ ...track, steps: track.steps.map(() => false) }));
}

export function toggleMute(tracks: readonly BeatTrack[], track: number): BeatTrack[] {
  return tracks.map((current, i) => (i === track ? { ...current, muted: !current.muted } : current));
}

/** 素材を消したとき、その素材を指していたトラックから外す。 */
export function detachSound(tracks: readonly BeatTrack[], soundId: string): BeatTrack[] {
  return tracks.map((track) => (track.soundId === soundId ? { steps: track.steps, muted: false } : track));
}

/** そのステップで鳴るトラックの番号。素材なし・消音・タイル切りは鳴らさない。 */
export function firingTracks(tracks: readonly BeatTrack[], step: number): number[] {
  return tracks.flatMap((track, i) =>
    track.soundId !== undefined && !track.muted && track.steps[step] === true ? [i] : [],
  );
}

/** タイルが1つでも入っていて素材もあるトラックの数。 */
export function activeTrackCount(tracks: readonly BeatTrack[]): number {
  return tracks.filter((track) => track.soundId !== undefined && track.steps.some((on) => on)).length;
}

/** 「4.8秒」のような表示。1周の長さや素材の長さに使う。 */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  return `${seconds.toFixed(1)}秒`;
}

/** 素材の長さから、それがちょうど1周になる BPM を逆算する。 */
export function bpmForDuration(durationSec: number, bars: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return DEFAULT_PATTERN.bpm;
  const bpm = (bars * BEATS_PER_BAR * 60) / durationSec;
  return clamp(Math.round(bpm), BPM_RANGE.min, BPM_RANGE.max);
}

/** 定番の8ビート。空の盤面から始める人が最初に鳴らせるようにする。 */
export function basicBeat(tracks: readonly BeatTrack[], bars: number): BeatTrack[] {
  const length = stepCount(bars);
  const on = (predicate: (step: number) => boolean) => Array.from({ length }, (_unused, s) => predicate(s));
  const patterns: ((step: number) => boolean)[] = [
    (s) => s % STEPS_PER_BAR === 0 || s % STEPS_PER_BAR === 8 + 2, // キック: 1拍目と3拍裏
    (s) => s % STEPS_PER_BAR === 4 || s % STEPS_PER_BAR === 12, // スネア: 2・4拍
    (s) => s % 2 === 0, // ハット: 8分
  ];
  return tracks.map((track, i) => (patterns[i] ? { ...track, steps: on(patterns[i]) } : track));
}
