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
  SharedRecipe,
  SoundSlot,
  TriangleTrial,
} from '../domain/types';
import { DEFAULT_COMPETITION, DEFAULT_SETTINGS, TARGET_BEVERAGE_G } from '../domain/defaults';
import { uid } from '../lib/random';
import { moderate } from '../lib/moderation';
import { isSupabaseConfigured } from '../lib/supabase';
import { deletePost as deleteRemotePost, insertPost as insertRemotePost } from './social';

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

/** 拡張子から MIME を補う。端末によっては File.type が空で来る。 */
function mediaMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  const byExtension: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    // iPhone で撮った動画。音声トラックだけ使う。
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
  };
  return byExtension[extension] ?? 'audio/mpeg';
}

/**
 * 動画から取り出した音声に付ける表示名。IMG_1234.MOV のような長い名前ではなく
 * 「音声1」「音声2」で示す。他の枠と同名にならない最小の番号を使う。
 */
export function nextExtractedSoundName(settings: Settings, slot: SoundSlot = 'custom'): string {
  const other = slot === 'custom' ? settings.finishCustomSoundName : settings.customSoundName;
  const taken = Number(/^音声(\d+)$/.exec(other ?? '')?.[1] ?? 0);
  return `音声${taken === 1 ? 2 : 1}`;
}

/**
 * アップロードした合図音を端末内に保存し、その置き場を選択状態にする。
 * audio を渡すと、その中身（動画から取り出した音声）を元ファイルの代わりに保存する。
 * 返すのは表示名。
 */
export async function saveCustomSound(file: File, slot: SoundSlot = 'custom', audio?: Blob): Promise<string> {
  // File はディスク上の実体への参照なので、そのまま保存すると端末側で
  // 元ファイルが消えたときに読めなくなる。中身を写した Blob を持つ。
  const source = audio ?? file;
  const blob = new Blob([await source.arrayBuffer()], { type: audio ? audio.type : mediaMimeType(file) });
  const settings = await getSettings();
  const name = mediaMimeType(file).startsWith('video/')
    ? nextExtractedSoundName(settings, slot)
    : file.name;
  await db.sounds.put({ id: slot, name, blob });
  await saveSettings(
    slot === 'custom'
      ? { ...settings, soundId: slot, customSoundName: name }
      : { ...settings, finishSoundId: slot, finishCustomSoundName: name },
  );
  return name;
}

/** アップロードした合図音を捨て、既定の選択に戻す。 */
export async function deleteCustomSound(slot: SoundSlot = 'custom'): Promise<void> {
  await db.sounds.delete(slot);
  const settings = await getSettings();
  if (slot === 'custom') {
    const { customSoundName: _dropped, ...rest } = settings;
    await saveSettings({ ...rest, soundId: DEFAULT_SETTINGS.soundId });
    return;
  }
  const { finishCustomSoundName: _dropped, ...rest } = settings;
  await saveSettings({ ...rest, finishSoundId: DEFAULT_SETTINGS.finishSoundId });
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
 * Supabase を設定したビルドではサーバーへ、未設定なら端末内に保存する。
 */
export async function submitPost(
  author: string,
  body: string,
  recipe?: SharedRecipe,
): Promise<ModerationVerdict> {
  const verdict = await moderate(body);
  if (!verdict.allowed) {
    await recordAudit({
      kind: 'moderation',
      subject: 'post',
      detail: `投稿を拒否（${verdict.provider}: ${verdict.categories.join(', ') || '不適切'}）`,
    });
    return verdict;
  }
  const name = author.trim() === '' ? '豆挽けば名無し' : author.trim();
  if (isSupabaseConfigured) {
    await insertRemotePost({ author: name, body, recipe, moderation: verdict });
    return verdict;
  }
  const post: Post = {
    id: uid('post'),
    author: name,
    body,
    createdAt: new Date().toISOString(),
    recipe,
    moderation: verdict,
  };
  await db.posts.put(post);
  return verdict;
}

/** レシピを共有用の写しに変換する。 */
export function toSharedRecipe(recipe: Recipe): SharedRecipe {
  return {
    name: recipe.name,
    doseG: recipe.doseG,
    totalWaterG: recipe.totalWaterG,
    grindSetting: recipe.grindSetting,
    brewer: recipe.brewer,
    waterTempC: recipe.waterTempC,
    pours: recipe.pours,
    finishSec: recipe.finishSec,
  };
}

/** 投稿に添付されたレシピを自分のレシピとして取り込む。 */
export async function importSharedRecipe(shared: SharedRecipe): Promise<Recipe> {
  const bean = await db.beans.toCollection().first();
  const recipe: Recipe = {
    id: uid('recipe'),
    name: shared.name,
    beanId: bean?.id ?? '',
    doseG: shared.doseG,
    grindSetting: shared.grindSetting,
    waterTempC: shared.waterTempC,
    waterId: '',
    totalWaterG: shared.totalWaterG,
    targetBeverageG: TARGET_BEVERAGE_G,
    brewer: shared.brewer,
    filter: '',
    pours: shared.pours,
    finishSec: shared.finishSec,
    createdAt: new Date().toISOString(),
  };
  await db.recipes.put(recipe);
  return recipe;
}

/** R-2: 削除は記録に残す。サーバー上の投稿は自分のものだけ消せる（RLS）。 */
export async function deletePost(post: Post): Promise<void> {
  if (post.source === 'remote') {
    await deleteRemotePost(post.id);
  } else {
    const stored = await db.posts.get(post.id);
    if (!stored) return;
    await db.posts.delete(post.id);
  }
  await recordAudit({ kind: 'delete', subject: post.id, detail: `${post.author} の投稿を削除` });
}
