import Dexie, { type Table } from 'dexie';
import type {
  AuditEntry,
  Bean,
  BeatPattern,
  BrewRecord,
  Competition,
  ExternalLabel,
  FlavorDescriptorSet,
  Gear,
  LoopSound,
  Post,
  Recipe,
  RehearsalRecord,
  Session,
  Settings,
  StoredMidi,
  StoredSound,
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
  posts!: Table<Post, string>;
  sounds!: Table<StoredSound, string>;
  loopSounds!: Table<LoopSound, string>;
  beatPatterns!: Table<BeatPattern, string>;
  midis!: Table<StoredMidi, string>;

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
    this.version(4).stores({
      posts: 'id, createdAt',
    });
    this.version(5).stores({
      sounds: 'id',
    });
    // 既定音を「卓上ベル」に変える。自分で選んでいない端末（旧既定のベルのまま）だけ移す。
    this.version(6)
      .stores({})
      .upgrade((tx) =>
        tx
          .table<Settings>('settings')
          .toCollection()
          .modify((settings) => {
            if (settings.soundId === undefined || settings.soundId === 'bell') settings.soundId = 'desk';
          }),
      );
    // 抽出終了の2回鳴らしを既定でトゥルルにする（未設定の端末だけ）。
    this.version(7)
      .stores({})
      .upgrade((tx) =>
        tx
          .table<Settings>('settings')
          .toCollection()
          .modify((settings) => {
            settings.finishSoundId ??= 'tururu';
          }),
      );
    // ビートタブの音素材と盤面。
    this.version(8).stores({
      loopSounds: 'id, createdAt',
      mixerBoards: 'id',
    });
    // 枠に素材を入れる方式からタイルのグリッドへ。旧盤面は捨てて作り直す。
    this.version(9).stores({
      mixerBoards: null,
      beatPatterns: 'id',
    });
    // アップロードした MIDI。
    this.version(10).stores({
      midis: 'id, createdAt',
    });
  }
}

export const db = new CoffeerenceDb();
