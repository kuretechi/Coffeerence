import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoopSound, MixerBoard } from '../domain/types';
import { loopSeconds, nextBoundary, soundingSlots } from '../lib/loopMixer';

/** 鳴り始めまでの余裕。今すぐ鳴らすと詰まって音が欠けるため少し先に予約する。 */
const LEAD_SEC = 0.12;
/** 消すときの短いフェード。切り際のプツッという音を防ぐ。 */
const FADE_SEC = 0.02;

function createContext(): AudioContext | undefined {
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : undefined;
}

/**
 * 素材をループ1周の長さに揃える。
 * 短い素材は後ろを無音で埋め、長い素材は切り詰める。
 * loopEnd を素材の長さにすると小節頭からずれていくため、長さごと揃えておく。
 */
function fitToLoop(ctx: BaseAudioContext, buffer: AudioBuffer, loopSec: number): AudioBuffer {
  const frames = Math.round(loopSec * buffer.sampleRate);
  if (frames === buffer.length) return buffer;
  const fitted = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
  const copy = Math.min(frames, buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    fitted.getChannelData(channel).set(buffer.getChannelData(channel).subarray(0, copy));
  }
  return fitted;
}

/**
 * ループを重ねて鳴らす装置。
 * 各枠の素材をループ1周の長さに揃えて loop=true で持つので、
 * 途中で枠を足しても全部が同じ小節頭で回る。
 */
class LoopMixer {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private readonly nodes = new Map<number, { source: AudioBufferSourceNode; gain: GainNode }>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly decoding = new Map<string, Promise<AudioBuffer | undefined>>();
  private startedAt: number | undefined;
  private loopSec = 0;
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

  get playing(): boolean {
    return this.startedAt !== undefined;
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

  /** 盤面のとおりに鳴らす。演奏中に呼ぶと差分だけを直す。 */
  async apply(board: MixerBoard, sounds: readonly LoopSound[], wanted: boolean): Promise<void> {
    if (!wanted) {
      this.stop();
      return;
    }
    const ctx = this.resume();
    if (!ctx) return;
    const byId = new Map(sounds.map((s) => [s.id, s]));
    const targets = soundingSlots(board.slots);

    // 必要な素材を先に用意する（鳴らす直前にデコードすると頭が欠ける）。
    const buffers = new Map<number, AudioBuffer>();
    for (const index of targets) {
      const sound = byId.get(board.slots[index].soundId ?? '');
      if (!sound) continue;
      const buffer = await this.decode(sound);
      if (buffer) buffers.set(index, buffer);
    }

    const loopSec = loopSeconds(board.bpm, board.bars);

    // ループ長が変わったら全体を組み直す（揃え直さないと小節頭がずれる）。
    if (this.startedAt !== undefined && Math.abs(loopSec - this.loopSec) > 1e-9) this.stop();

    if (this.startedAt === undefined) {
      this.startedAt = ctx.currentTime + LEAD_SEC;
      this.loopSec = loopSec;
    }

    // 鳴らさなくなった枠を止める。
    for (const index of [...this.nodes.keys()]) {
      if (!buffers.has(index)) this.stopSlot(index);
    }
    // 新しく鳴る枠は次のループ頭から入れる。
    const when = nextBoundary(ctx.currentTime, this.startedAt, this.loopSec);
    for (const [index, buffer] of buffers) {
      if (this.nodes.has(index)) continue;
      this.startSlot(index, buffer, when);
    }
  }

  private startSlot(index: number, buffer: AudioBuffer, when: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const gain = ctx.createGain();
    gain.connect(master);
    const source = ctx.createBufferSource();
    source.buffer = fitToLoop(ctx, buffer, this.loopSec);
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = source.buffer.duration;
    source.connect(gain);
    source.start(when);
    this.nodes.set(index, { source, gain });
  }

  private stopSlot(index: number): void {
    const node = this.nodes.get(index);
    const ctx = this.ctx;
    if (!node || !ctx) return;
    const now = ctx.currentTime;
    node.gain.gain.setValueAtTime(node.gain.gain.value, now);
    node.gain.gain.linearRampToValueAtTime(0, now + FADE_SEC);
    node.source.stop(now + FADE_SEC);
    this.nodes.delete(index);
  }

  stop(): void {
    for (const index of [...this.nodes.keys()]) this.stopSlot(index);
    this.startedAt = undefined;
  }

  /** 1つの素材だけ試聴する（演奏とは別に鳴らす）。 */
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

export interface LoopMixerControls {
  playing: boolean;
  /** 再生/停止。押した操作の中で AudioContext を作るため、必ずボタンから呼ぶ。 */
  toggle: () => void;
  preview: (sound: LoopSound) => Promise<boolean>;
  /** 素材を消したときにデコード結果も捨てる。 */
  forget: (soundId: string) => void;
  /** ループ1周の長さ（秒）。 */
  loopSec: number;
}

/**
 * 盤面の変化に追従して鳴らし続けるフック。
 * 枠の追加・消音・音量の変更は再生を止めずに反映する。
 */
export function useLoopMixer(board: MixerBoard, sounds: readonly LoopSound[]): LoopMixerControls {
  const mixer = useRef<LoopMixer | undefined>(undefined);
  mixer.current ??= new LoopMixer();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    void mixer.current?.apply(board, sounds, playing);
  }, [board, sounds, playing]);

  useEffect(() => {
    mixer.current?.setVolume(board.volume);
  }, [board.volume]);

  // 画面を離れたら鳴らしっぱなしにしない。
  useEffect(() => {
    const instance = mixer.current;
    return () => instance?.stop();
  }, []);

  const toggle = useCallback(() => {
    mixer.current?.resume();
    setPlaying((current) => !current);
  }, []);

  const preview = useCallback(async (sound: LoopSound) => (await mixer.current?.preview(sound)) ?? false, []);
  const forget = useCallback((soundId: string) => mixer.current?.forget(soundId), []);

  return {
    playing,
    toggle,
    preview,
    forget,
    loopSec: loopSeconds(board.bpm, board.bars),
  };
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
