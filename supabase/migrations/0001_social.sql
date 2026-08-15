-- 豆友（SNS）のテーブルと行レベルセキュリティ。
-- Supabase ダッシュボードの SQL Editor に貼って実行するか、Supabase CLI で適用する。

-- ─── プロフィール ─────────────────────────
-- 認証ユーザー 1 人に 1 行。表示名だけを持つ（メールアドレスは公開しない）。
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '豆挽けば名無し' check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone" on public.profiles
  for select using (true);

drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ─── 投稿 ─────────────────────────────────
-- moderation はアプリ側の自動判定の結果。allowed=false の投稿はそもそも入らない。
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  author text not null check (char_length(author) between 1 and 40),
  body text not null default '' check (char_length(body) <= 500),
  recipe jsonb,
  moderation jsonb not null default '{"allowed": true, "categories": [], "provider": "local"}'::jsonb,
  created_at timestamptz not null default now(),
  -- 本文もレシピも無い投稿は作れない。
  constraint posts_not_empty check (char_length(btrim(body)) > 0 or recipe is not null),
  -- 判定を通っていない投稿は保存できない（サーバー側の最後の砦）。
  constraint posts_moderation_allowed check ((moderation ->> 'allowed')::boolean is true)
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_user_id_idx on public.posts (user_id);

alter table public.posts enable row level security;

drop policy if exists "posts are readable by everyone" on public.posts;
create policy "posts are readable by everyone" on public.posts
  for select using (true);

drop policy if exists "users insert own posts" on public.posts;
create policy "users insert own posts" on public.posts
  for insert with check (auth.uid() = user_id);

drop policy if exists "users update own posts" on public.posts;
create policy "users update own posts" on public.posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users delete own posts" on public.posts;
create policy "users delete own posts" on public.posts
  for delete using (auth.uid() = user_id);

-- ─── サインアップ時にプロフィールを作る ───
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), '豆挽けば名無し')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── タイムラインの購読（Realtime）─────────
-- 二度実行しても失敗しないよう、未登録のときだけ追加する。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;
end;
$$;
