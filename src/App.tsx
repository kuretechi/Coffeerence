import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useSettings } from './ui/data';
import { HomeScreen } from './screens/HomeScreen';
import { SessionPlanScreen } from './screens/SessionPlanScreen';
import { BrewScreen } from './screens/BrewScreen';
import { ScoringScreen } from './screens/ScoringScreen';
import { CompareScreen } from './screens/CompareScreen';
import { RevealScreen } from './screens/RevealScreen';
import { AnalysisScreen } from './screens/AnalysisScreen';
import { ReliabilityScreen } from './screens/ReliabilityScreen';
import { StrategyScreen } from './screens/StrategyScreen';
import { RehearsalScreen } from './screens/RehearsalScreen';
import { TrainingScreen } from './screens/TrainingScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const TABS = [
  { to: '/', label: 'ホーム' },
  { to: '/plan', label: '計画' },
  { to: '/analysis', label: '分析' },
  { to: '/reliability', label: '信頼度' },
  { to: '/strategy', label: '戦略' },
  { to: '/rehearsal', label: 'リハーサル' },
  { to: '/training', label: '訓練' },
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
        <h1>コーヒーレンス</h1>
        <span className="subtitle">統計に基づく練習支援</span>
      </header>

      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/plan" element={<SessionPlanScreen />} />
        <Route path="/session/:sessionId/brew" element={<BrewScreen />} />
        <Route path="/session/:sessionId/score" element={<ScoringScreen />} />
        <Route path="/session/:sessionId/compare" element={<CompareScreen />} />
        <Route path="/session/:sessionId/reveal" element={<RevealScreen />} />
        <Route path="/analysis" element={<AnalysisScreen />} />
        <Route path="/reliability" element={<ReliabilityScreen />} />
        <Route path="/strategy" element={<StrategyScreen />} />
        <Route path="/rehearsal" element={<RehearsalScreen />} />
        <Route path="/training" element={<TrainingScreen />} />
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
