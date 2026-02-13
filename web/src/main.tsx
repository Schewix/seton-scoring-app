import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './auth/fetch';
import { AuthProvider } from './auth/context';
import ErrorBoundary from './components/ErrorBoundary';
import { registerSW } from 'virtual:pwa-register';
import {
  FORGOT_PASSWORD_ROUTE,
  LEGACY_FORGOT_PASSWORD_ROUTE,
  LEGACY_ROUTE_PREFIX,
  ROUTE_PREFIX,
  isAdminPathname,
  isScoreboardPathname,
  isStationAppPath,
} from './routing';

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
  if (document.title !== 'Zelená liga | zelenaliga.cz') {
    document.title = 'Zelená liga | zelenaliga.cz';
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
const normalizedPath = pathname.replace(/\/$/, '') || '/';
const isScoreboardPath = isScoreboardPathname(pathname);
const isAdminPath = isAdminPathname(pathname);
const isHomepagePath = normalizedPath === '/';
const isScoringNamespace =
  normalizedPath === ROUTE_PREFIX ||
  normalizedPath.startsWith(`${ROUTE_PREFIX}/`) ||
  normalizedPath === LEGACY_ROUTE_PREFIX ||
  normalizedPath.startsWith(`${LEGACY_ROUTE_PREFIX}/`) ||
  isStationAppPath(normalizedPath);
const scoreboardViews = new Set(['scoreboard', 'vysledky']);
const forgotPasswordViews = new Set(['zapomenute-heslo', 'forgot-password']);

function render(element: React.ReactNode) {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <AuthProvider>{element}</AuthProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

if (isAdminPath) {
  import('./admin/AdminApp')
    .then(({ default: AdminApp }) => {
      render(<AdminApp />);
    })
    .catch((error) => {
      console.error('Failed to load admin view', error);
    });
} else if (
  (view && forgotPasswordViews.has(view)) ||
  normalizedPath === FORGOT_PASSWORD_ROUTE ||
  normalizedPath === LEGACY_FORGOT_PASSWORD_ROUTE
) {
  import('./auth/ForgotPasswordScreen')
    .then(({ default: ForgotPasswordScreen }) => {
      render(<ForgotPasswordScreen />);
    })
    .catch((error) => {
      console.error('Failed to load forgot password view', error);
    });
} else if ((view && scoreboardViews.has(view)) || isScoreboardPath) {
  import('./scoreboard/ScoreboardApp')
    .then(({ default: ScoreboardApp }) => {
      render(<ScoreboardApp />);
    })
    .catch((error) => {
      console.error('Failed to load scoreboard view', error);
    });
} else if (isHomepagePath && !isScoringNamespace) {
  import('./homepage/Homepage')
    .then(({ default: Homepage }) => {
      render(<Homepage />);
    })
    .catch((error) => {
      console.error('Failed to load homepage', error);
    });
} else if (isScoringNamespace || normalizedPath === ROUTE_PREFIX) {
  import('./App')
    .then(({ default: App }) => {
      render(<App />);
    })
    .catch((error) => {
      console.error('Failed to load scoring app', error);
    });
} else {
  import('./homepage/Homepage')
    .then(({ default: Homepage }) => {
      render(<Homepage />);
    })
    .catch((error) => {
      console.error('Failed to load homepage', error);
    });
}
