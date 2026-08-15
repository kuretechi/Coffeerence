import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { fetchProfiles, fetchTimeline, subscribeTimeline } from '../db/social';
import type { Post } from '../domain/types';
import { usePosts, useSettings } from './data';

export interface Timeline {
  /** remote = Supabase のタイムライン。local = 端末内（Supabase 未設定）。 */
  mode: 'remote' | 'local';
  posts: Post[];
  loading: boolean;
  error?: string;
  reload: () => void;
}

/**
 * 豆友のタイムライン。Supabase が設定されていればサーバーの投稿を購読し、
 * 未設定なら従来どおり端末内（IndexedDB）の投稿を表示する。
 */
export function useTimeline(): Timeline {
  const localPosts = usePosts();
  const [remotePosts, setRemotePosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let alive = true;
    setLoading(true);
    fetchTimeline()
      .then((posts) => {
        if (!alive) return;
        setRemotePosts(posts);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'タイムラインを読み込めませんでした。');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return subscribeTimeline(reload);
  }, [reload]);

  if (!isSupabaseConfigured) {
    return { mode: 'local', posts: localPosts, loading: false, reload };
  }
  return { mode: 'remote', posts: remotePosts, loading, error, reload };
}

/**
 * 投稿者のプロフィール画像。remote の投稿は profiles から引き、
 * 端末内の投稿は自分の設定（settings.avatarUrl）を使う。
 */
export function useAvatars(posts: Post[]): (post: Post) => string | undefined {
  const localAvatar = useSettings().avatarUrl;
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const userIds = [...new Set(posts.map((post) => post.userId).filter((id): id is string => id !== undefined))];
  const key = userIds.join(',');

  useEffect(() => {
    if (!isSupabaseConfigured || key === '') return;
    let alive = true;
    fetchProfiles(key.split(','))
      .then((profiles) => {
        if (!alive) return;
        setAvatars(
          Object.fromEntries(
            profiles
              .filter((profile) => profile.avatarUrl !== undefined)
              .map((profile) => [profile.id, profile.avatarUrl as string]),
          ),
        );
      })
      .catch(() => {
        // 画像が引けなくても頭文字で表示できるので黙って諦める。
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return (post: Post) => (post.userId === undefined ? localAvatar : avatars[post.userId]);
}
