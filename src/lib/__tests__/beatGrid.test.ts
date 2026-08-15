import { describe, expect, it } from 'vitest';
import {
  BARS_RANGE,
  DEFAULT_PATTERN,
  STEPS_PER_BAR,
  TRACK_COUNT,
  activeTrackCount,
  assignTrack,
  basicBeat,
  bpmForDuration,
  clearTrack,
  detachSound,
  emptyTrack,
  eraseAll,
  eraseTrack,
  firingTracks,
  formatSeconds,
  isBarHead,
  isBeatHead,
  loopSeconds,
  normalizePattern,
  stepCount,
  stepSeconds,
  toggleMute,
  toggleStep,
} from '../beatGrid';
import type { BeatPattern, BeatTrack } from '../../domain/types';

/** soundId に null を渡すと「素材なし」のトラックになる。 */
function trackWith(steps: number[], bars = 1, soundId: string | null = 'sound'): BeatTrack {
  const track = emptyTrack(bars);
  const filled = { ...track, steps: track.steps.map((_unused, i) => steps.includes(i)) };
  return soundId === null ? filled : { ...filled, soundId };
}

describe('グリッドの寸法', () => {
  it('1小節は16タイル', () => {
    expect(stepCount(1)).toBe(16);
    expect(stepCount(4)).toBe(64);
  });

  it('100BPM の16分は0.15秒', () => {
    expect(stepSeconds(100)).toBeCloseTo(0.15, 10);
  });

  it('100BPM・1小節の1周は2.4秒', () => {
    expect(loopSeconds(100, 1)).toBeCloseTo(2.4, 10);
    expect(loopSeconds(120, 2)).toBeCloseTo(4, 10);
  });

  it('BPM や小節数が不正なら例外', () => {
    expect(() => stepSeconds(0)).toThrow();
    expect(() => stepSeconds(Number.NaN)).toThrow();
    expect(() => loopSeconds(100, 0)).toThrow();
  });

  it('拍と小節の頭を見分ける', () => {
    expect(isBeatHead(0)).toBe(true);
    expect(isBeatHead(4)).toBe(true);
    expect(isBeatHead(5)).toBe(false);
    expect(isBarHead(0)).toBe(true);
    expect(isBarHead(STEPS_PER_BAR)).toBe(true);
    expect(isBarHead(4)).toBe(false);
  });
});

describe('盤面の整え', () => {
  it('既定の盤面はトラック数とタイル数が揃っている', () => {
    expect(DEFAULT_PATTERN.tracks).toHaveLength(TRACK_COUNT);
    for (const track of DEFAULT_PATTERN.tracks) expect(track.steps).toHaveLength(16);
  });

  it('範囲外の BPM・小節数を丸める', () => {
    const messy: BeatPattern = { ...DEFAULT_PATTERN, bpm: 999, bars: 99, volume: 5 };
    const fixed = normalizePattern(messy);
    expect(fixed.bpm).toBe(240);
    expect(fixed.bars).toBe(BARS_RANGE.max);
    expect(fixed.volume).toBe(1);
  });

  it('小節数を増やすとタイルを無音で足し、減らすと切り詰める', () => {
    const wide = normalizePattern({ ...DEFAULT_PATTERN, bars: 2, tracks: [trackWith([0, 4])] });
    expect(wide.tracks[0].steps).toHaveLength(32);
    expect(wide.tracks[0].steps[0]).toBe(true);
    expect(wide.tracks[0].steps[20]).toBe(false);

    const narrow = normalizePattern({ ...wide, bars: 1 });
    expect(narrow.tracks[0].steps).toHaveLength(16);
    expect(narrow.tracks[0].steps[4]).toBe(true);
  });

  it('壊れた盤面でもトラック数を揃える', () => {
    const fixed = normalizePattern({ ...DEFAULT_PATTERN, tracks: [] });
    expect(fixed.tracks).toHaveLength(TRACK_COUNT);
    expect(fixed.tracks[3].steps.every((on) => !on)).toBe(true);
  });

  it('NaN の BPM は下限になる', () => {
    expect(normalizePattern({ ...DEFAULT_PATTERN, bpm: Number.NaN }).bpm).toBe(40);
  });
});

describe('タイルとトラックの操作', () => {
  const tracks = [trackWith([0]), trackWith([4], 1, null)];

  it('タイルの入り切りを反転する', () => {
    const next = toggleStep(tracks, 0, 2);
    expect(next[0].steps[2]).toBe(true);
    expect(toggleStep(next, 0, 2)[0].steps[2]).toBe(false);
    expect(next[1]).toBe(tracks[1]);
  });

  it('素材を入れる・外すでタイルは残る', () => {
    const assigned = assignTrack(tracks, 1, 'other');
    expect(assigned[1].soundId).toBe('other');
    const cleared = clearTrack(assigned, 1);
    expect(cleared[1].soundId).toBeUndefined();
    expect(cleared[1].steps[4]).toBe(true);
  });

  it('タイルだけ消す', () => {
    expect(eraseTrack(tracks, 0)[0].steps.some((on) => on)).toBe(false);
    expect(eraseTrack(tracks, 0)[0].soundId).toBe('sound');
    expect(eraseAll(tracks).every((track) => track.steps.every((on) => !on))).toBe(true);
  });

  it('消音を切り替える', () => {
    expect(toggleMute(tracks, 0)[0].muted).toBe(true);
    expect(toggleMute(toggleMute(tracks, 0), 0)[0].muted).toBe(false);
  });

  it('素材を消したトラックから外す', () => {
    expect(detachSound(tracks, 'sound')[0].soundId).toBeUndefined();
    expect(detachSound(tracks, 'sound')[0].steps[0]).toBe(true);
  });
});

describe('鳴らす対象', () => {
  it('素材があり消音でなくタイルが入っているものだけ鳴る', () => {
    const tracks = [
      trackWith([0, 8]), // 鳴る
      trackWith([0], 1, null), // 素材なし
      { ...trackWith([0]), muted: true }, // 消音
      trackWith([8]), // 別のステップ
    ];
    expect(firingTracks(tracks, 0)).toEqual([0]);
    expect(firingTracks(tracks, 8)).toEqual([0, 3]);
    expect(firingTracks(tracks, 1)).toEqual([]);
  });

  it('組み終わったトラックの数を数える', () => {
    expect(activeTrackCount([trackWith([0]), trackWith([], 1), trackWith([2], 1, null)])).toBe(1);
  });
});

describe('補助', () => {
  it('素材の長さから BPM を逆算する', () => {
    expect(bpmForDuration(2.4, 1)).toBe(100);
    expect(bpmForDuration(0, 1)).toBe(DEFAULT_PATTERN.bpm);
  });

  it('秒を表示する', () => {
    expect(formatSeconds(2.4)).toBe('2.4秒');
    expect(formatSeconds(Number.NaN)).toBe('--');
  });

  it('8ビートは上3トラックにだけ入る', () => {
    const beat = basicBeat(DEFAULT_PATTERN.tracks, 1);
    expect(beat[0].steps[0]).toBe(true);
    expect(beat[1].steps[4]).toBe(true);
    expect(beat[2].steps.filter((on) => on)).toHaveLength(8);
    expect(beat[3].steps.some((on) => on)).toBe(false);
  });
});
