import { db } from './db';
import type {
  AuditEntry,
  Bean,
  BrewRecord,
  Competition,
  Cup,
  ExternalLabel,
  FlavorDescriptorSet,
  Gear,
  ModerationVerdict,
  Post,
  Recipe,
  RehearsalRecord,
  Score,
  Session,
  Settings,
  TriangleTrial,
} from '../domain/types';
import { DEFAULT_COMPETITION, DEFAULT_SETTINGS, TARGET_BEVERAGE_G } from '../domain/defaults';
import { uid } from '../lib/random';
import { moderate } from '../lib/moderation';

export async function seedIfEmpty(): Promise<void> {
  const existing = await db.settings.get('settings');
  if (existing) return;

  const bean: Bean = {
    id: 'bean_default',
    name: '練習用の豆',
    roaster: '',
    remainingG: 500,
    note: '設定画面で名前と残量を編集できます',
  };
  const descriptors: FlavorDescriptorSet = {
    id: 'descriptors_default',
    beanId: bean.id,
    real: ['赤い果実', '柑橘', '花', '紅茶', 'カカオ', 'ナッツ', 'ハーブ', '蜂蜜'],
    dummies: ['ピクルス', '燻製肉'],
  };
  const recipe: Recipe = {
    id: 'recipe_base',
    name: '基準レシピ',
    beanId: bean.id,
    doseG: 20,
    grindSetting: '現状',
    waterTempC: 92,
    waterId: '軟水',
    totalWaterG: 320,
    targetBeverageG: TARGET_BEVERAGE_G,
    brewer: 'V60 02',
    filter: '純正ペーパー',
    pours: [
      { index: 1, targetG: 60, startSec: 0, note: '蒸らし' },
      { index: 2, targetG: 200, startSec: 45 },
      { index: 3, targetG: 320, startSec: 90 },
    ],
    createdAt: new Date().toISOString(),
  };

  await db.transaction(
    'rw',
    [db.competitions, db.beans, db.descriptorSets, db.recipes, db.settings],
    async () => {
      await db.competitions.put(DEFAULT_COMPETITION);
      await db.beans.put(bean);
      await db.descriptorSets.put(descriptors);
      await db.recipes.put(recipe);
      await db.settings.put(DEFAULT_SETTINGS);
    },
  );
}

export async function getSettings(): Promise<Settings> {
  // 後から追加した項目が欠けた古いレコードでも壊れないよう、既定値で埋める。
  const stored = await db.settings.get('settings');
  return stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await db.settings.put(settings);
}

export async function getActiveCompetition(): Promise<Competition> {
  const settings = await getSettings();
  return (await db.competitions.get(settings.activeCompetitionId)) ?? DEFAULT_COMPETITION;
}

export async function saveCompetition(competition: Competition): Promise<void> {
  await db.competitions.put(competition);
}

export const listBeans = () => db.beans.toArray();
export const listRecipes = () => db.recipes.toArray();
export const listSessions = () => db.sessions.orderBy('date').reverse().toArray();
export const listExternalLabels = () => db.externalLabels.toArray();
export const listTriangleTrials = () => db.triangleTrials.orderBy('date').toArray();
export const listRehearsals = () => db.rehearsals.orderBy('date').reverse().toArray();
export const listAudit = () => db.audit.orderBy('at').reverse().toArray();

export const saveBean = (bean: Bean) => db.beans.put(bean);
export const listGear = () => db.gear.toArray();
export const saveGear = (gear: Gear) => db.gear.put(gear);
export const saveRecipe = (recipe: Recipe) => db.recipes.put(recipe);
export const listBrews = () => db.brews.orderBy('date').reverse().toArray();
export const saveBrew = (brew: BrewRecord) => db.brews.put(brew);
export const saveSession = (session: Session) => db.sessions.put(session);
export const saveExternalLabel = (label: ExternalLabel) => db.externalLabels.put(label);
export const saveTriangleTrial = (trial: TriangleTrial) => db.triangleTrials.put(trial);
export const saveRehearsal = (record: RehearsalRecord) => db.rehearsals.put(record);
export const getSession = (id: string) => db.sessions.get(id);
export const getDescriptorSetForBean = (beanId: string) =>
  db.descriptorSets.where('beanId').equals(beanId).first();
export const saveDescriptorSet = (set: FlavorDescriptorSet) => db.descriptorSets.put(set);

export async function recordAudit(entry: Omit<AuditEntry, 'id' | 'at'>): Promise<void> {
  await db.audit.put({ id: uid('audit'), at: new Date().toISOString(), ...entry });
}

export class RevealedSessionError extends Error {
  constructor() {
    super('リビール済みのセッションは編集できません（NF-07）');
    this.name = 'RevealedSessionError';
  }
}

/** F-04: リビール前は変更可能／リビール後は変更不可。 */
export async function saveScore(sessionId: string, cupId: string, score: Score): Promise<Session> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('セッションが見つかりません');
  if (session.status === 'revealed') throw new RevealedSessionError();

  const cups = session.cups.map((cup) => (cup.id === cupId ? { ...cup, score } : cup));
  const next: Session = { ...session, cups, status: allScored(cups) ? 'comparing' : 'scoring' };
  await db.sessions.put(next);
  return next;
}

export async function saveBrewLog(sessionId: string, cupId: string, brewLog: Cup['brewLog']): Promise<Session> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('セッションが見つかりません');
  if (session.status === 'revealed') throw new RevealedSessionError();
  const cups = session.cups.map((cup) => (cup.id === cupId ? { ...cup, brewLog } : cup));
  const next: Session = { ...session, cups, status: session.status === 'planned' ? 'brewing' : session.status };
  await db.sessions.put(next);
  return next;
}

export function allScored(cups: readonly Cup[]): boolean {
  return cups.length > 0 && cups.every((cup) => Boolean(cup.score));
}

/** F-04: 全カップの採点が完了するまでリビールを許可しない。 */
export async function revealSession(sessionId: string): Promise<Session> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('セッションが見つかりません');
  if (!allScored(session.cups)) throw new Error('全カップの採点が終わるまでリビールできません');
  const next: Session = { ...session, status: 'revealed', revealedAt: new Date().toISOString() };
  await db.sessions.put(next);
  await recordAudit({ kind: 'reveal', subject: sessionId, detail: `${session.cups.length}杯をリビール` });
  return next;
}

/** R-2: 削除は記録に残す。 */
export async function deleteSession(sessionId: string, reason: string): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session) return;
  await db.sessions.delete(sessionId);
  await recordAudit({
    kind: 'delete',
    subject: sessionId,
    detail: `${session.date} のセッション（${session.cups.length}杯）を削除: ${reason}`,
  });
}

/** R-2: 削除は記録に残す。 */
export async function deleteBrew(brewId: string): Promise<void> {
  const brew = await db.brews.get(brewId);
  if (!brew) return;
  await db.brews.delete(brewId);
  await recordAudit({ kind: 'delete', subject: brewId, detail: `${brew.date} の抽出記録を削除` });
}

/** R-2: 削除は記録に残す。 */
export async function deleteGear(gearId: string): Promise<void> {
  const gear = await db.gear.get(gearId);
  if (!gear) return;
  await db.gear.delete(gearId);
  await recordAudit({
    kind: 'delete',
    subject: gearId,
    detail: `${gear.kind === 'kettle' ? 'ケトル' : 'ミル'}「${gear.name}」を削除`,
  });
}

/** R-2: 削除は記録に残す。 */
export async function deleteRecipe(recipeId: string): Promise<void> {
  const recipe = await db.recipes.get(recipeId);
  if (!recipe) return;
  await db.recipes.delete(recipeId);
  await recordAudit({ kind: 'delete', subject: recipeId, detail: `レシピ「${recipe.name}」を削除` });
}

export async function consumeBeans(beanId: string, grams: number): Promise<void> {
  const bean = await db.beans.get(beanId);
  if (!bean) return;
  await db.beans.put({ ...bean, remainingG: Math.max(0, bean.remainingG - grams) });
}

// ─── 豆友（投稿と自動判定）───────────────
/**
 * 判定を通った投稿だけを保存する。不適切と判定された場合は保存せず、
 * 判定結果を監査ログに残して呼び出し側に返す。
 */
export async function submitPost(author: string, body: string): Promise<ModerationVerdict> {
  const verdict = await moderate(body);
  if (!verdict.allowed) {
    await recordAudit({
      kind: 'moderation',
      subject: 'post',
      detail: `投稿を拒否（${verdict.provider}: ${verdict.categories.join(', ') || '不適切'}）`,
    });
    return verdict;
  }
  const post: Post = {
    id: uid('post'),
    author: author.trim() === '' ? '豆挽けば名無し' : author.trim(),
    body,
    createdAt: new Date().toISOString(),
    moderation: verdict,
  };
  await db.posts.put(post);
  return verdict;
}

/**
 * 保存済みの投稿をまとめて再判定し、不適切なものを削除する。
 * 判定器を差し替えた（APIキーを設定した）あとの遡り適用に使う。
 */
export async function remoderatePosts(): Promise<number> {
  const posts = await db.posts.toArray();
  let removed = 0;
  for (const post of posts) {
    const verdict = await moderate(post.body);
    if (verdict.allowed) {
      await db.posts.put({ ...post, moderation: verdict });
      continue;
    }
    await db.posts.delete(post.id);
    removed += 1;
    await recordAudit({
      kind: 'moderation',
      subject: post.id,
      detail: `再判定で削除（${verdict.provider}: ${verdict.categories.join(', ') || '不適切'}）`,
    });
  }
  return removed;
}

/** R-2: 削除は記録に残す。 */
export async function deletePost(postId: string): Promise<void> {
  const post = await db.posts.get(postId);
  if (!post) return;
  await db.posts.delete(postId);
  await recordAudit({ kind: 'delete', subject: postId, detail: `${post.author} の投稿を削除` });
}
