import { db } from './db';
import type { LoopSound, MixerBoard } from '../domain/types';
import { DEFAULT_BOARD, detachSound, normalizeBoard } from '../lib/loopMixer';
import { uid } from '../lib/random';

/** 音重ねタブで開ける形式。iOS の m4a も含める。 */
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

/** 素材を消し、その素材を指していた枠も空にする。 */
export async function deleteLoopSound(id: string): Promise<void> {
  await db.loopSounds.delete(id);
  const board = await getMixerBoard();
  await saveMixerBoard({ ...board, slots: detachSound(board.slots, id) });
}

export async function getMixerBoard(): Promise<MixerBoard> {
  const stored = await db.mixerBoards.get('board');
  return stored ? normalizeBoard({ ...DEFAULT_BOARD, ...stored }) : DEFAULT_BOARD;
}

export async function saveMixerBoard(board: MixerBoard): Promise<void> {
  await db.mixerBoards.put(normalizeBoard(board));
}
