import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useSettings } from './ui/data';
import { Logo } from './ui/Logo';
import { TabIcon } from './ui/TabIcon';
import type { TabIconName } from './ui/TabIcon';
import { RecipeScreen } from './screens/RecipeScreen';
import { TimerScreen } from './screens/TimerScreen';
import { LogScreen } from './screens/LogScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ComingSoonScreen } from './screens/ComingSoonScreen';

const TABS: { to: string; label: string; icon: TabIconName }[] = [
  { to: '/', label: 'レシピ', icon: 'recipe' },
  { to: '/timer', label: 'タイマー', icon: 'timer' },
  { to: '/log', label: '記録', icon: 'log' },
  { to: '/friends', label: '豆友', icon: 'friends' },
  { to: '/account', label: 'アカウント', icon: 'account' },
  { to: '/settings', label: '設定', icon: 'settings' },
];

export function App() {
  const settings = useSettings();

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <Logo />
        </h1>
      </header>

      <Routes>
        <Route path="/" element={<RecipeScreen />} />
        <Route path="/timer" element={<TimerScreen />} />
        <Route path="/log" element={<LogScreen />} />
        <Route
          path="/friends"
          element={<ComingSoonScreen title="豆友" description="他の競技者のレシピを見たり、自分のレシピを投稿したりする画面です。" />}
        />
        <Route
          path="/account"
          element={<ComingSoonScreen title="アカウント" description="アカウント登録とログインの画面です。" />}
        />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <nav className="tabs">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <TabIcon name={tab.icon} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
