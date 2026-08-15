import { describe, expect, it } from 'vitest';
import { nextExtractedSoundName } from '../repo';
import { DEFAULT_SETTINGS } from '../../domain/defaults';

describe('nextExtractedSoundName', () => {
  it('取り込みが無ければ音声1にする', () => {
    expect(nextExtractedSoundName(DEFAULT_SETTINGS)).toBe('音声1');
  });

  it('他の枠が音声1なら音声2にする', () => {
    expect(nextExtractedSoundName({ ...DEFAULT_SETTINGS, finishCustomSoundName: '音声1' })).toBe('音声2');
  });

  it('他の枠が音声2なら音声1を使い回す', () => {
    expect(nextExtractedSoundName({ ...DEFAULT_SETTINGS, finishCustomSoundName: '音声2' })).toBe('音声1');
  });

  it('ファイル名のままの枠は番号として数えない', () => {
    expect(nextExtractedSoundName({ ...DEFAULT_SETTINGS, finishCustomSoundName: 'bell.wav' })).toBe('音声1');
  });
});
