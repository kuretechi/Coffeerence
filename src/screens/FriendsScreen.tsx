import { useState } from 'react';
import { Banner, Field, formatSeconds } from '../ui/components';
import { usePosts, useRecipes } from '../ui/data';
import { deletePost, importSharedRecipe, submitPost, toSharedRecipe } from '../db/repo';
import type { SharedRecipe } from '../domain/types';

const MAX_BODY = 500;

/** 「3分」「2時間」のような相対表記。24時間を超えたら日付にする。 */
function relativeTime(iso: string): string {
  const diffSec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${Math.floor(diffSec)}秒`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間`;
  return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

/** 投稿に添付されたレシピ。取り込むと自分のレシピ一覧に追加される。 */
function AttachedRecipe({ recipe }: { recipe: SharedRecipe }) {
  const [imported, setImported] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <div className="stack post-recipe">
      <button className="log-summary" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <strong>{recipe.name}</strong>
      </button>
      {open ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}

/** 投稿フォーム。タイムラインの「投稿する」から開く。 */
function PostDialog({ onClose }: { onClose: () => void }) {
  const recipes = useRecipes();
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
      const verdict = await submitPost(author, body.trim(), attached ? toSharedRecipe(attached) : undefined);
      if (verdict.allowed) {
        onClose();
        return;
      }
      setNotice(`投稿できません: ${verdict.reason ?? '不適切な内容と判定されました。'}`);
    } catch {
      setNotice('投稿に失敗しました。もう一度お試しください。');
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
          <Field label="名前">
            <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="豆挽けば名無し" />
          </Field>
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

/** 豆友（投稿）。中身は仮で、書き込みと不適切判定の機構だけ先に入れている。 */
export function FriendsScreen() {
  const posts = usePosts();
  const [composing, setComposing] = useState(false);

  return (
    <>
      <div className="feed-wrap">
        {posts.length === 0 ? (
          <Banner>まだ投稿がありません。</Banner>
        ) : (
          <div className="feed">
            {posts.map((post) => (
              <article key={post.id} className="feed-item">
                <div className="account-avatar feed-avatar" aria-hidden="true">
                  {post.author.slice(0, 1)}
                </div>
                <div className="feed-body">
                  <div className="feed-head">
                    <strong>{post.author}</strong>
                    <span className="muted">
                      <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString('ja-JP')}>
                        {relativeTime(post.createdAt)}
                      </time>
                    </span>
                    <button
                      className="feed-delete"
                      type="button"
                      aria-label="この投稿を削除"
                      onClick={() => void deletePost(post.id)}
                    >
                      ×
                    </button>
                  </div>
                  {post.body === '' ? null : <p className="feed-text">{post.body}</p>}
                  {post.recipe ? <AttachedRecipe recipe={post.recipe} /> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <button className="fab" type="button" aria-label="投稿する" onClick={() => setComposing(true)}>
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

      {composing ? <PostDialog onClose={() => setComposing(false)} /> : null}
    </>
  );
}
