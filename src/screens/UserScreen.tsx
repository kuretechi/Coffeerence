import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Avatar, Banner, Card } from '../ui/components';
import { ANONYMOUS_NAME, useAuth } from '../ui/auth';
import { useTimeline } from '../ui/social';
import { fetchProfile } from '../db/social';
import { isSupabaseConfigured } from '../lib/supabase';
import { genderLabel } from '../lib/profile';
import type { Profile } from '../domain/types';

/** 豆友のタイムラインから開く他人のプロフィール。自分なら /account に送る。 */
export function UserScreen() {
  const { userId } = useParams();
  const auth = useAuth();
  const timeline = useTimeline();
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured || userId === undefined) return;
    let alive = true;
    setLoading(true);
    fetchProfile(userId)
      .then((found) => {
        if (alive) setProfile(found);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'プロフィールを読み込めませんでした。');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  if (userId === undefined || userId === auth.user?.id) return <Navigate to="/account" replace />;

  const posts = timeline.posts.filter((post) => post.userId === userId);
  const name = profile?.displayName ?? posts[0]?.author ?? ANONYMOUS_NAME;

  return (
    <>
      <Card title="プロフィール">
        <div className="stack">
          <div className="row account-profile">
            <Avatar name={name} url={profile?.avatarUrl} className="account-avatar-lg" />
            <div className="stack account-profile-text">
              <strong>{name}</strong>
            </div>
          </div>
          {auth.user ? (
            <div className="row">
              <Link className="button primary" to={`/dm/${userId}`}>
                DM を送る
              </Link>
            </div>
          ) : (
            <p className="muted">
              DM を送るには<Link to="/account">ログイン</Link>が必要です。
            </p>
          )}
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {loading ? <Banner>読み込み中です。</Banner> : null}
          <p>{profile?.bio ?? '自己紹介はまだありません。'}</p>
          <dl className="brew-detail">
            <dt>年齢</dt>
            <dd className="mono">{profile?.age === undefined ? '—' : `${profile.age}歳`}</dd>
            <dt>性別</dt>
            <dd>{genderLabel(profile?.gender)}</dd>
          </dl>
        </div>
      </Card>

      <Card title="投稿" hint={`タイムラインに ${posts.length} 件`}>
        {posts.length === 0 ? (
          <p className="muted">表示できる投稿がありません。</p>
        ) : (
          <ul className="plain-list">
            {posts.map((post) => (
              <li key={post.id}>
                <span className="muted mono">
                  {new Date(post.createdAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                </span>{' '}
                {post.body === '' ? (post.recipe?.name ?? '（レシピ）') : post.body}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          <Link to="/friends">豆友タブ</Link>に戻る
        </p>
      </Card>
    </>
  );
}
