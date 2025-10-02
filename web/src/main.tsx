import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AuthProvider } from './auth/context';
import { registerSW } from 'virtual:pwa-register';
import { isScoreboardPathname } from './routing';

type IconLinkConfig = {
  rel: string;
  href: string;
  sizes?: string;
  type?: string;
};

const ICON_LINKS: IconLinkConfig[] = [
  {
    rel: 'icon',
    type: 'image/png',
    sizes: '32x32',
    href: '/favicon-32.png',
  },
  {
    rel: 'icon',
    type: 'image/png',
    sizes: '192x192',
    href: '/icon-192.png',
  },
  {
    rel: 'shortcut icon',
    type: 'image/png',
    sizes: '32x32',
    href: '/favicon-32.png',
  },
  {
    rel: 'apple-touch-icon',
    sizes: '180x180',
    href: '/apple-touch-icon.png',
  },
];

function upsertIconLink(config: IconLinkConfig) {
  const { rel, href, sizes, type } = config;
  let selector = `link[rel='${rel}']`;
  if (sizes) {
    selector += `[sizes='${sizes}']`;
  }

  let link = document.head.querySelector<HTMLLinkElement>(selector);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    if (sizes) {
      link.sizes = sizes;
    }
    document.head.appendChild(link);
  }

  if (type) {
    link.type = type;
  } else {
    link.removeAttribute('type');
  }

  if (sizes) {
    link.sizes = sizes;
  } else {
    link.removeAttribute('sizes');
  }

  link.href = href;
}

function applyBranding() {
  if (document.title !== 'Zelena liga') {
    document.title = 'Zelena liga';
  }

  ICON_LINKS.forEach(upsertIconLink);
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
