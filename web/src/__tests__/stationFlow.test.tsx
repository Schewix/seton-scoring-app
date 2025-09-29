import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import localforage from 'localforage';
import type { ReactNode } from 'react';
import { AuthProvider } from '../auth/context';

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
                      sex: 'M',
                      patrol_code: 'N-01',
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
        };
      case 'station_scores':
        return {
          upsert: () => Promise.resolve({ error: new Error('Offline') }),
          select: () => listScores(),
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
const mockDeviceKey = new Uint8Array(32);
const fetchMock = vi.fn();

vi.mock('../auth/context', async () => {
  const { vi: vitest } = await import('vitest');
  const mockPatrols = [
    {
      id: 'patrol-1',
      team_name: 'Vlci',
      category: 'N',
      sex: 'H',
      patrol_code: 'N-01',
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
    logout: vitest.fn(),
    updateManifest: vitest.fn(),
    refreshManifest: vitest.fn().mockResolvedValue(undefined),
    get status() {
      return {
        state: 'authenticated' as const,
        manifest: buildManifest(),
        patrols: mockPatrols,
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

async function renderApp() {
  const { default: App } = await import('../App');
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
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

describe('station workflow', () => {
  beforeEach(async () => {
    mockedStationCode = 'X';
    supabaseMock.__resetMocks();
    vi.clearAllMocks();
    fetchMock.mockReset();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    await localforage.clear();
    window.localStorage.clear();
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
    expect(init?.headers?.Authorization).toContain('Bearer');
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
        judge: 'Test Judge',
        note: 'Offline záznam',
        useTargetScoring: false,
        normalizedAnswers: null,
        shouldDeleteQuiz: true,
        patrol_code: 'N-99',
        team_name: 'Rysi',
        sex: 'F',
        finish_time: null,
        judge_id: 'judge-test',
        session_id: 'session-test',
        manifest_version: 1,
      },
      signature: 'offline-signature',
      signature_payload: '{}',
      created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
      inProgress: false,
      retryCount: 0,
      nextAttemptAt: Date.now(),
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
        judge: 'Test Judge',
        note: 'Terč offline',
        useTargetScoring: true,
        normalizedAnswers: 'ABCDABCDABCD',
        shouldDeleteQuiz: false,
        patrol_code: 'N-77',
        team_name: 'Ještěrky',
        sex: 'F',
        finish_time: null,
        judge_id: 'judge-test',
        session_id: 'session-test',
        manifest_version: 1,
      },
      signature: 'offline-signature',
      signature_payload: '{}',
      created_at: new Date('2024-02-01T09:15:00Z').toISOString(),
      inProgress: false,
      retryCount: 0,
      nextAttemptAt: Date.now(),
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
});
