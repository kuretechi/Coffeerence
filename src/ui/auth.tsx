import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { describeAuthError, isSupabaseConfigured, supabase } from '../lib/supabase';
import { fetchProfile, upsertProfile } from '../db/social';

export const ANONYMOUS_NAME = '豆挽けば名無し';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  /** プロフィール画像の data URL。未設定なら undefined。 */
  avatarUrl?: string;
}

export interface AuthApi {
  /** Supabase を設定したビルドかどうか。false なら認証機能は使えない。 */
  enabled: boolean;
  /** 初回のセッション復元が終わったか。 */
  ready: boolean;
  user: AuthUser | undefined;
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsEmailConfirm: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  /** プロフィール画像を差し替える（undefined で削除）。 */
  updateAvatar: (avatarUrl: string | undefined) => Promise<void>;
}

const AuthContext = createContext<AuthApi | undefined>(undefined);

function requireClient() {
  if (!supabase) throw new Error('Supabase が設定されていません（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）');
  return supabase;
}

/** Supabase のエラーを日本語にして投げ直す。 */
function fail(message: string): never {
  throw new Error(describeAuthError(message));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isSupabaseConfigured);
  const [user, setUser] = useState<AuthUser | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    async function load(userId: string, email: string, metaName: unknown): Promise<void> {
      const fallback = typeof metaName === 'string' && metaName.trim() !== '' ? metaName.trim() : ANONYMOUS_NAME;
      let displayName = fallback;
      let avatarUrl: string | undefined;
      try {
        const profile = await fetchProfile(userId);
        if (profile) {
          displayName = profile.displayName;
          avatarUrl = profile.avatarUrl;
        } else {
          await upsertProfile({ id: userId, displayName: fallback });
        }
      } catch {
        // プロフィールが読めなくてもログイン自体は続行する。
      }
      if (alive) setUser({ id: userId, email, displayName, avatarUrl });
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const current = session?.user;
      if (!current) {
        setUser(undefined);
        setReady(true);
        return;
      }
      void load(current.id, current.email ?? '', current.user_metadata?.display_name).finally(() => {
        if (alive) setReady(true);
      });
    });

    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!sessionData.session && alive) setReady(true);
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const name = displayName.trim() === '' ? ANONYMOUS_NAME : displayName.trim();
    const { data, error } = await requireClient().auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    });
    if (error) fail(error.message);
    // メール確認が有効なプロジェクトではセッションが返らない。
    return { needsEmailConfirm: data.session === null };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) fail(error.message);
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await requireClient().auth.signOut();
    if (error) fail(error.message);
    setUser(undefined);
  }, []);

  const updateDisplayName = useCallback(
    async (displayName: string) => {
      const name = displayName.trim() === '' ? ANONYMOUS_NAME : displayName.trim();
      if (!user) throw new Error('ログインしていません');
      await upsertProfile({ id: user.id, displayName: name, avatarUrl: user.avatarUrl });
      await requireClient().auth.updateUser({ data: { display_name: name } });
      setUser({ ...user, displayName: name });
    },
    [user],
  );

  const updateAvatar = useCallback(
    async (avatarUrl: string | undefined) => {
      if (!user) throw new Error('ログインしていません');
      await upsertProfile({ id: user.id, displayName: user.displayName, avatarUrl });
      setUser({ ...user, avatarUrl });
    },
    [user],
  );

  const value = useMemo<AuthApi>(
    () => ({
      enabled: isSupabaseConfigured,
      ready,
      user,
      signUp,
      signIn,
      signOut,
      updateDisplayName,
      updateAvatar,
    }),
    [ready, user, signUp, signIn, signOut, updateDisplayName, updateAvatar],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const api = useContext(AuthContext);
  if (!api) throw new Error('AuthProvider の外で useAuth を呼び出しました');
  return api;
}
