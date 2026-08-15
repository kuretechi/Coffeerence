import { useState } from 'react';
import { Banner, Card, Field, Segmented } from '../ui/components';
import { ANONYMOUS_NAME, useAuth } from '../ui/auth';

type Mode = 'login' | 'signup';

/** ログイン済みのプロフィール。表示名を変えると以後の投稿名に反映される。 */
function Profile() {
  const auth = useAuth();
  const [displayName, setDisplayName] = useState(auth.user?.displayName ?? '');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await auth.updateDisplayName(displayName);
      setNotice({ tone: 'ok', text: '表示名を変更しました。' });
    } catch (cause) {
      setNotice({ tone: 'danger', text: cause instanceof Error ? cause.message : '変更できませんでした。' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="プロフィール">
        <div className="stack">
          <div className="row account-profile">
            <div className="account-avatar" aria-hidden="true">
              豆
            </div>
            <div className="stack account-profile-text">
              <strong>{auth.user?.displayName}</strong>
              <span className="muted">{auth.user?.email}</span>
            </div>
          </div>
          <Field label="表示名">
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={ANONYMOUS_NAME}
            />
          </Field>
          {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
          <div className="row">
            <button className="primary" type="button" disabled={busy} onClick={() => void save()}>
              表示名を保存
            </button>
          </div>
          <p className="muted">豆友の投稿はこの表示名で保存されます。</p>
        </div>
      </Card>

      <Card title="ログアウト">
        <div className="row">
          <button type="button" onClick={() => void auth.signOut()}>
            ログアウトする
          </button>
        </div>
      </Card>
    </>
  );
}

/** メールアドレスとパスワードでの登録・ログイン。 */
function SignInForm() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const canSubmit = !busy && email.trim() !== '' && password !== '';

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setNotice(undefined);
    try {
      if (mode === 'signup') {
        const { needsEmailConfirm } = await auth.signUp(email.trim(), password, displayName);
        setNotice({
          tone: 'ok',
          text: needsEmailConfirm
            ? '確認メールを送りました。リンクを開くとログインできます。'
            : '登録しました。',
        });
      } else {
        await auth.signIn(email.trim(), password);
      }
      setPassword('');
    } catch (cause) {
      setNotice({ tone: 'danger', text: cause instanceof Error ? cause.message : 'うまくいきませんでした。' });
    } finally {
      setBusy(false);
    }
  }

  return (
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
              placeholder={ANONYMOUS_NAME}
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
        {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
        <div className="row">
          <button className="primary" type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {mode === 'login' ? 'ログイン' : '登録する'}
          </button>
        </div>
      </div>
    </Card>
  );
}

/** アカウント。Supabase を設定したビルドでのみ登録・ログインできる。 */
export function AccountScreen() {
  const auth = useAuth();

  if (!auth.enabled) {
    return (
      <>
        <Card title="アカウント">
          <Banner>
            このビルドにはサーバー（Supabase）が設定されていないため、登録・ログインはできません。
          </Banner>
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
            <p className="muted">豆友の投稿は端末内にだけ保存されます。</p>
          </div>
        </Card>
      </>
    );
  }

  if (!auth.ready) {
    return (
      <Card title="アカウント">
        <Banner>ログイン状態を確認しています。</Banner>
      </Card>
    );
  }

  return auth.user ? <Profile /> : <SignInForm />;
}
