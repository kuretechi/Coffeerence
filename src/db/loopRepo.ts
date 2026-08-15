import { db } from './db';
import type { BeatPattern, LoopSound } from '../domain/types';
import { DEFAULT_PATTERN, detachSound, normalizePattern } from '../lib/beatGrid';
import { uid } from '../lib/random';

/** ビートタブで開ける形式。iOS の m4a も含める。 */
export const LOOP_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac';

/** 端末を埋めないための上限（1素材）。 */
export const MAX_LOOP_BYTES = 20 * 1024 * 1024;

export class LoopSoundTooLargeError extends Error {
  constructor() {
    super('素材が大きすぎます');
    this.name = 'LoopSoundTooLargeError';
  }
}

/**
 * アップロードした素材を端末内に保存する。
 * File はディスク上の実体への参照なので、中身を写した Blob を持つ。
 */
export async function saveLoopSound(file: File, durationSec: number): Promise<LoopSound> {
  if (file.size > MAX_LOOP_BYTES) throw new LoopSoundTooLargeError();
  const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' });
  const sound: LoopSound = {
    id: uid('loop'),
    name: file.name.replace(/\.[^.]+$/, '') || '素材',
    blob,
    durationSec,
    createdAt: new Date().toISOString(),
  };
  await db.loopSounds.put(sound);
  return sound;
}

export async function renameLoopSound(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const sound = await db.loopSounds.get(id);
  if (!sound) return;
  await db.loopSounds.put({ ...sound, name: trimmed });
}

/** 素材を消し、その素材を指していたトラックからも外す。 */
export async function deleteLoopSound(id: string): Promise<void> {
  await db.loopSounds.delete(id);
  const pattern = await getBeatPattern();
  await saveBeatPattern({ ...pattern, tracks: detachSound(pattern.tracks, id) });
}

export async function getBeatPattern(): Promise<BeatPattern> {
  const stored = await db.beatPatterns.get('pattern');
  return stored ? normalizePattern({ ...DEFAULT_PATTERN, ...stored }) : DEFAULT_PATTERN;
}

export async function saveBeatPattern(pattern: BeatPattern): Promise<void> {
  await db.beatPatterns.put(normalizePattern(pattern));
}
