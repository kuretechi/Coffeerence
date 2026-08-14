import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Banner, Card, Field } from '../ui/components';
import { useCompetition, useSession } from '../ui/data';
import { estimateBradleyTerry, nextComparisonPair, toOutcomes } from '../lib/bradleyTerry';
import { COMPARISON_LABELS } from '../domain/defaults';
import { revealSession, saveSession } from '../db/repo';
import { shuffle, uid } from '../lib/random';
import type { Comparison, CriterionKey } from '../domain/types';

export function CompareScreen() {
  const { sessionId } = useParams();
  const session = useSession(sessionId);
  const competition = useCompetition();
  const navigate = useNavigate();
  const [criterion, setCriterion] = useState<CriterionKey>('balance');
  const [round, setRound] = useState(0);
  const [error, setError] = useState<string | undefined>();

  const pair = useMemo(() => {
    if (!session) return undefined;
    const comparisons = session.comparisons.filter((c) => c.criterion === criterion);
    const { theta } = estimateBradleyTerry(toOutcomes(comparisons));
    const chosen = nextComparisonPair(
      session.cups.map((c) => c.id),
      comparisons,
      theta,
    );
    if (!chosen) return undefined;
    // 提示順は左右をランダム化する
    const [aId, bId] = shuffle(chosen);
    return { aId, bId };
    // round を依存に入れて、回答のたびに次のペアを引き直す
  }, [session, criterion, round]);

  if (!session) return <Card title="セッションが見つかりません">ホームから選び直してください。</Card>;

  const allScored = session.cups.every((c) => c.score);
  const cupCode = (id: string) => session.cups.find((c) => c.id === id)?.code ?? '???';

  async function record(result: Comparison['result']) {
    if (!session || !pair) return;
    const comparison: Comparison = {
      id: uid('cmp'),
      sessionId: session.id,
      criterion,
      cupAId: pair.aId,
      cupBId: pair.bId,
      result,
      comparedAt: new Date().toISOString(),
    };
    await saveSession({ ...session, comparisons: [...session.comparisons, comparison], status: 'comparing' });
    setRound((r) => r + 1);
  }

  async function reveal() {
    if (!session) return;
    try {
      await revealSession(session.id);
      navigate(`/session/${session.id}/reveal`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Card title="対比較" hint="2杯を比べて優劣だけを答えます。情報量が最大になるペアをアプリが選びます。">
        <Field label="比較する項目">
          <select value={criterion} onChange={(event) => setCriterion(event.target.value as CriterionKey)}>
            {competition.criteria.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="hint" style={{ marginBottom: 0 }}>
          この項目の比較数: {session.comparisons.filter((c) => c.criterion === criterion).length}
        </p>
      </Card>

      {pair ? (
        <Card>
          <div className="row between">
            <span className="code">{cupCode(pair.aId)}</span>
            <span className="muted">と</span>
            <span className="code">{cupCode(pair.bId)}</span>
          </div>
          <p className="hint">{competition.criteria.find((c) => c.key === criterion)?.label} が良いのは？</p>
          <div className="stack">
            {([2, 1, 0, -1, -2] as const).map((result) => (
              <button key={result} type="button" onClick={() => record(result)}>
                {COMPARISON_LABELS[result].replace(/^[AB]/, (m) =>
                  m === 'A' ? cupCode(pair.aId) : cupCode(pair.bId),
                )}
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <Banner>比較できるカップが足りません。</Banner>
      )}

      <Card title="リビール" hint="全カップの採点が終わるまで、正体は開示されません。">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {!allScored ? <Banner tone="danger">未採点の杯があります（{session.cups.filter((c) => !c.score).length}杯）。</Banner> : null}
        <button className="primary" type="button" onClick={reveal} disabled={!allScored}>
          採点を締めてリビールする
        </button>
        <p className="hint" style={{ marginBottom: 0 }}>
          リビール後は採点を変更できません（NF-07）。
        </p>
      </Card>
    </>
  );
}
