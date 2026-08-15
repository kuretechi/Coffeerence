import { useState } from 'react';
import { Banner, Card, Field } from '../ui/components';
import { usePosts, useSettings } from '../ui/data';
import { deletePost, remoderatePosts, submitPost } from '../db/repo';

const MAX_BODY = 500;

/** 豆友（投稿）。中身は仮で、書き込みと不適切判定の機構だけ先に入れている。 */
export function FriendsScreen() {
  const posts = usePosts();
  const moderation = useSettings().moderation;
  const [author, setAuthor] = useState('');
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function post() {
    if (body.trim() === '' || busy) return;
    setBusy(true);
    try {
      const verdict = await submitPost(author, body.trim());
      if (verdict.allowed) {
        setBody('');
        setNotice({ tone: 'ok', text: '投稿しました。' });
      } else {
        setNotice({ tone: 'danger', text: `投稿できません: ${verdict.reason ?? '不適切な内容と判定されました。'}` });
      }
    } finally {
      setBusy(false);
    }
  }

  async function recheck() {
    setBusy(true);
    try {
      const removed = await remoderatePosts();
      setNotice({ tone: removed > 0 ? 'danger' : 'ok', text: `再判定しました（削除 ${removed} 件）。` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="豆友" hint="いまは端末内にだけ保存されます。投稿は自動判定を通ったものだけが残ります。">
        <div className="stack">
          <Field label="名前">
            <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="名無し" />
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
          {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
          <div className="row">
            <button className="primary" type="button" disabled={body.trim() === '' || busy} onClick={() => void post()}>
              投稿する
            </button>
            <button type="button" disabled={posts.length === 0 || busy} onClick={() => void recheck()}>
              全投稿を再判定
            </button>
          </div>
          <p className="muted">
            判定: {moderation.provider === 'remote' && moderation.apiKey !== '' ? 'AI判定（設定のAPI）' : 'ローカル判定'}
            。設定画面で切り替えられます。
          </p>
        </div>
      </Card>

      <Card title="タイムライン">
        {posts.length === 0 ? (
          <Banner>まだ投稿がありません。</Banner>
        ) : (
          <div className="stack">
            {posts.map((post) => (
              <div key={post.id} className="todo-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <span className="row between">
                  <strong>{post.author}</strong>
                  <span className="muted">{new Date(post.createdAt).toLocaleString('ja-JP')}</span>
                </span>
                <p>{post.body}</p>
                <div className="row">
                  <button className="danger" type="button" onClick={() => void deletePost(post.id)}>
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
