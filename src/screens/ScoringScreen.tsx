import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Banner, Card, Field, Segmented } from '../ui/components';
import { useDescriptorSet, useSession } from '../ui/data';
import { cupsInServingOrder } from '../lib/plan';
import { saveScore } from '../db/repo';
import { shuffle } from '../lib/random';
import {
  CONFIDENCE_ANCHORS,
  DEFECTS,
  DEFECT_LEVEL_LABELS,
  FINISH_LENGTH_ANCHORS,
  FINISH_QUALITY_ANCHORS,
  TEXTURE_ANCHORS,
} from '../domain/defaults';
import type { DefectKey, FlavorPick, Likert5, Score } from '../domain/types';

interface Draft {
  defects: Record<DefectKey, 0 | 1 | 2>;
  texture: Likert5;
  finishLength: Likert5;
  finishQuality: Likert5;
  flavors: Record<string, 1 | 2 | 3>;
  confidence: 1 | 2 | 3;
}

const emptyDraft = (): Draft => ({
  defects: Object.fromEntries(DEFECTS.map((d) => [d.key, 0])) as Record<DefectKey, 0 | 1 | 2>,
  texture: 3,
  finishLength: 3,
  finishQuality: 3,
  flavors: {},
  confidence: 2,
});

export function ScoringScreen() {
  const { sessionId } = useParams();
  const session = useSession(sessionId);
  const descriptorSet = useDescriptorSet(session?.beanId);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const descriptors = useMemo(() => {
    if (!descriptorSet) return [] as { id: string; isDummy: boolean }[];
    const items = [
      ...descriptorSet.real.map((id) => ({ id, isDummy: false })),
      ...descriptorSet.dummies.map((id) => ({ id, isDummy: true })),
    ];
    return shuffle(items);
  }, [descriptorSet]);

  if (!session) return <Card title="セッションが見つかりません">ホームから選び直してください。</Card>;

  const ordered = cupsInServingOrder(session.cups, session.plan.servingOrder);
  const pending = ordered.filter((c) => !c.score);
  const cup = pending[0];

  if (!cup) {
    return (
      <Card title="採点完了" hint="続いて対比較を行います。バランス・総合は対比較でのみ取得します。">
        <Link className="button primary" to={`/session/${session.id}/compare`}>
          対比較へ進む
        </Link>
      </Card>
    );
  }

  async function submit() {
    if (!cup || !session) return;
    const flavors: FlavorPick[] = Object.entries(draft.flavors).map(([descriptorId, intensity]) => ({
      descriptorId,
      intensity,
      isDummy: descriptorSet?.dummies.includes(descriptorId) ?? false,
    }));
    const score: Score = {
      cupId: cup.id,
      ratedAt: new Date().toISOString(),
      defects: DEFECTS.map((d) => ({ key: d.key, level: draft.defects[d.key] })),
      texture: draft.texture,
      finishLength: draft.finishLength,
      finishQuality: draft.finishQuality,
      flavors,
      confidence: draft.confidence,
    };
    await saveScore(session.id, cup.id, score);
    setDraft(emptyDraft());
    window.scrollTo({ top: 0 });
  }

  return (
    <>
      <Card title={`ブラインド採点（残り ${pending.length} 杯）`}>
        <div className="row between">
          <span className="code">{cup.code}</span>
          <span className="muted">レシピ情報は表示しません</span>
        </div>
      </Card>

      <Card title="層1 ネガティブ・チェック" hint="欠点の強さだけを答えます。クリーンカップはここから合成します。">
        <div className="stack">
          {DEFECTS.map((defect) => (
            <Field key={defect.key} label={defect.label}>
              <Segmented
                options={DEFECT_LEVEL_LABELS.map((label, level) => ({ value: level as 0 | 1 | 2, label }))}
                value={draft.defects[defect.key]}
                onChange={(level) => setDraft({ ...draft, defects: { ...draft.defects, [defect.key]: level } })}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card title="層2 強度スケール" hint="言語アンカーに一番近いものを選びます。">
        <div className="stack">
          <Field label="質感">
            <Segmented
              options={TEXTURE_ANCHORS.map((label, i) => ({ value: (i + 1) as Likert5, label: `${i + 1} ${label}` }))}
              value={draft.texture}
              onChange={(texture) => setDraft({ ...draft, texture })}
            />
          </Field>
          <Field label="余韻の長さ">
            <Segmented
              options={FINISH_LENGTH_ANCHORS.map((label, i) => ({ value: (i + 1) as Likert5, label: `${i + 1} ${label}` }))}
              value={draft.finishLength}
              onChange={(finishLength) => setDraft({ ...draft, finishLength })}
            />
          </Field>
          <Field label="余韻の質">
            <Segmented
              options={FINISH_QUALITY_ANCHORS.map((label, i) => ({ value: (i + 1) as Likert5, label: `${i + 1} ${label}` }))}
              value={draft.finishQuality}
              onChange={(finishQuality) => setDraft({ ...draft, finishQuality })}
            />
          </Field>
        </div>
      </Card>

      <Card title="層3 フレーバー（再認課題）" hint="感じたものを選び、強度を付けます。自由入力はしません。">
        <div className="stack">
          {descriptors.map((descriptor) => {
            const intensity = draft.flavors[descriptor.id];
            return (
              <div key={descriptor.id} className="row between">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={intensity !== undefined}
                    onChange={(event) => {
                      const flavors = { ...draft.flavors };
                      if (event.target.checked) flavors[descriptor.id] = 2;
                      else delete flavors[descriptor.id];
                      setDraft({ ...draft, flavors });
                    }}
                  />
                  <span>{descriptor.id}</span>
                </label>
                {intensity !== undefined ? (
                  <div style={{ flex: '1 1 160px' }}>
                    <Segmented
                      options={[1, 2, 3].map((v) => ({ value: v as 1 | 2 | 3, label: `強度${v}` }))}
                      value={intensity}
                      onChange={(value) => setDraft({ ...draft, flavors: { ...draft.flavors, [descriptor.id]: value } })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
          {descriptors.length === 0 ? <Banner>この豆の記述子セットが未設定です。設定画面で登録してください。</Banner> : null}
        </div>
      </Card>

      <Card title="層4 自信度">
        <Segmented
          options={CONFIDENCE_ANCHORS.map((label, i) => ({ value: (i + 1) as 1 | 2 | 3, label }))}
          value={draft.confidence}
          onChange={(confidence) => setDraft({ ...draft, confidence })}
        />
      </Card>

      <Card>
        <Banner>バランス・総合は単独では取得しません（最も主観的なため、対比較でのみ扱います）。</Banner>
        <button className="primary" type="button" onClick={submit}>
          この杯の採点を確定して次へ
        </button>
      </Card>
    </>
  );
}
