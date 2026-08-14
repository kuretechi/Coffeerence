import { useRef, useState } from 'react';
import { Banner, Card, Field, NumberField } from '../ui/components';
import { revealedSessions, useAudit, useBeans, useCompetition, useSessions, useSettings } from '../ui/data';
import { saveBean, saveCompetition, saveSettings } from '../db/repo';
import { downloadFile, exportAll, importAll, sessionsToCsv } from '../db/exportData';
import { DEFECTS } from '../domain/defaults';

export function SettingsScreen() {
  const settings = useSettings();
  const competition = useCompetition();
  const beans = useBeans();
  const sessions = useSessions();
  const audit = useAudit();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | undefined>();

  async function doExportJson() {
    const bundle = await exportAll();
    downloadFile(`coffeerence-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json');
  }

  function doExportCsv() {
    downloadFile(
      `coffeerence-sessions-${new Date().toISOString().slice(0, 10)}.csv`,
      sessionsToCsv(revealedSessions(sessions), competition, settings.weights),
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

      <Card title="大会定義" hint="ルールが確定したらここを更新します。分析は常にこの定義に従います。">
        <NumberField
          label="準備時間"
          suffix="秒"
          value={competition.prepSeconds}
          onChange={(value) => void saveCompetition({ ...competition, prepSeconds: value ?? 420 })}
        />
        <NumberField
          label="競技時間"
          suffix="秒"
          value={competition.brewSeconds}
          onChange={(value) => void saveCompetition({ ...competition, brewSeconds: value ?? 420 })}
        />
        <NumberField
          label="審査時間"
          suffix="秒"
          value={competition.judgeSeconds}
          onChange={(value) => void saveCompetition({ ...competition, judgeSeconds: value ?? 180 })}
        />
        <NumberField
          label="最低提出量"
          suffix="mL"
          value={competition.minVolumeMl}
          onChange={(value) => void saveCompetition({ ...competition, minVolumeMl: value ?? 150 })}
        />
        <NumberField
          label="ジャッジ人数"
          suffix="名"
          value={competition.judgeCount}
          onChange={(value) => void saveCompetition({ ...competition, judgeCount: value ?? 3 })}
        />
      </Card>

      <Card title="分析パラメータ">
        <NumberField
          label="検出したい効果量 δ"
          suffix="点"
          step={0.1}
          value={settings.detectableEffect}
          onChange={(value) => void saveSettings({ ...settings, detectableEffect: value ?? 0.5 })}
        />
        <NumberField
          label="目標ライン（2回合計）"
          suffix="点"
          step={0.5}
          value={settings.targetLine}
          onChange={(value) => void saveSettings({ ...settings, targetLine: value ?? 0 })}
        />
        <Field label="タイマー音">
          <input
            type="checkbox"
            checked={settings.soundEnabled}
            onChange={(event) => void saveSettings({ ...settings, soundEnabled: event.target.checked })}
          />
        </Field>
      </Card>

      <Card title="スコア合成の重み" hint="欠点の重みを変えると、クリーンカップの減点幅が変わります。">
        {DEFECTS.map((defect) => (
          <NumberField
            key={defect.key}
            label={defect.label}
            step={0.1}
            min={0}
            value={settings.weights.defect[defect.key]}
            onChange={(value) =>
              void saveSettings({
                ...settings,
                weights: { ...settings.weights, defect: { ...settings.weights.defect, [defect.key]: value ?? 0 } },
              })
            }
          />
        ))}
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
