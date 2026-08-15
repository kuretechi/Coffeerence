import { describe, expect, it } from 'vitest';
import { centerSemitone, parseMidi } from '../midi';

/** 可変長数値（SMF のデルタタイム表現）。 */
function varint(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function chunk(name: string, body: number[]): number[] {
  const length = body.length;
  return [
    ...[...name].map((char) => char.charCodeAt(0)),
    (length >> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
    ...body,
  ];
}

/** 四分音符 = ticksPerQuarter の MIDI を組む。トラックを複数渡すとマルチトラックになる。 */
function midiFile(events: number[] | number[][], ticksPerQuarter = 480): ArrayBuffer {
  const trackEvents = Array.isArray(events[0]) ? (events as number[][]) : [events as number[]];
  const header = chunk('MThd', [0, 1, 0, trackEvents.length, (ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff]);
  const tracks = trackEvents.flatMap((body) => chunk('MTrk', [...body, ...varint(0), 0xff, 0x2f, 0x00]));
  return new Uint8Array([...header, ...tracks]).buffer;
}

/** トラック名のメタイベント。 */
function trackName(name: string): number[] {
  const bytes = [...new TextEncoder().encode(name)];
  return [...varint(0), 0xff, 0x03, bytes.length, ...bytes];
}

describe('parseMidi', () => {
  it('note on を半音差と秒に直す（既定は 120 BPM）', () => {
    const data = midiFile([
      ...varint(0), 0x90, 60, 127,
      ...varint(480), 0x90, 72, 64,
      ...varint(480), 0x80, 60, 0,
    ]);
    const song = parseMidi(data);
    expect(song.notes).toEqual([
      // note off が来た音は 1 秒、来なかった音は既定の長さ。
      { semitone: 0, startSec: 0, holdSec: 1, velocity: 1, track: 0 },
      { semitone: 12, startSec: 0.5, holdSec: 0.5, velocity: 64 / 127, track: 0 },
    ]);
    expect(song.tracks).toEqual([{ index: 0, name: 'トラック 1', notes: 2 }]);
    expect(song.seconds).toBeCloseTo(1);
    expect(song.truncated).toBe(false);
  });

  it('テンポ指定を効かせ、変わった位置から先の音をずらす', () => {
    // 240 BPM（四分音符 0.25 秒）。
    const data = midiFile([
      ...varint(0), 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90,
      ...varint(0), 0x90, 60, 100,
      ...varint(960), 0x90, 62, 100,
    ]);
    const song = parseMidi(data);
    expect(song.notes.map((note) => note.startSec)).toEqual([0, 0.5]);
  });

  it('強さ 0 の note on は鳴らさず、ランニングステータスも読む', () => {
    const data = midiFile([
      ...varint(0), 0x90, 60, 100,
      // ステータスバイトを省いた続きのイベント（同じ note on）。
      ...varint(240), 62, 0,
      ...varint(240), 64, 100,
    ]);
    const song = parseMidi(data);
    expect(song.notes.map((note) => note.semitone)).toEqual([0, 4]);
  });

  it('打楽器の 10ch は鳴らさない', () => {
    const data = midiFile([
      ...varint(0), 0x99, 36, 100,
      ...varint(0), 0x90, 60, 100,
    ]);
    const song = parseMidi(data);
    expect(song.notes).toHaveLength(1);
    expect(song.notes[0].semitone).toBe(0);
  });

  it('トラックごとに音を分け、トラック名を拾う', () => {
    const data = midiFile([
      [...trackName('主旋律'), ...varint(0), 0x90, 72, 100],
      [...varint(0), 0x90, 48, 100, ...varint(480), 0x90, 55, 100],
    ]);
    const song = parseMidi(data);
    expect(song.tracks).toEqual([
      { index: 0, name: '主旋律', notes: 1 },
      { index: 1, name: 'トラック 2', notes: 2 },
    ]);
    expect(song.notes.filter((note) => note.track === 1).map((note) => note.semitone)).toEqual([-12, -5]);
  });

  it('音域の中心を半音で返す', () => {
    expect(
      centerSemitone([
        { semitone: 12, startSec: 0, holdSec: 1, velocity: 1, track: 0 },
        { semitone: 24, startSec: 0, holdSec: 1, velocity: 1, track: 0 },
        { semitone: 30, startSec: 0, holdSec: 1, velocity: 1, track: 1 },
      ]),
    ).toBe(24);
    expect(centerSemitone([])).toBe(0);
  });

  it('MIDI でない中身や音が無い中身は例外にする', () => {
    expect(() => parseMidi(new Uint8Array(20).buffer)).toThrow();
    expect(() => parseMidi(midiFile([]))).toThrow();
  });
});
