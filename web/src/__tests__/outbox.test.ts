import { describe, expect, it, vi } from 'vitest';
import {
  buildStationScorePayload,
  enqueueStationScore,
  flushOutboxBatch,
  isLikelyNetworkFailure,
  releaseNetworkBackoff,
  type OutboxEntry,
  type StationScorePayload,
} from '../outbox';

describe('outbox enqueue', () => {
  it('builds payload with client metadata', () => {
    const payload = buildStationScorePayload(
      {
        event_id: 'event-1',
        station_id: 'station-1',
        patrol_id: 'patrol-1',
        category: 'M',
        arrived_at: '2025-01-01T00:00:00.000Z',
        wait_minutes: 0,
        points: 5,
        note: '',
        use_target_scoring: false,
        normalized_answers: null,
        finish_time: null,
        patrol_code: 'MH-1',
        team_name: 'Test',
        sex: 'H',
      },
      'client-1',
      '2025-01-01T00:00:00.000Z',
    );

    expect(payload.client_event_id).toBe('client-1');
    expect(payload.client_created_at).toBe('2025-01-01T00:00:00.000Z');
  });

  it('writes to outbox before attempting network', async () => {
    const calls: string[] = [];
    const write = vi.fn(async () => {
      calls.push('write');
    });
    const refresh = vi.fn(async () => {
      calls.push('refresh');
    });
    const flush = vi.fn(() => {
      calls.push('flush');
    });
    const pushAlert = vi.fn();

    const payload = {
      event_id: 'event-1',
      station_id: 'station-1',
      patrol_id: 'patrol-1',
      category: 'M',
      arrived_at: new Date().toISOString(),
      wait_minutes: 0,
      points: 5,
      note: '',
      use_target_scoring: false,
      normalized_answers: null,
      finish_time: null,
      patrol_code: 'MH-1',
      team_name: 'Test',
      sex: 'H',
    } satisfies Omit<StationScorePayload, 'client_event_id' | 'client_created_at'>;

    const ok = await enqueueStationScore(
      payload,
      {
        write,
        refresh,
        flush,
        pushAlert,
        isOnline: () => true,
      },
      { clientEventId: 'client-1', nowIso: '2025-01-01T00:00:00.000Z' },
    );

    expect(ok).toBe(true);
    expect(calls).toEqual(['write', 'refresh', 'flush']);
  });

  it('does not duplicate the same client_event_id', async () => {
    const store = new Map<string, OutboxEntry>();
    const write = vi.fn(async (entry: OutboxEntry) => {
      // Localforage store uses client_event_id as key, so the same id overwrites.
      store.set(entry.client_event_id, entry);
    });
    const refresh = vi.fn(async () => {});
    const flush = vi.fn(() => {});
    const pushAlert = vi.fn();

    const payload = {
      event_id: 'event-1',
      station_id: 'station-1',
      patrol_id: 'patrol-1',
      category: 'M',
      arrived_at: '2025-01-01T00:00:00.000Z',
      wait_minutes: 0,
      points: 5,
      note: '',
      use_target_scoring: false,
      normalized_answers: null,
      finish_time: null,
      patrol_code: 'MH-1',
      team_name: 'Test',
      sex: 'H',
    } satisfies Omit<StationScorePayload, 'client_event_id' | 'client_created_at'>;

    await enqueueStationScore(
      payload,
      { write, refresh, flush, pushAlert, isOnline: () => false },
      { clientEventId: 'same-id', nowIso: '2025-01-01T00:00:00.000Z' },
    );
    await enqueueStationScore(
      payload,
      { write, refresh, flush, pushAlert, isOnline: () => false },
      { clientEventId: 'same-id', nowIso: '2025-01-01T00:00:01.000Z' },
    );

    expect(store.size).toBe(1);
  });
});

describe('outbox flush', () => {
  it('detects browser network failures from error message', () => {
    expect(isLikelyNetworkFailure('Load failed')).toBe(true);
    expect(isLikelyNetworkFailure('Failed to fetch')).toBe(true);
    expect(isLikelyNetworkFailure('HTTP 500')).toBe(false);
  });

  it('releases retry backoff after reconnect for network errors', () => {
    const now = Date.now();
    const item: OutboxEntry = {
      client_event_id: 'client-1',
      type: 'station_score',
      payload: buildStationScorePayload(
        {
          event_id: 'event-1',
          station_id: 'station-1',
          patrol_id: 'patrol-1',
          category: 'M',
          arrived_at: '2025-01-01T00:00:00.000Z',
          wait_minutes: 0,
          points: 5,
          note: '',
          use_target_scoring: false,
          normalized_answers: null,
          finish_time: null,
          patrol_code: 'MH-1',
          team_name: 'Test',
          sex: 'H',
        },
        'client-1',
        '2025-01-01T00:00:00.000Z',
      ),
      event_id: 'event-1',
      station_id: 'station-1',
      state: 'failed',
      attempts: 2,
      last_error: 'Load failed',
      next_attempt_at: now + 60_000,
      created_at: '2025-01-01T00:00:00.000Z',
      response: null,
    };

    const { updated, changed } = releaseNetworkBackoff([item], {
      eventId: 'event-1',
      stationId: 'station-1',
      now,
    });

    expect(changed).toBe(true);
    expect(updated[0]?.next_attempt_at).toBe(now);
  });

  it('keeps items when network fails', async () => {
    const item: OutboxEntry = {
      client_event_id: 'client-1',
      type: 'station_score',
      payload: buildStationScorePayload(
        {
          event_id: 'event-1',
          station_id: 'station-1',
          patrol_id: 'patrol-1',
          category: 'M',
          arrived_at: '2025-01-01T00:00:00.000Z',
          wait_minutes: 0,
          points: 5,
          note: '',
          use_target_scoring: false,
          normalized_answers: null,
          finish_time: null,
          patrol_code: 'MH-1',
          team_name: 'Test',
          sex: 'H',
        },
        'client-1',
        '2025-01-01T00:00:00.000Z',
      ),
      event_id: 'event-1',
      station_id: 'station-1',
      state: 'queued',
      attempts: 0,
      next_attempt_at: 0,
      created_at: '2025-01-01T00:00:00.000Z',
      response: null,
    };

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 }));

    const now = Date.now();
    const { updated, sentIds } = await flushOutboxBatch({
      items: [item],
      eventId: 'event-1',
      stationId: 'station-1',
      accessToken: 'token',
      endpoint: 'http://example.com',
      fetchFn,
      now,
      batchSize: 10,
    });

    expect(sentIds).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.state).toBe('failed');
    expect(updated[0]?.attempts).toBe(1);
  });

  it('removes items when network succeeds', async () => {
    const item: OutboxEntry = {
      client_event_id: 'client-1',
      type: 'station_score',
      payload: buildStationScorePayload(
        {
          event_id: 'event-1',
          station_id: 'station-1',
          patrol_id: 'patrol-1',
          category: 'M',
          arrived_at: '2025-01-01T00:00:00.000Z',
          wait_minutes: 0,
          points: 5,
          note: '',
          use_target_scoring: false,
          normalized_answers: null,
          finish_time: null,
          patrol_code: 'MH-1',
          team_name: 'Test',
          sex: 'H',
        },
        'client-1',
        '2025-01-01T00:00:00.000Z',
      ),
      event_id: 'event-1',
      station_id: 'station-1',
      state: 'queued',
      attempts: 0,
      next_attempt_at: 0,
      created_at: '2025-01-01T00:00:00.000Z',
      response: null,
    };

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { updated, sentIds } = await flushOutboxBatch({
      items: [item],
      eventId: 'event-1',
      stationId: 'station-1',
      accessToken: 'token',
      endpoint: 'http://example.com',
      fetchFn,
      now: Date.now(),
      batchSize: 10,
    });

    expect(sentIds).toEqual(['client-1']);
    expect(updated[0]?.state).toBe('sent');
    const retained = updated.filter((entry) => entry.state !== 'sent');
    expect(retained).toHaveLength(0);
  });
});
