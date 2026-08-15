import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Banner, formatSeconds } from '../ui/components';
import { RecipeWizard } from './RecipeScreen';
import { db } from '../db/db';
import { toSteps } from '../lib/pours';

/** レシピ1件の閲覧＋演習開始。行タップの遷移先。 */
export function RecipeViewScreen() {
  const { recipeId } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  // 読み込み中は undefined、見つからないときは null。
  const recipe = useLiveQuery(
    async () => (recipeId ? (await db.recipes.get(recipeId)) ?? null : null),
    [recipeId],
    undefined,
  );

  if (recipe === undefined) return null;
  if (recipe === null) return <Navigate to="/" replace />;

  const steps = toSteps(recipe.pours);

  return (
    <>
      <section className="card">
        <div className="card-head">
          <Link className="head-back" to="/" aria-label="レシピ一覧へ戻る">
            ←
          </Link>
          <h2 className="recipe-view-name">{recipe.name}</h2>
          <button className="head-edit" type="button" onClick={() => setEditing(true)}>
            編集
          </button>
        </div>

        <dl className="brew-detail">
          <dt>粉量 / 総湯量</dt>
          <dd className="mono">
            {recipe.doseG}g / {recipe.totalWaterG}g
          </dd>
          <dt>挽き目 / ドリッパー</dt>
          <dd>
            {recipe.grindSetting || '—'} / {recipe.brewer || '—'}
          </dd>
          <dt>初期湯温</dt>
          <dd className="mono">{recipe.waterTempC}℃</dd>
          <dt>落ち切り</dt>
          <dd className="mono">{recipe.finishSec === undefined ? '—' : formatSeconds(recipe.finishSec)}</dd>
        </dl>

        {recipe.pours.length === 0 ? (
          <Banner>注湯の内訳が未登録です。</Banner>
        ) : (
          <ol className="pour-timeline-list recipe-view-pours">
            {recipe.pours.map((pour, index) => (
              <li className="pour-node" key={pour.index}>
                <div className="pour-node-axis">
                  <span className="pour-node-badge">{pour.index}</span>
                  <span className="pour-node-time mono">{formatSeconds(pour.startSec)}</span>
                </div>
                <div className="pour-node-card">
                  <dl className="pour-view-grid">
                    <div>
                      <dt>この投</dt>
                      <dd className="mono">{steps[index]?.waterG ?? 0}g</dd>
                    </div>
                    <div>
                      <dt>累計</dt>
                      <dd className="mono">{pour.targetG}g</dd>
                    </div>
                    <div>
                      <dt>湯温</dt>
                      <dd className="mono">{pour.waterTempC ?? recipe.waterTempC}℃</dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ol>
        )}

        <button
          className="primary recipe-view-start"
          type="button"
          onClick={() => navigate(`/timer?recipe=${encodeURIComponent(recipe.id)}`)}
        >
          このレシピで計測
        </button>
      </section>

      {editing ? <RecipeWizard recipe={recipe} onClose={() => setEditing(false)} /> : null}
    </>
  );
}
