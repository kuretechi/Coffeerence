import Dexie, { type Table } from 'dexie';
import type {
  AuditEntry,
  Bean,
  BrewRecord,
  Competition,
  ExternalLabel,
  FlavorDescriptorSet,
  Gear,
  Recipe,
  RehearsalRecord,
  Session,
  Settings,
  TriangleTrial,
} from '../domain/types';

// NF-02: ローカル保存（IndexedDB）。v1 ではアカウント不要。
export class CoffeerenceDb extends Dexie {
  competitions!: Table<Competition, string>;
  beans!: Table<Bean, string>;
  descriptorSets!: Table<FlavorDescriptorSet, string>;
  gear!: Table<Gear, string>;
  recipes!: Table<Recipe, string>;
  brews!: Table<BrewRecord, string>;
  sessions!: Table<Session, string>;
  externalLabels!: Table<ExternalLabel, string>;
  triangleTrials!: Table<TriangleTrial, string>;
  rehearsals!: Table<RehearsalRecord, string>;
  settings!: Table<Settings, string>;
  audit!: Table<AuditEntry, string>;

  constructor(name = 'coffeerence') {
    super(name);
    this.version(1).stores({
      competitions: 'id',
      beans: 'id',
      descriptorSets: 'id, beanId',
      recipes: 'id, beanId, createdAt',
      sessions: 'id, date, status, beanId',
      externalLabels: 'id, recipeId, date',
      triangleTrials: 'id, date, factor',
      rehearsals: 'id, date',
      settings: 'id',
      audit: 'id, at',
    });
    this.version(2).stores({
      brews: 'id, date, recipeId',
    });
    this.version(3).stores({
      gear: 'id, kind',
    });
  }
}

export const db = new CoffeerenceDb();
