import type { MixerBoard, MixerSlot } from '../domain/types';

/** 枠の数。1画面に収まり、かつ重ねごたえのある数にする。 */
export const MIXER_SLOT_COUNT = 8;

/** 1小節の拍数。4拍固定（音重ねの用途では拍子の指定まではしない）。 */
export const BEATS_PER_BAR = 4;

export const BPM_RANGE = { min: 40, max: 240 } as const;
export const BARS_RANGE = { min: 1, max: 8 } as const;

/** 枠の見出し。キャラクターの代わりに短い名前で区別する。 */
export const SLOT_LABELS = ['ドラム', 'ベース', 'コード', 'メロ', '声1', '声2', '効果', '飾り'] as const;

export const DEFAULT_BOARD: MixerBoard = {
  id: 'board',
  bpm: 100,
  bars: 2,
  slots: Array.from({ length: MIXER_SLOT_COUNT }, () => ({ muted: false })),
  volume: 0.8,
};

/** BPM と小節数からループ1周の秒数を出す。 */
export function loopSeconds(bpm: number, bars: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('bpm must be a positive number');
  if (!Number.isFinite(bars) || bars <= 0) throw new Error('bars must be a positive number');
  return (bars * BEATS_PER_BAR * 60) / bpm;
}

/**
 * 次のループ頭の時刻。演奏中に枠を足しても小節頭から鳴り始めるようにするために使う。
 * すでに境界上にいる場合はその時刻をそのまま返す。
 */
export function nextBoundary(now: number, startedAt: number, loopSec: number): number {
  if (!Number.isFinite(loopSec) || loopSec <= 0) throw new Error('loopSec must be a positive number');
  if (now <= startedAt) return startedAt;
  const elapsed = now - startedAt;
  const turns = Math.ceil(elapsed / loopSec);
  // 浮動小数の誤差でちょうど境界のときに1周先へ飛ばないよう、極小の余裕を見る。
  return Math.abs(turns * loopSec - elapsed) < 1e-9 ? now : startedAt + turns * loopSec;
}

/** 盤面を保存できる値に整える（範囲外の入力や壊れた枠数を直す）。 */
export function normalizeBoard(board: MixerBoard): MixerBoard {
  const slots = Array.from({ length: MIXER_SLOT_COUNT }, (_unused, i) => board.slots[i] ?? { muted: false });
  return {
    ...board,
    bpm: clamp(Math.round(board.bpm), BPM_RANGE.min, BPM_RANGE.max),
    bars: clamp(Math.round(board.bars), BARS_RANGE.min, BARS_RANGE.max),
    slots,
    volume: clamp(board.volume, 0, 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 枠に素材を入れる（同じ素材を複数の枠に入れてもよい）。 */
export function assignSlot(slots: readonly MixerSlot[], index: number, soundId: string): MixerSlot[] {
  return slots.map((slot, i) => (i === index ? { ...slot, soundId, muted: false } : slot));
}

/** 枠を空にする。 */
export function clearSlot(slots: readonly MixerSlot[], index: number): MixerSlot[] {
  return slots.map((slot, i) => (i === index ? { muted: false } : slot));
}

/** 枠の消音を切り替える。素材の割り当ては保ったままにする。 */
export function toggleMute(slots: readonly MixerSlot[], index: number): MixerSlot[] {
  return slots.map((slot, i) => (i === index ? { ...slot, muted: !slot.muted } : slot));
}

/** 素材を消したとき、その素材を指していた枠を空にする。 */
export function detachSound(slots: readonly MixerSlot[], soundId: string): MixerSlot[] {
  return slots.map((slot) => (slot.soundId === soundId ? { muted: false } : slot));
}

/** いま鳴るべき枠の番号。 */
export function soundingSlots(slots: readonly MixerSlot[]): number[] {
  return slots.flatMap((slot, i) => (slot.soundId !== undefined && !slot.muted ? [i] : []));
}

/** 「1:23.4」のような表示。ループ長や素材の長さに使う。 */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  return `${seconds.toFixed(1)}秒`;
}

/**
 * 素材の長さから小節数を見積もる。アップロードした素材を今の BPM に当てはめる補助。
 * 最も近い小節数（1〜8）を返す。
 */
export function guessBars(durationSec: number, bpm: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return DEFAULT_BOARD.bars;
  const barSec = loopSeconds(bpm, 1);
  const bars = Math.round(durationSec / barSec);
  return clamp(bars, BARS_RANGE.min, BARS_RANGE.max);
}

/** 素材の長さと BPM から、ぴったり合う BPM を逆算する（小節数は指定値のまま）。 */
export function bpmForDuration(durationSec: number, bars: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return DEFAULT_BOARD.bpm;
  const bpm = (bars * BEATS_PER_BAR * 60) / durationSec;
  return clamp(Math.round(bpm), BPM_RANGE.min, BPM_RANGE.max);
}
