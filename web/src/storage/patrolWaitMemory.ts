import { getLocalforage } from './localforage';

type StoredWaitMap = Record<string, number>;

const PATROL_WAIT_PREFIX = 'station_patrol_wait_v1';

function buildKey(eventId: string, stationId: string) {
  return `${PATROL_WAIT_PREFIX}_${eventId}_${stationId}`;
}

function normalizeWaitMinutes(waitMinutes: number) {
  if (!Number.isFinite(waitMinutes)) {
    return 0;
  }
  return Math.max(0, Math.round(waitMinutes));
}

export async function loadStoredPatrolWaitMinutes(
  eventId: string,
  stationId: string,
  patrolId: string,
): Promise<number | null> {
  const localforage = getLocalforage();
  const key = buildKey(eventId, stationId);
  const map = (await localforage.getItem<StoredWaitMap>(key)) ?? {};
  const raw = map[patrolId];
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return normalizeWaitMinutes(raw);
}

export async function saveStoredPatrolWaitMinutes(
  eventId: string,
  stationId: string,
  patrolId: string,
  waitMinutes: number,
): Promise<void> {
  const localforage = getLocalforage();
  const key = buildKey(eventId, stationId);
  const current = (await localforage.getItem<StoredWaitMap>(key)) ?? {};
  const nextWaitMinutes = normalizeWaitMinutes(waitMinutes);
  if (nextWaitMinutes <= 0) {
    if (Object.prototype.hasOwnProperty.call(current, patrolId)) {
      const next = { ...current };
      delete next[patrolId];
      await localforage.setItem(key, next);
    }
    return;
  }
  await localforage.setItem(key, {
    ...current,
    [patrolId]: nextWaitMinutes,
  });
}
