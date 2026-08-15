import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Card, formatSeconds } from '../ui/components';
import { RecipeWizard } from './RecipeWizard';
import { useLoadedRecipes } from '../ui/data';
import { toSteps } from '../lib/pours';

/** レシピ1件の閲覧と、そのレシピでの演習（タイマー）への導線。 */
export function RecipeViewScreen() {
  const { recipeId } = useParams();
  const recipes = useLoadedRecipes();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  if (recipes === undefined) return null;
  const recipe = recipes.find((item) => item.id === recipeId);
  if (!recipe) return <Navigate to="/" replace />;

  const steps = toSteps(recipe.pours);

  return (
    <>
      <div className="recipe-view-bar">
        <button className="recipe-view-back" type="button" aria-label="レシピ一覧へ戻る" onClick={() => navigate('/')}>
          ←
        </button>
        <strong className="recipe-view-name">{recipe.name}</strong>
        <button type="button" onClick={() => setEditing(true)}>
          編集
        </button>
      </div>

      <Card>
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
          <dt>抽出終了</dt>
          <dd className="mono">{recipe.finishSec === undefined ? '—' : formatSeconds(recipe.finishSec)}</dd>
        </dl>
      </Card>

      <Card title="注湯">
        {recipe.pours.length === 0 ? (
          <p className="muted">—</p>
        ) : (
          <ol className="pour-timeline-list">
            {recipe.pours.map((pour, index) => (
              <li className="pour-node" key={pour.index}>
                <div className="pour-node-axis">
                  <span className="pour-node-badge">{pour.index}</span>
                  <span className="pour-node-time mono">{formatSeconds(pour.startSec)}</span>
                </div>
                <div className="pour-node-card">
                  <dl className="pour-view-grid">
                    <div>
                      <dt>累計湯量</dt>
                      <dd className="mono">{pour.targetG}g</dd>
                    </div>
                    <div>
                      <dt>この投</dt>
                      <dd className="mono">{steps[index]?.waterG ?? 0}g</dd>
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
      </Card>

      <div className="recipe-view-actions">
        <button
          className="primary"
          type="button"
          onClick={() => navigate(`/timer?recipe=${encodeURIComponent(recipe.id)}`)}
        >
          このレシピで計測
        </button>
      </div>

      {editing ? <RecipeWizard editing={recipe} onClose={() => setEditing(false)} /> : null}
    </>
  );
}
