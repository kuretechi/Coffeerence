import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Banner, Field, formatSeconds, relativeTime } from '../ui/components';
import { useRecipes } from '../ui/data';
import { useAvatars, useTimeline } from '../ui/social';
import { useAuth } from '../ui/auth';
import { deletePost, importSharedRecipe, submitPost, toSharedRecipe } from '../db/repo';
import { SignInRequiredError } from '../db/social';
import type { Post, SharedRecipe } from '../domain/types';

const MAX_BODY = 500;

/** 投稿者のプロフィールへの行き先。端末内の投稿は自分なので /account。 */
function profilePath(post: Post): string {
  return post.userId === undefined ? '/account' : `/users/${post.userId}`;
}

/** 投稿に添付されたレシピ。取り込むと自分のレシピ一覧に追加される。 */
function AttachedRecipe({ recipe }: { recipe: SharedRecipe }) {
  const [imported, setImported] = useState(false);

  return (
    <div className="stack post-recipe">
      <strong>{recipe.name}</strong>
      <dl className="brew-detail">
        <dt>粉量 / 総湯量</dt>
        <dd className="mono">
          {recipe.doseG}g / {recipe.totalWaterG}g
        </dd>
        <dt>挽き目 / ドリッパー</dt>
        <dd>
          {recipe.grindSetting || '—'} / {recipe.brewer || '—'}
        </dd>
        <dt>初期湯温</dt>
        <dd className="mono">{recipe.waterTempC}℃</dd>
        <dt>注湯</dt>
        <dd className="mono">
          {recipe.pours.length === 0
            ? '—'
            : recipe.pours
                .map(
                  (pour) =>
                    `${formatSeconds(pour.startSec)} 累計${pour.targetG}g ${pour.waterTempC ?? recipe.waterTempC}℃`,
                )
                .join(' / ')}
        </dd>
        <dt>抽出終了</dt>
        <dd className="mono">{recipe.finishSec === undefined ? '—' : formatSeconds(recipe.finishSec)}</dd>
      </dl>
      <div className="row">
        <button
          type="button"
          disabled={imported}
          onClick={() => {
            void importSharedRecipe(recipe).then(() => setImported(true));
          }}
        >
          {imported ? '取り込み済み' : '自分のレシピに取り込む'}
        </button>
      </div>
    </div>
  );
}

/** 投稿フォーム。タイムラインの「投稿する」から開く。 */
function PostDialog({ remote, onPosted, onClose }: { remote: boolean; onPosted: () => void; onClose: () => void }) {
  const recipes = useRecipes();
  const auth = useAuth();
  const [author, setAuthor] = useState('');
  const [recipeId, setRecipeId] = useState('');
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const empty = body.trim() === '' && recipeId === '';

  async function post() {
    if (busy || empty) return;
    setBusy(true);
    try {
      const attached = recipes.find((recipe) => recipe.id === recipeId);
      const verdict = await submitPost(
        remote ? (auth.user?.displayName ?? '') : author,
        body.trim(),
        attached ? toSharedRecipe(attached) : undefined,
      );
      if (verdict.allowed) {
        onPosted();
        onClose();
        return;
      }
      setNotice(`投稿できません: ${verdict.reason ?? '不適切な内容と判定されました。'}`);
    } catch (cause) {
      setNotice(
        cause instanceof SignInRequiredError
          ? '投稿にはログインが必要です。アカウントタブからログインしてください。'
          : '投稿に失敗しました。もう一度お試しください。',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="投稿"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="row between">
          <strong>投稿</strong>
          <button className="feed-delete" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="stack">
          {remote ? (
            <p className="muted">投稿者名: {auth.user?.displayName}（アカウントの表示名）</p>
          ) : (
            <Field label="名前">
              <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="豆挽けば名無し" />
            </Field>
          )}
          <Field label={`本文（${body.length}/${MAX_BODY}）`}>
            <textarea
              value={body}
              maxLength={MAX_BODY}
              rows={4}
              onChange={(event) => setBody(event.target.value)}
              placeholder="レシピの気づきや質問を書けます。"
            />
          </Field>
          <Field label="レシピを添付">
            <select value={recipeId} onChange={(event) => setRecipeId(event.target.value)}>
              <option value="">添付しない</option>
              {recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name}
                </option>
              ))}
            </select>
          </Field>
          {recipes.length === 0 ? <p className="muted">レシピタブで登録すると添付できます。</p> : null}
          {notice ? <Banner tone="danger">{notice}</Banner> : null}
          <div className="row">
            <button className="primary" type="button" disabled={busy || empty} onClick={() => void post()}>
              投稿する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 豆友（投稿）。Supabase を設定すると全員のタイムラインになり、未設定なら端末内に残る。 */
export function FriendsScreen() {
  const timeline = useTimeline();
  const avatarOf = useAvatars(timeline.posts);
  const auth = useAuth();
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const remote = timeline.mode === 'remote';
  const signedIn = auth.user !== undefined;

  function canDelete(post: Post): boolean {
    return post.source === 'remote' ? post.userId === auth.user?.id : true;
  }

  async function remove(target: Post) {
    try {
      await deletePost(target);
      timeline.reload();
    } catch {
      setError('削除に失敗しました。もう一度お試しください。');
    }
  }

  return (
    <>
      <div className="feed-wrap">
        {remote && !signedIn ? (
          <Banner>
            投稿するには<Link to="/account">アカウントタブ</Link>でログインしてください。読むだけならログイン不要です。
          </Banner>
        ) : null}
        {timeline.error ? <Banner tone="danger">タイムラインを読み込めませんでした: {timeline.error}</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {timeline.loading && timeline.posts.length === 0 ? (
          <Banner>読み込み中です。</Banner>
        ) : timeline.posts.length === 0 ? (
          <Banner>まだ投稿がありません。</Banner>
        ) : (
          <div className="feed">
            {timeline.posts.map((post) => (
              <article key={post.id} className="feed-item">
                <Link className="feed-avatar-link" to={profilePath(post)} aria-label={`${post.author} のプロフィール`}>
                  <Avatar name={post.author} url={avatarOf(post)} className="feed-avatar" />
                </Link>
                <div className="feed-body">
                  <div className="feed-head">
                    <Link className="feed-author" to={profilePath(post)}>
                      {post.author}
                    </Link>
                    <span className="muted">
                      <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString('ja-JP')}>
                        {relativeTime(post.createdAt)}
                      </time>
                    </span>
                    {canDelete(post) ? (
                      <button
                        className="feed-delete"
                        type="button"
                        aria-label="この投稿を削除"
                        onClick={() => void remove(post)}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                  {post.body === '' ? null : <p className="feed-text">{post.body}</p>}
                  {post.recipe ? <AttachedRecipe recipe={post.recipe} /> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <button
        className="fab"
        type="button"
        aria-label="投稿する"
        disabled={remote && !signedIn}
        onClick={() => setComposing(true)}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M4 20h4l10-10-4-4L4 16v4zM16.5 3.5l4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {composing ? (
        <PostDialog remote={remote} onPosted={timeline.reload} onClose={() => setComposing(false)} />
      ) : null}
    </>
  );
}
