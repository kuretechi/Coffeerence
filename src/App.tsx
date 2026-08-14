import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useSettings } from './ui/data';
import { Logo } from './ui/Logo';
import { RecipeScreen } from './screens/RecipeScreen';
import { TimerScreen } from './screens/TimerScreen';
import { LogScreen } from './screens/LogScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const TABS = [
  { to: '/', label: 'レシピ' },
  { to: '/timer', label: 'タイマー' },
  { to: '/log', label: '記録' },
  { to: '/settings', label: '設定' },
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
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <nav className="tabs">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
