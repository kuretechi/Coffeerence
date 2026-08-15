import { useState } from 'react';
import { Banner, Card, Field, Segmented } from '../ui/components';

type Mode = 'login' | 'signup';

/** アカウント。サーバーがまだ無いので見た目だけで、送信はできない。 */
export function AccountScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  return (
    <>
      <Card title="アカウント">
        <Banner>まだ見た目だけです。登録・ログインはできません。</Banner>
      </Card>

      <Card title="プロフィール">
        <div className="stack">
          <div className="row account-profile">
            <div className="account-avatar" aria-hidden="true">
              豆
            </div>
            <div className="stack account-profile-text">
              <strong>ゲスト</strong>
              <span className="muted">未ログイン</span>
            </div>
          </div>
          <p className="muted">豆友の投稿は「豆挽けば名無し」で保存されます。</p>
        </div>
      </Card>

      <Card title={mode === 'login' ? 'ログイン' : '新規登録'}>
        <div className="stack">
          <Segmented
            options={[
              { value: 'login', label: 'ログイン' },
              { value: 'signup', label: '新規登録' },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'signup' ? (
            <Field label="表示名">
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="豆挽けば名無し"
              />
            </Field>
          ) : null}
          <Field label="メールアドレス">
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="coffee@example.com"
            />
          </Field>
          <Field label="パスワード">
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="8文字以上"
            />
          </Field>
          <div className="row">
            <button className="primary" type="button" disabled>
              {mode === 'login' ? 'ログイン' : '登録する'}
            </button>
          </div>
        </div>
      </Card>
    </>
  );
}
