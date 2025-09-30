export const ROUTE_PREFIX = '/setonuv-zavod';
export const STATION_ROUTE_PREFIX = `${ROUTE_PREFIX}/station`;
export const SCOREBOARD_ROUTE_PREFIX = `${ROUTE_PREFIX}/scoreboard`;

const LEGACY_STATION_PREFIXES = ['/stations', '/stanoviste'];
const LEGACY_SCOREBOARD_PREFIXES = ['/scoreboard'];

export function getStationPath(stationId: string): string {
  return `${STATION_ROUTE_PREFIX}/${encodeURIComponent(stationId)}`;
}

export function isStationAppPath(pathname: string): boolean {
  if (pathname === STATION_ROUTE_PREFIX || pathname.startsWith(`${STATION_ROUTE_PREFIX}/`)) {
    return true;
  }

  return LEGACY_STATION_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isScoreboardPathname(pathname: string): boolean {
  if (pathname === SCOREBOARD_ROUTE_PREFIX || pathname.startsWith(`${SCOREBOARD_ROUTE_PREFIX}/`)) {
    return true;
  }

  return LEGACY_SCOREBOARD_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
