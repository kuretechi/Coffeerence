import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { seedIfEmpty } from './db/repo';
import { AuthProvider } from './ui/auth';
import './styles.css';

void seedIfEmpty();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </AuthProvider>
  </StrictMode>,
);

// NF-01 オフライン動作
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {
      /* オフライン化に失敗してもアプリ自体は動く */
    });
  });
}
