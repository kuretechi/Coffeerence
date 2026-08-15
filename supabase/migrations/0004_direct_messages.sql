-- ユーザー同士の DM（1対1）。
-- Supabase ダッシュボードの SQL Editor に貼って実行するか、Supabase CLI で適用する。

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  moderation jsonb not null default '{"allowed": true, "categories": [], "provider": "local"}'::jsonb,
  created_at timestamptz not null default now(),
  -- 受け取った側が開いた時刻。未読は null。
  read_at timestamptz,
  -- 自分宛の DM は作れない。
  constraint messages_not_self check (sender_id <> recipient_id),
  -- 判定を通っていない DM は保存できない（サーバー側の最後の砦）。
  constraint messages_moderation_allowed check ((moderation ->> 'allowed')::boolean is true)
);

create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);

alter table public.messages enable row level security;

-- 投稿と違い、DM は当事者だけが読める。
drop policy if exists "participants read own messages" on public.messages;
create policy "participants read own messages" on public.messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "users send own messages" on public.messages;
create policy "users send own messages" on public.messages
  for insert with check (auth.uid() = sender_id);

-- 受け取った側が既読を付けられる（本文は書き換えられない）。
drop policy if exists "recipients mark messages read" on public.messages;
create policy "recipients mark messages read" on public.messages
  for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

drop policy if exists "senders delete own messages" on public.messages;
create policy "senders delete own messages" on public.messages
  for delete using (auth.uid() = sender_id);

-- 届いた DM をその場で画面に出すため Realtime に載せる。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
