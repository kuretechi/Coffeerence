# 判定プロキシ（Cloudflare Workers）

豆友の投稿判定は OpenAI の moderation モデル（自然言語処理）で行う。API キーは静的サイトに置けないため、
鍵を持つプロキシをここに置き、アプリはその URL だけを知る。

## デプロイ

```bash
npm create cloudflare@latest coffeerence-moderation -- --type hello-world
# 生成された src/index.js を proxy/moderation-worker.js の内容で置き換える
cd coffeerence-moderation
npx wrangler secret put OPENAI_API_KEY        # OpenAI の API キー
npx wrangler deploy
```

`wrangler.toml` に許可オリジンを入れておく（省略すると全オリジンを許可する）。

```toml
[vars]
ALLOWED_ORIGIN = "https://kuretechi.github.io"
# MODERATION_MODEL = "omni-moderation-latest"
```

## アプリ側の設定

デプロイで得た URL（例 `https://coffeerence-moderation.<account>.workers.dev`）を
GitHub リポジトリの Settings → Secrets and variables → Actions → Variables に
`VITE_MODERATION_ENDPOINT` として登録する。Pages のデプロイでビルドに渡る。

未設定のままでも投稿はできる。その場合はモデル判定に到達できないので、
語彙による規則判定（`src/lib/moderation.ts`）だけが働く。
