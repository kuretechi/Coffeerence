import { Banner, Card, Pill } from '../ui/components';
import { revealedSessions, useCompetition, useSessions, useSettings } from '../ui/data';
import { SIGMA_VERDICT_LABEL, raterReliability, sigmaVerdict } from '../lib/sigma';
import { SIGMA_TRUST_THRESHOLD, SIGMA_WARN_THRESHOLD } from '../domain/defaults';
import { requiredTrials } from '../lib/stats';

export function ReliabilityScreen() {
  const sessions = revealedSessions(useSessions());
  const competition = useCompetition();
  const settings = useSettings();
  const reliability = raterReliability(sessions, competition, settings.weights);

  return (
    <>
      <Card
        title="あなたの採点信頼度"
        hint="隠し重複ペアの採点差から推定した測定誤差 σ です。ペアが少ない間は事前分布（σ=1.0）へ縮小しています。"
      >
        <table>
          <thead>
            <tr>
              <th>項目</th>
              <th>σ</th>
              <th>ペア数</th>
              <th>必要試行</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reliability.map((r) => {
              const verdict = sigmaVerdict(r.sigma, SIGMA_TRUST_THRESHOLD, SIGMA_WARN_THRESHOLD);
              return (
                <tr key={r.criterion} className={verdict === 'unreliable' ? 'dimmed' : ''}>
                  <td>{competition.criteria.find((c) => c.key === r.criterion)?.label}</td>
                  <td className="mono">{r.sigma.toFixed(2)}</td>
                  <td className="mono">{r.nPairs}</td>
                  <td className="mono">{requiredTrials(r.sigma, settings.detectableEffect)}</td>
                  <td>
                    <Pill tone={verdict === 'trustworthy' ? 'ok' : verdict === 'caution' ? 'warn' : 'danger'}>
                      {SIGMA_VERDICT_LABEL[verdict]}
                    </Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="hint" style={{ marginBottom: 0 }}>
          「必要試行」は δ={settings.detectableEffect} 点の差を検出力80%で検出するのに必要な比較回数です。
        </p>
      </Card>

      <Card title="フレーバー評価の癖">
        {reliability
          .filter((r) => r.criterion === 'flavor')
          .map((r) => (
            <p key={r.criterion} className="hint" style={{ margin: 0 }}>
              ダミー記述子の選択率: <strong>{(r.dummyPickRate * 100).toFixed(0)}%</strong>
              {r.dummyPickRate > 0.2
                ? ' — 高すぎます。フレーバー項目の推定は信頼度を下げて扱います。'
                : ' — 妥当な範囲です。'}
            </p>
          ))}
      </Card>

      <Card title="推移律の破れ" hint="A>B, B>C, C>A のような矛盾の割合です。σ が大きいほど増えます。">
        <table>
          <thead>
            <tr>
              <th>項目</th>
              <th>破れ率</th>
            </tr>
          </thead>
          <tbody>
            {reliability.map((r) => (
              <tr key={r.criterion}>
                <td>{competition.criteria.find((c) => c.key === r.criterion)?.label}</td>
                <td className="mono">{(r.transitivityViolationRate * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {sessions.length === 0 ? <Banner>まだデータがありません。σ は事前分布の値を表示しています。</Banner> : null}
    </>
  );
}
