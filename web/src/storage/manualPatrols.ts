import { getLocalforage } from './localforage';

export interface ManualPatrol {
  id: string;
  team_name: string;
  category: string;
  sex: string;
  patrol_code: string;
}

const MANUAL_PREFIX = 'manual_patrols_v1';

function buildKey(eventId: string) {
  return `${MANUAL_PREFIX}_${eventId}`;
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

export async function getManualPatrols(eventId: string): Promise<ManualPatrol[]> {
  const localforage = getLocalforage();
  const key = buildKey(eventId);
  return ((await localforage.getItem<ManualPatrol[]>(key)) ?? []).slice();
}

export async function upsertManualPatrol(
  eventId: string,
  patrol: ManualPatrol,
): Promise<ManualPatrol[]> {
  const localforage = getLocalforage();
  const key = buildKey(eventId);
  const current = (await localforage.getItem<ManualPatrol[]>(key)) ?? [];
  const normalized = normalizeCode(patrol.patrol_code);
  const next = current.filter((entry) => {
    if (entry.id === patrol.id) {
      return false;
    }
    const entryCode = normalizeCode(entry.patrol_code);
    return entryCode !== normalized;
  });
  next.push({ ...patrol, patrol_code: normalized });
  await localforage.setItem(key, next);
  return next;
}
