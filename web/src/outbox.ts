import { getOutboxStore } from './storage/localforage';

export type OutboxState = 'queued' | 'sending' | 'sent' | 'failed' | 'needs_auth' | 'blocked_other_session';

export interface StationScorePayload {
  client_event_id: string;
  client_created_at: string;
  event_id: string;
  station_id: string;
  patrol_id: string;
  category: string;
  arrived_at: string;
  wait_minutes: number;
  points: number;
  note: string;
  use_target_scoring: boolean;
  normalized_answers: string | null;
  finish_time: string | null;
  patrol_code: string;
  team_name?: string;
  sex?: string;
}

export interface OutboxEntry {
  client_event_id: string;
  type: 'station_score';
  payload: StationScorePayload;
  event_id: string;
  station_id: string;
  state: OutboxState;
  attempts: number;
  last_error?: string;
  next_attempt_at: number;
  created_at: string;
  response?: Record<string, unknown> | null;
}

export function generateClientEventId() {
  const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildStationScorePayload(
  payload: Omit<StationScorePayload, 'client_event_id' | 'client_created_at'>,
  clientEventId: string,
  nowIso: string,
): StationScorePayload {
  return {
    ...payload,
    client_event_id: clientEventId,
    client_created_at: nowIso,
  };
}

export function buildOutboxEntry(submission: StationScorePayload, nowIso: string): OutboxEntry {
  return {
    client_event_id: submission.client_event_id,
    type: 'station_score',
    payload: submission,
    event_id: submission.event_id,
    station_id: submission.station_id,
    state: 'queued',
    attempts: 0,
    next_attempt_at: Date.now(),
    created_at: nowIso,
    response: null,
  };
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  const outboxStore = getOutboxStore();
  const keys = await outboxStore.keys();
  if (!keys.length) {
    return [];
  }
  const entries = await Promise.all(keys.map((key: string) => outboxStore.getItem<OutboxEntry>(key)));
  return entries.filter((entry: OutboxEntry | null): entry is OutboxEntry => Boolean(entry));
}

export async function writeOutboxEntries(items: OutboxEntry[]) {
  const outboxStore = getOutboxStore();
  if (!items.length) {
    return;
  }
  await Promise.all(items.map((item) => outboxStore.setItem(item.client_event_id, item)));
}

export async function writeOutboxEntry(item: OutboxEntry) {
  const outboxStore = getOutboxStore();
  await outboxStore.setItem(item.client_event_id, item);
}

export async function deleteOutboxEntries(ids: string[]) {
  const outboxStore = getOutboxStore();
  if (!ids.length) {
    return;
  }
  await Promise.all(ids.map((id) => outboxStore.removeItem(id)));
}

export function computeBackoffMs(retryCount: number) {
  const base = 5000;
  const max = 5 * 60 * 1000;
  const delay = base * 2 ** Math.max(0, retryCount - 1);
  return Math.min(max, delay);
}

const NETWORK_ERROR_MESSAGES = ['failed to fetch', 'load failed', 'networkerror', 'network request failed'];

export function isLikelyNetworkFailure(lastError?: string) {
  if (!lastError) {
    return false;
  }
  const normalized = lastError.trim().toLowerCase();
  return NETWORK_ERROR_MESSAGES.some((message) => normalized.includes(message));
}

export function releaseNetworkBackoff(
  items: OutboxEntry[],
  params: { eventId: string; stationId: string; now: number },
) {
  let changed = false;
  const updated = items.map((item) => {
    if (
      item.event_id === params.eventId &&
      item.station_id === params.stationId &&
      item.state === 'failed' &&
      item.next_attempt_at > params.now &&
      isLikelyNetworkFailure(item.last_error)
    ) {
      changed = true;
      return { ...item, next_attempt_at: params.now };
    }
    return item;
  });

  return { updated, changed };
}

export async function enqueueStationScore(
  payload: Omit<StationScorePayload, 'client_event_id' | 'client_created_at'>,
  deps: {
    write: (entry: OutboxEntry) => Promise<void>;
    refresh: () => Promise<void>;
    flush: () => void;
    pushAlert: (message: string) => void;
    isOnline: () => boolean;
  },
  options?: { clientEventId?: string; nowIso?: string },
): Promise<boolean> {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const clientEventId = options?.clientEventId ?? generateClientEventId();
  const submission = buildStationScorePayload(payload, clientEventId, nowIso);
  const outboxEntry = buildOutboxEntry(submission, nowIso);
  try {
    await deps.write(outboxEntry);
    await deps.refresh();
    if (deps.isOnline()) {
      deps.flush();
    }
    return true;
  } catch (error) {
    console.error('Failed to persist submission queue', error);
    deps.pushAlert('Nepodařilo se uložit záznam do fronty. Zkus to prosím znovu.');
    return false;
  }
}

export async function flushOutboxBatch(params: {
  items: OutboxEntry[];
  eventId: string;
  stationId: string;
  accessToken: string;
  endpoint: string;
  fetchFn: typeof fetch;
  now: number;
  batchSize: number;
}) {
  const ready = params.items.filter(
    (item) =>
      item.event_id === params.eventId &&
      item.station_id === params.stationId &&
      (item.state === 'queued' || item.state === 'failed') &&
      item.next_attempt_at <= params.now,
  );
  if (!ready.length) {
    return { updated: params.items, sentIds: [] as string[] };
  }

  const batch = ready.slice(0, params.batchSize);
  const batchIds = new Set(batch.map((item) => item.client_event_id));
  const sendingItems = params.items.map<OutboxEntry>((item) =>
    batchIds.has(item.client_event_id) ? { ...item, state: 'sending' } : item,
  );

  const resultMap = new Map<string, OutboxEntry>();
  const sentIds: string[] = [];

  for (const item of batch) {
    try {
      const response = await params.fetchFn(params.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.accessToken}`,
        },
        body: JSON.stringify(item.payload),
      });

      let body: Record<string, unknown> | null = null;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        body = null;
      }

      if (response.ok) {
        sentIds.push(item.client_event_id);
        resultMap.set(item.client_event_id, {
          ...item,
          state: 'sent',
          last_error: undefined,
          response: body,
        });
        continue;
      }

      if (response.status === 401) {
        resultMap.set(item.client_event_id, {
          ...item,
          state: 'needs_auth',
          last_error: body?.error ? String(body.error) : 'missing-session',
          next_attempt_at: params.now,
        });
        continue;
      }

      if (response.status === 403) {
        resultMap.set(item.client_event_id, {
          ...item,
          state: 'blocked_other_session',
          last_error: body?.error ? String(body.error) : 'forbidden',
          next_attempt_at: params.now,
        });
        continue;
      }

      const retryCount = item.attempts + 1;
      resultMap.set(item.client_event_id, {
        ...item,
        state: 'failed',
        attempts: retryCount,
        last_error: body?.error ? String(body.error) : `HTTP ${response.status}`,
        next_attempt_at: params.now + computeBackoffMs(retryCount),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'network-error';
      const retryCount = item.attempts + 1;
      resultMap.set(item.client_event_id, {
        ...item,
        state: 'failed',
        attempts: retryCount,
        last_error: message,
        next_attempt_at: params.now + computeBackoffMs(retryCount),
      });
    }
  }

  const updated: OutboxEntry[] = sendingItems.map((item) => resultMap.get(item.client_event_id) ?? item);
  return { updated, sentIds };
}
