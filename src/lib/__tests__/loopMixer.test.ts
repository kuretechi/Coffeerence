import { describe, expect, it } from 'vitest';
import {
  BARS_RANGE,
  BPM_RANGE,
  DEFAULT_BOARD,
  MIXER_SLOT_COUNT,
  assignSlot,
  bpmForDuration,
  clearSlot,
  detachSound,
  formatSeconds,
  guessBars,
  loopSeconds,
  nextBoundary,
  normalizeBoard,
  soundingSlots,
  toggleMute,
} from '../loopMixer';
import type { MixerSlot } from '../../domain/types';

describe('loopSeconds', () => {
  it('100BPM・2小節は4.8秒', () => {
    expect(loopSeconds(100, 2)).toBeCloseTo(4.8, 12);
  });

  it('120BPM・1小節は2秒', () => {
    expect(loopSeconds(120, 1)).toBeCloseTo(2, 12);
  });

  it('BPMや小節数が0以下・非数なら例外', () => {
    expect(() => loopSeconds(0, 1)).toThrow();
    expect(() => loopSeconds(100, 0)).toThrow();
    expect(() => loopSeconds(Number.NaN, 1)).toThrow();
    expect(() => loopSeconds(100, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('nextBoundary', () => {
  it('演奏開始前は開始時刻をそのまま返す', () => {
    expect(nextBoundary(1, 2, 4.8)).toBe(2);
  });

  it('周回の途中なら次のループ頭を返す', () => {
    expect(nextBoundary(3, 0, 2)).toBeCloseTo(4, 12);
    expect(nextBoundary(5.5, 0, 2)).toBeCloseTo(6, 12);
  });

  it('ちょうど境界上なら待たずにその時刻を返す', () => {
    expect(nextBoundary(4, 0, 2)).toBe(4);
  });

  it('ループ長が0以下なら例外', () => {
    expect(() => nextBoundary(1, 0, 0)).toThrow();
  });
});

describe('normalizeBoard', () => {
  it('BPMと小節数を範囲内へ丸める', () => {
    const board = normalizeBoard({ ...DEFAULT_BOARD, bpm: 999, bars: 99, volume: 3 });
    expect(board.bpm).toBe(BPM_RANGE.max);
    expect(board.bars).toBe(BARS_RANGE.max);
    expect(board.volume).toBe(1);
  });

  it('枠が欠けている盤面を既定の枠数まで埋める', () => {
    const board = normalizeBoard({ ...DEFAULT_BOARD, slots: [{ soundId: 's1', muted: false }] });
    expect(board.slots).toHaveLength(MIXER_SLOT_COUNT);
    expect(board.slots[0].soundId).toBe('s1');
    expect(board.slots[1]).toEqual({ muted: false });
  });

  it('非数のBPMは下限にする', () => {
    expect(normalizeBoard({ ...DEFAULT_BOARD, bpm: Number.NaN }).bpm).toBe(BPM_RANGE.min);
  });
});

describe('枠の操作', () => {
  const slots: MixerSlot[] = [{ muted: false }, { soundId: 's2', muted: true }, { muted: false }];

  it('素材を入れると消音は解除される', () => {
    const next = assignSlot(slots, 1, 's9');
    expect(next[1]).toEqual({ soundId: 's9', muted: false });
    // 元の配列は変えない
    expect(slots[1]).toEqual({ soundId: 's2', muted: true });
  });

  it('枠を空にする', () => {
    expect(clearSlot(slots, 1)[1]).toEqual({ muted: false });
  });

  it('消音を切り替えても素材は保つ', () => {
    expect(toggleMute(slots, 1)[1]).toEqual({ soundId: 's2', muted: false });
    expect(toggleMute(toggleMute(slots, 1), 1)[1]).toEqual({ soundId: 's2', muted: true });
  });

  it('素材を消すとその素材の枠だけ空になる', () => {
    const filled: MixerSlot[] = [
      { soundId: 's2', muted: false },
      { soundId: 's3', muted: false },
      { soundId: 's2', muted: true },
    ];
    expect(detachSound(filled, 's2')).toEqual([{ muted: false }, { soundId: 's3', muted: false }, { muted: false }]);
  });

  it('鳴る枠は素材があって消音でないものだけ', () => {
    expect(
      soundingSlots([{ soundId: 'a', muted: false }, { soundId: 'b', muted: true }, { muted: false }, { soundId: 'c', muted: false }]),
    ).toEqual([0, 3]);
  });
});

describe('素材の長さからの見積もり', () => {
  it('100BPMで4.8秒の素材は2小節', () => {
    expect(guessBars(4.8, 100)).toBe(2);
  });

  it('長さが取れない素材は既定の小節数', () => {
    expect(guessBars(0, 100)).toBe(DEFAULT_BOARD.bars);
    expect(guessBars(Number.NaN, 100)).toBe(DEFAULT_BOARD.bars);
  });

  it('2小節で4.8秒ならBPMは100', () => {
    expect(bpmForDuration(4.8, 2)).toBe(100);
  });

  it('見積もりは範囲内に収める', () => {
    expect(bpmForDuration(0.01, 8)).toBe(BPM_RANGE.max);
    expect(bpmForDuration(600, 1)).toBe(BPM_RANGE.min);
  });
});

describe('formatSeconds', () => {
  it('小数1桁の秒で表す', () => {
    expect(formatSeconds(4.8)).toBe('4.8秒');
    expect(formatSeconds(0)).toBe('0.0秒');
  });

  it('長さが不明なら --', () => {
    expect(formatSeconds(Number.NaN)).toBe('--');
    expect(formatSeconds(-1)).toBe('--');
  });
});
