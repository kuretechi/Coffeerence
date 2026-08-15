import { describe, expect, it } from 'vitest';
import { REVERB_PRESETS, reverbAmount } from '../useTimer';

describe('reverbAmount', () => {
  it('未設定なら効果ごとの既定値を使う', () => {
    expect(reverbAmount('room')).toEqual(REVERB_PRESETS.room);
    expect(reverbAmount('hall')).toEqual(REVERB_PRESETS.hall);
  });

  it('設定した数値を優先し、片方だけでも受け付ける', () => {
    expect(reverbAmount('hall', { mix: 30, seconds: 1.5 })).toEqual({ mix: 30, seconds: 1.5 });
    expect(reverbAmount('hall', { mix: 30 })).toEqual({ mix: 30, seconds: REVERB_PRESETS.hall.seconds });
  });

  it('範囲外の数値は丸める', () => {
    expect(reverbAmount('room', { mix: 400, seconds: 99 })).toEqual({ mix: 100, seconds: 6 });
    expect(reverbAmount('room', { mix: -10, seconds: 0 })).toEqual({ mix: 0, seconds: 0.2 });
    expect(reverbAmount('room', { mix: Number.NaN, seconds: Number.NaN })).toEqual({ mix: 0, seconds: 0.2 });
  });
});
