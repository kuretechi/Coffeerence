/**
 * 豆友の投稿を OpenAI の moderation モデルで判定するためのプロキシ。
 * API キーを静的サイトに置けないので、鍵はこの Worker のシークレット（OPENAI_API_KEY）に持たせる。
 *
 * デプロイ手順は proxy/README.md を参照。
 */

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/moderations';
const DEFAULT_MODEL = 'omni-moderation-latest';
const MAX_INPUT_CHARS = 2000;

/** ALLOWED_ORIGIN に一致する場合だけ CORS を許可する。 */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGIN ?? '';
  return {
    'Access-Control-Allow-Origin': allowed === '' || origin === allowed ? origin || '*' : allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid JSON' }, 400, cors);
    }

    const input = typeof payload.input === 'string' ? payload.input.slice(0, MAX_INPUT_CHARS) : '';
    if (input === '') return json({ error: 'input is required' }, 400, cors);

    const upstream = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: env.MODERATION_MODEL ?? DEFAULT_MODEL, input }),
    });

    if (!upstream.ok) {
      // 上流のエラー本文には鍵の情報が混ざり得るので、そのままは返さない。
      return json({ error: `upstream ${upstream.status}` }, 502, cors);
    }

    const body = await upstream.json();
    return json({ results: body.results ?? [] }, 200, cors);
  },
};
