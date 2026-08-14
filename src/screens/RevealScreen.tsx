import { Link, useParams } from 'react-router-dom';
import { Banner, Card, Pill, formatSigned } from '../ui/components';
import { useCompetition, useRecipes, useSession, useSettings } from '../ui/data';
import { composeScores } from '../lib/scoring';
import { CRITERION_ORDER, FACTORS } from '../domain/defaults';
import { estimateSigma } from '../lib/sigma';
import { estimateBradleyTerry, toOutcomes } from '../lib/bradleyTerry';
import type { CriterionKey } from '../domain/types';

export function RevealScreen() {
  const { sessionId } = useParams();
  const session = useSession(sessionId);
  const competition = useCompetition();
  const settings = useSettings();
  const recipes = useRecipes();

  if (!session) return <Card title="セッションが見つかりません">ホームから選び直してください。</Card>;
  if (session.status !== 'revealed') {
    return (
      <Card title="まだリビールできません" hint="全カップの採点を終えてから開示されます。">
        <Link className="button" to={`/session/${session.id}/score`}>
          採点に戻る
        </Link>
      </Card>
    );
  }

  const recipeName = (id: string) => recipes.find((r) => r.id === id)?.name ?? id;
  const labelOfRecipe = (id: string) => session.plan.levels.find((l) => l.recipeId === id)?.label ?? recipeName(id);

  const duplicatePairs = session.cups
    .filter((c) => c.isHiddenDuplicate && c.duplicateOfCupId)
    .map((c) => ({ dup: c, donor: session.cups.find((x) => x.id === c.duplicateOfCupId) }))
    .filter((p): p is { dup: NonNullable<typeof p.dup>; donor: NonNullable<typeof p.donor> } => Boolean(p.donor));

  const balanceTheta = estimateBradleyTerry(
    toOutcomes(session.comparisons.filter((c) => c.criterion === 'balance')),
  ).theta;

  return (
    <>
      <Card title="リビール" hint={`検証因子: ${FACTORS.find((f) => f.key === session.plan.factor)?.label}`}>
        <table>
          <thead>
            <tr>
              <th>コード</th>
              <th>正体</th>
              <th>θ(総合)</th>
              {CRITERION_ORDER.filter((c) => c !== 'balance').map((c) => (
                <th key={c}>{competition.criteria.find((x) => x.key === c)?.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {session.cups.map((cup) => {
              const composed = cup.score ? composeScores(cup.score, competition, settings.weights) : {};
              const theta = balanceTheta.get(cup.id);
              return (
                <tr key={cup.id}>
                  <td className="mono">{cup.code}</td>
                  <td>
                    {labelOfRecipe(cup.recipeId)}
                    {cup.isHiddenDuplicate ? <Pill>隠し重複</Pill> : null}
                  </td>
                  <td className="mono">{theta === undefined ? '—' : theta.toFixed(2)}</td>
                  {CRITERION_ORDER.filter((c) => c !== 'balance').map((c) => (
                    <td key={c} className="mono">
                      {composed[c as CriterionKey]?.toFixed(1) ?? '—'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="σ への寄与（隠し重複ペア）" hint="同じレシピを2杯採点したときの差が、あなたの測定誤差そのものです。">
        {duplicatePairs.length === 0 ? (
          <Banner>このセッションには隠し重複がありませんでした（重複数は毎回変わります）。</Banner>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ペア</th>
                {CRITERION_ORDER.filter((c) => c !== 'balance').map((c) => (
                  <th key={c}>{competition.criteria.find((x) => x.key === c)?.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {duplicatePairs.map(({ dup, donor }) => {
                const a = dup.score ? composeScores(dup.score, competition, settings.weights) : {};
                const b = donor.score ? composeScores(donor.score, competition, settings.weights) : {};
                return (
                  <tr key={dup.id}>
                    <td className="mono">
                      {dup.code} / {donor.code}
                    </td>
                    {CRITERION_ORDER.filter((c) => c !== 'balance').map((c) => {
                      const x = a[c as CriterionKey];
                      const y = b[c as CriterionKey];
                      return (
                        <td key={c} className="mono">
                          {x === undefined || y === undefined ? '—' : formatSigned(x - y, 1)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr>
                <td className="muted">σ 推定</td>
                {CRITERION_ORDER.filter((c) => c !== 'balance').map((c) => {
                  const diffs = duplicatePairs
                    .map(({ dup, donor }) => {
                      if (!dup.score || !donor.score) return undefined;
                      const x = composeScores(dup.score, competition, settings.weights)[c as CriterionKey];
                      const y = composeScores(donor.score, competition, settings.weights)[c as CriterionKey];
                      return x === undefined || y === undefined ? undefined : x - y;
                    })
                    .filter((v): v is number => v !== undefined);
                  return (
                    <td key={c} className="mono">
                      {diffs.length === 0 ? '—' : estimateSigma(diffs).sigma.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        )}
      </Card>

      <Card title="次にやること">
        <div className="row">
          <Link className="button" to="/analysis">
            分析を見る
          </Link>
          <Link className="button" to="/plan">
            次のセッションを組む
          </Link>
        </div>
      </Card>
    </>
  );
}
