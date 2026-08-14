import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Card, Field, Segmented } from '../ui/components';
import { useBeans, useCompetition, useRecipes, useSessions, useTriangleTrials } from '../ui/data';
import { FACTORS } from '../domain/defaults';
import { applyFactor, factorValue } from '../lib/factors';
import { cupsAffordable, generatePlan } from '../lib/plan';
import { saveRecipe, saveSession } from '../db/repo';
import { minimumUsefulDelta, summarizeTriangleTrials } from '../lib/triangle';
import { uid } from '../lib/random';
import type { FactorKey, PlanLevel, Recipe, Session } from '../domain/types';

export function SessionPlanScreen() {
  const navigate = useNavigate();
  const recipes = useRecipes();
  const beans = useBeans();
  const competition = useCompetition();
  const sessions = useSessions();
  const trials = useTriangleTrials();

  const [factor, setFactor] = useState<FactorKey>('grind');
  const [baseRecipeId, setBaseRecipeId] = useState<string>('');
  const [variantValue, setVariantValue] = useState<string>('');
  const [variantLabel, setVariantLabel] = useState<string>('1段細く');
  const [replicates, setReplicates] = useState(2);
  const [goal, setGoal] = useState('');
  const [error, setError] = useState<string | undefined>();

  const baseRecipe: Recipe | undefined = recipes.find((r) => r.id === baseRecipeId) ?? recipes[0];
  const bean = beans.find((b) => b.id === baseRecipe?.beanId) ?? beans[0];
  const maxCups = cupsAffordable(bean?.remainingG ?? 0, baseRecipe?.doseG ?? 20);
  const active = sessions.find((s) => s.status !== 'revealed');

  const discriminationHint = useMemo(() => {
    const summaries = summarizeTriangleTrials(trials);
    const delta = minimumUsefulDelta(summaries, factor);
    return delta;
  }, [trials, factor]);

  const planned = replicates * 2;

  async function generate() {
    setError(undefined);
    if (!baseRecipe || !bean) {
      setError('レシピと豆を設定画面で登録してください');
      return;
    }
    if (!variantValue.trim()) {
      setError('比較する水準の値を入力してください');
      return;
    }

    const variant = applyFactor(
      { ...baseRecipe, id: uid('recipe'), name: `${baseRecipe.name} / ${variantLabel}`, createdAt: new Date().toISOString() },
      factor,
      variantValue.trim(),
    );
    await saveRecipe(variant);

    const levels: PlanLevel[] = [
      { label: '現状', recipeId: baseRecipe.id },
      { label: variantLabel || '変更後', recipeId: variant.id },
    ];

    const { plan, cups } = generatePlan({ factor, levels, replicates, maxCups: maxCups || undefined });
    const session: Session = {
      id: uid('session'),
      competitionId: competition.id,
      beanId: bean.id,
      date: new Date().toISOString().slice(0, 10),
      goal: goal || `${FACTORS.find((f) => f.key === factor)?.label} の検証`,
      plan,
      cups,
      comparisons: [],
      status: 'planned',
    };
    await saveSession(session);
    navigate(`/session/${session.id}/brew`);
  }

  return (
    <>
      {active ? (
        <Banner tone="danger">
          進行中のセッションがあります（{active.date}）。先にそちらを終わらせてください。新しく作ると比較の情報が分散します。
        </Banner>
      ) : null}

      <Card
        title="セッション計画の自動生成"
        hint="1因子のみを変え、他は固定します（OFAT）。隠し重複はアプリが勝手に混ぜます。どの杯が重複かは開示しません。"
      >
        <div className="stack">
          <Field label="検証する因子">
            <select
              value={factor}
              onChange={(event) => {
                setFactor(event.target.value as FactorKey);
                setVariantValue('');
              }}
            >
              {FACTORS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="基準レシピ（固定条件）">
            <select value={baseRecipe?.id ?? ''} onChange={(event) => setBaseRecipeId(event.target.value)}>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>

          {baseRecipe ? (
            <p className="hint" style={{ margin: 0 }}>
              固定条件: 豆量 {baseRecipe.doseG}g ／ 湯温 {baseRecipe.waterTempC}℃ ／ 総湯量 {baseRecipe.totalWaterG}g ／{' '}
              {baseRecipe.pours.length}投
              <br />
              現在の{FACTORS.find((f) => f.key === factor)?.label}: <strong>{factorValue(baseRecipe, factor)}</strong>
            </p>
          ) : null}

          <div className="row">
            <Field label="比較水準のラベル">
              <input value={variantLabel} onChange={(event) => setVariantLabel(event.target.value)} />
            </Field>
            <Field label="比較水準の値">
              <input
                value={variantValue}
                onChange={(event) => setVariantValue(event.target.value)}
                placeholder={baseRecipe ? factorValue(baseRecipe, factor) : ''}
              />
            </Field>
          </div>

          <Field label="各水準のレプリケート数">
            <Segmented
              options={[1, 2, 3].map((n) => ({ value: n, label: `${n}回` }))}
              value={replicates}
              onChange={setReplicates}
            />
          </Field>

          <Field label="このセッションの狙い（任意）">
            <input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="例: 挽き目を確定させる" />
          </Field>

          {discriminationHint ? (
            <Banner>
              三点識別の結果、あなたがこの因子で識別できる最小の差は約 <strong>{discriminationHint}</strong> です。
              これより小さい差の検証は情報を生みません。
            </Banner>
          ) : null}

          <Banner tone={maxCups >= planned ? 'ok' : 'danger'}>
            残り豆 {bean?.remainingG ?? 0}g で淹れられるのは約 {maxCups} 杯。この計画は本体 {planned} 杯＋隠し重複 0〜2 杯です。
          </Banner>

          {error ? <Banner tone="danger">{error}</Banner> : null}

          <button className="primary" type="button" onClick={generate} disabled={!baseRecipe}>
            この内容で計画を生成する
          </button>
        </div>
      </Card>
    </>
  );
}
