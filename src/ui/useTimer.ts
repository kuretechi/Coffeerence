import { useCallback, useEffect, useRef, useState } from 'react';

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

/** ユーザー操作の中で呼び、以降のタイマー発火でも鳴るようにする。 */
export function primeAudio(enabled: boolean): void {
  if (!enabled) return;
  try {
    audioContext();
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

/** 「チーン」と一度鳴らす合図（音声ファイル不要）。 */
export function chime(enabled: boolean, frequency = 1244, durationMs = 2200): void {
  if (!enabled) return;
  try {
    const ctx = audioContext();
    if (!ctx) return;
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
  if ('vibrate' in navigator) navigator.vibrate?.(80);
}

/** 「チーン、チーン」と2回鳴らす合図。 */
export function doubleChime(enabled: boolean, frequency = 1244, durationMs = 2200): void {
  chime(enabled, frequency, durationMs);
  window.setTimeout(() => chime(enabled, frequency, durationMs), 420);
}
