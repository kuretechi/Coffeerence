import { describe, expect, it } from 'vitest';
import { moderate, moderateLocally } from '../moderation';

describe('moderateLocally', () => {
  it('通常の投稿は通す', () => {
    expect(moderateLocally('93℃で3投、蒸らし60gが良かった').allowed).toBe(true);
  });

  it('暴力的な表現は拒否する', () => {
    const verdict = moderateLocally('お前を殺す');
    expect(verdict.allowed).toBe(false);
    expect(verdict.categories).toContain('violence');
  });

  it('追加のNGワードも拒否する', () => {
    expect(moderateLocally('この豆は禁止語です', ['禁止語']).categories).toContain('blocklist');
  });
});

describe('moderate', () => {
  it('API 未設定のときはローカル判定に従う', async () => {
    await expect(moderate('死ね')).resolves.toMatchObject({ allowed: false, provider: 'local' });
    await expect(moderate('美味しく淹れられた')).resolves.toMatchObject({ allowed: true });
  });
});
