import { supabase } from '../lib/supabase';
import { SignInRequiredError, SupabaseUnavailableError } from './social';
import type { DirectMessage, ModerationVerdict } from '../domain/types';
import type { MessageRow } from './schema';

/**
 * DM のサーバー側データ。投稿と違い RLS で当事者しか読めない。
 * Supabase 未設定のビルドでは画面ごと出さないので呼び出されない。
 */

const MESSAGE_LIMIT = 500;

function client() {
  if (!supabase) throw new SupabaseUnavailableError();
  return supabase;
}

function toMessage(row: MessageRow): DirectMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
  };
}

/** 自分が関わる DM をまとめて引く。RLS があるので絞り込みはサーバー側でも効く。 */
export async function fetchMessages(limit = MESSAGE_LIMIT): Promise<DirectMessage[]> {
  const { data, error } = await client()
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toMessage);
}

export async function insertMessage(input: {
  recipientId: string;
  body: string;
  moderation: ModerationVerdict;
}): Promise<DirectMessage> {
  const supabaseClient = client();
  const { data: auth } = await supabaseClient.auth.getUser();
  const user = auth.user;
  if (!user) throw new SignInRequiredError();
  const { data, error } = await supabaseClient
    .from('messages')
    .insert({
      sender_id: user.id,
      recipient_id: input.recipientId,
      body: input.body,
      moderation: input.moderation,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return toMessage(data);
}

/** 開いたやりとりの自分宛の未読に既読を付ける。 */
export async function markThreadRead(otherUserId: string): Promise<void> {
  const supabaseClient = client();
  const { data: auth } = await supabaseClient.auth.getUser();
  const user = auth.user;
  if (!user) return;
  const { error } = await supabaseClient
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', user.id)
    .eq('sender_id', otherUserId)
    .is('read_at', null);
  if (error) throw new Error(error.message);
}

/** 自分が送った DM は取り消せる（RLS でも同じ条件を強制している）。 */
export async function deleteMessage(messageId: string): Promise<void> {
  const { error } = await client().from('messages').delete().eq('id', messageId);
  if (error) throw new Error(error.message);
}

/** 届いた DM をその場で反映するため購読する。 */
export function subscribeMessages(onChange: () => void): () => void {
  const channel = client()
    .channel('direct-messages')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => onChange())
    .subscribe();
  return () => {
    void client().removeChannel(channel);
  };
}
