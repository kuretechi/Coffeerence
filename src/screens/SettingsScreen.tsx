import { useRef, useState } from 'react';
import { Banner, Card, Field, NumberField } from '../ui/components';
import { useAudit, useBeans, useBrews, useRecipes, useSettings } from '../ui/data';
import { saveBean, saveSettings } from '../db/repo';
import { brewsToCsv, downloadFile, exportAll, importAll } from '../db/exportData';
import type { ThemeName } from '../domain/types';

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'classic', label: '既定' },
  { value: 'hud', label: 'HUD' },
];

export function SettingsScreen() {
  const settings = useSettings();
  const beans = useBeans();
  const brews = useBrews();
  const recipes = useRecipes();
  const audit = useAudit();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | undefined>();

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
      <Card title="豆の残量" hint="残量から、あと何杯試せるかを計算します。">
        {beans.map((bean) => (
          <NumberField
            key={bean.id}
            label={bean.name}
            suffix="g"
            value={bean.remainingG}
            step={1}
            min={0}
            onChange={(value) => void saveBean({ ...bean, remainingG: value ?? 0 })}
          />
        ))}
      </Card>

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
        <Field label="タイマー音">
          <input
            type="checkbox"
            checked={settings.soundEnabled}
            onChange={(event) => void saveSettings({ ...settings, soundEnabled: event.target.checked })}
          />
        </Field>
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
    </>
  );
}
