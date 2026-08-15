import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { fetchMessages, subscribeMessages } from '../db/messages';
import { fetchProfiles } from '../db/social';
import { countUnread, toThreads } from '../lib/messages';
import type { DirectMessage, DmThread, Profile } from '../domain/types';
import { useAuth } from './auth';

export interface Inbox {
  messages: DirectMessage[];
  threads: DmThread[];
  unread: number;
  loading: boolean;
  error?: string;
  reload: () => void;
}

/**
 * 自分が関わる DM 全部。相手ごとのまとめと未読数も返す。
 * Supabase 未設定またはログイン前は空のまま（DM はサーバーが要る）。
 */
export function useInbox(): Inbox {
  const auth = useAuth();
  const myId = auth.user?.id;
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!isSupabaseConfigured || myId === undefined) {
      setMessages([]);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchMessages()
      .then((found) => {
        if (!alive) return;
        setMessages(found);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'DM を読み込めませんでした。');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [myId, nonce]);

  useEffect(() => {
    if (!isSupabaseConfigured || myId === undefined) return;
    return subscribeMessages(reload);
  }, [myId, reload]);

  const threads = useMemo(() => (myId === undefined ? [] : toThreads(messages, myId)), [messages, myId]);
  const unread = useMemo(() => (myId === undefined ? 0 : countUnread(messages, myId)), [messages, myId]);

  return { messages, threads, unread, loading, error, reload };
}

/** DM の相手のプロフィール。名前と画像の表示だけに使う。 */
export function useProfiles(userIds: string[]): Record<string, Profile> {
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const key = [...new Set(userIds)].sort().join(',');

  useEffect(() => {
    if (!isSupabaseConfigured || key === '') return;
    let alive = true;
    fetchProfiles(key.split(','))
      .then((found) => {
        if (alive) setProfiles(Object.fromEntries(found.map((profile) => [profile.id, profile])));
      })
      .catch(() => {
        // 名前が引けなくても頭文字で表示できるので黙って諦める。
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return profiles;
}
