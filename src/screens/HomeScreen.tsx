import { Link } from 'react-router-dom';
import { Banner, Card, Pill } from '../ui/components';
import { useBeans, useCompetition, useRecipes, useSessions, useSettings, revealedSessions } from '../ui/data';
import { estimateEffects, explorationVerdicts } from '../lib/effects';
import { raterReliability } from '../lib/sigma';
import { recommendNextSessions } from '../lib/recommend';
import { FACTORS, SIGMA_TRUST_THRESHOLD } from '../domain/defaults';
import type { CriterionKey, Session } from '../domain/types';

const STATUS_LABEL: Record<Session['status'], string> = {
  planned: '計画済み',
  brewing: '抽出中',
  scoring: '採点中',
  comparing: '対比較',
  revealed: 'リビール済み',
};

function nextStep(session: Session): { to: string; label: string } {
  const scored = session.cups.filter((c) => c.score).length;
  if (scored < session.cups.length) {
    const brewed = session.cups.filter((c) => c.brewLog.beverageG !== undefined).length;
    if (brewed < session.cups.length) {
      return { to: `/session/${session.id}/brew`, label: `淹れる（${brewed}/${session.cups.length}杯）` };
    }
    return { to: `/session/${session.id}/score`, label: `ブラインド採点（${scored}/${session.cups.length}杯）` };
  }
  if (session.status !== 'revealed') {
    return { to: `/session/${session.id}/compare`, label: '対比較 → リビール' };
  }
  return { to: `/session/${session.id}/reveal`, label: '結果を見る' };
}

export function HomeScreen() {
  const sessions = useSessions();
  const settings = useSettings();
  const competition = useCompetition();
  const recipes = useRecipes();
  const beans = useBeans();

  const active = sessions.find((s) => s.status !== 'revealed');
  const done = revealedSessions(sessions);
  const reliability = raterReliability(done, competition, settings.weights);
  const sigmaByCriterion = Object.fromEntries(reliability.map((r) => [r.criterion, r.sigma])) as Partial<
    Record<CriterionKey, number>
  >;
  const estimates = estimateEffects(done, {
    competition,
    weights: settings.weights,
    sigmaByCriterion,
    detectableEffect: settings.detectableEffect,
    bootstrapIterations: 200,
  });
  const verdicts = explorationVerdicts(estimates, sigmaByCriterion, settings.detectableEffect);

  const bean = beans[0];
  const baseRecipe = recipes[0];
  const recommendation = recommendNextSessions({
    remainingBeanG: bean?.remainingG ?? 0,
    doseG: baseRecipe?.doseG ?? 20,
    daysUntilCompetition: 9,
    estimates,
    verdicts,
    sigmaByCriterion,
    detectableEffect: settings.detectableEffect,
  });

  return (
    <>
      <Card title="今日やること">
        {active ? (
          <ul className="list-plain">
            <li>
              <Link className="todo-item" to={nextStep(active).to}>
                <span className="step">継続中</span>
                <span>
                  <strong>{nextStep(active).label}</strong>
                  <br />
                  <span className="muted">
                    {active.date} ／ 検証因子: {FACTORS.find((f) => f.key === active.plan.factor)?.label} ／{' '}
                    {STATUS_LABEL[active.status]}
                  </span>
                </span>
              </Link>
            </li>
          </ul>
        ) : (
          <ul className="list-plain">
            <li>
              <Link className="todo-item" to="/plan">
                <span className="step">STEP 1</span>
                <span>
                  <strong>今日のセッションを生成する</strong>
                  <br />
                  <span className="muted">
                    {recommendation.days[0]
                      ? `推奨: ${recommendation.days[0].headline}`
                      : '検証したい因子を選ぶと、淹れる構成をアプリが決めます'}
                  </span>
                </span>
              </Link>
            </li>
            <li>
              <Link className="todo-item" to="/rehearsal">
                <span className="step">STEP 2</span>
                <span>
                  <strong>競技リハーサル（7分＋7分）</strong>
                  <br />
                  <span className="muted">本番の進行を身体に入れる</span>
                </span>
              </Link>
            </li>
            <li>
              <Link className="todo-item" to="/training">
                <span className="step">STEP 3</span>
                <span>
                  <strong>三点識別トレーニング</strong>
                  <br />
                  <span className="muted">識別できない差を検証しても情報は生まれません</span>
                </span>
              </Link>
            </li>
          </ul>
        )}
      </Card>

      <Card title="いまの資源">
        <p className="muted" style={{ margin: 0 }}>
          {recommendation.note}
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          {reliability.map((r) => (
            <Pill key={r.criterion} tone={r.nPairs === 0 ? 'plain' : r.sigma <= SIGMA_TRUST_THRESHOLD ? 'ok' : 'warn'}>
              {competition.criteria.find((c) => c.key === r.criterion)?.label} σ=
              {r.nPairs === 0 ? '—' : r.sigma.toFixed(1)}
            </Pill>
          ))}
        </div>
      </Card>

      {done.length === 0 ? (
        <Banner>
          まだリビール済みのセッションがありません。σ（あなたの測定誤差）が分かるまで、効果量の数字は表示しません。
        </Banner>
      ) : null}

      <Card title="これまでのセッション">
        {sessions.length === 0 ? (
          <p className="muted">まだセッションがありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>因子</th>
                <th>杯数</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 10).map((session) => (
                <tr key={session.id}>
                  <td>
                    <Link to={nextStep(session).to}>{session.date}</Link>
                  </td>
                  <td>{FACTORS.find((f) => f.key === session.plan.factor)?.label}</td>
                  <td>{session.cups.length}</td>
                  <td>{STATUS_LABEL[session.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
