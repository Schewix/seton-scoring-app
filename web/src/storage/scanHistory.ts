import { getLocalforage } from './localforage';

export interface ScanRecord {
  code: string;
  scannedAt: string;
  status: 'success' | 'failed';
  reason?: string;
  patrolId?: string;
  teamName?: string;
}

const HISTORY_LIMIT = 100;
const HISTORY_PREFIX = 'scan_history_v1';

function buildKey(eventId: string, stationId: string) {
  return `${HISTORY_PREFIX}_${eventId}_${stationId}`;
}

export async function appendScanRecord(
  eventId: string,
  stationId: string,
  record: ScanRecord,
): Promise<void> {
  const localforage = getLocalforage();
  const key = buildKey(eventId, stationId);
  const current = (await localforage.getItem<ScanRecord[]>(key)) ?? [];
  const next = [...current, record];
  if (next.length > HISTORY_LIMIT) {
    next.splice(0, next.length - HISTORY_LIMIT);
  }
  await localforage.setItem(key, next);
}

export async function getScanHistory(eventId: string, stationId: string): Promise<ScanRecord[]> {
  const localforage = getLocalforage();
  const key = buildKey(eventId, stationId);
  return ((await localforage.getItem<ScanRecord[]>(key)) ?? []).slice();
}
