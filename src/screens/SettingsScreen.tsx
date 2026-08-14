import { useEffect, useRef, useState } from 'react';
import { Banner, Card, Field, NumberField } from '../ui/components';
import { useAudit, useBeans, useBrews, useLoadedSettings, useRecipes, useSettings } from '../ui/data';
import { saveBean, saveSettings } from '../db/repo';
import { brewsToCsv, downloadFile, exportAll, importAll } from '../db/exportData';
import type { RecipeDefaults, ThemeName } from '../domain/types';

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
