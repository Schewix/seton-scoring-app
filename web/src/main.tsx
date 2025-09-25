import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AuthProvider } from './auth/context';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

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
