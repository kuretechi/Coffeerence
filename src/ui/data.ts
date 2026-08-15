import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { DEFAULT_COMPETITION, DEFAULT_SETTINGS } from '../domain/defaults';
import { THEME_NAMES } from '../domain/types';
import type {
  Bean,
  BrewRecord,
  Competition,
  Gear,
  GearKind,
  Post,
  Recipe,
  Session,
  Settings,
  SoundSlot,
  StoredSound,
} from '../domain/types';

/** 廃止したテーマ（HUD）が保存されたままの端末を既定へ戻す。 */
function normalize(stored: Settings): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  return THEME_NAMES.includes(merged.theme) ? merged : { ...merged, theme: DEFAULT_SETTINGS.theme };
}

export function useSettings(): Settings {
  const stored = useLiveQuery(() => db.settings.get('settings'), [], undefined);
  // 既存レコードに後から追加した項目は既定値で補う。
  return stored ? normalize(stored) : DEFAULT_SETTINGS;
}

/** 読み込み中は undefined。保存済みの値でフォームを初期化したいときに使う。 */
export function useLoadedSettings(): Settings | undefined {
  const stored = useLiveQuery(() => db.settings.get('settings'), [], undefined);
  return stored ? normalize(stored) : undefined;
}

export function useCompetition(): Competition {
  const settings = useSettings();
  return (
    useLiveQuery(() => db.competitions.get(settings.activeCompetitionId), [settings.activeCompetitionId], undefined) ??
    DEFAULT_COMPETITION
  );
}

export function useSessions(): Session[] {
  return useLiveQuery(() => db.sessions.orderBy('date').reverse().toArray(), [], []) ?? [];
}

export function useSession(id: string | undefined): Session | undefined {
  return useLiveQuery(() => (id ? db.sessions.get(id) : undefined), [id], undefined);
}

export function useRecipes(): Recipe[] {
  return useLiveQuery(() => db.recipes.toArray(), [], []) ?? [];
}

/** 読み込み中は undefined。存在しないIDを判定したいときに使う。 */
export function useLoadedRecipes(): Recipe[] | undefined {
  return useLiveQuery(() => db.recipes.toArray(), [], undefined);
}

export function useBrews(): BrewRecord[] {
  return useLiveQuery(() => db.brews.orderBy('date').reverse().toArray(), [], []) ?? [];
}

export function usePosts(): Post[] {
  return useLiveQuery(() => db.posts.orderBy('createdAt').reverse().toArray(), [], []) ?? [];
}

/** アップロードした合図音（未設定なら undefined）。 */
export function useCustomSound(slot: SoundSlot = 'custom'): StoredSound | undefined {
  return useLiveQuery(() => db.sounds.get(slot), [slot], undefined);
}

export function useBeans(): Bean[] {
  return useLiveQuery(() => db.beans.toArray(), [], []) ?? [];
}

export function useGear(kind: GearKind): Gear[] {
  return useLiveQuery(() => db.gear.where('kind').equals(kind).toArray(), [kind], []) ?? [];
}

export function useExternalLabels() {
  return useLiveQuery(() => db.externalLabels.toArray(), [], []) ?? [];
}

export function useTriangleTrials() {
  return useLiveQuery(() => db.triangleTrials.orderBy('date').toArray(), [], []) ?? [];
}

export function useRehearsals() {
  return useLiveQuery(() => db.rehearsals.orderBy('date').reverse().toArray(), [], []) ?? [];
}

export function useDescriptorSet(beanId: string | undefined) {
  return useLiveQuery(
    () => (beanId ? db.descriptorSets.where('beanId').equals(beanId).first() : undefined),
    [beanId],
    undefined,
  );
}

export function useAudit() {
  return useLiveQuery(() => db.audit.orderBy('at').reverse().limit(50).toArray(), [], []) ?? [];
}

/** リビール済みセッションのみを解析対象にする（採点中の情報が漏れないようにする） */
export function revealedSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter((s) => s.status === 'revealed');
}
