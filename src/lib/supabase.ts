import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../db/schema';

/**
 * Supabase クライアント。環境変数が無いビルドでは undefined のままにして、
 * アプリはこれまでどおり端末内（IndexedDB）だけで動くようにする。
 */

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = url !== '' && anonKey !== '';

export const supabase: SupabaseClient<Database> | undefined = isSupabaseConfigured
  ? createClient<Database>(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // メール確認リンクは `?code=...#/` の形で戻るので、ハッシュルーターでも取り込める。
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : undefined;

/** Supabase 側のエラーを画面に出せる日本語に寄せる。 */
export function describeAuthError(message: string): string {
  if (/Invalid login credentials/i.test(message)) return 'メールアドレスかパスワードが違います。';
  if (/Email not confirmed/i.test(message)) return 'メールの確認が済んでいません。届いたリンクを開いてください。';
  if (/User already registered/i.test(message)) return 'このメールアドレスは登録済みです。';
  if (/Password should be at least/i.test(message)) return 'パスワードが短すぎます。';
  if (/rate limit|too many/i.test(message)) return '試行が多すぎます。しばらく待ってからやり直してください。';
  if (/Failed to fetch|NetworkError/i.test(message)) return 'サーバーに接続できません。通信環境を確認してください。';
  return message;
}
