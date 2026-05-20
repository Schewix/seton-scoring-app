import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './auth/fetch';
import { AuthProvider } from './auth/context';
import ErrorBoundary from './components/ErrorBoundary';
import { registerSW } from 'virtual:pwa-register';
import {
  DESKOVKY_ROUTE_PREFIX,
  FORGOT_PASSWORD_ROUTE,
  LEGACY_FORGOT_PASSWORD_ROUTE,
  LEGACY_FORGOT_PASSWORD_ROUTE_ALT,
  LEGACY_ROUTE_PREFIX,
  MAPA_PROCHODU_ROUTE,
  ROUTE_PREFIX,
  isChangePasswordPathname,
  isAdminPathname,
  isDeskovkyPathname,
  isSetonMapAdminPathname,
  isSetonMapPathname,
  isScoreboardPathname,
  isStationAppPath,
} from './routing';

type IconLinkConfig = {
  rel: string;
  href: string;
  sizes?: string;
  type?: string;
};

type SeoConfig = {
  title: string;
  description: string;
  canonicalPath: string;
  robots: string;
};

const SITE_URL = 'https://www.zelenaliga.cz';
const DEFAULT_SEO = {
  title: 'Zelená liga | zelenaliga.cz',
  description: 'Zelená liga pro rozhodčí, veřejný přehled výsledků, soutěže, oddíly a fotogalerie.',
};

const ROUTE_SEO: Record<string, Pick<SeoConfig, 'title' | 'description'>> = {
  '/': DEFAULT_SEO,
  '/aktualni-poradi': {
    title: 'Aktuální pořadí Zelené ligy',
    description: 'Průběžné pořadí oddílů v Zelené lize a bodování jednotlivých soutěží.',
  },
  '/aplikace': {
    title: 'Aplikace Zelené ligy',
    description: 'Veřejné aplikace a výsledkové přehledy soutěží Zelené ligy.',
  },
  '/aplikace/deskovky': {
    title: 'Deskové hry | Zelená liga',
    description: 'Aplikace pro turnaj deskových her v rámci Zelené ligy.',
  },
  '/aplikace/deskovky/pravidla': {
    title: 'Pravidla deskových her | Zelená liga',
    description: 'Pravidla a informace k soutěži deskových her v rámci Zelené ligy.',
  },
  '/aplikace/deskovky/standings': {
    title: 'Výsledky deskových her | Zelená liga',
    description: 'Aktuální výsledky a pořadí soutěže deskových her.',
  },
  '/aplikace/setonuv-zavod/vysledky': {
    title: 'Výsledky Setonova závodu | Zelená liga',
    description: 'Veřejný přehled výsledků Setonova závodu v rámci Zelené ligy.',
  },
  '/clanky': {
    title: 'Články a novinky | Zelená liga',
    description: 'Aktuality, články a novinky ze soutěží Zelené ligy.',
  },
  '/fotogalerie': {
    title: 'Fotogalerie | Zelená liga',
    description: 'Fotogalerie ze soutěží a akcí Zelené ligy.',
  },
  '/kontakty': {
    title: 'Kontakty | Zelená liga',
    description: 'Kontaktní informace pro organizátory Zelené ligy a SPTO Brno.',
  },
  '/o-spto': {
    title: 'O SPTO Brno | Zelená liga',
    description: 'Informace o Sdružení pionýrských tábornických oddílů Brno.',
  },
  '/oddily': {
    title: 'Oddíly SPTO | Zelená liga',
    description: 'Přehled oddílů zapojených do Zelené ligy a SPTO Brno.',
  },
  '/souteze': {
    title: 'Soutěže | Zelená liga',
    description: 'Přehled soutěží Zelené ligy, pravidla a informace pro oddíly.',
  },
  '/souteze/brnenske-bloudeni': {
    title: 'Brněnské bloudění | Zelená liga',
    description: 'Městská orientační hra Brněnské bloudění v rámci Zelené ligy.',
  },
  '/souteze/deskove-hry': {
    title: 'Deskové hry | Zelená liga',
    description: 'Soutěž jednotlivců v deskových hrách v rámci Zelené ligy.',
  },
  '/souteze/draci-smycka': {
    title: 'Dračí smyčka | Zelená liga',
    description: 'Soutěž jednotlivců ve vázání uzlů v rámci Zelené ligy.',
  },
  '/souteze/karakoram': {
    title: 'Karakoram | Zelená liga',
    description: 'Soutěž týmů v překonávání lanových překážek v rámci Zelené ligy.',
  },
  '/souteze/kosmuv-prostor': {
    title: 'Kosmův prostor | Zelená liga',
    description: 'Doplňková soutěž oddílů Kosmův prostor v rámci Zelené ligy.',
  },
  '/souteze/lakros': {
    title: 'Lakros | Zelená liga',
    description: 'Turnaj v pionýrském lakrosu v rámci Zelené ligy.',
  },
  '/souteze/memorial-bedricha-stolicky': {
    title: 'Memoriál Bedřicha Stolíčky | Zelená liga',
    description: 'Atletická a silová soutěž Memoriál Bedřicha Stolíčky v rámci Zelené ligy.',
  },
  '/souteze/piotrio': {
    title: 'Pio Trio | Zelená liga',
    description: 'Soutěž tříčlenných hlídek Pio Trio v rámci Zelené ligy.',
  },
  '/souteze/ringobal': {
    title: 'Ringobal | Zelená liga',
    description: 'Sportovní turnaj v ringobalu pro oddíly Zelené ligy.',
  },
  '/souteze/setonuv-zavod': {
    title: 'Setonův závod | Zelená liga',
    description: 'Týmový tábornický závod hlídek na stanovištích v přírodě.',
  },
  '/souteze/vybijena': {
    title: 'Vybíjená | Zelená liga',
    description: 'Sportovní turnaj ve vybíjené v rámci Zelené ligy.',
  },
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

function absoluteUrl(pathname: string) {
  return `${SITE_URL}${pathname === '/' ? '/' : pathname}`;
}

function upsertMeta(selector: string, create: () => HTMLMetaElement, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(selector);
  if (!meta) {
    meta = create();
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function upsertMetaName(name: string, content: string) {
  upsertMeta(
    `meta[name='${name}']`,
    () => {
      const meta = document.createElement('meta');
      meta.name = name;
      return meta;
    },
    content,
  );
}

function upsertMetaProperty(property: string, content: string) {
  upsertMeta(
    `meta[property='${property}']`,
    () => {
      const meta = document.createElement('meta');
      meta.setAttribute('property', property);
      return meta;
    },
    content,
  );
}

function upsertCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>("link[rel='canonical']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = href;
}

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

function normalizePathname(pathname: string) {
  return pathname.replace(/\/+$/, '') || '/';
}

function isPrivateOrDuplicatePath(pathname: string) {
  if (
    isAdminPathname(pathname) ||
    isSetonMapAdminPathname(pathname) ||
    isStationAppPath(pathname) ||
    isChangePasswordPathname(pathname)
  ) {
    return true;
  }
  return (
    pathname === ROUTE_PREFIX ||
    pathname.startsWith(`${ROUTE_PREFIX}/stanoviste`) ||
    pathname.startsWith(`${ROUTE_PREFIX}/station`) ||
    pathname.startsWith(`${ROUTE_PREFIX}/admin`) ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/redakce') ||
    pathname.startsWith('/stanoviste') ||
    pathname.startsWith('/stations') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/scoreboard') ||
    pathname.startsWith('/vysledky')
  );
}

function resolveSeo(pathname: string): SeoConfig {
  const normalizedPathname = normalizePathname(pathname);
  const canonicalPath = normalizedPathname === '/zelena-liga' ? '/aktualni-poradi' : normalizedPathname;
  const direct = ROUTE_SEO[canonicalPath];
  if (direct) {
    return {
      ...direct,
      canonicalPath,
      robots: isPrivateOrDuplicatePath(normalizedPathname) ? 'noindex,nofollow' : 'index,follow',
    };
  }
  if (canonicalPath.startsWith('/clanky/')) {
    return {
      title: 'Článek | Zelená liga',
      description: 'Článek a novinky ze soutěží Zelené ligy.',
      canonicalPath,
      robots: 'index,follow',
    };
  }
  if (canonicalPath.startsWith('/fotogalerie/')) {
    return {
      title: 'Fotogalerie | Zelená liga',
      description: 'Album fotografií ze soutěží a akcí Zelené ligy.',
      canonicalPath,
      robots: 'index,follow',
    };
  }
  if (canonicalPath.startsWith('/oddily/')) {
    return {
      title: 'Oddíl SPTO | Zelená liga',
      description: 'Profil oddílu zapojeného do Zelené ligy a SPTO Brno.',
      canonicalPath,
      robots: 'index,follow',
    };
  }
  return {
    ...DEFAULT_SEO,
    canonicalPath,
    robots: isPrivateOrDuplicatePath(normalizedPathname) ? 'noindex,nofollow' : 'index,follow',
  };
}

function applyBranding(pathname: string) {
  const seo = resolveSeo(pathname);
  if (document.title !== seo.title) {
    document.title = seo.title;
  }

  const canonicalUrl = absoluteUrl(seo.canonicalPath);
  upsertCanonical(canonicalUrl);
  upsertMetaName('description', seo.description);
  upsertMetaName('robots', seo.robots);
  upsertMetaProperty('og:title', seo.title);
  upsertMetaProperty('og:description', seo.description);
  upsertMetaProperty('og:url', canonicalUrl);
  ICON_LINKS.forEach(upsertIconLink);
}

async function requestPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return;
  }

  const storageManager = navigator.storage;
  if (typeof storageManager.persist !== 'function') {
    return;
  }

  try {
    const alreadyPersisted =
      typeof storageManager.persisted === 'function' ? await storageManager.persisted() : false;
    if (alreadyPersisted) {
      return;
    }
    await storageManager.persist();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug('[storage] persistent storage request failed', error);
    }
  }
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}
void requestPersistentStorage();

const params = new URLSearchParams(window.location.search);
const view = params.get('view');
const pathname = window.location.pathname;
const normalizedPath = pathname.replace(/\/$/, '') || '/';
applyBranding(normalizedPath);
const isScoreboardPath = isScoreboardPathname(pathname);
const isAdminPath = isAdminPathname(pathname);
const isSetonMapPath = isSetonMapPathname(pathname);
const isSetonMapAdminPath = isSetonMapAdminPathname(pathname);
const isHomepagePath = normalizedPath === '/';
const isDeskovkyPath = isDeskovkyPathname(pathname);
const isChangePasswordPath = isChangePasswordPathname(normalizedPath);
const isScoringNamespace =
  normalizedPath === ROUTE_PREFIX ||
  normalizedPath.startsWith(`${ROUTE_PREFIX}/`) ||
  normalizedPath === LEGACY_ROUTE_PREFIX ||
  normalizedPath.startsWith(`${LEGACY_ROUTE_PREFIX}/`) ||
  isStationAppPath(normalizedPath) ||
  isChangePasswordPath;
const scoreboardViews = new Set(['scoreboard', 'vysledky']);
const forgotPasswordViews = new Set(['zapomenute-heslo', 'forgot-password']);
const forgotPasswordPathnames = new Set([
  FORGOT_PASSWORD_ROUTE,
  LEGACY_FORGOT_PASSWORD_ROUTE,
  LEGACY_FORGOT_PASSWORD_ROUTE_ALT,
  '/zapomenute-heslo',
]);
const resetPasswordPathnames = new Set([
  '/auth/reset-password',
  '/auth/recovery',
  '/reset-password',
]);

function render(element: React.ReactNode) {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <AuthProvider>{element}</AuthProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

if (isSetonMapAdminPath) {
  import('./liveMap/SetonMapAdminApp')
    .then(({ default: SetonMapAdminApp }) => {
      render(<SetonMapAdminApp />);
    })
    .catch((error) => {
      console.error('Failed to load seton map admin view', error);
    });
} else if (isSetonMapPath || normalizedPath === MAPA_PROCHODU_ROUTE) {
  import('./liveMap/SetonLiveMapApp')
    .then(({ default: SetonLiveMapApp }) => {
      render(<SetonLiveMapApp />);
    })
    .catch((error) => {
      console.error('Failed to load seton live map view', error);
    });
} else if (isAdminPath) {
  import('./admin/AdminApp')
    .then(({ default: AdminApp }) => {
      render(<AdminApp />);
    })
    .catch((error) => {
      console.error('Failed to load admin view', error);
    });
} else if (isDeskovkyPath || normalizedPath === DESKOVKY_ROUTE_PREFIX) {
  import('./features/deskovky/DeskovkyApp')
    .then(({ default: DeskovkyApp }) => {
      render(<DeskovkyApp />);
    })
    .catch((error) => {
      console.error('Failed to load deskovky app', error);
    });
} else if (
  (view && forgotPasswordViews.has(view)) ||
  forgotPasswordPathnames.has(normalizedPath)
) {
  import('./auth/ForgotPasswordScreen')
    .then(({ default: ForgotPasswordScreen }) => {
      render(<ForgotPasswordScreen />);
    })
    .catch((error) => {
      console.error('Failed to load forgot password view', error);
    });
} else if (resetPasswordPathnames.has(normalizedPath)) {
  const target = `${ROUTE_PREFIX}?reset=1`;
  if (`${normalizedPath}${window.location.search}` !== target) {
    window.history.replaceState(window.history.state, '', target);
  }
  import('./App')
    .then(({ default: App }) => {
      render(<App />);
    })
    .catch((error) => {
      console.error('Failed to load scoring app', error);
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
