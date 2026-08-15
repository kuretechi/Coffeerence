import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Avatar, Banner, Card, Field, relativeTime } from '../ui/components';
import { ANONYMOUS_NAME, useAuth } from '../ui/auth';
import { useInbox, useProfiles } from '../ui/messages';
import { SignInRequiredError } from '../db/social';
import { markThreadRead } from '../db/messages';
import { sendDirectMessage } from '../db/repo';

const MAX_BODY = 500;

/** 相手ひとりとのやりとり。開いた時点で自分宛の未読に既読を付ける。 */
export function DmThreadScreen() {
  const { userId } = useParams();
  const auth = useAuth();
  const inbox = useInbox();
  const profiles = useProfiles(userId === undefined ? [] : [userId]);
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const signedIn = auth.user !== undefined;

  useEffect(() => {
    if (!signedIn || userId === undefined) return;
    void markThreadRead(userId).catch(() => {
      // 既読が付かなくても読むことはできるので黙って諦める。
    });
  }, [signedIn, userId, inbox.messages.length]);

  if (userId === undefined || userId === auth.user?.id) return <Navigate to="/dm" replace />;

  if (!signedIn) {
    return (
      <Card title="DM">
        <Banner>
          DM を使うには<Link to="/account">アカウントタブ</Link>でログインしてください。
        </Banner>
      </Card>
    );
  }

  const name = profiles[userId]?.displayName ?? ANONYMOUS_NAME;
  // 一覧は新しい順で持っているので、会話は古い順に並べ直す。
  const thread = inbox.messages
    .filter((message) => message.senderId === userId || message.recipientId === userId)
    .slice()
    .reverse();

  async function send() {
    if (busy || body.trim() === '' || userId === undefined) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const verdict = await sendDirectMessage(userId, body);
      if (verdict.allowed) {
        setBody('');
        inbox.reload();
      } else {
        setNotice(`送れません: ${verdict.reason ?? '不適切な内容と判定されました。'}`);
      }
    } catch (cause) {
      setNotice(
        cause instanceof SignInRequiredError
          ? 'DM を送るにはログインが必要です。'
          : 'DM を送れませんでした。もう一度お試しください。',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`${name} との DM`}>
      <div className="stack">
        <div className="row account-profile">
          <Avatar name={name} url={profiles[userId]?.avatarUrl} className="feed-avatar" />
          <Link to={`/users/${userId}`}>プロフィールを見る</Link>
        </div>
        {inbox.error ? <Banner tone="danger">DM を読み込めませんでした: {inbox.error}</Banner> : null}
        {thread.length === 0 ? <Banner>まだやりとりがありません。最初の DM を送れます。</Banner> : null}
        <ul className="plain-list dm-log">
          {thread.map((message) => (
            <li key={message.id} className={message.senderId === auth.user?.id ? 'dm-bubble mine' : 'dm-bubble'}>
              <span className="dm-bubble-body">{message.body}</span>
              <span className="muted mono dm-bubble-time">{relativeTime(message.createdAt)}</span>
            </li>
          ))}
        </ul>
        <Field label={`本文（${body.length}/${MAX_BODY}）`}>
          <textarea
            value={body}
            maxLength={MAX_BODY}
            rows={3}
            onChange={(event) => setBody(event.target.value)}
            placeholder="レシピの相談などを送れます。"
          />
        </Field>
        {notice ? <Banner tone="danger">{notice}</Banner> : null}
        <div className="row">
          <button className="primary" type="button" disabled={busy || body.trim() === ''} onClick={() => void send()}>
            送る
          </button>
          <Link to="/dm">DM 一覧へ</Link>
        </div>
      </div>
    </Card>
  );
}
