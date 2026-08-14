import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { DEFAULT_COMPETITION, DEFAULT_SETTINGS } from '../domain/defaults';
import type { Bean, Competition, Recipe, Session, Settings } from '../domain/types';

export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('settings'), [], undefined) ?? DEFAULT_SETTINGS;
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

export function useBeans(): Bean[] {
  return useLiveQuery(() => db.beans.toArray(), [], []) ?? [];
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
