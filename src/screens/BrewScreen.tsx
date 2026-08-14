import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Banner, Card, Field, NumberField, formatSeconds } from '../ui/components';
import { useCompetition, useRecipes, useSession } from '../ui/data';
import { cupsInServingOrder } from '../lib/plan';
import { beverageVolumeMl, extractionYield, meetsMinimumVolume } from '../lib/scoring';
import { HOT_WATER_DENSITY } from '../domain/defaults';
import { consumeBeans, saveBrewLog } from '../db/repo';
import { useStopwatch } from '../ui/useTimer';
import type { BrewLog, Cup } from '../domain/types';

export function BrewScreen() {
  const { sessionId } = useParams();
  const session = useSession(sessionId);
  const recipes = useRecipes();
  const competition = useCompetition();
  const stopwatch = useStopwatch();
  const [draft, setDraft] = useState<BrewLog>({});
  const [deviation, setDeviation] = useState('');

  if (!session) return <Card title="セッションが見つかりません">ホームから選び直してください。</Card>;

  const ordered = cupsInServingOrder(session.cups, session.plan.servingOrder);
  const remaining = ordered.filter((c) => c.brewLog.beverageG === undefined);
  const cup: Cup | undefined = remaining[0];
  const recipe = recipes.find((r) => r.id === cup?.recipeId);

  if (!cup || !recipe) {
    return (
      <Card title="全て淹れ終えました" hint="ここから先はレシピ情報を表示しません。">
        <Link className="button primary" to={`/session/${session.id}/score`}>
          ブラインド採点へ進む
        </Link>
      </Card>
    );
  }

  const nextPour = recipe.pours.find((p) => p.startSec > stopwatch.elapsed);
  const currentPour = [...recipe.pours].reverse().find((p) => p.startSec <= stopwatch.elapsed);
  const volumeOk =
    draft.beverageG !== undefined && meetsMinimumVolume(draft.beverageG, HOT_WATER_DENSITY, competition.minVolumeMl);

  async function complete() {
    if (!cup || !recipe) return;
    const log: BrewLog = {
      ...draft,
      totalTimeSec: draft.totalTimeSec ?? Math.round(stopwatch.elapsed),
      deviations: deviation ? [deviation] : undefined,
      extractionYield:
        draft.tds !== undefined && draft.beverageG !== undefined
          ? extractionYield(draft.tds, draft.beverageG, draft.actualDoseG ?? recipe.doseG)
          : undefined,
    };
    await saveBrewLog(session!.id, cup.id, log);
    await consumeBeans(session!.beanId, draft.actualDoseG ?? recipe.doseG);
    setDraft({});
    setDeviation('');
    stopwatch.reset();
  }

  return (
    <>
      <Card title={`残り ${remaining.length} 杯`} hint="提供順はシャッフル済みです。全て淹れ終えてから採点します。">
        <div className="row between">
          <span className="code">{cup.code}</span>
          <span className="muted">
            {recipe.name}
          </span>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          豆量 {recipe.doseG}g ／ 挽き目 {recipe.grindSetting} ／ 湯温 {recipe.waterTempC}℃ ／ 総湯量 {recipe.totalWaterG}g
        </p>
      </Card>

      <Card title="注湯タイマー">
        <div className={`timer ${nextPour && nextPour.startSec - stopwatch.elapsed < 5 ? 'warning' : ''}`}>
          {formatSeconds(stopwatch.elapsed)}
        </div>
        <div className="row">
          {stopwatch.running ? (
            <button type="button" onClick={stopwatch.pause}>
              一時停止
            </button>
          ) : (
            <button type="button" className="primary" onClick={stopwatch.start}>
              スタート
            </button>
          )}
          <button type="button" onClick={stopwatch.reset}>
            リセット
          </button>
        </div>
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>投</th>
              <th>開始</th>
              <th>累積目標</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recipe.pours.map((pour) => (
              <tr key={pour.index} className={currentPour?.index === pour.index ? '' : 'dimmed'}>
                <td>{pour.index}</td>
                <td className="mono">{formatSeconds(pour.startSec)}</td>
                <td className="mono">{pour.targetG}g</td>
                <td className="muted">{pour.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="実測値" hint="熱い液体は密度が1未満です。重量で 155〜160g を確保すれば 150ml を超えます。">
        <div className="row">
          <NumberField
            label="豆量"
            suffix="g"
            step={0.1}
            value={draft.actualDoseG}
            onChange={(v) => setDraft({ ...draft, actualDoseG: v })}
          />
          <NumberField
            label="総湯量"
            suffix="g"
            value={draft.actualTotalWaterG}
            onChange={(v) => setDraft({ ...draft, actualTotalWaterG: v })}
          />
        </div>
        <div className="row">
          <NumberField
            label="提出量"
            suffix="g"
            value={draft.beverageG}
            onChange={(v) => setDraft({ ...draft, beverageG: v })}
          />
          <NumberField
            label="落ちきり"
            suffix="秒"
            value={draft.drawdownSec}
            onChange={(v) => setDraft({ ...draft, drawdownSec: v })}
          />
        </div>
        <div className="row">
          <NumberField label="TDS" suffix="%" step={0.01} value={draft.tds} onChange={(v) => setDraft({ ...draft, tds: v })} />
          <NumberField
            label="総抽出時間"
            suffix="秒"
            value={draft.totalTimeSec ?? (Math.round(stopwatch.elapsed) || undefined)}
            onChange={(v) => setDraft({ ...draft, totalTimeSec: v })}
          />
        </div>
        <Field label="計画からの逸脱メモ（任意）">
          <input value={deviation} onChange={(event) => setDeviation(event.target.value)} placeholder="例: 3投目が10秒遅れた" />
        </Field>

        {draft.beverageG !== undefined ? (
          <Banner tone={volumeOk ? 'ok' : 'danger'}>
            {draft.beverageG}g ≒ {beverageVolumeMl(draft.beverageG, HOT_WATER_DENSITY).toFixed(0)}ml。
            {volumeOk ? ` 提出量 ${competition.minVolumeMl}ml をクリアしています。` : ` ${competition.minVolumeMl}ml に届きません。`}
          </Banner>
        ) : (
          <Banner>目標 155〜160g（安全マージン込み）</Banner>
        )}

        <button className="primary" type="button" onClick={complete} disabled={draft.beverageG === undefined}>
          この杯を記録して次へ
        </button>
      </Card>
    </>
  );
}
