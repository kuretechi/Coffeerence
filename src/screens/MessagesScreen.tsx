import { Link } from 'react-router-dom';
import { Avatar, Banner, Card, relativeTime } from '../ui/components';
import { ANONYMOUS_NAME, useAuth } from '../ui/auth';
import { useInbox, useProfiles } from '../ui/messages';

/** DM の相手一覧。押すとそのやりとりを開く。 */
export function MessagesScreen() {
  const auth = useAuth();
  const inbox = useInbox();
  const profiles = useProfiles(inbox.threads.map((thread) => thread.userId));

  if (!auth.enabled) {
    return (
      <Card title="DM">
        <Banner>このビルドでは DM を使えません（サーバー未設定）。</Banner>
      </Card>
    );
  }

  if (auth.user === undefined) {
    return (
      <Card title="DM">
        <Banner>
          DM を使うには<Link to="/account">アカウントタブ</Link>でログインしてください。
        </Banner>
      </Card>
    );
  }

  return (
    <Card title="DM" hint="豆友のプロフィールから新しい相手に送れます">
      {inbox.error ? <Banner tone="danger">DM を読み込めませんでした: {inbox.error}</Banner> : null}
      {inbox.loading && inbox.threads.length === 0 ? <Banner>読み込み中です。</Banner> : null}
      {!inbox.loading && inbox.threads.length === 0 ? <Banner>まだやりとりがありません。</Banner> : null}
      <ul className="plain-list dm-threads">
        {inbox.threads.map((thread) => {
          const name = profiles[thread.userId]?.displayName ?? ANONYMOUS_NAME;
          return (
            <li key={thread.userId}>
              <Link className="dm-thread" to={`/dm/${thread.userId}`}>
                <Avatar name={name} url={profiles[thread.userId]?.avatarUrl} className="feed-avatar" />
                <span className="dm-thread-text">
                  <span className="row between">
                    <strong>{name}</strong>
                    <span className="muted mono">{relativeTime(thread.latest.createdAt)}</span>
                  </span>
                  <span className="muted dm-thread-excerpt">
                    {thread.latest.senderId === auth.user?.id ? '自分: ' : ''}
                    {thread.latest.body}
                  </span>
                </span>
                {thread.unread > 0 ? <span className="dm-unread">{thread.unread}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
