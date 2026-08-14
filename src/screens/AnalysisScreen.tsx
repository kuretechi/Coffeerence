import { useMemo } from 'react';
import { Banner, Card, Pill, formatSigned } from '../ui/components';
import { revealedSessions, useBeans, useCompetition, useRecipes, useSessions, useSettings } from '../ui/data';
import { estimateEffects, explorationVerdicts } from '../lib/effects';
import { raterReliability } from '../lib/sigma';
import { SENSITIVITY_VERDICT_LABEL, sensitivityMap } from '../lib/sensitivity';
import { recommendNextSessions } from '../lib/recommend';
import { FACTORS, SIGMA_WARN_THRESHOLD } from '../domain/defaults';
import type { CriterionKey, EffectEstimate } from '../domain/types';

const VERDICT_LABEL: Record<EffectEstimate['verdict'], string> = {
  significant: '有意',
  inconclusive: '判定不能',
  no_effect: '効果なし',
};

export function AnalysisScreen() {
  const sessions = revealedSessions(useSessions());
  const settings = useSettings();
  const competition = useCompetition();
  const recipes = useRecipes();
  const beans = useBeans();

  const reliability = raterReliability(sessions, competition, settings.weights);
  const sigmaByCriterion = Object.fromEntries(reliability.map((r) => [r.criterion, r.sigma])) as Partial<
    Record<CriterionKey, number>
  >;

  const estimates = useMemo(
    () =>
      estimateEffects(sessions, {
        competition,
        weights: settings.weights,
        sigmaByCriterion,
        detectableEffect: settings.detectableEffect,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, competition, settings],
  );

  const verdicts = explorationVerdicts(estimates, sigmaByCriterion, settings.detectableEffect);
  const sensitivity = sensitivityMap(sessions, recipes, competition, settings.weights).filter(
    (row) => row.verdict !== 'insufficient',
  );
  const bean = beans[0];
  const recommendation = recommendNextSessions({
    remainingBeanG: bean?.remainingG ?? 0,
    doseG: recipes[0]?.doseG ?? 20,
    daysUntilCompetition: 9,
    estimates,
    verdicts,
    sigmaByCriterion,
    detectableEffect: settings.detectableEffect,
  });

  const criterionLabel = (key: CriterionKey) => competition.criteria.find((c) => c.key === key)?.label ?? key;
  const factorLabel = (key: string) => FACTORS.find((f) => f.key === key)?.label ?? key;

  if (sessions.length === 0) {
    return <Card title="分析">リビール済みのセッションがまだありません。</Card>;
  }

  return (
    <>
      <Card title="効果量" hint="信頼区間がゼロを跨ぐ場合は「判定不能」と表示します。差があったように見せません。">
        {estimates.length === 0 ? (
          <p className="muted">まだ推定できるデータがありません。</p>
        ) : (
          estimates.map((e) => {
            const sigma = sigmaByCriterion[e.criterion] ?? 1;
            const unreliable = sigma > SIGMA_WARN_THRESHOLD;
            return (
              <div key={`${e.factor}${e.fromLevel}${e.toLevel}${e.criterion}`} className={unreliable ? 'dimmed' : ''}>
                <div className="row between">
                  <strong>
                    {factorLabel(e.factor)}: {e.fromLevel} → {e.toLevel} ／ {criterionLabel(e.criterion)}
                  </strong>
                  <Pill tone={e.verdict === 'significant' ? 'ok' : e.verdict === 'inconclusive' ? 'warn' : 'plain'}>
                    {VERDICT_LABEL[e.verdict]}
                  </Pill>
                </div>
                <p className="hint">
                  推定効果 {formatSigned(e.estimate)} 点 ［95% {formatSigned(e.ciLow)} 〜 {formatSigned(e.ciHigh)}］（n=
                  {e.n}、σ={sigma.toFixed(1)}）
                  {e.verdict === 'inconclusive' && e.additionalTrialsNeeded
                    ? ` この差の検出にはあと約 ${e.additionalTrialsNeeded} 回の比較が必要です。`
                    : ''}
                  {unreliable ? ' ※この項目はσが大きく、数字の信頼度が低いです。' : ''}
                </p>
              </div>
            );
          })
        )}
      </Card>

      <Card title="探索の打ち切り判定">
        {verdicts.length === 0 ? (
          <p className="muted">判定に足るデータがありません。</p>
        ) : (
          verdicts.map((v) => (
            <div key={v.factor} className="row between" style={{ marginBottom: 8 }}>
              <span>
                <strong>{factorLabel(v.factor)}</strong>
                <br />
                <span className="muted">{v.reason}</span>
              </span>
              <Pill tone={v.stopRecommended ? 'ok' : 'warn'}>{v.stopRecommended ? '打ち切り推奨' : '継続'}</Pill>
            </div>
          ))
        )}
      </Card>

      <Card title="感度マップ" hint="本番でのブレに対する耐性。準備7分・競技7分のどこに注意を配分するかの判断材料です。">
        {sensitivity.length === 0 ? (
          <Banner>実測値のばらつきが足りず、まだ感度を推定できません（各変数3点以上の記録が必要）。</Banner>
        ) : (
          <table>
            <thead>
              <tr>
                <th>変数</th>
                <th>項目</th>
                <th>影響</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sensitivity
                .slice()
                .sort((a, b) => Math.abs(b.impactAtTolerance) - Math.abs(a.impactAtTolerance))
                .slice(0, 12)
                .map((row) => (
                  <tr key={`${row.variable.key}${row.criterion}`}>
                    <td>
                      {row.variable.label} ±{row.variable.tolerance}
                      {row.variable.unit}
                    </td>
                    <td>{criterionLabel(row.criterion)}</td>
                    <td className="mono">{formatSigned(row.impactAtTolerance, 2)}</td>
                    <td>
                      <Pill tone={row.verdict === 'critical' ? 'danger' : row.verdict === 'watch' ? 'warn' : 'plain'}>
                        {SENSITIVITY_VERDICT_LABEL[row.verdict]}
                      </Pill>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="次セッションの推奨" hint={recommendation.note}>
        <ul className="list-plain">
          {recommendation.days.map((day) => (
            <li key={day.day} className="todo-item">
              <span className="step">Day{day.day}</span>
              <span>
                <strong>{day.headline}</strong>
                <br />
                <span className="muted">
                  {day.reason}（{day.cups}杯）
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
