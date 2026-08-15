// DM が届いたら受け取った人のメールアドレスに通知する Edge Function。
// public.messages の INSERT を拾う Database Webhook から呼ばれる。
// 必要な環境変数: RESEND_API_KEY / DM_MAIL_FROM / DM_WEBHOOK_SECRET（任意）/ DM_APP_URL（任意）
// SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で入れる。
// 設定手順は docs/supabase-setup.md を参照。

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface MessageRecord {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
}

interface WebhookPayload {
  type: string;
  record?: MessageRecord;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} が設定されていません`);
  return value;
}

/** メール本文に入れる抜粋。長い DM は途中で切る。 */
function excerpt(body: string, limit = 120): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const secret = Deno.env.get('DM_WEBHOOK_SECRET') ?? '';
  if (secret !== '' && request.headers.get('x-webhook-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const payload = (await request.json()) as WebhookPayload;
  const record = payload.record;
  if (payload.type !== 'INSERT' || !record) return new Response('ignored');

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  const { data: recipient, error: recipientError } = await admin.auth.admin.getUserById(record.recipient_id);
  if (recipientError) return new Response(recipientError.message, { status: 500 });
  const email = recipient.user?.email;
  // 招待前などメールが無いユーザーは通知できない。DM 自体は保存済みなので成功として返す。
  if (!email) return new Response('no email');

  const { data: sender } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', record.sender_id)
    .maybeSingle();
  const name = sender?.display_name ?? '豆挽けば名無し';
  const appUrl = Deno.env.get('DM_APP_URL') ?? 'https://kuretechi.github.io/Coffeerence/';
  const link = `${appUrl}#/dm/${record.sender_id}`;

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env('DM_MAIL_FROM'),
      to: [email],
      subject: `【珈琲整合】${name} さんから DM が届きました`,
      text: [`${name} さんから DM が届きました。`, '', excerpt(record.body), '', `返信する: ${link}`].join('\n'),
    }),
  });

  if (!response.ok) return new Response(await response.text(), { status: 502 });
  return new Response('sent');
});
