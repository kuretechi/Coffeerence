import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { ReverbAmount, SoundEffect, SoundSlot } from '../domain/types';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

/** NF-06: タイマー動作中は画面スリープを抑制する。 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinelLike | undefined;
    let cancelled = false;
    nav.wakeLock
      .request('screen')
      .then((lock) => {
        if (cancelled) void lock.release();
        else sentinel = lock;
      })
      .catch(() => {
        /* 取得できない環境では何もしない */
      });
    return () => {
      cancelled = true;
      void sentinel?.release();
    };
  }, [active]);
}

export interface Stopwatch {
  elapsed: number;
  running: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
}

export function useStopwatch(): Stopwatch {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const startedAt = useRef<number | undefined>(undefined);
  const offset = useRef(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (startedAt.current === undefined) return;
      setElapsed(offset.current + (Date.now() - startedAt.current) / 1000);
    }, 100);
    return () => window.clearInterval(id);
  }, [running]);

  useWakeLock(running);

  const start = useCallback(() => {
    startedAt.current = Date.now();
    setRunning(true);
  }, []);

  const pause = useCallback(() => {
    if (startedAt.current !== undefined) offset.current += (Date.now() - startedAt.current) / 1000;
    startedAt.current = undefined;
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    offset.current = 0;
    startedAt.current = undefined;
    setElapsed(0);
    setRunning(false);
  }, []);

  return { elapsed, running, start, pause, reset };
}

let sharedContext: AudioContext | undefined;

/**
 * 音を出す AudioContext を使い回す。iOS はユーザー操作以外で作った
 * AudioContext を鳴らさないため、開始ボタンで一度だけ作って以後は resume する。
 */
function audioContext(): AudioContext | undefined {
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  sharedContext ??= new Ctor();
  if (sharedContext.state === 'suspended') void sharedContext.resume();
  return sharedContext;
}

/** 選べる既定の合図音。オフラインでも鳴るよう同梱の静的アセットを指す。 */
export const CHIME_SOUNDS: { id: string; label: string; file: string }[] = [
  { id: 'desk', label: '卓上ベル', file: 'chime-desk.mp3' },
  { id: 'bell', label: 'ベル', file: 'bell.mp3' },
  { id: 'high', label: '高い鈴', file: 'chime-high.mp3' },
  { id: 'low', label: '低い鐘', file: 'chime-low.mp3' },
  { id: 'beep', label: '電子音', file: 'chime-beep.mp3' },
  { id: 'tururu', label: 'トゥルル', file: 'chime-tururu.mp3' },
];

/** 抽出終了の音を合図音に揃えるときの選択値。 */
export const SAME_AS_CHIME_ID = 'same';

/** ピッチの調整幅（半音）。 */
export const PITCH_RANGE = 24;

/** 半音単位のピッチを再生速度に直す。 */
function pitchRate(semitones: number): number {
  const clamped = Math.min(PITCH_RANGE, Math.max(-PITCH_RANGE, semitones));
  return 2 ** (clamped / 12);
}

/** 合図音にかけられる効果。 */
export const SOUND_EFFECTS: { id: SoundEffect; label: string }[] = [
  { id: 'none', label: 'そのまま' },
  { id: 'room', label: '残響（小）' },
  { id: 'hall', label: '残響（大）' },
  { id: 'echo', label: 'やまびこ' },
  { id: 'muffled', label: 'こもり' },
  { id: 'radio', label: '電話ごし' },
];

/** 残響の既定値。数値を設定していないときに使う。 */
export const REVERB_PRESETS: Record<'room' | 'hall', ReverbAmount> = {
  room: { mix: 60, seconds: 0.8 },
  hall: { mix: 90, seconds: 2.6 },
};

/** 残響量の指定できる範囲。 */
export const REVERB_MIX_RANGE = { min: 0, max: 100, step: 5 };
export const REVERB_SECONDS_RANGE = { min: 0.2, max: 6, step: 0.1 };

/** 残響がかかる効果か。 */
export function hasReverb(effect: SoundEffect): effect is 'room' | 'hall' {
  return effect === 'room' || effect === 'hall';
}

/** 設定値と既定値を合わせて、実際に使う残響量にする。 */
export function reverbAmount(effect: SoundEffect, amount?: Partial<ReverbAmount>): ReverbAmount {
  const preset = hasReverb(effect) ? REVERB_PRESETS[effect] : REVERB_PRESETS.room;
  const mix = amount?.mix ?? preset.mix;
  const seconds = amount?.seconds ?? preset.seconds;
  return {
    mix: clamp(mix, REVERB_MIX_RANGE.min, REVERB_MIX_RANGE.max),
    seconds: clamp(seconds, REVERB_SECONDS_RANGE.min, REVERB_SECONDS_RANGE.max),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

const impulses = new Map<string, AudioBuffer>();

/**
 * 残響用のインパルス応答。音源を同梱せずに済むよう、指数的に減衰する
 * ノイズから作る（部屋の反射が一様に散っていく様子の近似）。
 */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const key = seconds.toFixed(2);
  const cached = impulses.get(key);
  if (cached) return cached;
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.5;
    }
  }
  impulses.set(key, buffer);
  return buffer;
}

/**
 * 効果の配線を組み、音源をつなぐ先を返す。出口側は destination まで
 * つないだ状態で返るので、呼ぶ側は返り値に音源を connect するだけでよい。
 */
function effectInput(
  ctx: AudioContext,
  effect: SoundEffect = 'none',
  reverb?: Partial<ReverbAmount>,
): AudioNode {
  if (hasReverb(effect)) {
    const amount = reverbAmount(effect, reverb);
    // 原音と残響を混ぜる。混ぜないと遠くで鳴っているようにしか聞こえない。
    const input = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = amount.mix / 100;
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse(ctx, amount.seconds);
    input.connect(ctx.destination);
    input.connect(convolver);
    convolver.connect(wet);
    wet.connect(ctx.destination);
    return input;
  }
  if (effect === 'echo') {
    const input = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.24;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.45;
    input.connect(ctx.destination);
    input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(ctx.destination);
    return input;
  }
  if (effect === 'muffled') {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.connect(ctx.destination);
    return filter;
  }
  if (effect === 'radio') {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1600;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = 1.8;
    filter.connect(gain);
    gain.connect(ctx.destination);
    return filter;
  }
  return ctx.destination;
}

/** アップロードした音を指すID（= 置き場の ID）。 */
export const CUSTOM_SOUND_ID: SoundSlot = 'custom';
/** 抽出終了用にアップロードした音を指すID。 */
export const CUSTOM_FINISH_SOUND_ID: SoundSlot = 'custom-finish';
const SOUND_SLOTS: SoundSlot[] = [CUSTOM_SOUND_ID, CUSTOM_FINISH_SOUND_ID];

function isCustom(soundId: string): soundId is SoundSlot {
  return (SOUND_SLOTS as string[]).includes(soundId);
}

/** 鳴らす音源。key でデコード結果を使い回す。 */
interface ChimeSource {
  key: string;
  data: () => Promise<ArrayBuffer>;
}

const buffers = new Map<string, AudioBuffer>();
const loads = new Map<string, Promise<AudioBuffer | undefined>>();
const customSounds = new Map<SoundSlot, { key: string; blob: Blob }>();
/** decodeAudioData では開けないアップロード音（動画）。毎回読み直さない。 */
const elementOnly = new Set<string>();

/**
 * アップロードした音源を登録する。Blob URL を介さず Blob から直接
 * デコードするので、URL の失効で鳴らなくなることがない。
 */
export function setCustomChime(slot: SoundSlot, blob: Blob | undefined, key = ''): void {
  if (blob) customSounds.set(slot, { key, blob });
  else customSounds.delete(slot);
}

function chimeSource(soundId: string): ChimeSource | undefined {
  if (isCustom(soundId)) {
    const current = customSounds.get(soundId);
    if (!current) return undefined;
    return { key: `${soundId}:${current.key}`, data: () => current.blob.arrayBuffer() };
  }
  const sound = CHIME_SOUNDS.find((item) => item.id === soundId) ?? CHIME_SOUNDS[0];
  const url = `${import.meta.env.BASE_URL}${sound.file}`;
  return { key: url, data: () => fetch(url).then((response) => response.arrayBuffer()) };
}

/** 音源を一度だけデコードして使い回す。 */
function load(ctx: AudioContext, source: ChimeSource): Promise<AudioBuffer | undefined> {
  const cached = loads.get(source.key);
  if (cached) return cached;
  const pending = source
    .data()
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      buffers.set(source.key, buffer);
      return buffer;
    })
    .catch(() => {
      // 失敗を覚えたままにせず、次回また読めるようにする。
      loads.delete(source.key);
      return undefined;
    });
  loads.set(source.key, pending);
  return pending;
}

/** アップロードされた合図音を鳴らせるよう登録しておく。 */
export function useCustomChime(): void {
  const stored = useLiveQuery(() => db.sounds.toArray(), [], undefined);

  useEffect(() => {
    if (!stored) return;
    for (const slot of SOUND_SLOTS) {
      const sound = stored.find((item) => item.id === slot);
      setCustomChime(slot, sound?.blob, sound ? `${sound.name}:${sound.blob.size}` : '');
    }
  }, [stored]);
}

/**
 * 動画（iPhone の .MOV など）は decodeAudioData では開けないので、
 * 再生は media 要素に任せて音声トラックだけを鳴らす。
 */
function playViaElement(blob: Blob, pitch: number): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  const element = document.createElement('video');
  element.src = url;
  element.preload = 'auto';
  // 画面には出さず、再生速度でピッチを変える（音高保持を切る）。
  element.playbackRate = pitchRate(pitch);
  element.preservesPitch = false;
  element.onended = () => URL.revokeObjectURL(url);
  return element
    .play()
    .then(() => true)
    .catch(() => {
      URL.revokeObjectURL(url);
      return false;
    });
}

/**
 * 動画から音声トラックだけを取り出し、wav にして返す。動画のままだと
 * 映像ぶんの容量を端末に抱えることになるので、取り込み時に捨てる。
 * この端末でデコードできなければ undefined。
 */
export async function extractAudioTrack(blob: Blob): Promise<Blob | undefined> {
  const ctx = audioContext();
  if (!ctx) return undefined;
  try {
    return toWav(await ctx.decodeAudioData(await blob.arrayBuffer()));
  } catch {
    return undefined;
  }
}

/** AudioBuffer を 16bit PCM の wav にする。 */
function toWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const samples = buffer.length;
  const bytes = samples * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, bytes, true);
  const tracks = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let i = 0; i < samples; i += 1) {
    for (const track of tracks) {
      const value = Math.max(-1, Math.min(1, track[i] ?? 0));
      view.setInt16(offset, Math.round(value * 32767), true);
      offset += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/** 鳴らせる音源かを調べる（アップロード直後の検査用）。 */
export async function canDecodeChime(blob: Blob): Promise<boolean> {
  const ctx = audioContext();
  if (ctx) {
    try {
      await ctx.decodeAudioData(await blob.arrayBuffer());
      return true;
    } catch {
      /* 動画なら media 要素で鳴るか試す */
    }
  }
  return canPlayInElement(blob);
}

/** media 要素で音声付きとして開けるかを調べる。 */
function canPlayInElement(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const element = document.createElement('video');
    const done = (playable: boolean) => {
      element.onloadedmetadata = element.onerror = null;
      URL.revokeObjectURL(url);
      resolve(playable);
    };
    element.onloadedmetadata = () => done(element.duration > 0);
    element.onerror = () => done(false);
    element.preload = 'metadata';
    element.src = url;
  });
}

/** ユーザー操作の中で呼び、以降のタイマー発火でも鳴るようにする。 */
export function primeAudio(enabled: boolean, soundId = CHIME_SOUNDS[0].id): void {
  if (!enabled) return;
  try {
    const ctx = audioContext();
    const source = chimeSource(soundId);
    if (ctx && source && !elementOnly.has(source.key)) void load(ctx, source);
  } catch {
    /* 音が出せない環境では黙って続行する */
  }
}

/**
 * 卓上ベル（レストランの呼び鈴）の部分音。金属の響きは倍音が整数比から外れ、
 * 高い部分音のほうが速く減衰するため、比・音量・減衰の長さを個別に持たせる。
 * detune は同じ部分音をわずかにずらして「うなり」を作り、金属らしい揺れを出す。
 */
const BELL_PARTIALS = [
  { ratio: 1, level: 1, decay: 1, detune: 0 },
  { ratio: 2.02, level: 0.62, decay: 0.78, detune: 1.6 },
  { ratio: 2.79, level: 0.42, decay: 0.6, detune: -2.4 },
  { ratio: 4.16, level: 0.24, decay: 0.42, detune: 3.1 },
  { ratio: 5.43, level: 0.16, decay: 0.3, detune: -3.6 },
  { ratio: 7.11, level: 0.09, decay: 0.2, detune: 4.2 },
];

/** 撞木が当たる瞬間の金属音。短い帯域ノイズで「カン」という立ち上がりを足す。 */
function strike(ctx: AudioContext, destination: AudioNode, frequency: number, now: number): void {
  const length = Math.floor(ctx.sampleRate * 0.02);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) samples[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = frequency * 3;
  band.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.value = 0.12;
  source.connect(band);
  band.connect(gain);
  gain.connect(destination);
  source.start(now);
  source.stop(now + 0.02);
}

/** ベル音が読み込めない環境向けの合成音。 */
function synthChime(ctx: AudioContext, frequency = 1244, out: AudioNode = ctx.destination, durationMs = 2200): void {
  try {
    const now = ctx.currentTime;
    const seconds = durationMs / 1000;
    // 高域の刺さりを抑えて、器を叩いたような丸い響きにする。
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = frequency * 8;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    tone.connect(master);
    master.connect(out);
    strike(ctx, master, frequency, now);
    for (const partial of BELL_PARTIALS) {
      const end = now + seconds * partial.decay;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency * partial.ratio;
      oscillator.detune.value = partial.detune;
      oscillator.connect(gain);
      gain.connect(tone);
      // 立ち上がりは鋭く、その後は指数的に減衰させて余韻を長く残す。
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2 * partial.level, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.start(now);
      oscillator.stop(end);
    }
  } catch {
    /* 音が出せない環境では黙って続行する */
  }
}

/** 選んである合図音を一度鳴らす。pitch は半音単位。 */
export function chime(
  enabled: boolean,
  soundId = CHIME_SOUNDS[0].id,
  pitch = 0,
  effect: SoundEffect = 'none',
  reverb?: Partial<ReverbAmount>,
): void {
  if (!enabled) return;
  try {
    const ctx = audioContext();
    if (ctx) {
      const source = chimeSource(soundId);
      // 読み込み前に呼ばれても取りこぼさないよう、完了を待ってから鳴らす。
      const ready =
        source && !elementOnly.has(source.key) ? load(ctx, source) : Promise.resolve<AudioBuffer | undefined>(undefined);
      void ready.then((buffer) => {
        const rate = pitchRate(pitch);
        const out = effectInput(ctx, effect, reverb);
        if (!buffer) {
          // decode できないアップロード音（動画）は media 要素で鳴らす。
          const blob = isCustom(soundId) ? customSounds.get(soundId)?.blob : undefined;
          if (!blob) {
            synthChime(ctx, 1244 * rate, out);
            return;
          }
          const key = source?.key ?? soundId;
          void playViaElement(blob, pitch).then((played: boolean) => {
            if (played) elementOnly.add(key);
            else synthChime(ctx, 1244 * rate, out);
          });
          return;
        }
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = rate;
        node.connect(out);
        node.start();
      });
    }
  } catch {
    /* 音が出せない環境では黙って続行する */
  }
  if ('vibrate' in navigator) navigator.vibrate?.(80);
}
