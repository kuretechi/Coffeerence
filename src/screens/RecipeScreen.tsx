import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/components';
import { RecipeWizard } from './RecipeWizard';
import { useRecipes } from '../ui/data';
import { deleteRecipe } from '../db/repo';

export function RecipeScreen() {
  const recipes = useRecipes();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  function remove(id: string, name: string) {
    if (!window.confirm(`「${name}」を削除しますか？`)) return;
    void deleteRecipe(id);
  }

  return (
    <>
      <Card title="レシピ">
        {recipes.length === 0 ? (
          <div className="recipe-empty">
            <p className="recipe-empty-text">レシピなし</p>
            <p className="recipe-empty-hint muted">右下の ＋ から追加</p>
          </div>
        ) : (
          <ul className="recipe-list">
            {recipes.map((recipe) => (
              <li key={recipe.id} className="recipe-row">
                <button
                  className="recipe-row-main"
                  type="button"
                  onClick={() => navigate(`/recipes/${recipe.id}`)}
                >
                  <strong>{recipe.name}</strong>
                  <span className="mono muted">
                    {recipe.doseG}g / {recipe.totalWaterG}g / {recipe.waterTempC}℃
                  </span>
                </button>
                <button
                  className="recipe-row-delete"
                  type="button"
                  aria-label={`${recipe.name}を削除`}
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(recipe.id, recipe.name);
                  }}
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <button className="fab recipe-fab" type="button" aria-label="レシピを追加" onClick={() => setCreating(true)}>
        ＋
      </button>

      {creating ? <RecipeWizard onClose={() => setCreating(false)} /> : null}
    </>
  );
}
