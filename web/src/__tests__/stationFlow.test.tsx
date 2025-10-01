import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import localforage from 'localforage';
import type { ReactNode } from 'react';
import { AuthProvider } from '../auth/context';

const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }));

vi.stubEnv('VITE_EVENT_ID', 'event-test');
vi.stubEnv('VITE_STATION_ID', 'station-test');
vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test');
vi.stubEnv('VITE_AUTH_BYPASS', '1');
vi.stubEnv('VITE_STATION_CODE', 'X');

vi.mock('../supabaseClient', () => {
  const tableFactories = new Map<string, () => unknown>();

  const selectEmpty = () => ({
    eq: () => ({
      eq: () => Promise.resolve({ data: [], error: null }),
    }),
  });

  const listScores = () => ({
    eq: () => ({
      eq: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  });

  const realtimeChannel: any = {};
  realtimeChannel.on = () => realtimeChannel;
  realtimeChannel.subscribe = () => realtimeChannel;

  const buildDefault = (table: string) => {
    switch (table) {
      case 'station_category_answers':
        return {
          select: () => selectEmpty(),
        };
      case 'patrols':
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: 'patrol-1',
                      team_name: 'Vlci',
                      category: 'N',
                      sex: 'H',
                      patrol_code: mockedPatrolCode,
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      case 'stations':
        return {
          select: () => {
            const listResult = Promise.resolve({
              data: [{ id: 'station-test', code: 'X', name: 'Testovací stanoviště' }],
              error: null,
            });
            const maybeSingleResult = Promise.resolve({
              data: { code: 'X', name: 'Testovací stanoviště' },
              error: null,
            });
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => maybeSingleResult,
                }),
                order: () => listResult,
              }),
              order: () => listResult,
            };
          },
        };
      case 'station_passages':
        return {
          upsert: () => Promise.resolve({ error: new Error('Offline') }),
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      case 'station_scores':
        return {
          upsert: () => Promise.resolve({ error: new Error('Offline') }),
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: () => Promise.resolve({ data: [], error: null }),
          select: () => {
            const finalResult = Promise.resolve({ data: [], error: null });
            const orderObj = {
              limit: () => finalResult,
            };
            const secondEqObj: any = {
              order: () => orderObj,
              then: finalResult.then.bind(finalResult),
              catch: finalResult.catch.bind(finalResult),
              finally: finalResult.finally?.bind(finalResult),
            };
            return {
              eq: () => ({
                eq: () => secondEqObj,
                order: () => orderObj,
              }),
            };
          },
        };
      case 'station_quiz_responses':
        return {
          upsert: () => Promise.resolve({ error: new Error('Offline') }),
          delete: () => ({
            match: () => Promise.resolve({ error: new Error('Offline') }),
          }),
          select: () => {
            const result = Promise.resolve({ data: [], error: null });
            const ordered = Object.assign(result, {
              order: () => result,
            });
            const secondEq = {
              eq: () => ordered,
            };
            return {
              eq: () => secondEq,
            };
          },
        };
      case 'timings':
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data:
                    mockedStartTime !== null
                      ? [
                        {
                          start_time: mockedStartTime,
                          finish_time: mockedFinishTime,
                        },
                      ]
                      : [],
                  error: null,
                }),
            }),
          }),
        };
      default:
        return {
          select: () => selectEmpty(),
        };
    }
  };

  const supabase = {
    from(table: string) {
      const factory = tableFactories.get(table);
      if (factory) {
        return factory();
      }
      return buildDefault(table);
    },
    channel: () => realtimeChannel,
    removeChannel: () => undefined,
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: {
            access_token: 'session-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        },
        error: null,
      })),
    },
    __setMock(table: string, factory: () => unknown) {
      tableFactories.set(table, factory);
    },
    __resetMocks() {
      tableFactories.clear();
    },
    __getDefault(table: string) {
      return buildDefault(table);
    },
  };

  return { supabase };
});

vi.mock('../components/QRScanner', () => ({
  default: () => <div data-testid="qr-scanner" />,
}));

let mockedStationCode = 'X';
let mockedPatrolCode: string | null = 'N-01';
let mockedStartTime: string | null = '2024-02-01T08:00:00Z';
let mockedFinishTime: string | null = '2024-02-01T08:45:00Z';
const mockDeviceKey = new Uint8Array(32);
const fetchMock = vi.fn();

vi.mock('../auth/context', async () => {
  const { vi: vitest } = await import('vitest');
  const mockPatrols = () => [
    {
      id: 'patrol-1',
      team_name: 'Vlci',
      category: 'N',
      sex: 'H',
      patrol_code: mockedPatrolCode,
    },
  ];

  function buildManifest() {
    return {
      judge: { id: 'judge-test', email: 'test@example.com', displayName: 'Test Judge' },
      station: {
        id: 'station-test',
        code: mockedStationCode,
        name: mockedStationCode === 'T' ? 'Terčové stanoviště' : 'Stanoviště X',
      },
      event: { id: 'event-test', name: 'Test Event' },
      allowedCategories: ['N', 'M', 'S', 'R'],
      allowedTasks: [],
      manifestVersion: 1,
    };
  }

  const contextValue = {
    login: vitest.fn(),
    unlock: vitest.fn(),
    logout: logoutMock,
    updateManifest: vitest.fn(),
    refreshManifest: vitest.fn().mockResolvedValue(undefined),
    get status() {
      return {
        state: 'authenticated' as const,
        manifest: buildManifest(),
        patrols: mockPatrols(),
        deviceKey: mockDeviceKey,
        tokens: {
          accessToken: 'access-test',
          accessTokenExpiresAt: Date.now() + 3600 * 1000,
          refreshToken: 'refresh-test',
          sessionId: 'session-test',
        },
      };
    },
  };

  return {
    useAuth: () => contextValue,
    AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

import { supabase } from '../supabaseClient';

async function flushMicrotasks() {
  return Promise.resolve();
}

async function renderApp() {
  const { default: App } = await import('../App');
  await act(async () => {
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    await flushMicrotasks();
  });
}

type TableFactory = () => unknown;

interface SupabaseTestClient {
  from: (table: string) => unknown;
  channel: () => unknown;
  removeChannel: (channel: unknown) => void;
  __setMock: (table: string, factory: TableFactory) => void;
  __resetMocks: () => void;
  __getDefault: (table: string) => unknown;
}

const supabaseMock = supabase as unknown as SupabaseTestClient;

const QUEUE_KEY = 'web_pending_ops_v1_station-test';

const realSetTimeout = global.setTimeout;
const realSetInterval = global.setInterval;

function createMaybeSingleResult<T>(data: T, error: unknown = null) {
  const row = {
    id: 'station-test',
    code: (data as unknown as { code?: string }).code ?? 'X',
    name: (data as unknown as { name?: string | null }).name ?? null,
  };
  const listResult = Promise.resolve({ data: [row], error: null });
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error }),
        }),
        order: () => listResult,
      }),
      order: () => listResult,
    }),
  };
}

function createSelectResult<T>(data: T, error: unknown = null) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => Promise.resolve({ data, error }),
      }),
    }),
  };
}

// Loosened typing to avoid Vitest version-specific type mismatches
let timeoutSpy: any;
let intervalSpy: any;
let scrollIntoViewSpy: any;

describe('station workflow', () => {
  beforeEach(async () => {
    timeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (typeof handler !== 'function') {
          return realSetTimeout(handler, timeout, ...(args as Parameters<typeof setTimeout>));
        }
        return realSetTimeout(
          ((...innerArgs: unknown[]) => {
            act(() => {
              (handler as (...cbArgs: unknown[]) => void)(...innerArgs);
            });
          }) as TimerHandler,
          timeout,
          ...(args as Parameters<typeof setTimeout>),
        );
      }) as typeof setTimeout);

    intervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (typeof handler !== 'function') {
          return realSetInterval(handler, timeout, ...(args as Parameters<typeof setInterval>));
        }
        return realSetInterval(
          ((...innerArgs: unknown[]) => {
            act(() => {
              (handler as (...cbArgs: unknown[]) => void)(...innerArgs);
            });
          }) as TimerHandler,
          timeout,
          ...(args as Parameters<typeof setInterval>),
        );
      }) as typeof setInterval);

    mockedStationCode = 'X';
    mockedPatrolCode = 'N-01';
    mockedStartTime = '2024-02-01T08:00:00Z';
    mockedFinishTime = '2024-02-01T08:45:00Z';
    supabaseMock.__resetMocks();
    vi.clearAllMocks();
    fetchMock.mockReset();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    await localforage.clear();
    window.localStorage.clear();
    if (typeof Element !== 'undefined') {
      const proto = Element.prototype as Element & { scrollIntoView?: () => void };
      if (typeof proto.scrollIntoView !== 'function') {
        Object.defineProperty(proto, 'scrollIntoView', {
          value: () => {},
          configurable: true,
          writable: true,
        });
      }
      scrollIntoViewSpy = vi.spyOn(proto, 'scrollIntoView').mockImplementation(() => {});
    } else {
      scrollIntoViewSpy = null;
    }
  });

  afterEach(() => {
    timeoutSpy?.mockRestore();
    intervalSpy?.mockRestore();
    scrollIntoViewSpy?.mockRestore();
  });

  it('stores offline submissions with queue preview details', async () => {
    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('např. NH-15'), 'N-01');
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    const pointsInput = screen.getByLabelText('Body (0 až 12)');
    await user.clear(pointsInput);
    await user.type(pointsInput, '10');

    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    expect(await screen.findByText(/Záznam uložen do fronty/)).toBeInTheDocument();
    expect(await screen.findByText(/Čeká na odeslání: 1/)).toBeInTheDocument();

    const queueLabel = await screen.findByText('Vlci (N-01)');
    expect(queueLabel).toBeInTheDocument();
    expect(screen.getByText(/N-01/)).toBeInTheDocument();
    expect(screen.getByText('Manuální body')).toBeInTheDocument();
    expect(screen.getByText(/Chyba:/)).toBeInTheDocument();
  });

  it('automatically scores target answers and saves quiz responses', async () => {
    mockedStationCode = 'T';
    supabaseMock.__setMock('stations', () => createMaybeSingleResult({ code: 'T', name: 'Terčové stanoviště' }));
    supabaseMock.__setMock(
      'station_category_answers',
      () => createSelectResult([{ category: 'N', correct_answers: 'ABCDABCDABCD' }])
    );

    fetchMock.mockImplementation(async (_input, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      const results = (body.operations ?? []).map((op: { id: string }) => ({ id: op.id, status: 'done' as const }));
      return {
        ok: true,
        status: 200,
        json: async () => ({ results }),
      } as any;
    });

    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());
    await screen.findByText('Správné odpovědi');

    await user.type(screen.getByPlaceholderText('např. NH-15'), 'N-01');
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    await screen.findAllByText(/Vlci/);

    const answersInput = await screen.findByLabelText('Odpovědi hlídky (12)');
    await user.type(answersInput, 'A B C D A B C D A B C D');

    await screen.findByText('Správně: 12 / 12');

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    await screen.findByText(/Záznam uložen do fronty/);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.queryByText(/Čeká na odeslání:/)).not.toBeInTheDocument();
    });
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(init?.headers?.Authorization).toBeUndefined();
    expect(init?.credentials).toBe('include');
    const body = JSON.parse((init?.body as string) ?? '{}');
    expect(body.operations).toHaveLength(1);

    await waitFor(async () => {
      const storedQueue = await localforage.getItem(QUEUE_KEY);
      expect(storedQueue).toBeNull();
    });
  });

  it('queues submission when sync endpoint reports failure', async () => {
    mockedStationCode = 'T';
    supabaseMock.__setMock('stations', () => createMaybeSingleResult({ code: 'T', name: 'Terčové stanoviště' }));
    supabaseMock.__setMock(
      'station_category_answers',
      () => createSelectResult([{ category: 'N', correct_answers: 'ABCDABCDABCD' }])
    );

    fetchMock.mockImplementation(async (_input, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      const results = (body.operations ?? []).map((op: { id: string }) => ({
        id: op.id,
        status: 'failed' as const,
        error: 'server-error',
      }));
      return {
        ok: true,
        status: 200,
        json: async () => ({ results }),
      } as any;
    });

    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());
    await screen.findByText('Správné odpovědi');

    await user.type(screen.getByPlaceholderText('např. NH-15'), 'N-01');
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    await screen.findAllByText(/Vlci/);

    const answersInput = await screen.findByLabelText('Odpovědi hlídky (12)');
    await user.type(answersInput, 'A B C D A B C D A B C D');

    await screen.findByText('Správně: 12 / 12');

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    await screen.findByText(/Záznam uložen do fronty/);
    await screen.findByText(/Čeká na odeslání: 1/);

    const storedQueue = (await localforage.getItem(QUEUE_KEY)) as any[] | null;
    expect(storedQueue).not.toBeNull();
    expect(storedQueue).toHaveLength(1);
    const [queued] = storedQueue!;
    expect(queued.retryCount).toBe(1);
    expect(queued.lastError).toBe('server-error');
  });

  it('forces logout when sync endpoint responds with unauthorized error', async () => {
    const user = userEvent.setup();

    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Session revoked' }),
    } as any);

    await renderApp();

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('např. NH-15'), 'N-01');
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    const pointsInput = screen.getByLabelText('Body (0 až 12)');
    await user.clear(pointsInput);
    await user.type(pointsInput, '10');

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    expect(await screen.findByText(/Čeká na odeslání: 1/)).toBeInTheDocument();
    expect(await screen.findByText(/Chyba: Session revoked/)).toBeInTheDocument();
    expect(await screen.findByText('Přihlášení vypršelo, přihlas se prosím znovu.')).toBeInTheDocument();

    const storedQueue = (await localforage.getItem(QUEUE_KEY)) as any[] | null;
    expect(storedQueue).not.toBeNull();
    expect(storedQueue).toHaveLength(1);
    expect(storedQueue?.[0]?.lastError).toBe('Session revoked');

    await waitFor(() => expect(logoutMock).toHaveBeenCalled());
  });

  it('synchronizes pending queue when connectivity is restored', async () => {
    const pendingOperation = {
      id: 'op-sync-test',
      type: 'submission' as const,
      payload: {
        event_id: 'event-test',
        station_id: 'station-test',
        patrol_id: 'patrol-queued',
        category: 'N',
        arrived_at: new Date('2024-01-01T10:00:00Z').toISOString(),
        wait_minutes: 5,
        points: 7,
        note: 'Offline záznam',
        useTargetScoring: false,
        normalizedAnswers: null,
        shouldDeleteQuiz: true,
        patrol_code: 'N-99',
        team_name: 'Rysi',
        sex: 'F',
        finish_time: null,
        manifest_version: 1,
      },
      signature: 'offline-signature',
      signature_payload: '{}',
      created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
      inProgress: false,
      retryCount: 0,
      nextAttemptAt: Date.now(),
      sessionId: 'session-test',
    };

    await localforage.setItem(QUEUE_KEY, [pendingOperation]);

    fetchMock.mockImplementation(async (_input, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      const results = (body.operations ?? []).map((op: { id: string }) => ({ id: op.id, status: 'done' as const }));
      return {
        ok: true,
        status: 200,
        json: async () => ({ results }),
      } as any;
    });

    await renderApp();

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByText(/Čeká na odeslání:/)).not.toBeInTheDocument();
    });
    const storedQueue = await localforage.getItem(QUEUE_KEY);
    expect(storedQueue).toBeNull();
  });

  it('removes submissions from previous sessions before syncing', async () => {
    const staleOperation = {
      id: 'op-stale-session',
      type: 'submission' as const,
      payload: {
        event_id: 'event-test',
        station_id: 'station-test',
        patrol_id: 'patrol-stale',
        category: 'N',
        arrived_at: new Date('2024-03-01T09:00:00Z').toISOString(),
        wait_minutes: 3,
        points: 5,
        note: 'Stará relace',
        useTargetScoring: false,
        normalizedAnswers: null,
        shouldDeleteQuiz: true,
        patrol_code: 'N-98',
        team_name: 'Lišky',
        sex: 'F',
        finish_time: null,
        manifest_version: 1,
      },
      signature: 'stale-signature',
      signature_payload: '{}',
      created_at: new Date('2024-03-01T09:00:00Z').toISOString(),
      inProgress: false,
      retryCount: 0,
      nextAttemptAt: Date.now(),
      sessionId: 'other-session',
    };

    await localforage.setItem(QUEUE_KEY, [staleOperation]);

    await renderApp();

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());

    const alerts = await screen.findAllByText(
      'Odebrán 1 záznam z dřívější relace – nelze jej odeslat.',
    );
    expect(alerts.length).toBeGreaterThanOrEqual(1);

    await waitFor(async () => {
      const storedQueue = await localforage.getItem(QUEUE_KEY);
      expect(storedQueue).toBeNull();
    });
  });

  it('removes submissions from previous sessions using signature metadata when payload is missing', async () => {
    const signaturePayload = {
      version: 1,
      manifest_version: 1,
      session_id: 'other-session',
      judge_id: 'judge-test',
      station_id: 'station-test',
      event_id: 'event-test',
      signed_at: new Date('2024-03-01T09:00:00Z').toISOString(),
      data: {
        event_id: 'event-test',
        station_id: 'station-test',
        patrol_id: 'patrol-stale',
        category: 'N',
        arrived_at: new Date('2024-03-01T09:00:00Z').toISOString(),
        wait_minutes: 3,
        points: 5,
        note: 'Stará relace',
        use_target_scoring: false,
        normalized_answers: null,
        finish_time: null,
        patrol_code: 'N-98',
      },
    };

    const staleOperation = {
      id: 'op-stale-session-signature',
      type: 'submission' as const,
      payload: {
        event_id: 'event-test',
        station_id: 'station-test',
        patrol_id: 'patrol-stale',
        category: 'N',
        arrived_at: new Date('2024-03-01T09:00:00Z').toISOString(),
        wait_minutes: 3,
        points: 5,
        note: 'Stará relace',
        useTargetScoring: false,
        normalizedAnswers: null,
        shouldDeleteQuiz: true,
        patrol_code: 'N-98',
        team_name: 'Lišky',
        sex: 'F',
        finish_time: null,
        manifest_version: 1,
      } as any,
      signature: 'stale-signature',
      signature_payload: JSON.stringify(signaturePayload),
      created_at: new Date('2024-03-01T09:00:00Z').toISOString(),
      inProgress: false,
      retryCount: 0,
      nextAttemptAt: Date.now(),
    };

    await localforage.setItem(QUEUE_KEY, [staleOperation]);

    await renderApp();

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());

    const alerts = await screen.findAllByText(
      'Odebrán 1 záznam z dřívější relace – nelze jej odeslat.',
    );
    expect(alerts.length).toBeGreaterThanOrEqual(1);

    await waitFor(async () => {
      const storedQueue = await localforage.getItem(QUEUE_KEY);
      expect(storedQueue).toBeNull();
    });
  });

  it('flushes queued target quiz submission via sync endpoint', async () => {
    const pendingOperation = {
      id: 'op-target-sync',
      type: 'submission' as const,
      payload: {
        event_id: 'event-test',
        station_id: 'station-test',
        patrol_id: 'patrol-target',
        category: 'N',
        arrived_at: new Date('2024-02-01T09:15:00Z').toISOString(),
        wait_minutes: 0,
        points: 11,
        note: 'Terč offline',
        useTargetScoring: true,
        normalizedAnswers: 'ABCDABCDABCD',
        shouldDeleteQuiz: false,
        patrol_code: 'N-77',
        team_name: 'Ještěrky',
        sex: 'F',
        finish_time: null,
        manifest_version: 1,
      },
      signature: 'offline-signature',
      signature_payload: '{}',
      created_at: new Date('2024-02-01T09:15:00Z').toISOString(),
      inProgress: false,
      retryCount: 0,
      nextAttemptAt: Date.now(),
      sessionId: 'session-test',
    };

    await localforage.setItem(QUEUE_KEY, [pendingOperation]);

    fetchMock.mockImplementation(async (_input, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      const results = (body.operations ?? []).map((op: { id: string }) => ({ id: op.id, status: 'done' as const }));
      return {
        ok: true,
        status: 200,
        json: async () => ({ results }),
      } as any;
    });

    await renderApp();

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByText(/Čeká na odeslání:/)).not.toBeInTheDocument();
    });
    const storedQueue = await localforage.getItem(QUEUE_KEY);
    expect(storedQueue).toBeNull();
  });

  it('generates temporary code when patrol lacks official code', async () => {
    mockedPatrolCode = null;

    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('např. NH-15'), 'N-01');
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    const quickAddButton = await screen.findByRole('button', { name: 'Čekat' });

    await user.click(quickAddButton);

    expect(await screen.findByText('TMP-001')).toBeInTheDocument();
  });

  it('shows offline queue health widget', async () => {
    await renderApp();

    const widget = await screen.findByLabelText('Stav offline fronty');
    expect(within(widget).getByText('Síť:')).toBeInTheDocument();
    expect(within(widget).getByText('Online')).toBeInTheDocument();
    expect(within(widget).getByText('Fronta:')).toBeInTheDocument();
    expect(within(widget).getByText('prázdná')).toBeInTheDocument();
  });
});
