import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AuthProvider } from './auth/context';
import { registerSW } from 'virtual:pwa-register';
import zelenaLigaLogo from './assets/znak_SPTO_transparent.png';

function applyBranding() {
  if (document.title !== 'Zelena liga') {
    document.title = 'Zelena liga';
  }

  const existingLinks = Array.from(
    document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']"),
  );

  if (existingLinks.length > 0) {
    existingLinks.forEach((link) => {
      link.rel = 'icon';
      link.type = 'image/png';
      link.href = zelenaLigaLogo;
    });
    return;
  }

  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = zelenaLigaLogo;
  document.head.appendChild(link);
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

applyBranding();

const params = new URLSearchParams(window.location.search);
const view = params.get('view');
const pathname = window.location.pathname;
const isScoreboardPath = /^\/scoreboard(?:\b|\/)/i.test(pathname);

function render(element: React.ReactNode) {
  root.render(
    <React.StrictMode>
      <AuthProvider>{element}</AuthProvider>
    </React.StrictMode>,
  );
}

if (view === 'scoreboard' || isScoreboardPath) {
  import('./scoreboard/ScoreboardApp')
    .then(({ default: ScoreboardApp }) => {
      render(<ScoreboardApp />);
    })
    .catch((error) => {
      console.error('Failed to load scoreboard view', error);
    });
} else {
  import('./App')
    .then(({ default: App }) => {
      render(<App />);
    })
    .catch((error) => {
      console.error('Failed to load scoring app', error);
    });
}
