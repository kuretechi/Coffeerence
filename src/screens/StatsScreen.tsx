import { useMemo, useState } from 'react';
import { Banner, Card, Pill } from '../ui/components';
import { useBrews, useExternalLabels, useRecipes, useSessions, useSettings, useTriangleTrials } from '../ui/data';
import {
  STATS_FACTORS,
  calibrationPointsFrom,
  comparableLevelPairs,
  comparisonsFromData,
  duplicatePairsFromBrews,
  estimateThresholdFromOutcomes,
  observationsFor,
  projectionsFromBrews,
  scoredBrews,
  triangleOutcomes,
  triangleSummary,
} from '../ui/statsInputs';
import type { StatsFactorKey } from '../ui/statsInputs';
import {
  calibrate,
  estimateEffect,
  estimateSigma,
  evaluateStrategies,
  evaluateTriangleTests,
  fitBradleyTerry,
  requiredSampleSize,
} from '../stats';

/** 解析のシードは固定する。同じ記録なら毎回同じ数字が出るようにするため。 */
const SEED = 20260815;

const RELIABILITY_LABEL = {
  reliable: '使える',
  caution: '注意',
  unreliable: '当てにならない',
} as const;

const RELIABILITY_TONE = { reliable: 'ok', caution: 'warn', unreliable: 'danger' } as const;

const EFFECT_LABEL = {
  significant: '効果あり',
  no_effect: '効果なし',
  inconclusive: '判定不能',
  insufficient_data: 'データ不足',
} as const;

const EFFECT_TONE = {
  significant: 'ok',
  no_effect: 'plain',
  inconclusive: 'warn',
  insufficient_data: 'plain',
} as const;

/** 点推定と信頼区間を必ず並べて表示する（点推定だけを見せない）。 */
function Interval({ estimate, low, high, unit = '点' }: { estimate: number; low: number; high: number; unit?: string }) {
  const known = Number.isFinite(low) && Number.isFinite(high);
  return (
    <span className="mono">
      {Number.isFinite(estimate) ? estimate.toFixed(2) : '--'}
      {unit}
      <span className="muted">
        {' '}
        ［95% {known ? `${low.toFixed(2)} 〜 ${high.toFixed(2)}` : '区間なし'}］
      </span>
    </span>
  );
}

export function StatsScreen() {
  const brews = useBrews();
  const recipes = useRecipes();
  const sessions = useSessions();
  const trials = useTriangleTrials();
  const labels = useExternalLabels();
  const settings = useSettings();

  const [factor, setFactor] = useState<StatsFactorKey>('grind');
  const [pairIndex, setPairIndex] = useState(0);
  const [target, setTarget] = useState(8);

  const scored = useMemo(() => scoredBrews(brews), [brews]);

  // M-1 採点のばらつき σ
  const reliability = useMemo(() => estimateSigma(duplicatePairsFromBrews(brews), { scaleMax: 5 }), [brews]);

  // M-5 必要試行回数
  const power = useMemo(
    () => requiredSampleSize(reliability.sigma, settings.detectableEffect, { currentN: scored.length }),
    [reliability.sigma, settings.detectableEffect, scored.length],
  );

  // M-2 まぐれ判定
  const triangle = useMemo(() => {
    const summary = triangleSummary(trials);
    return summary.trials === 0 ? null : evaluateTriangleTests(summary.trials, summary.correct);
  }, [trials]);

  // M-6 識別閾値
  const threshold = useMemo(() => estimateThresholdFromOutcomes(triangleOutcomes(trials)), [trials]);

  // M-4 効果量
  const observations = useMemo(() => observationsFor(brews, recipes, factor), [brews, recipes, factor]);
  const levelPairs = useMemo(() => comparableLevelPairs(observations), [observations]);
  const pair = levelPairs[Math.min(pairIndex, Math.max(levelPairs.length - 1, 0))];
  const effect = useMemo(
    () =>
      pair
        ? estimateEffect(observations, pair.from, pair.to, { mde: settings.detectableEffect, seed: SEED })
        : null,
    [observations, pair, settings.detectableEffect],
  );

  // M-3 潜在スコア
  const bt = useMemo(() => fitBradleyTerry(comparisonsFromData(sessions, brews), { seed: SEED }), [sessions, brews]);
  const recipeName = (id: string) => recipes.find((r) => r.id === id)?.name ?? '不明なレシピ';

  // M-7 2回の組み合わせ
  const { projections, nByRecipe } = useMemo(() => projectionsFromBrews(brews, recipes), [brews, recipes]);
  const strategies = useMemo(
    () => (projections.length === 0 ? [] : evaluateStrategies(projections, target)),
    [projections, target],
  );

  // M-8 外部スコアへの校正
  const calibration = useMemo(() => {
    const theta = new Map(bt.scores.map((s) => [s.itemId, s.theta]));
    const self = new Map(projections.map((p) => [p.recipeId, p.expectedScore]));
    return calibrate(calibrationPointsFrom(labels, theta, self));
  }, [bt.scores, projections, labels]);

  return (
    <>
      <Card
        title="採点のばらつき σ"
        hint="同じ日に同じレシピを2杯以上淹れて採点した記録から、自分の採点がどれだけ揺れるかを測ります。ここが大きいと他の数字も当てになりません。"
      >
        <div className="row between">
          <strong className="mono">σ = {reliability.sigma.toFixed(2)} 点</strong>
          <Pill tone={RELIABILITY_TONE[reliability.interpretation]}>
            {RELIABILITY_LABEL[reliability.interpretation]}
          </Pill>
        </div>
        <p className="hint">
          重複ペア {reliability.nPairs} 組（生の推定 {reliability.nPairs === 0 ? '--' : reliability.sigmaRaw.toFixed(2)}
          {reliability.shrinkageApplied ? '、少数データのため事前分布へ縮小済み' : ''}）
          {reliability.nPairs === 0
            ? ' ／ 重複ペアがまだ無いので、既定値をそのまま出しています。'
            : ''}
        </p>
        <h3>この σ で 0.5 点差を見分けるのに必要な回数</h3>
        <p className="hint">
          1水準あたり <strong className="mono">{power.requiredN}</strong> 回（両水準で {power.totalRequired} 回）。
          いまの記録 {power.currentN} 回、あと <strong className="mono">{power.additionalNeeded}</strong> 回。
          前提: σ={power.assumptions.sigma.toFixed(2)}／検出したい差={power.assumptions.mde}点／有意水準=
          {power.assumptions.alpha}／検出力={power.assumptions.power}
        </p>
      </Card>

      <Card
        title="まぐれ判定（三点識別）"
        hint="3杯中1杯の仲間はずれを当てる課題の成績です。当て推量なら的中率は1/3なので、それを超えていると言い切れるかを検定します。中断した試行も試行数に数えます。"
      >
        {triangle === null ? (
          <Banner>三点識別の記録がまだありません。</Banner>
        ) : (
          <>
            <div className="row between">
              <strong className="mono">
                {triangle.correct}/{triangle.trials} 正解
              </strong>
              <Pill tone={triangle.verdict === 'discriminable' ? 'ok' : 'warn'}>
                {triangle.verdict === 'discriminable' ? '識別できている' : '判定不能'}
              </Pill>
            </div>
            <p className="hint">
              まぐれの確率 p = {triangle.pValue.toFixed(4)}（{triangle.nSigma.toFixed(2)}σ 相当／当て推量 ={' '}
              {(triangle.chanceLevel * 100).toFixed(0)}%）
              {triangle.verdict === 'inconclusive' && triangle.trialsNeededForSignificance
                ? ` いまの的中率のままなら、あと ${triangle.trialsNeededForSignificance - triangle.trials} 回で有意になります。`
                : ''}
            </p>
          </>
        )}
        <h3>識別できる差の大きさ</h3>
        <p className="hint">
          {threshold.threshold === null
            ? `反転 ${threshold.reversalCount} 回では閾値を出せません（試行 ${threshold.trialsUsed} 回）。`
            : `閾値 ${threshold.threshold.toFixed(2)} 段（反転 ${threshold.reversalCount} 回、試行 ${threshold.trialsUsed} 回${threshold.converged ? '' : '、まだ収束していません'}）`}
        </p>
      </Card>

      <Card
        title="淹れ方を変えた効果"
        hint="同じ日に両方の淹れ方を試した記録だけを使い、日ごとの差を集めて推定します。区間がゼロを跨ぐときは「効果あり」とは言いません。"
      >
        <div className="stats-chips">
          {STATS_FACTORS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={f.key === factor ? 'stats-chip active' : 'stats-chip'}
              onClick={() => {
                setFactor(f.key);
                setPairIndex(0);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        {levelPairs.length === 0 || effect === null ? (
          <Banner>
            同じ日に2種類の水準を試した記録がまだありません（同日に条件を変えて2回淹れると比較できます）。
          </Banner>
        ) : (
          <>
            <div className="stats-chips">
              {levelPairs.slice(0, 4).map((p, i) => (
                <button
                  key={`${p.from}-${p.to}`}
                  type="button"
                  className={i === Math.min(pairIndex, levelPairs.length - 1) ? 'stats-chip active' : 'stats-chip'}
                  onClick={() => setPairIndex(i)}
                >
                  {p.from}→{p.to}
                </button>
              ))}
            </div>
            <div className="row between">
              <strong>
                {effect.fromLevel} → {effect.toLevel}
              </strong>
              <Pill tone={EFFECT_TONE[effect.verdict]}>{EFFECT_LABEL[effect.verdict]}</Pill>
            </div>
            <p className="hint">
              <Interval estimate={effect.estimate} low={effect.ciLow} high={effect.ciHigh} />
              <br />
              セッション {effect.nSessions} 日／記録 {effect.nObservations} 件
              {effect.lowConfidence ? '／セッションが少ないため区間は狭く出がちです' : ''}
              {effect.additionalTrialsNeeded ? `／判定にはあと約 ${effect.additionalTrialsNeeded} 回` : ''}
            </p>
          </>
        )}
      </Card>

      <Card
        title="レシピの相対的な強さ θ"
        hint="どちらが良かったかの比較だけから、レシピの相対順位を復元します（絶対点は使いません）。比較の繋がりが切れている場合は別グループとして扱います。"
      >
        {bt.scores.length === 0 ? (
          <Banner>比較できる記録がまだありません（同じ日に別のレシピを淹れると比較になります）。</Banner>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>レシピ</th>
                  <th>θ ［95%区間］</th>
                  <th>比較数</th>
                </tr>
              </thead>
              <tbody>
                {[...bt.scores]
                  .sort((a, b) => b.theta - a.theta)
                  .map((s) => (
                    <tr key={s.itemId}>
                      <td>{recipeName(s.itemId)}</td>
                      <td>
                        <Interval estimate={s.theta} low={s.ciLow} high={s.ciHigh} unit="" />
                      </td>
                      <td className="mono">{s.nComparisons}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="hint">
              比較グループ {bt.components} 個／推移律の破れ {(bt.transitivityViolationRate * 100).toFixed(0)}%
              {bt.converged ? '' : '／反復が収束していません'}
              {bt.components > 1 ? '／別グループどうしの θ は直接比べられません。' : ''}
              {bt.transitivityViolationRate > 0.3
                ? ' 破れが大きいので、順位そのものを疑ってください。'
                : ''}
            </p>
          </>
        )}
      </Card>

      <Card
        title="2回の組み合わせ"
        hint="本番は2回淹れて合計点で競います。期待値が高い組み合わせより、目標を超える確率が高い組み合わせを選びます。"
      >
        {strategies.length === 0 ? (
          <Banner>味評価済みの記録がまだありません。</Banner>
        ) : (
          <>
            <label className="field">
              <span>目標の合計点（2回分・自己採点10点満点）</span>
              <input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={0}
                max={10}
                value={target}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) setTarget(value);
                }}
              />
            </label>
            <table>
              <thead>
                <tr>
                  <th>組み合わせ</th>
                  <th>合計の期待値</th>
                  <th>目標超え</th>
                </tr>
              </thead>
              <tbody>
                {strategies.slice(0, 6).map((option) => (
                  <tr key={option.label}>
                    <td>{option.label}</td>
                    <td className="mono">
                      {option.expectedTotal.toFixed(2)} ± {option.sdTotal.toFixed(2)}
                    </td>
                    <td className="mono">{(option.probExceedTarget * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              各レシピの記録数:{' '}
              {projections.map((p) => `${p.label} ${nByRecipe.get(p.recipeId) ?? 0}回`).join('／')}
              。記録が2回未満のレシピはばらつきを0と仮定しているので、確率を過信しないでください。
            </p>
          </>
        )}
      </Card>

      <Card
        title="外部採点との照合"
        hint="第三者の採点が3件以上あると、自分の θ を外部スコアに換算できます。予測は必ず幅つきで出します。"
      >
        {!calibration.calibrated ? (
          <Banner>
            外部採点が {calibration.n} 件です（3件以上、かつ θ にばらつきがあると換算できます）。
          </Banner>
        ) : (
          <>
            <p className="hint">
              外部スコア ≈ {calibration.slope.toFixed(2)} × θ + {calibration.intercept.toFixed(2)}（R² =
              {calibration.r2.toFixed(2)}、n = {calibration.n}）
              {calibration.selfBias === undefined
                ? ''
                : `／自己採点の偏り ${calibration.selfBias > 0 ? '+' : ''}${calibration.selfBias.toFixed(2)} 点`}
            </p>
            <table>
              <thead>
                <tr>
                  <th>レシピ</th>
                  <th>外部スコア換算 ［予測区間］</th>
                </tr>
              </thead>
              <tbody>
                {[...bt.scores]
                  .sort((a, b) => b.theta - a.theta)
                  .map((s) => {
                    const p = calibration.predict(s.theta);
                    return (
                      <tr key={s.itemId}>
                        <td>{recipeName(s.itemId)}</td>
                        <td>
                          <Interval estimate={p.estimate} low={p.piLow} high={p.piHigh} unit="" />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <p className="hint">
        すべての推定は固定シード（{SEED}）で計算しているので、記録が同じなら数字も同じになります。
      </p>
    </>
  );
}
