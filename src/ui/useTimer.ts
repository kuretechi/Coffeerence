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

/** 短い通知音（音声ファイル不要）。 */
export function beep(enabled: boolean, frequency = 880, durationMs = 160): void {
  if (!enabled) return;
  try {
    const ctx = audioContext();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    oscillator.start();
    oscillator.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    /* 音が出せない環境では黙って続行する */
  }
  if ('vibrate' in navigator) navigator.vibrate?.(80);
}

/** 「ピピッ」と2回鳴らす合図。 */
export function doubleBeep(enabled: boolean, frequency = 880, durationMs = 120): void {
  beep(enabled, frequency, durationMs);
  window.setTimeout(() => beep(enabled, frequency, durationMs), durationMs + 90);
}
