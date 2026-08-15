import { useEffect, useRef, useState } from 'react';
import { Banner, Card, Field, NumberField, Switch } from '../ui/components';
import {
  useAudit,
  useBrews,
  useCustomSound,
  useGear,
  useLoadedSettings,
  useRecipes,
  useSettings,
} from '../ui/data';
import { deleteCustomSound, deleteGear, saveCustomSound, saveGear, saveSettings } from '../db/repo';
import {
  CHIME_SOUNDS,
  CUSTOM_FINISH_SOUND_ID,
  CUSTOM_SOUND_ID,
  PITCH_RANGE,
  SAME_AS_CHIME_ID,
  canDecodeChime,
  chime,
  doubleChime,
  primeAudio,
  setCustomChime,
} from '../ui/useTimer';
import { brewsToCsv, downloadFile, exportAll, importAll } from '../db/exportData';
import { uid } from '../lib/random';
import { useAuth } from '../ui/auth';
import type { GearKind, RecipeDefaults, SoundSlot, ThemeName } from '../domain/types';

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'classic', label: '既定' },
  { value: 'light', label: 'ライト' },
  { value: 'paper', label: '和紙' },
  { value: 'midnight', label: '深夜' },
  { value: 'matcha', label: '抹茶' },
];

export function SettingsScreen() {
  const settings = useSettings();
  const brews = useBrews();
  const recipes = useRecipes();
  const audit = useAudit();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | undefined>();
  const loaded = useLoadedSettings();
  // 保存の往復を待たず入力を反映させるため、入力中の値は手元で持つ。
  const [defaults, setDefaults] = useState<RecipeDefaults>(settings.recipeDefaults);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !loaded) return;
    initialized.current = true;
    setDefaults(loaded.recipeDefaults);
  }, [loaded]);

  function saveRecipeDefaults(patch: Partial<RecipeDefaults>) {
    const next = { ...defaults, ...patch };
    setDefaults(next);
    void saveSettings({ ...settings, recipeDefaults: next });
  }

  async function doExportJson() {
    const bundle = await exportAll();
    downloadFile(`coffeerence-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json');
  }

  function doExportCsv() {
    downloadFile(
      `coffeerence-brews-${new Date().toISOString().slice(0, 10)}.csv`,
      brewsToCsv(brews, recipes),
      'text/csv',
    );
  }

  async function doImport(file: File) {
    try {
      await importAll(JSON.parse(await file.text()));
      setMessage('インポートしました。');
    } catch (error) {
      setMessage(`インポートに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <>
      <Card title="レシピの初期値" hint="レシピ登録フォームの初期値です。注湯は「蒸らし＝粉量×3g → 中間 → 総湯量」で組み立て、各投の湯温には初期湯温が入ります。">
        <div className="row">
          <NumberField
            label="粉量"
            suffix="g"
            step={0.1}
            min={0}
            value={defaults.doseG}
            onChange={(doseG) => saveRecipeDefaults({ doseG: doseG ?? 0 })}
          />
          <NumberField
            label="初期湯温"
            suffix="℃"
            step={1}
            min={0}
            value={defaults.waterTempC}
            onChange={(waterTempC) => saveRecipeDefaults({ waterTempC: waterTempC ?? 0 })}
          />
        </div>
        <NumberField
          label="総湯量"
          suffix="g"
          step={1}
          min={0}
          value={defaults.totalWaterG}
          onChange={(totalWaterG) => saveRecipeDefaults({ totalWaterG: totalWaterG ?? 0 })}
        />
        <Field label="挽き目">
          <input
            value={defaults.grindSetting}
            placeholder="例: 中細 / ダイヤル 18"
            onChange={(event) => saveRecipeDefaults({ grindSetting: event.target.value })}
          />
        </Field>
        <Field label="ドリッパー">
          <input
            value={defaults.brewer}
            onChange={(event) => saveRecipeDefaults({ brewer: event.target.value })}
          />
        </Field>
      </Card>

      <GearCard kind="kettle" title="ケトル" placeholder="例: 月兎印 ドリップポット 0.7L" notePlaceholder="例: 注ぎ口が細い / 温度計付き" />
      <GearCard kind="mill" title="ミル" placeholder="例: コマンダンテ C40" notePlaceholder="例: 常用ダイヤル 20 / 臼は標準" />

      <Card title="表示と音">
        <Field label="表示テーマ">
          <div className="segmented">
            {THEMES.map((theme) => (
              <button
                key={theme.value}
                type="button"
                className={settings.theme === theme.value ? 'selected' : ''}
                onClick={() => void saveSettings({ ...settings, theme: theme.value })}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </Field>
        <Switch
          label="タイマー音"
          checked={settings.soundEnabled}
          onChange={(soundEnabled) => void saveSettings({ ...settings, soundEnabled })}
        />
        <SoundPicker
          label="合図音"
          slot={CUSTOM_SOUND_ID}
          selected={settings.soundId}
          fallbackId={settings.soundId}
          pitch={settings.soundPitch ?? 0}
          onSelect={(soundId) => void saveSettings({ ...settings, soundId })}
          onPitch={(soundPitch) => void saveSettings({ ...settings, soundPitch })}
        />
        <SoundPicker
          label="抽出終了の音"
          hint="抽出終了で2回鳴らす音だけを別にできます。"
          slot={CUSTOM_FINISH_SOUND_ID}
          selected={settings.finishSoundId ?? SAME_AS_CHIME_ID}
          fallbackId={settings.soundId}
          sameLabel="合図音と同じ"
          pitch={settings.finishSoundPitch ?? 0}
          onSelect={(finishSoundId) => void saveSettings({ ...settings, finishSoundId })}
          onPitch={(finishSoundPitch) => void saveSettings({ ...settings, finishSoundPitch })}
        />
      </Card>

      <Card title="データ" hint="すべてこの端末の IndexedDB に保存されています。アカウントもクラウド同期もありません。">
        {message ? <Banner>{message}</Banner> : null}
        <div className="row">
          <button type="button" onClick={doExportJson}>
            JSON で書き出す
          </button>
          <button type="button" onClick={doExportCsv}>
            CSV で書き出す
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            JSON を読み込む
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void doImport(file);
            event.target.value = '';
          }}
        />
      </Card>

      <Card title="監査ログ" hint="削除・計画変更・リビール・中断は記録に残ります。">
        {audit.length === 0 ? (
          <p className="muted">記録はまだありません。</p>
        ) : (
          <ul className="list-plain">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className="mono">{new Date(entry.at).toLocaleString('ja-JP')}</span> {entry.kind} / {entry.detail}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SignOutCard />
    </>
  );
}

/** ログイン中だけ出すログアウト。 */
function SignOutCard() {
  const auth = useAuth();
  if (!auth.user) return null;

  return (
    <Card title="ログアウト" hint={auth.user.email}>
      <div className="row">
        <button type="button" onClick={() => void auth.signOut()}>
          ログアウトする
        </button>
      </div>
    </Card>
  );
}

/** ケトル・ミルの登録。名前だけの軽い台帳で、削除は監査ログに残す。 */
function GearCard({
  kind,
  title,
  placeholder,
  notePlaceholder,
}: {
  kind: GearKind;
  title: string;
  placeholder: string;
  notePlaceholder: string;
}) {
  const gear = useGear(kind);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    void saveGear({ id: uid('gear'), kind, name: trimmed, note: note.trim() || undefined });
    setName('');
    setNote('');
  }

  return (
    <Card title={title} hint={`使っている${title}を登録しておくと、記録のときに条件を振り返れます。`}>
      {gear.length === 0 ? (
        <p className="muted">まだ登録がありません。</p>
      ) : (
        <ul className="list-plain">
          {gear.map((item) => (
            <li key={item.id} className="row between">
              <span>
                <strong>{item.name}</strong>
                {item.note ? <span className="muted"> / {item.note}</span> : null}
              </span>
              <button className="danger" type="button" onClick={() => void deleteGear(item.id)}>
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      <Field label="名前">
        <input value={name} placeholder={placeholder} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="メモ">
        <input
          value={note}
          placeholder={notePlaceholder}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <button type="button" disabled={!name.trim()} onClick={add}>
        追加
      </button>
    </Card>
  );
}

/**
 * 合図音の選択。内蔵音に加えて、この置き場にアップロードした音を選べる。
 * sameLabel を渡すと「未選択＝別の音を使わない」も選べる。
 */
function SoundPicker({
  label,
  hint,
  slot,
  selected,
  fallbackId,
  sameLabel,
  pitch,
  onSelect,
  onPitch,
}: {
  label: string;
  hint?: string;
  slot: SoundSlot;
  selected: string;
  /** 「合図音と同じ」のときに実際に鳴る音。 */
  fallbackId: string;
  sameLabel?: string;
  /** ピッチ（半音）。 */
  pitch: number;
  onSelect: (soundId: string) => void;
  onPitch: (pitch: number) => void;
}) {
  const custom = useCustomSound(slot);
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | undefined>();
  const isFinish = slot === CUSTOM_FINISH_SOUND_ID;

  /** 選んだ音をその場で鳴らす。オフ設定でも試聴だけは鳴らす。 */
  function playPreview(soundId: string, previewPitch = pitch) {
    primeAudio(true, soundId);
    if (isFinish) doubleChime(true, soundId, previewPitch);
    else chime(true, soundId, previewPitch);
  }

  const playedId = selected === SAME_AS_CHIME_ID ? fallbackId : selected;

  function select(soundId: string) {
    onSelect(soundId);
    playPreview(soundId === SAME_AS_CHIME_ID ? fallbackId : soundId);
  }

  /** ピッチを動かすたびにその高さで鳴らして確かめられるようにする。 */
  function changePitch(next: number) {
    if (next === pitch) return;
    onPitch(next);
    playPreview(playedId, next);
  }

  async function upload(file: File) {
    // 鳴らせない形式を黙って受け入れないよう、保存前にデコードを試す。
    if (!(await canDecodeChime(file))) {
      setMessage(`${file.name} はこの端末で再生できません。別の mp3 / wav を選んでください。`);
      return;
    }
    await saveCustomSound(file, slot);
    // 保存の反映を待たずに鳴らせるよう、この場でも登録しておく。
    setCustomChime(slot, file, `${file.name}:${file.size}`);
    setMessage(`${file.name} を${label}にしました。`);
    playPreview(slot);
  }

  return (
    <>
      {hint ? <p className="hint">{hint}</p> : null}
      <Field label={label}>
        <div className="segmented">
          {sameLabel ? (
            <button
              type="button"
              className={selected === SAME_AS_CHIME_ID ? 'selected' : ''}
              onClick={() => select(SAME_AS_CHIME_ID)}
            >
              {sameLabel}
            </button>
          ) : null}
          {CHIME_SOUNDS.map((sound) => (
            <button
              key={sound.id}
              type="button"
              className={selected === sound.id ? 'selected' : ''}
              onClick={() => select(sound.id)}
            >
              {sound.label}
            </button>
          ))}
          {custom ? (
            <button type="button" className={selected === slot ? 'selected' : ''} onClick={() => select(slot)}>
              {custom.name}
            </button>
          ) : null}
        </div>
      </Field>
      <Field label={`${label}のピッチ（${pitch > 0 ? '+' : ''}${pitch} 半音）`}>
        <input
          className="slider"
          type="range"
          min={-PITCH_RANGE}
          max={PITCH_RANGE}
          step={1}
          value={pitch}
          onChange={(event) => changePitch(Number(event.target.value))}
        />
      </Field>
      {message ? <Banner>{message}</Banner> : null}
      <div className="row">
        <button type="button" onClick={() => input.current?.click()}>
          mp3 / wav をアップロード
        </button>
        <button type="button" onClick={() => playPreview(playedId)}>
          試聴
        </button>
        {custom ? (
          <button
            type="button"
            onClick={() => {
              void deleteCustomSound(slot);
              setMessage('アップロードした音を削除しました。');
            }}
          >
            アップロードした音を削除
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }}
      />
    </>
  );
}
