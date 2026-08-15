import { describe, expect, it } from 'vitest';
import { countUnread, toThreads } from '../messages';
import type { DirectMessage } from '../../domain/types';

function message(partial: Partial<DirectMessage> & { id: string }): DirectMessage {
  return {
    senderId: 'me',
    recipientId: 'other',
    body: '本文',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('toThreads', () => {
  it('相手ごとにまとめ、最新の1通と自分宛の未読数を持つ', () => {
    const threads = toThreads(
      [
        message({ id: '1', senderId: 'a', recipientId: 'me', createdAt: '2026-01-03T00:00:00.000Z' }),
        message({ id: '2', senderId: 'me', recipientId: 'a', createdAt: '2026-01-02T00:00:00.000Z' }),
        message({ id: '3', senderId: 'a', recipientId: 'me', createdAt: '2026-01-01T00:00:00.000Z' }),
        message({ id: '4', senderId: 'b', recipientId: 'me', createdAt: '2026-01-04T00:00:00.000Z', readAt: 'x' }),
      ],
      'me',
    );

    expect(threads.map((thread) => thread.userId)).toEqual(['b', 'a']);
    expect(threads[1]?.latest.id).toBe('1');
    expect(threads[1]?.unread).toBe(2);
    expect(threads[0]?.unread).toBe(0);
  });

  it('自分が送った未読は未読に数えない', () => {
    const threads = toThreads([message({ id: '1', senderId: 'me', recipientId: 'a' })], 'me');
    expect(threads).toHaveLength(1);
    expect(threads[0]?.unread).toBe(0);
  });
});

describe('countUnread', () => {
  it('自分宛で read_at が無いものだけ数える', () => {
    const unread = countUnread(
      [
        message({ id: '1', senderId: 'a', recipientId: 'me' }),
        message({ id: '2', senderId: 'a', recipientId: 'me', readAt: '2026-01-02T00:00:00.000Z' }),
        message({ id: '3', senderId: 'me', recipientId: 'a' }),
      ],
      'me',
    );
    expect(unread).toBe(1);
  });
});
