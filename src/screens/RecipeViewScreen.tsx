import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Card, formatSeconds } from '../ui/components';
import { useRecipe } from '../ui/data';
import { RecipeWizard } from './RecipeScreen';

/** レシピ1件の閲覧＋演習の開始。1投=カードを縦に積み、左の軸に累計時間を出す。 */
export function RecipeViewScreen() {
  const { recipeId } = useParams();
  const recipe = useRecipe(recipeId);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  if (recipe === undefined) return null;
  if (recipe === null) return <Navigate to="/" replace />;

  return (
    <>
      <Card title={recipe.name}>
        <div className="stack">
          <div className="recipe-view-bar">
            <button type="button" aria-label="レシピ一覧へ戻る" onClick={() => navigate('/')}>
              ← 一覧
            </button>
            <button type="button" onClick={() => setEditing(true)}>
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
            <dt>抽出終了</dt>
            <dd className="mono">{recipe.finishSec === undefined ? '—' : formatSeconds(recipe.finishSec)}</dd>
          </dl>

          <ol className="pour-timeline-list">
            {recipe.pours.map((pour, index) => {
              const previous = index === 0 ? 0 : recipe.pours[index - 1]?.targetG ?? 0;
              return (
                <li className={index === recipe.pours.length - 1 ? 'pour-node pour-node-last' : 'pour-node'} key={pour.index}>
                  <div className="pour-node-axis">
                    <span className="pour-node-badge">{pour.index}</span>
                    <span className="pour-node-time mono">{formatSeconds(pour.startSec)}</span>
                  </div>
                  <div className="pour-node-card">
                    <dl className="recipe-view-grid">
                      <div>
                        <dt>この投</dt>
                        <dd className="mono">{Math.round((pour.targetG - previous) * 10) / 10}g</dd>
                      </div>
                      <div>
                        <dt>累計まで</dt>
                        <dd className="mono">{pour.targetG}g</dd>
                      </div>
                      <div>
                        <dt>湯温</dt>
                        <dd className="mono">{pour.waterTempC ?? recipe.waterTempC}℃</dd>
                      </div>
                    </dl>
                  </div>
                </li>
              );
            })}
          </ol>

          <button
            className="primary recipe-view-start"
            type="button"
            onClick={() => navigate(`/timer?recipe=${encodeURIComponent(recipe.id)}`)}
          >
            このレシピで計測
          </button>
        </div>
      </Card>

      {editing ? <RecipeWizard recipe={recipe} onClose={() => setEditing(false)} /> : null}
    </>
  );
}
