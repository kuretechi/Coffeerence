# Supabase セットアップ手順（豆友の DB と認証）

この手順は**あなた（リポジトリ所有者）が実行する作業**です。アプリ側の実装はすでに入っているので、
下の 6 ステップを終えると「アカウント登録・ログイン」と「全員で共有する豆友タイムライン」が動きます。

環境変数を設定しないビルドでは、これまでどおり投稿は端末内（IndexedDB）にだけ保存され、
アカウント画面は「サーバー未設定」の表示になります。既存の使い方は壊れません。

---

## 1. Supabase プロジェクトを作る

1. https://supabase.com にサインイン（GitHub アカウントで可）。
2. **New project** を押す。
   - Name: `coffeerence`
   - Database Password: 自動生成の強いものをパスワードマネージャに保存（後で使いません／DB 直接接続用）
   - Region: `Northeast Asia (Tokyo)`
   - Plan: Free で十分
3. 作成完了まで 1〜2 分待つ。

## 2. テーブルと権限（RLS）を作る

1. 左メニュー **SQL Editor** → **New query**。
2. リポジトリの `supabase/migrations/0001_social.sql` の中身を全部貼り付けて **Run**。
3. `Success. No rows returned` と出れば完了。**Table Editor** に `profiles` と `posts` が見えます。

この SQL が作るもの:

| 対象 | 内容 |
| --- | --- |
| `profiles` | ユーザー 1 人 1 行（表示名のみ）。メールアドレスは公開しない |
| `posts` | 投稿（本文・添付レシピ JSON・自動判定結果・投稿者） |
| RLS | 読むのは誰でも可、書く・消すのは本人の行だけ |
| トリガー | サインアップ時に `profiles` を自動作成（表示名は登録フォームの値） |
| Realtime | `posts` を購読対象にして、他の端末の投稿がその場で流れてくる |

> Supabase CLI を使う場合は `supabase link --project-ref <ref>` のあと `supabase db push` でも同じです。

## 3. 認証の設定

左メニュー **Authentication** で:

1. **Sign In / Providers** → `Email` を有効（既定で有効）。パスワード最小長は 8 以上を推奨。
2. **URL Configuration**
   - `Site URL`: 公開先（例 `https://kuretechi.github.io/Coffeerence/`）
   - `Redirect URLs` に開発用も追加: `http://localhost:5173/`
   - ハッシュルーターなので `.../#/` が付いた URL でも戻れます（`?code=...#/` を取り込む実装済み）。
3. メール確認をどうするか決める:
   - **確認あり（推奨・既定）**: 登録後に届くリンクを開くとログイン可。無料枠の送信数は少ないので、
     本格運用時は **SMTP Settings** で自分のメール送信サービス（Resend / SendGrid など）を設定。
   - **確認なし（動作確認を早くしたいとき）**: **Sign In / Providers → Email → Confirm email** をオフ。

## 4. API キーを取り、ローカルで動かす

1. **Project Settings → API** から次の 2 つをコピー。
   - `Project URL`
   - `anon` `public` キー（公開前提のキー。`service_role` は絶対に使わない）
2. リポジトリのルートで:

```sh
cp .env.example .env
# .env を開いて VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を貼る
npm install
npm run dev
```

3. http://localhost:5173/ → 「アカウント」タブで新規登録 → 「豆友」タブで投稿。
   別のブラウザ（またはシークレットウィンドウ）で開くと、同じ投稿が見えます。

`.env` は `.gitignore` 済みなのでコミットされません。

## 5. 公開ビルド（GitHub Pages）に環境変数を渡す

GitHub の **Settings → Secrets and variables → Actions** で登録します。

| 種別 | 名前 | 値 |
| --- | --- | --- |
| Variables | `VITE_SUPABASE_URL` | Project URL |
| Secrets | `VITE_SUPABASE_ANON_KEY` | anon キー |

`anon` キーはブラウザに載る前提のキーですが、リポジトリに平文で置かないため Secrets に入れています。
登録後に `main` へ push（または Actions から `Deploy to GitHub Pages` を手動実行）すると、
公開版でもログインと共有タイムラインが有効になります。

> 未登録のままでも Deploy は成功します（その場合は端末内保存のままの動作）。

## 6. 動作確認チェックリスト

- [ ] 新規登録 → 確認メールのリンク → ログインできる
- [ ] アカウントタブで表示名を変更できる（以後の投稿名に反映）
- [ ] 豆友タブで投稿すると、別ブラウザのタイムラインにも出る
- [ ] 他人の投稿には削除ボタンが出ない（自分の投稿だけ消せる）
- [ ] 未ログインでもタイムラインは読める／投稿ボタンは押せない
- [ ] 不適切な語を含む投稿は保存されない（自動判定）

---

## 運用メモ

- **費用**: Free プランは DB 500MB・月間アクティブユーザー 5 万まで。豆友の規模なら十分。
  7 日間アクセスが無いと一時停止するので、ダッシュボードから再開できることを覚えておく。
- **不適切投稿の判定**: 端末内の規則判定は必ず通ります。AI 判定も使う場合、API キーをブラウザに置かず
  Supabase Edge Function 経由にするのが安全です（`VITE_MODERATION_ENDPOINT` にその関数の URL を入れる）。
  DB 側にも「判定を通っていない投稿は入れられない」制約を入れてあります。
- **削除**: サーバー上の投稿は本人だけが削除できます（RLS）。管理者として消す場合は
  ダッシュボードの Table Editor から直接削除してください。
- **オフライン**: Supabase を設定しても、レシピ・記録・タイマーは従来どおり端末内で完結します。
  同期されるのは豆友の投稿とアカウントだけです。
