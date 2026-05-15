import {
  ADMIN_ROUTE_PREFIX,
  LEGACY_ADMIN_ROUTE_PREFIX,
} from '../routing';

export type AdminPageKey =
  | 'live'
  | 'patrols'
  | 'stations'
  | 'results'
  | 'statistics'
  | 'settings';

export type AdminPageItem = {
  key: AdminPageKey;
  label: string;
};

export const ADMIN_PAGE_ITEMS: ReadonlyArray<AdminPageItem> = [
  { key: 'live', label: 'Live' },
  { key: 'patrols', label: 'Hlídky' },
  { key: 'stations', label: 'Stanoviště' },
  { key: 'results', label: 'Výsledky' },
  { key: 'statistics', label: 'Statistiky' },
  { key: 'settings', label: 'Nastavení' },
];

const ADMIN_PAGE_SET = new Set<AdminPageKey>(ADMIN_PAGE_ITEMS.map((item) => item.key));

const ADMIN_PAGE_ALIASES: Record<string, AdminPageKey> = {
  dashboard: 'live',
  stats: 'statistics',
  exports: 'settings',
  queues: 'live',
  starts: 'patrols',
};

function stripTrailingSlash(pathname: string): string {
  return pathname.replace(/\/$/, '') || '/';
}

function decodeSegment(value: string): string {
  if (!value) {
    return '';
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isAdminPageKey(value: string): value is AdminPageKey {
  return ADMIN_PAGE_SET.has(value as AdminPageKey);
}

export function normalizeAdminPage(value: string | null | undefined): AdminPageKey {
  const normalized = (value ?? '').trim().toLowerCase();
  if (isAdminPageKey(normalized)) {
    return normalized;
  }
  if (normalized in ADMIN_PAGE_ALIASES) {
    return ADMIN_PAGE_ALIASES[normalized];
  }
  return 'live';
}

export function detectAdminRoutePrefix(pathname: string): string {
  const normalized = stripTrailingSlash(pathname);
  if (
    normalized === LEGACY_ADMIN_ROUTE_PREFIX ||
    normalized.startsWith(`${LEGACY_ADMIN_ROUTE_PREFIX}/`)
  ) {
    return LEGACY_ADMIN_ROUTE_PREFIX;
  }
  return ADMIN_ROUTE_PREFIX;
}

export function parseAdminRoute(pathname: string): {
  prefix: string;
  eventId: string | null;
  page: AdminPageKey;
} {
  const normalized = stripTrailingSlash(pathname);
  const prefix = detectAdminRoutePrefix(normalized);

  if (normalized === prefix) {
    return { prefix, eventId: null, page: 'live' };
  }

  if (normalized.startsWith(`${prefix}/event/`)) {
    const rest = normalized.slice(`${prefix}/event/`.length);
    const [eventSegment, pageSegment] = rest.split('/');
    return {
      prefix,
      eventId: decodeSegment(eventSegment || '') || null,
      page: normalizeAdminPage(pageSegment),
    };
  }

  if (normalized.startsWith(`${prefix}/`)) {
    const firstSegment = normalized.slice(prefix.length + 1).split('/')[0] || '';
    return {
      prefix,
      eventId: null,
      page: normalizeAdminPage(firstSegment),
    };
  }

  return { prefix, eventId: null, page: 'live' };
}

export function buildAdminRoutePath(options: {
  prefix: string;
  eventId: string;
  page: AdminPageKey;
}): string {
  const normalizedPrefix = stripTrailingSlash(options.prefix) || ADMIN_ROUTE_PREFIX;
  return `${normalizedPrefix}/event/${encodeURIComponent(options.eventId)}/${options.page}`;
}
