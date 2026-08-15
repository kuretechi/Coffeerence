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

/** 鈴の倍音比。基音とこの比の部分音を重ねると「チーン」に近い響きになる。 */
const BELL_PARTIALS = [
  { ratio: 1, level: 1 },
  { ratio: 2.76, level: 0.5 },
  { ratio: 5.4, level: 0.25 },
];

/** 「チーン」と一度鳴らす合図（音声ファイル不要）。 */
export function chime(enabled: boolean, frequency = 1046.5, durationMs = 1200): void {
  if (!enabled) return;
  try {
    const ctx = audioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const end = now + durationMs / 1000;
    for (const partial of BELL_PARTIALS) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency * partial.ratio;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      // 立ち上がりは鋭く、その後は指数的に減衰させて余韻を残す。
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18 * partial.level, now + 0.01);
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
export function doubleChime(enabled: boolean, frequency = 1046.5, durationMs = 1200): void {
  chime(enabled, frequency, durationMs);
  window.setTimeout(() => chime(enabled, frequency, durationMs), 550);
}
