import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AuthProvider } from './auth/context';
import { registerSW } from 'virtual:pwa-register';
import zelenaLigaLogo from './assets/znak_SPTO_transparent.png';
import { isScoreboardPathname } from './routing';

function applyBranding() {
  if (document.title !== 'Zelena liga') {
    document.title = 'Zelena liga';
  }

  const iconHref = zelenaLigaLogo;
  const appleTouchHref = zelenaLigaLogo;

  function ensureLink(
    relValue: string,
    attributes: Record<string, string | undefined>,
  ) {
    const selector = `link[rel='${relValue}']`;
    const existingLinks = document.querySelectorAll<HTMLLinkElement>(selector);

    const updateLink = (link: HTMLLinkElement) => {
      link.rel = relValue;

      Object.entries(attributes).forEach(([attribute, value]) => {
        if (value === undefined) {
          link.removeAttribute(attribute);
          return;
        }

        if (attribute === 'href') {
          link.href = value;
          return;
        }

        if (attribute === 'type') {
          link.type = value;
          return;
        }

        if (attribute === 'sizes') {
          link.setAttribute('sizes', value);
          return;
        }

        link.setAttribute(attribute, value);
      });
    };

    if (existingLinks.length > 0) {
      existingLinks.forEach(updateLink);
    } else {
      const link = document.createElement('link');
      updateLink(link);
      document.head.appendChild(link);
    }

    ensureLink('icon', {
      href: iconHref,
      type: 'image/png',
    });
    ensureLink('shortcut icon', {
      href: iconHref,
      type: 'image/png',
    });
    ensureLink('apple-touch-icon', {
      href: appleTouchHref,
    });
  }

  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

  if ('serviceWorker' in navigator) {
    registerSW({ immediate: true });
  }

  applyBranding();

  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const pathname = window.location.pathname;
  const isScoreboardPath = isScoreboardPathname(pathname);
  const scoreboardViews = new Set(['scoreboard', 'vysledky']);

  function render(element: React.ReactNode) {
    root.render(
      <React.StrictMode>
        <AuthProvider>{element}</AuthProvider>
      </React.StrictMode>,
    );
  }

  if ((view && scoreboardViews.has(view)) || isScoreboardPath) {
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
}
