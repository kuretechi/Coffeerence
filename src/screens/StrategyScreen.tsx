import { useState } from 'react';
import { Banner, Card, Field, NumberField, Pill, formatSigned } from '../ui/components';
import {
  revealedSessions,
  useCompetition,
  useExternalLabels,
  useRecipes,
  useSessions,
  useSettings,
} from '../ui/data';
import { estimateBradleyTerry, toOutcomes } from '../lib/bradleyTerry';
import { MIN_EXTERNAL_LABELS, calibrate } from '../lib/calibration';
import { STANCE_LABEL, recipeProjections, strategyOptions, strategyStance } from '../lib/strategy';
import { saveExternalLabel, saveSettings } from '../db/repo';
import { uid } from '../lib/random';
import { CRITERION_ORDER } from '../domain/defaults';
import type { CriterionKey, ExternalLabel } from '../domain/types';

export function StrategyScreen() {
  const sessions = revealedSessions(useSessions());
  const competition = useCompetition();
  const settings = useSettings();
  const recipes = useRecipes();
  const labels = useExternalLabels();
  const [labelDraft, setLabelDraft] = useState<{
    recipeId?: string;
    source: ExternalLabel['source'];
    raterName: string;
    scores: Partial<Record<CriterionKey, number>>;
  }>({ source: 'competition', raterName: '', scores: {} });

  const thetaByRecipe: Partial<Record<CriterionKey, Map<string, number>>> = {};
  for (const criterion of CRITERION_ORDER) {
    const comparisons = sessions.flatMap((s) => s.comparisons.filter((c) => c.criterion === criterion));
    const { theta } = estimateBradleyTerry(toOutcomes(comparisons));
    const byRecipe = new Map<string, number>();
    for (const session of sessions) {
      for (const cup of session.cups) {
        const value = theta.get(cup.id);
        if (value === undefined) continue;
        byRecipe.set(cup.recipeId, value);
      }
    }
    thetaByRecipe[criterion] = byRecipe;
  }

  const calibration = calibrate(labels, thetaByRecipe, sessions, competition, settings.weights);
  const calibratedRecipeIds = new Set(labels.map((l) => l.recipeId));
  const projections = recipeProjections(sessions, competition, settings.weights, calibratedRecipeIds);
  const recipeLabel = (id: string) => recipes.find((r) => r.id === id)?.name ?? id;
  const options = strategyOptions(projections, settings.targetLine, recipeLabel);
  const stance = strategyStance(options[0]?.expectedTotal ?? 0, settings.targetLine);
  const labelComplete =
    labelDraft.recipeId !== undefined && CRITERION_ORDER.every((c) => labelDraft.scores[c] !== undefined);

  async function addLabel() {
    if (!labelDraft.recipeId || !labelComplete) return;
    const scores = Object.fromEntries(
      CRITERION_ORDER.map((criterion) => [criterion, labelDraft.scores[criterion] ?? 0]),
    ) as Record<CriterionKey, number>;
    const label: ExternalLabel = {
      id: uid('label'),
      recipeId: labelDraft.recipeId,
      source: labelDraft.source,
      raterName: labelDraft.raterName || undefined,
      date: new Date().toISOString(),
      scores,
    };
    await saveExternalLabel(label);
    setLabelDraft({ source: 'competition', raterName: '', scores: {} });
  }

  return (
    <>
      <Card title="目標ライン" hint="この点数を超える確率で戦略を選びます。">
        <NumberField
          label="2回合計の目標点"
          value={settings.targetLine}
          step={0.5}
          onChange={(value) => void saveSettings({ ...settings, targetLine: value ?? 0 })}
        />
      </Card>

      <Card title="2回試技の賭け方" hint={STANCE_LABEL[stance]}>
        {options.length === 0 ? (
          <Banner>候補レシピの採点データが足りません。</Banner>
        ) : (
          <table>
            <thead>
              <tr>
                <th>組み合わせ</th>
                <th>期待合計</th>
                <th>SD</th>
                <th>目標超過確率</th>
              </tr>
            </thead>
            <tbody>
              {options.slice(0, 8).map((option) => (
                <tr key={option.label}>
                  <td>
                    {option.label}
                    {option.recommended ? <Pill tone="ok">推奨</Pill> : null}
                  </td>
                  <td className="mono">{option.expectedTotal.toFixed(1)}</td>
                  <td className="mono">{option.sdTotal.toFixed(2)}</td>
                  <td className="mono">{(option.probExceedTarget * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="外部ラベルによる校正"
        hint={`第三者の採点を ${MIN_EXTERNAL_LABELS} 件以上入れると、自己採点を大会スコアの尺度へ写像します。`}
      >
        {calibration.calibrated ? (
          <Banner tone="ok">校正済み。以降の予測値は外部尺度に変換されています。</Banner>
        ) : (
          <Banner>校正未実施（外部ラベル {labels.length} 件）。予測値は自己採点の尺度のままです。</Banner>
        )}
        <table>
          <thead>
            <tr>
              <th>項目</th>
              <th>自己バイアス</th>
            </tr>
          </thead>
          <tbody>
            {CRITERION_ORDER.map((criterion) => {
              const bias = calibration.bias[criterion];
              return (
                <tr key={criterion}>
                  <td>{competition.criteria.find((c) => c.key === criterion)?.label}</td>
                  <td className="mono">{bias ? `${formatSigned(bias.value, 2)} (n=${bias.n})` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h3>外部ラベルを追加</h3>
        <Field label="レシピ">
          <select
            value={labelDraft.recipeId ?? ''}
            onChange={(event) => setLabelDraft({ ...labelDraft, recipeId: event.target.value || undefined })}
          >
            <option value="">選択してください</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="採点者">
          <select
            value={labelDraft.source}
            onChange={(event) => setLabelDraft({ ...labelDraft, source: event.target.value as ExternalLabel['source'] })}
          >
            <option value="competition">大会ジャッジ</option>
            <option value="coach">コーチ</option>
            <option value="peer">仲間</option>
          </select>
        </Field>
        <Field label="採点者名（任意）">
          <input
            type="text"
            value={labelDraft.raterName}
            onChange={(event) => setLabelDraft({ ...labelDraft, raterName: event.target.value })}
          />
        </Field>
        {CRITERION_ORDER.map((criterion) => (
          <NumberField
            key={criterion}
            label={competition.criteria.find((c) => c.key === criterion)?.label ?? criterion}
            value={labelDraft.scores[criterion]}
            step={0.25}
            min={0}
            onChange={(value) => setLabelDraft({ ...labelDraft, scores: { ...labelDraft.scores, [criterion]: value } })}
          />
        ))}
        <button className="primary" type="button" onClick={addLabel} disabled={!labelComplete}>
          外部ラベルを保存
        </button>
      </Card>
    </>
  );
}
