export const ROUTE_PREFIX = '/aplikace/setonuv-zavod';
export const LEGACY_ROUTE_PREFIX = '/setonuv-zavod';
export const STATION_ROUTE_PREFIX = `${ROUTE_PREFIX}/stanoviste`;
export const LEGACY_STATION_ROUTE_PREFIX = `${LEGACY_ROUTE_PREFIX}/stanoviste`;
export const SCOREBOARD_ROUTE_PREFIX = `${ROUTE_PREFIX}/vysledky`;
export const LEGACY_SCOREBOARD_ROUTE_PREFIX = `${LEGACY_ROUTE_PREFIX}/vysledky`;
export const ADMIN_ROUTE_PREFIX = `${ROUTE_PREFIX}/admin`;
export const LEGACY_ADMIN_ROUTE_PREFIX = `${LEGACY_ROUTE_PREFIX}/admin`;
export const FORGOT_PASSWORD_ROUTE = '/aplikace/zapomenute-heslo';
export const LEGACY_FORGOT_PASSWORD_ROUTE = `${ROUTE_PREFIX}/zapomenute-heslo`;
export const LEGACY_FORGOT_PASSWORD_ROUTE_ALT = `${LEGACY_ROUTE_PREFIX}/zapomenute-heslo`;
export const DESKOVKY_ROUTE_PREFIX = '/aplikace/deskovky';
export const LEGACY_DESKOVKY_ROUTE_PREFIX = '/deskovky';
export const DESKOVKY_MATCH_NEW_ROUTE = `${DESKOVKY_ROUTE_PREFIX}/match/new`;
export const DESKOVKY_STANDINGS_ROUTE = `${DESKOVKY_ROUTE_PREFIX}/standings`;
export const DESKOVKY_ADMIN_ROUTE = `${DESKOVKY_ROUTE_PREFIX}/admin`;
export const DESKOVKY_RULES_ROUTE = `${DESKOVKY_ROUTE_PREFIX}/pravidla`;

const ADDITIONAL_STATION_PREFIXES = [
  `${ROUTE_PREFIX}/station`,
  `${LEGACY_ROUTE_PREFIX}/station`,
  LEGACY_STATION_ROUTE_PREFIX,
  '/stations',
  '/stanoviste',
];
const ADDITIONAL_SCOREBOARD_PREFIXES = [
  `${ROUTE_PREFIX}/scoreboard`,
  `${LEGACY_ROUTE_PREFIX}/scoreboard`,
  LEGACY_SCOREBOARD_ROUTE_PREFIX,
  '/scoreboard',
  '/vysledky',
];
const DESKOVKY_PREFIXES = [
  DESKOVKY_ROUTE_PREFIX,
  LEGACY_DESKOVKY_ROUTE_PREFIX,
  '/aplikace/deskove-hry',
  '/deskove-hry',
];

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function getStationSlug(stationName: string): string {
  const withoutDiacritics = stripDiacritics(stationName).toLowerCase();
  const slug = withoutDiacritics.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'stanoviste';
}

export function getStationPath(stationName: string): string {
  return `${STATION_ROUTE_PREFIX}/${getStationSlug(stationName)}`;
}

export function isStationAppPath(pathname: string): boolean {
  if (
    pathname === STATION_ROUTE_PREFIX ||
    pathname.startsWith(`${STATION_ROUTE_PREFIX}/`) ||
    pathname === LEGACY_STATION_ROUTE_PREFIX ||
    pathname.startsWith(`${LEGACY_STATION_ROUTE_PREFIX}/`)
  ) {
    return true;
  }

  return ADDITIONAL_STATION_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isScoreboardPathname(pathname: string): boolean {
  if (
    pathname === SCOREBOARD_ROUTE_PREFIX ||
    pathname.startsWith(`${SCOREBOARD_ROUTE_PREFIX}/`) ||
    pathname === LEGACY_SCOREBOARD_ROUTE_PREFIX ||
    pathname.startsWith(`${LEGACY_SCOREBOARD_ROUTE_PREFIX}/`)
  ) {
    return true;
  }

  return ADDITIONAL_SCOREBOARD_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAdminPathname(pathname: string): boolean {
  return (
    pathname === ADMIN_ROUTE_PREFIX ||
    pathname.startsWith(`${ADMIN_ROUTE_PREFIX}/`) ||
    pathname === LEGACY_ADMIN_ROUTE_PREFIX ||
    pathname.startsWith(`${LEGACY_ADMIN_ROUTE_PREFIX}/`)
  );
}

export function isDeskovkyPathname(pathname: string): boolean {
  return DESKOVKY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
