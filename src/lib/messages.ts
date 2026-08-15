import type { DirectMessage, DmThread } from '../domain/types';

/**
 * DM を相手ごとにまとめる。新しいやりとりが上に来る順で返す。
 * 未読は「自分宛でまだ開いていない」ものだけを数える。
 */
export function toThreads(messages: DirectMessage[], myId: string): DmThread[] {
  const threads = new Map<string, DmThread>();
  for (const message of messages) {
    const other = message.senderId === myId ? message.recipientId : message.senderId;
    const unread = message.recipientId === myId && message.readAt === undefined ? 1 : 0;
    const found = threads.get(other);
    if (!found) {
      threads.set(other, { userId: other, latest: message, unread });
      continue;
    }
    found.unread += unread;
    if (message.createdAt > found.latest.createdAt) found.latest = message;
  }
  return [...threads.values()].sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}

/** 自分宛の未読の総数。 */
export function countUnread(messages: DirectMessage[], myId: string): number {
  return messages.filter((message) => message.recipientId === myId && message.readAt === undefined).length;
}
