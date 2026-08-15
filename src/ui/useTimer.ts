import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { SoundSlot } from '../domain/types';

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
];

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

/** 鳴らせる音源かを調べる（アップロード直後の検査用）。 */
export async function canDecodeChime(blob: Blob): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return false;
  try {
    await ctx.decodeAudioData(await blob.arrayBuffer());
    return true;
  } catch {
    return false;
  }
}

/** ユーザー操作の中で呼び、以降のタイマー発火でも鳴るようにする。 */
export function primeAudio(enabled: boolean, soundId = CHIME_SOUNDS[0].id): void {
  if (!enabled) return;
  try {
    const ctx = audioContext();
    const source = chimeSource(soundId);
    if (ctx && source) void load(ctx, source);
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
function synthChime(ctx: AudioContext, frequency = 1244, durationMs = 2200): void {
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
    master.connect(ctx.destination);
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

/** 選んである合図音を一度鳴らす。 */
export function chime(enabled: boolean, soundId = CHIME_SOUNDS[0].id): void {
  if (!enabled) return;
  try {
    const ctx = audioContext();
    if (ctx) {
      const source = chimeSource(soundId);
      // 読み込み前に呼ばれても取りこぼさないよう、完了を待ってから鳴らす。
      const ready = source ? load(ctx, source) : Promise.resolve(undefined);
      void ready.then((buffer) => {
        if (!buffer) {
          synthChime(ctx);
          return;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start();
      });
    }
  } catch {
    /* 音が出せない環境では黙って続行する */
  }
  if ('vibrate' in navigator) navigator.vibrate?.(80);
}

/** 合図音を2回鳴らす。2打目は1打目が鳴り終わってから重ねる。 */
export function doubleChime(enabled: boolean, soundId = CHIME_SOUNDS[0].id): void {
  chime(enabled, soundId);
  const source = chimeSource(soundId);
  const loaded = source ? buffers.get(source.key) : undefined;
  const gap = loaded ? Math.min(loaded.duration, 1.2) * 1000 : 420;
  window.setTimeout(() => chime(enabled, soundId), gap);
}
