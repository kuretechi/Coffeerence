-- プロフィール画像（128px 角の JPEG data URL）を profiles に追加する。
-- 既存プロジェクトにも適用できるよう if not exists で足す。

alter table public.profiles
  add column if not exists avatar_url text
  check (avatar_url is null or char_length(avatar_url) <= 300000);
