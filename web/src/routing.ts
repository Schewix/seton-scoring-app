export const ROUTE_PREFIX = '/setonuv-zavod';
export const STATION_ROUTE_PREFIX = `${ROUTE_PREFIX}/stanoviste`;
export const SCOREBOARD_ROUTE_PREFIX = `${ROUTE_PREFIX}/vysledky`;

const ADDITIONAL_STATION_PREFIXES = [
  `${ROUTE_PREFIX}/station`,
  '/stations',
  '/stanoviste',
];
const ADDITIONAL_SCOREBOARD_PREFIXES = [
  `${ROUTE_PREFIX}/scoreboard`,
  '/scoreboard',
  '/vysledky',
];

export function getStationPath(stationId: string): string {
  return `${STATION_ROUTE_PREFIX}/${encodeURIComponent(stationId)}`;
}

export function isStationAppPath(pathname: string): boolean {
  if (pathname === STATION_ROUTE_PREFIX || pathname.startsWith(`${STATION_ROUTE_PREFIX}/`)) {
    return true;
  }

  return ADDITIONAL_STATION_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isScoreboardPathname(pathname: string): boolean {
  if (pathname === SCOREBOARD_ROUTE_PREFIX || pathname.startsWith(`${SCOREBOARD_ROUTE_PREFIX}/`)) {
    return true;
  }

  return ADDITIONAL_SCOREBOARD_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
