import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, Card, Field, formatSeconds } from '../ui/components';
import { useRecipes } from '../ui/data';
import { useTimeline } from '../ui/social';
import { useAuth } from '../ui/auth';
import { deletePost, importSharedRecipe, submitPost, toSharedRecipe } from '../db/repo';
import { SignInRequiredError } from '../db/social';
import type { Post, SharedRecipe } from '../domain/types';

const MAX_BODY = 500;

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

/** 豆友（投稿）。Supabase を設定すると全員のタイムラインになり、未設定なら端末内に残る。 */
export function FriendsScreen() {
  const timeline = useTimeline();
  const recipes = useRecipes();
  const auth = useAuth();
  const [author, setAuthor] = useState('');
  const [recipeId, setRecipeId] = useState('');
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const remote = timeline.mode === 'remote';
  const signedIn = auth.user !== undefined;
  const canPost = !busy && (body.trim() !== '' || recipeId !== '') && (!remote || signedIn);

  function canDelete(post: Post): boolean {
    return post.source === 'remote' ? post.userId === auth.user?.id : true;
  }

  async function post() {
    if (!canPost) return;
    setBusy(true);
    try {
      const attached = recipes.find((recipe) => recipe.id === recipeId);
      const verdict = await submitPost(
        remote ? (auth.user?.displayName ?? '') : author,
        body.trim(),
        attached ? toSharedRecipe(attached) : undefined,
      );
      if (verdict.allowed) {
        setBody('');
        setRecipeId('');
        setNotice({ tone: 'ok', text: '投稿しました。' });
        timeline.reload();
      } else {
        setNotice({ tone: 'danger', text: `投稿できません: ${verdict.reason ?? '不適切な内容と判定されました。'}` });
      }
    } catch (cause) {
      setNotice({
        tone: 'danger',
        text:
          cause instanceof SignInRequiredError
            ? '投稿にはログインが必要です。アカウントタブからログインしてください。'
            : '投稿に失敗しました。もう一度お試しください。',
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: Post) {
    try {
      await deletePost(target);
      timeline.reload();
    } catch {
      setNotice({ tone: 'danger', text: '削除に失敗しました。もう一度お試しください。' });
    }
  }

  return (
    <>
      <Card
        title="豆友"
        hint={
          remote
            ? '投稿はサーバーに保存され、ほかの豆友にも見えます。自動判定を通ったものだけが残ります。'
            : 'いまは端末内にだけ保存されます。投稿は自動判定を通ったものだけが残ります。'
        }
      >
        <div className="stack">
          {remote && !signedIn ? (
            <Banner>
              投稿するには<Link to="/account">アカウントタブ</Link>でログインしてください。読むだけならログイン不要です。
            </Banner>
          ) : null}
          {remote && signedIn ? <p className="muted">投稿者名: {auth.user?.displayName}（アカウントの表示名）</p> : null}
          {remote ? null : (
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
          {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
          <div className="row">
            <button className="primary" type="button" disabled={!canPost} onClick={() => void post()}>
              投稿する
            </button>
          </div>
          <p className="muted">投稿は必ず自動判定を通ります（利用者側での設定はありません）。</p>
        </div>
      </Card>

      <Card title="タイムライン">
        {timeline.error ? <Banner tone="danger">タイムラインを読み込めませんでした: {timeline.error}</Banner> : null}
        {timeline.loading && timeline.posts.length === 0 ? (
          <Banner>読み込み中です。</Banner>
        ) : timeline.posts.length === 0 ? (
          <Banner>まだ投稿がありません。</Banner>
        ) : (
          <div className="stack">
            {timeline.posts.map((post) => (
              <div key={post.id} className="todo-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <span className="row between">
                  <strong>{post.author}</strong>
                  <span className="muted">{new Date(post.createdAt).toLocaleString('ja-JP')}</span>
                </span>
                <p>{post.body}</p>
                {post.recipe ? <AttachedRecipe recipe={post.recipe} /> : null}
                {canDelete(post) ? (
                  <div className="row">
                    <button className="danger" type="button" onClick={() => void remove(post)}>
                      削除
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
