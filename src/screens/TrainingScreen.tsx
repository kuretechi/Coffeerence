import { useState } from 'react';
import { Banner, Card, Field, Pill } from '../ui/components';
import { useTriangleTrials } from '../ui/data';
import { saveTriangleTrial, recordAudit } from '../db/repo';
import {
  DELTA_LADDER,
  SIGNIFICANCE_SIGMA,
  abandonTriangleTrial,
  advanceStaircase,
  answerTriangleTrial,
  createTriangleTrial,
  initialStaircase,
  staircaseThreshold,
  summarizeTriangleTrials,
} from '../lib/triangle';
import { FACTORS } from '../domain/defaults';
import type { FactorKey, TriangleTrial } from '../domain/types';

export function TrainingScreen() {
  const trials = useTriangleTrials();
  const [factor, setFactor] = useState<FactorKey>('grind');
  const [staircase, setStaircase] = useState(initialStaircase);
  const [current, setCurrent] = useState<TriangleTrial | undefined>();
  const [feedback, setFeedback] = useState<string | undefined>();

  const summaries = summarizeTriangleTrials(trials);
  const factorLabel = (key: FactorKey) => FACTORS.find((f) => f.key === key)?.label ?? key;
  const threshold = staircaseThreshold(staircase);

  function begin() {
    setFeedback(undefined);
    setCurrent(createTriangleTrial(factor, DELTA_LADDER[staircase.index]));
  }

  async function answer(position: 0 | 1 | 2) {
    if (!current) return;
    const answered = answerTriangleTrial(current, position);
    await saveTriangleTrial(answered);
    setStaircase(advanceStaircase(staircase, answered.correct === true));
    setFeedback(
      answered.correct
        ? `正解。3回連続で正解すると差を1段小さくします。`
        : `不正解。正解は ${answered.oddPosition + 1} 番でした。差を1段大きくします。`,
    );
    setCurrent(undefined);
  }

  async function abandon() {
    if (!current) return;
    await saveTriangleTrial(abandonTriangleTrial(current));
    await recordAudit({
      kind: 'abandon_trial',
      subject: current.id,
      detail: '三点識別を中断（記録は削除できません）',
    });
    setCurrent(undefined);
    setFeedback('中断として記録しました。中断試行は削除できません。');
  }

  return (
    <>
      <Card title="三点識別トレーニング" hint="3杯のうち1杯だけ違います。当てられなければ、その差はあなたには使えません。">
        <Field label="因子">
          <select value={factor} onChange={(event) => setFactor(event.target.value as FactorKey)} disabled={!!current}>
            {FACTORS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="hint">
          現在の差: <strong>{DELTA_LADDER[staircase.index]}</strong>／反転 {staircase.reversals.length} 回
          {threshold ? `／識別閾値の推定: ${threshold}` : ''}
        </p>

        {current ? (
          <>
            <Banner>
              指示どおり3杯を用意し、左から 1・2・3 に並べてください（配置はアプリが決めています。正体は答えるまで表示しません）。
            </Banner>
            <div className="row">
              {[0, 1, 2].map((position) => (
                <button key={position} type="button" onClick={() => answer(position as 0 | 1 | 2)}>
                  {position + 1} 番が違う
                </button>
              ))}
            </div>
            <button type="button" onClick={abandon}>
              中断する（記録は残ります）
            </button>
          </>
        ) : (
          <button className="primary" type="button" onClick={begin}>
            試行を開始
          </button>
        )}
        {feedback ? <Banner tone={feedback.startsWith('正解') ? 'ok' : 'info'}>{feedback}</Banner> : null}
      </Card>

      <Card title="識別能力" hint={`二項検定（帰無仮説 = 1/3 のまぐれ当たり）。${SIGNIFICANCE_SIGMA}σ 以上で「識別できる」と判定します。`}>
        {summaries.length === 0 ? (
          <Banner>まだ完了した試行がありません。</Banner>
        ) : (
          <table>
            <thead>
              <tr>
                <th>因子</th>
                <th>差</th>
                <th>正答</th>
                <th>σ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={`${s.factor}${s.levelDelta}`}>
                  <td>{factorLabel(s.factor)}</td>
                  <td>{s.levelDelta}</td>
                  <td className="mono">
                    {s.correct}/{s.total}
                  </td>
                  <td className="mono">{s.nSigma.toFixed(1)}</td>
                  <td>
                    <Pill tone={s.discriminable ? 'ok' : 'warn'}>{s.discriminable ? '識別できる' : 'まぐれの範囲'}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint" style={{ marginBottom: 0 }}>
          識別できない差は、実験計画の候補から自動的に外します。
        </p>
      </Card>

      <Card title="中断した試行">
        <p className="hint" style={{ margin: 0 }}>
          中断 {trials.filter((t) => t.abandoned).length} 件／全 {trials.length} 件。都合の悪い結果を消せない仕組みです。
        </p>
      </Card>
    </>
  );
}
