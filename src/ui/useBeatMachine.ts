import { useCallback, useEffect, useRef, useState } from 'react';
import type { BeatPattern, LoopSound } from '../domain/types';
import { firingTracks, stepCount, stepSeconds } from '../lib/beatGrid';

/** 鳴り始めまでの余裕。今すぐ鳴らすと詰まって音が欠けるため少し先に予約する。 */
const LEAD_SEC = 0.12;
/** どれだけ先まで予約しておくか。JS の遅れに影響されない範囲で短くする。 */
const SCHEDULE_AHEAD_SEC = 0.2;
/** 予約を足しに行く間隔。 */
const TICK_MS = 25;

function createContext(): AudioContext | undefined {
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : undefined;
}

/**
 * タイルのグリッドを鳴らす装置。
 * ステップの時刻は `startedAt + index * stepSec` で決めるので、
 * JS のタイマーが遅れてもサンプルの鳴る位置はずれない。
 */
class BeatMachine {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly decoding = new Map<string, Promise<AudioBuffer | undefined>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private pattern: BeatPattern | undefined;
  private sounds: readonly LoopSound[] = [];
  private startedAt = 0;
  /** 次に予約するステップ番号（1周でのぶんを超えても増え続ける）。 */
  private cursor = 0;
  private volume = 1;

  /** iOS はユーザー操作の中で作らないと鳴らないため、再生ボタンから呼ぶ。 */
  resume(): AudioContext | undefined {
    this.ctx ??= createContext();
    if (!this.ctx) return undefined;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.master) {
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01);
  }

  /** 素材を一度だけデコードして使い回す。開けない素材は undefined。 */
  async decode(sound: LoopSound): Promise<AudioBuffer | undefined> {
    const cached = this.buffers.get(sound.id);
    if (cached) return cached;
    const pending = this.decoding.get(sound.id);
    if (pending) return pending;
    const ctx = this.resume();
    if (!ctx) return undefined;
    const promise = sound.blob
      .arrayBuffer()
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        this.buffers.set(sound.id, buffer);
        return buffer;
      })
      .catch(() => undefined)
      .finally(() => this.decoding.delete(sound.id));
    this.decoding.set(sound.id, promise);
    return promise;
  }

  forget(soundId: string): void {
    this.buffers.delete(soundId);
  }

  /** 盤面を差し替える。タイルの編集は演奏を止めずに次の予約から反映される。 */
  setPattern(pattern: BeatPattern, sounds: readonly LoopSound[]): void {
    const tempoChanged = this.pattern !== undefined && this.pattern.bpm !== pattern.bpm;
    const lengthChanged = this.pattern !== undefined && this.pattern.bars !== pattern.bars;
    this.pattern = pattern;
    this.sounds = sounds;
    void this.warm();
    // テンポや長さが変わったら時間の基準を引き直す（そのままだと予約済みの分とずれる）。
    if (this.timer !== undefined && (tempoChanged || lengthChanged)) this.restart();
  }

  /** 使う素材を先にデコードしておく（鳴らす直前に読むと頭が欠ける）。 */
  private async warm(): Promise<void> {
    const pattern = this.pattern;
    if (!pattern) return;
    const ids = new Set(pattern.tracks.flatMap((track) => (track.soundId === undefined ? [] : [track.soundId])));
    for (const sound of this.sounds) {
      if (ids.has(sound.id)) await this.decode(sound);
    }
  }

  get playing(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    const ctx = this.resume();
    if (!ctx || this.timer !== undefined) return;
    this.startedAt = ctx.currentTime + LEAD_SEC;
    this.cursor = 0;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  private restart(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.startedAt = ctx.currentTime + LEAD_SEC;
    this.cursor = 0;
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** いま光らせるべきタイルの位置（停止中は -1）。 */
  currentStep(): number {
    const ctx = this.ctx;
    const pattern = this.pattern;
    if (!ctx || !pattern || this.timer === undefined) return -1;
    const elapsed = ctx.currentTime - this.startedAt;
    if (elapsed < 0) return 0;
    const total = stepCount(pattern.bars);
    return Math.floor(elapsed / stepSeconds(pattern.bpm)) % total;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const pattern = this.pattern;
    if (!ctx || !pattern) return;
    const stepSec = stepSeconds(pattern.bpm);
    const total = stepCount(pattern.bars);
    const limit = ctx.currentTime + SCHEDULE_AHEAD_SEC;
    while (this.startedAt + this.cursor * stepSec < limit) {
      const when = this.startedAt + this.cursor * stepSec;
      const step = this.cursor % total;
      for (const track of firingTracks(pattern.tracks, step)) {
        const soundId = pattern.tracks[track].soundId;
        const buffer = soundId === undefined ? undefined : this.buffers.get(soundId);
        // まだデコードできていない素材はこのステップだけ見送る（次の周で鳴る）。
        if (buffer) this.fire(buffer, when, stepSec * total);
      }
      this.cursor += 1;
    }
  }

  /** 1発鳴らす。素材が1周より長い場合は次の周に被らないよう切る。 */
  private fire(buffer: AudioBuffer, when: number, loopSec: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start(when);
    if (buffer.duration > loopSec) source.stop(when + loopSec);
  }

  /** 1つの素材だけ試聴する。 */
  async preview(sound: LoopSound): Promise<boolean> {
    const ctx = this.resume();
    if (!ctx) return false;
    const buffer = await this.decode(sound);
    if (!buffer || !this.master) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    source.start();
    return true;
  }
}

export interface BeatMachineControls {
  playing: boolean;
  /** 再生/停止。押した操作の中で AudioContext を作るため、必ずボタンから呼ぶ。 */
  toggle: () => void;
  /** いま鳴っているタイルの位置（停止中は -1）。 */
  step: number;
  preview: (sound: LoopSound) => Promise<boolean>;
  /** 素材を消したときにデコード結果も捨てる。 */
  forget: (soundId: string) => void;
}

/**
 * 盤面の変化に追従して鳴らし続けるフック。
 * タイルの編集・消音・音量の変更は再生を止めずに反映する。
 */
export function useBeatMachine(pattern: BeatPattern, sounds: readonly LoopSound[]): BeatMachineControls {
  const machine = useRef<BeatMachine | undefined>(undefined);
  machine.current ??= new BeatMachine();
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);

  useEffect(() => {
    machine.current?.setPattern(pattern, sounds);
  }, [pattern, sounds]);

  useEffect(() => {
    machine.current?.setVolume(pattern.volume);
  }, [pattern.volume]);

  useEffect(() => {
    if (!playing) {
      machine.current?.stop();
      setStep(-1);
      return;
    }
    machine.current?.start();
    let frame = 0;
    const follow = () => {
      setStep(machine.current?.currentStep() ?? -1);
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // 画面を離れたら鳴らしっぱなしにしない。
  useEffect(() => {
    const instance = machine.current;
    return () => instance?.stop();
  }, []);

  const toggle = useCallback(() => {
    machine.current?.resume();
    setPlaying((current) => !current);
  }, []);

  const preview = useCallback(async (sound: LoopSound) => (await machine.current?.preview(sound)) ?? false, []);
  const forget = useCallback((soundId: string) => machine.current?.forget(soundId), []);

  return { playing, toggle, step, preview, forget };
}

/** 素材の長さを測る。decodeAudioData で開けない場合は 0。 */
export async function measureDuration(blob: Blob): Promise<number> {
  const ctx = createContext();
  if (!ctx) return 0;
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return buffer.duration;
  } catch {
    return 0;
  } finally {
    void ctx.close();
  }
}
