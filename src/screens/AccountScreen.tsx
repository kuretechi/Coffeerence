import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Banner, Card, Field, Segmented, formatSeconds } from '../ui/components';
import { ANONYMOUS_NAME, useAuth } from '../ui/auth';
import { useBrews, useRecipes, useSettings } from '../ui/data';
import { saveSettings } from '../db/repo';
import { toAvatarDataUrl } from '../lib/avatar';
import type { Gender } from '../domain/types';

type Mode = 'login' | 'signup';

const GENDERS: { value: Gender | 'unset'; label: string }[] = [
  { value: 'unset', label: '未回答' },
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
  { value: 'other', label: 'その他' },
];

const MAX_BIO = 200;
/** アカウント画面に出す自分のレシピ・記録の件数。 */
const PREVIEW_COUNT = 5;

function genderLabel(gender: Gender | undefined): string {
  return GENDERS.find((item) => item.value === gender)?.label ?? '未回答';
}

/**
 * プロフィールの表示と編集。端末内（settings）に必ず保存し、
 * ログイン中は Supabase の profiles にも反映する。
 */
function ProfileCard({ name, email, canEditName }: { name: string; email: string; canEditName: boolean }) {
  const auth = useAuth();
  const settings = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(name);
  const [avatarUrl, setAvatarUrl] = useState(settings.avatarUrl);
  const [bio, setBio] = useState(settings.bio ?? '');
  const [age, setAge] = useState(settings.age === undefined ? '' : String(settings.age));
  const [gender, setGender] = useState<Gender | 'unset'>(settings.gender ?? 'unset');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  function startEditing() {
    setDisplayName(name);
    setAvatarUrl(settings.avatarUrl);
    setBio(settings.bio ?? '');
    setAge(settings.age === undefined ? '' : String(settings.age));
    setGender(settings.gender ?? 'unset');
    setNotice(undefined);
    setEditing(true);
  }

  async function pick(file: File) {
    setNotice(undefined);
    try {
      setAvatarUrl(await toAvatarDataUrl(file));
    } catch (cause) {
      setNotice({ tone: 'danger', text: cause instanceof Error ? cause.message : '画像を読めませんでした。' });
    }
  }

  async function save() {
    const parsedAge = age.trim() === '' ? undefined : Number(age);
    if (parsedAge !== undefined && (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 120)) {
      setNotice({ tone: 'danger', text: '年齢は 0〜120 の整数で入力してください。' });
      return;
    }
    const edit = {
      displayName: displayName.trim() === '' ? ANONYMOUS_NAME : displayName.trim(),
      avatarUrl,
      bio: bio.trim() === '' ? undefined : bio.trim(),
      age: parsedAge,
      gender: gender === 'unset' ? undefined : gender,
    };
    setBusy(true);
    setNotice(undefined);
    try {
      await saveSettings({ ...settings, avatarUrl: edit.avatarUrl, bio: edit.bio, age: edit.age, gender: edit.gender });
      if (auth.user) await auth.updateProfile(edit);
      setEditing(false);
    } catch (cause) {
      setNotice({ tone: 'danger', text: cause instanceof Error ? cause.message : '保存できませんでした。' });
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <Card title="プロフィール">
        <div className="stack">
          <div className="row account-profile">
            <Avatar name={name} url={settings.avatarUrl} className="account-avatar-lg" />
            <div className="stack account-profile-text">
              <strong>{name}</strong>
              <span className="muted">{email}</span>
            </div>
          </div>
          <p>{settings.bio ?? '自己紹介はまだありません。'}</p>
          <dl className="brew-detail">
            <dt>年齢</dt>
            <dd className="mono">{settings.age === undefined ? '—' : `${settings.age}歳`}</dd>
            <dt>性別</dt>
            <dd>{genderLabel(settings.gender)}</dd>
          </dl>
          <div className="row">
            <button type="button" onClick={startEditing}>
              編集
            </button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card title="プロフィールを編集">
      <div className="stack">
        <div className="row account-profile">
          <Avatar name={displayName} url={avatarUrl} className="account-avatar-lg" />
          <div className="row">
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
              {avatarUrl ? '画像を変更' : '画像を選ぶ'}
            </button>
            {avatarUrl ? (
              <button type="button" disabled={busy} onClick={() => setAvatarUrl(undefined)}>
                画像を削除
              </button>
            ) : null}
          </div>
        </div>
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void pick(file);
          }}
        />
        {canEditName ? (
          <Field label="表示名">
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={ANONYMOUS_NAME}
            />
          </Field>
        ) : null}
        <Field label={`自己紹介（${bio.length}/${MAX_BIO}）`}>
          <textarea
            rows={3}
            maxLength={MAX_BIO}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder="好きな豆や淹れ方など"
          />
        </Field>
        <Field label="年齢">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            value={age}
            onChange={(event) => setAge(event.target.value)}
            placeholder="未回答"
          />
        </Field>
        <Field label="性別">
          <Segmented options={GENDERS} value={gender} onChange={setGender} />
        </Field>
        {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
        <div className="row">
          <button className="primary" type="button" disabled={busy} onClick={() => void save()}>
            保存
          </button>
          <button type="button" disabled={busy} onClick={() => setEditing(false)}>
            キャンセル
          </button>
        </div>
      </div>
    </Card>
  );
}

/** 自分が作ったレシピと記録の抜粋。全部はそれぞれのタブで見る。 */
function MyActivity() {
  const recipes = useRecipes();
  const brews = useBrews();
  const recipeName = (recipeId: string) => recipes.find((recipe) => recipe.id === recipeId)?.name ?? '（削除済み）';

  return (
    <>
      <Card title="自分のレシピ" hint={`登録 ${recipes.length} 件`}>
        {recipes.length === 0 ? (
          <Banner>
            まだレシピがありません。<Link to="/">レシピタブ</Link>で登録できます。
          </Banner>
        ) : (
          <ul className="plain-list">
            {recipes.slice(0, PREVIEW_COUNT).map((recipe) => (
              <li key={recipe.id} className="row between">
                <span>{recipe.name}</span>
                <span className="muted mono">
                  {recipe.doseG}g / {recipe.totalWaterG}g
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          すべては<Link to="/">レシピタブ</Link>で見られます。
        </p>
      </Card>

      <Card title="自分の記録" hint={`記録 ${brews.length} 件`}>
        {brews.length === 0 ? (
          <Banner>
            まだ記録がありません。<Link to="/timer">タイマータブ</Link>で淹れると残ります。
          </Banner>
        ) : (
          <ul className="plain-list">
            {brews.slice(0, PREVIEW_COUNT).map((brew) => (
              <li key={brew.id} className="row between">
                <span>
                  {new Date(brew.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}{' '}
                  {recipeName(brew.recipeId)}
                </span>
                <span className="muted mono">
                  {formatSeconds(brew.totalTimeSec)}
                  {brew.taste ? ` / 総合${brew.taste.overall}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          すべては<Link to="/log">記録タブ</Link>で見られます。
        </p>
      </Card>
    </>
  );
}

/** ログイン済みのアカウント。 */
function SignedIn() {
  const auth = useAuth();

  return (
    <>
      <ProfileCard name={auth.user?.displayName ?? ANONYMOUS_NAME} email={auth.user?.email ?? ''} canEditName />
      <MyActivity />
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
        <ProfileCard name="ゲスト" email="未ログイン" canEditName={false} />
        <MyActivity />
        <Card title="アカウント">
          <Banner>
            このビルドにはサーバー（Supabase）が設定されていないため、登録・ログインはできません。プロフィールと投稿は端末内にだけ保存されます。
          </Banner>
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

  return auth.user ? <SignedIn /> : <SignInForm />;
}
