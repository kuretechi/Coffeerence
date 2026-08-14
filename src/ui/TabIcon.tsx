import type { ReactElement } from 'react';

export type TabIconName = 'recipe' | 'timer' | 'log' | 'friends' | 'account' | 'settings';

/** タブ用の線画アイコン。色は currentColor に追従する。 */
export function TabIcon({ name }: { name: TabIconName }) {
  return (
    <svg
      className="tab-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

const PATHS: Record<TabIconName, ReactElement> = {
  // ドリッパーとサーバー
  recipe: (
    <>
      <path d="M5 5h14l-3.5 7h-7z" />
      <path d="M10 12v3" />
      <path d="M8 21h8a3 3 0 0 0 3-3v-3H5v3a3 3 0 0 0 3 3z" />
    </>
  ),
  // ストップウォッチ
  timer: (
    <>
      <circle cx="12" cy="14" r="7" />
      <path d="M12 14V10" />
      <path d="M9.5 3h5" />
      <path d="M18.5 7.5 20 6" />
    </>
  ),
  // 記録リスト
  log: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 10h8" />
      <path d="M8 14h8" />
      <path d="M8 18h5" />
    </>
  ),
  // 豆と人
  friends: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17.5" cy="11.5" r="3" />
      <path d="M14.5 20a4.5 4.5 0 0 1 7-3.7" />
    </>
  ),
  // アカウント
  account: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  // 設定スライダー
  settings: (
    <>
      <path d="M4 8h10" />
      <path d="M18 8h2" />
      <circle cx="16" cy="8" r="2" />
      <path d="M4 16h4" />
      <path d="M12 16h8" />
      <circle cx="10" cy="16" r="2" />
    </>
  ),
};
