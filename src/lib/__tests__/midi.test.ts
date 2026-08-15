import { describe, expect, it } from 'vitest';
import { parseMidi } from '../midi';

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

/** 四分音符 = ticksPerQuarter の MIDI を組む。 */
function midiFile(events: number[], ticksPerQuarter = 480, trackCount = 1): ArrayBuffer {
  const header = chunk('MThd', [0, 1, 0, trackCount, (ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff]);
  const track = chunk('MTrk', [...events, ...varint(0), 0xff, 0x2f, 0x00]);
  return new Uint8Array([...header, ...track]).buffer;
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
      { semitone: 0, startSec: 0, velocity: 1 },
      { semitone: 12, startSec: 0.5, velocity: 64 / 127 },
    ]);
    expect(song.seconds).toBeCloseTo(0.5);
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

  it('MIDI でない中身や音が無い中身は例外にする', () => {
    expect(() => parseMidi(new Uint8Array(20).buffer)).toThrow();
    expect(() => parseMidi(midiFile([]))).toThrow();
  });
});
