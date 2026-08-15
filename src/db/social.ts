import { supabase } from '../lib/supabase';
import type { ModerationVerdict, Post, Profile, SharedRecipe } from '../domain/types';
import type { PostRow, ProfileRow } from './schema';

/**
 * 豆友（SNS）のサーバー側データ。Supabase が未設定のときは呼び出されない。
 * 認証と行レベルセキュリティ（RLS）で「読むのは誰でも／書くのは本人だけ」を担保する。
 */

export class SupabaseUnavailableError extends Error {
  constructor() {
    super('Supabase が設定されていません');
    this.name = 'SupabaseUnavailableError';
  }
}

export class SignInRequiredError extends Error {
  constructor() {
    super('投稿にはログインが必要です');
    this.name = 'SignInRequiredError';
  }
}

const TIMELINE_LIMIT = 100;

function client() {
  if (!supabase) throw new SupabaseUnavailableError();
  return supabase;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    bio: row.bio ?? undefined,
    age: row.age ?? undefined,
    gender: row.gender ?? undefined,
  };
}

export function toPost(row: PostRow): Post {
  return {
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: row.created_at,
    recipe: row.recipe ?? undefined,
    moderation: row.moderation,
    source: 'remote',
    userId: row.user_id,
  };
}

export async function fetchTimeline(limit = TIMELINE_LIMIT): Promise<Post[]> {
  const { data, error } = await client()
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toPost);
}

export async function insertPost(input: {
  body: string;
  author: string;
  recipe?: SharedRecipe;
  moderation: ModerationVerdict;
}): Promise<Post> {
  const supabaseClient = client();
  const { data: auth } = await supabaseClient.auth.getUser();
  const user = auth.user;
  if (!user) throw new SignInRequiredError();
  const { data, error } = await supabaseClient
    .from('posts')
    .insert({
      user_id: user.id,
      author: input.author,
      body: input.body,
      recipe: input.recipe ?? null,
      moderation: input.moderation,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toPost(data);
}

/** 自分の投稿だけ消せる（RLS でも同じ条件を強制している）。 */
export async function deletePost(postId: string): Promise<void> {
  const { error } = await client().from('posts').delete().eq('id', postId);
  if (error) throw new Error(error.message);
}

/** 他の端末からの投稿もタイムラインに流れてくるよう購読する。 */
export function subscribeTimeline(onChange: () => void): () => void {
  const channel = client()
    .channel('posts-timeline')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => onChange())
    .subscribe();
  return () => {
    void client().removeChannel(channel);
  };
}

export async function fetchProfile(userId: string): Promise<Profile | undefined> {
  const { data, error } = await client()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toProfile(data) : undefined;
}

/** タイムラインに出ている投稿者のプロフィールをまとめて引く。 */
export async function fetchProfiles(userIds: string[]): Promise<Profile[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await client().from('profiles').select('*').in('id', userIds);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toProfile);
}

/** サインアップ直後にトリガーが走っていない場合もあるので、必要なら作る。 */
export async function upsertProfile(profile: Profile): Promise<void> {
  const { error } = await client()
    .from('profiles')
    .upsert({
      id: profile.id,
      display_name: profile.displayName,
      avatar_url: profile.avatarUrl ?? null,
      bio: profile.bio ?? null,
      age: profile.age ?? null,
      gender: profile.gender ?? null,
    });
  if (error) throw new Error(error.message);
}
