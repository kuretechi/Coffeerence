-- 自己紹介・年齢・性別を profiles に追加する。

alter table public.profiles
  add column if not exists bio text check (bio is null or char_length(bio) <= 200),
  add column if not exists age smallint check (age is null or (age >= 0 and age <= 120)),
  add column if not exists gender text check (gender is null or gender in ('male', 'female', 'other'));
