// 標準 MIDI ファイル（SMF）から鳴らすのに必要な音だけを取り出す。
// 楽器やコントロールチェンジは使わず、音の高さ・鳴り始め・強さだけを見る。

/** 鳴らす一音。 */
export interface MidiNote {
  /** 中央のド（MIDI 60）を 0 とした半音差。 */
  semitone: number;
  /** 曲の頭からの秒数。 */
  startSec: number;
  /** 鳴らし続ける秒数（note off まで）。 */
  holdSec: number;
  /** 強さ（0〜1）。 */
  velocity: number;
}

export interface MidiSong {
  notes: MidiNote[];
  /** 曲の長さ（秒）。 */
  seconds: number;
  /** 多すぎて切り落としたか。 */
  truncated: boolean;
}

/** 中央のド。半音差の基準。 */
const MIDDLE_C = 60;

/** 一度に組む音の上限。多い曲で端末が固まらないようにする。 */
export const MAX_NOTES = 4000;

const HEADER_CHUNK = 0x4d546864; // 'MThd'
const TRACK_CHUNK = 0x4d54726b; // 'MTrk'

/** テンポ指定が無い MIDI の既定（120 BPM）。 */
const DEFAULT_US_PER_QUARTER = 500_000;

/** 打楽器のチャンネル（0 始まりの 10ch）。音の高さではないので鳴らさない。 */
const DRUM_CHANNEL = 9;

/** note off が無い音の鳴らし続ける長さ（秒）。 */
const DEFAULT_HOLD_SEC = 0.5;

interface Cursor {
  view: DataView;
  pos: number;
}

interface RawNote {
  tick: number;
  /** note off の位置。見つからないままなら undefined。 */
  endTick?: number;
  note: number;
  velocity: number;
}

interface Tempo {
  tick: number;
  usPerQuarter: number;
}

function u8(cursor: Cursor): number {
  const value = cursor.view.getUint8(cursor.pos);
  cursor.pos += 1;
  return value;
}

function u16(cursor: Cursor): number {
  const value = cursor.view.getUint16(cursor.pos);
  cursor.pos += 2;
  return value;
}

function u32(cursor: Cursor): number {
  const value = cursor.view.getUint32(cursor.pos);
  cursor.pos += 4;
  return value;
}

/** SMF の可変長数値（1バイト7ビットで、続きがあれば最上位ビットが立つ）。 */
function varint(cursor: Cursor): number {
  let value = 0;
  for (let i = 0; i < 4; i += 1) {
    const byte = u8(cursor);
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return value;
}

/** MIDI を鳴らせる形に読み替える。読めない中身なら例外。 */
export function parseMidi(data: ArrayBuffer): MidiSong {
  const cursor: Cursor = { view: new DataView(data), pos: 0 };
  if (data.byteLength < 14 || u32(cursor) !== HEADER_CHUNK) throw new Error('MIDI ファイルとして読めません。');
  const headerEnd = cursor.pos + 4 + u32(cursor);
  u16(cursor); // フォーマット（0/1/2 のいずれでも、トラックを全部重ねて鳴らす）
  const trackCount = u16(cursor);
  const division = u16(cursor);
  cursor.pos = headerEnd;

  const raw: RawNote[] = [];
  const tempos: Tempo[] = [];
  for (let track = 0; track < trackCount && cursor.pos + 8 <= data.byteLength; track += 1) {
    const kind = u32(cursor);
    const end = Math.min(cursor.pos + 4 + u32(cursor), data.byteLength);
    if (kind === TRACK_CHUNK) readTrack(cursor, end, raw, tempos);
    cursor.pos = end;
  }

  raw.sort((a, b) => a.tick - b.tick);
  const truncated = raw.length > MAX_NOTES;
  const kept = truncated ? raw.slice(0, MAX_NOTES) : raw;
  const seconds = tickToSeconds(division, tempos);
  const notes = kept.map((note) => {
    const startSec = seconds(note.tick);
    return {
      semitone: note.note - MIDDLE_C,
      startSec,
      holdSec: note.endTick === undefined ? DEFAULT_HOLD_SEC : Math.max(0.05, seconds(note.endTick) - startSec),
      velocity: note.velocity / 127,
    };
  });
  if (notes.length === 0) throw new Error('鳴らせる音が入っていません。');
  const last = notes.reduce((max, note) => Math.max(max, note.startSec + note.holdSec), 0);
  return { notes, seconds: last, truncated };
}

/**
 * 曲の音域の中心（半音）。合図音は音源ごとに元の高さが違うため、
 * ここを基準にずらすと曲全体が音源そのままの高さの周りで鳴る。
 */
export function centerSemitone(notes: MidiNote[]): number {
  if (notes.length === 0) return 0;
  const sorted = [...notes].map((note) => note.semitone).sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}

/** 1トラック分のイベントを読み、音とテンポだけ拾う。 */
function readTrack(cursor: Cursor, end: number, notes: RawNote[], tempos: Tempo[]): void {
  let tick = 0;
  let status = 0;
  // 鳴っている音（チャンネルと音の番号で引く）。note off が来たら長さを確定させる。
  const sounding = new Map<number, RawNote>();
  while (cursor.pos < end) {
    tick += varint(cursor);
    if (cursor.pos >= end) break;
    const byte = u8(cursor);
    // 最上位ビットが立っていないバイトはデータの続き（ランニングステータス）。
    if (byte < 0x80) cursor.pos -= 1;
    else status = byte;

    if (status === 0xff) {
      const meta = u8(cursor);
      const length = varint(cursor);
      if (meta === 0x51 && length === 3) {
        tempos.push({ tick, usPerQuarter: (u8(cursor) << 16) | (u8(cursor) << 8) | u8(cursor) });
      } else {
        cursor.pos += length;
      }
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      cursor.pos += varint(cursor);
      continue;
    }
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (kind === 0x90 || kind === 0x80) {
      const note = u8(cursor);
      const velocity = u8(cursor);
      // 強さ 0 の note on は note off と同じ意味。
      const on = kind === 0x90 && velocity > 0;
      const key = channel * 128 + note;
      if (on) {
        if (channel === DRUM_CHANNEL) continue;
        // 同じ音が鳴り直したら、前の音はそこで終わったものとして扱う。
        const previous = sounding.get(key);
        if (previous) previous.endTick = tick;
        const raw: RawNote = { tick, note, velocity };
        sounding.set(key, raw);
        notes.push(raw);
      } else {
        const raw = sounding.get(key);
        if (raw) {
          raw.endTick = tick;
          sounding.delete(key);
        }
      }
      continue;
    }
    if (kind === 0xc0 || kind === 0xd0) {
      cursor.pos += 1;
      continue;
    }
    if (kind === 0xa0 || kind === 0xb0 || kind === 0xe0) {
      cursor.pos += 2;
      continue;
    }
    // 解釈できないバイトが出たら、そのトラックはそこで打ち切る。
    break;
  }
}

/** tick を秒に直す関数を作る。テンポ変化は変わった位置から先に効かせる。 */
function tickToSeconds(division: number, tempos: Tempo[]): (tick: number) => number {
  // 最上位ビットが立つ division は SMPTE 指定（1秒あたりの tick が固定）。
  if ((division & 0x8000) !== 0) {
    const fps = 256 - ((division >> 8) & 0xff);
    const perTick = 1 / Math.max(1, fps * (division & 0xff));
    return (tick) => tick * perTick;
  }
  const perQuarter = division > 0 ? division : 480;
  const points = [{ tick: 0, sec: 0, perTick: DEFAULT_US_PER_QUARTER / 1e6 / perQuarter }];
  for (const tempo of [...tempos].sort((a, b) => a.tick - b.tick)) {
    const last = points[points.length - 1];
    const perTick = tempo.usPerQuarter / 1e6 / perQuarter;
    if (tempo.tick <= last.tick) last.perTick = perTick;
    else points.push({ tick: tempo.tick, sec: last.sec + (tempo.tick - last.tick) * last.perTick, perTick });
  }
  return (tick) => {
    let point = points[0];
    for (const candidate of points) {
      if (candidate.tick > tick) break;
      point = candidate;
    }
    return point.sec + (tick - point.tick) * point.perTick;
  };
}
