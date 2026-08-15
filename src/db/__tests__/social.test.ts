import { describe, expect, it } from 'vitest';
import { toPost } from '../social';
import type { PostRow } from '../schema';

const row: PostRow = {
  id: '2b2d6d1e-0000-4000-8000-000000000001',
  user_id: 'e1f4a3c2-0000-4000-8000-000000000002',
  author: '豆挽けば名無し',
  body: '浅煎りは 92℃ が好み',
  recipe: null,
  moderation: { allowed: true, categories: [], provider: 'local' },
  created_at: '2026-08-15T01:00:00.000Z',
};

describe('toPost', () => {
  it('サーバーの行を投稿に変換する', () => {
    expect(toPost(row)).toEqual({
      id: row.id,
      author: row.author,
      body: row.body,
      createdAt: row.created_at,
      recipe: undefined,
      moderation: row.moderation,
      source: 'remote',
      userId: row.user_id,
    });
  });

  it('添付レシピをそのまま持ち越す', () => {
    const recipe = {
      name: '基準レシピ',
      doseG: 20,
      totalWaterG: 320,
      grindSetting: '現状',
      brewer: 'V60 02',
      waterTempC: 92,
      pours: [{ index: 1, targetG: 60, startSec: 0 }],
    };
    expect(toPost({ ...row, recipe })?.recipe).toEqual(recipe);
  });
});
