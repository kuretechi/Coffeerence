import type { ModerationVerdict, SharedRecipe } from '../domain/types';

// Supabase（PostgreSQL）側のテーブル定義。supabase/migrations の SQL と対応させる。

// 行の型は interface ではなく type にする（interface には暗黙のインデックス
// シグネチャが付かず、supabase-js の Database 制約を満たせない）。
export type ProfileRow = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type PostRow = {
  id: string;
  user_id: string;
  author: string;
  body: string;
  recipe: SharedRecipe | null;
  moderation: ModerationVerdict;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: { id: string; display_name: string; avatar_url?: string | null; created_at?: string };
        Update: { display_name?: string; avatar_url?: string | null };
        Relationships: [];
      };
      posts: {
        Row: PostRow;
        Insert: {
          id?: string;
          user_id: string;
          author: string;
          body: string;
          recipe?: SharedRecipe | null;
          moderation: ModerationVerdict;
          created_at?: string;
        };
        Update: { body?: string; moderation?: ModerationVerdict };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
