import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import localforage from 'localforage';
import type { ReactNode } from 'react';
import { AuthProvider } from '../auth/context';
import { ROUTE_PREFIX } from '../routing';

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

  const registryRows = [
    { id: 'reg-nh-01', patrol_code: 'NH-01', category: 'N', sex: 'H', active: true },
    { id: 'reg-nd-01', patrol_code: 'ND-01', category: 'N', sex: 'D', active: true },
    { id: 'reg-mh-01', patrol_code: 'MH-01', category: 'M', sex: 'H', active: true },
    { id: 'reg-md-01', patrol_code: 'MD-01', category: 'M', sex: 'D', active: true },
    { id: 'reg-sh-01', patrol_code: 'SH-01', category: 'S', sex: 'H', active: true },
    { id: 'reg-sd-01', patrol_code: 'SD-01', category: 'S', sex: 'D', active: true },
    { id: 'reg-rh-01', patrol_code: 'RH-01', category: 'R', sex: 'H', active: true },
    { id: 'reg-rd-01', patrol_code: 'RD-01', category: 'R', sex: 'D', active: true },
  ];

  const buildDefault = (table: string) => {
    switch (table) {
      case 'station_category_answers':
        return {
          select: () => selectEmpty(),
        };
      case 'patrols': {
        const createOrderChain = () => {
          const result = Promise.resolve({ data: registryRows, error: null });
          const chain: any = {
            order: () => chain,
            then: result.then.bind(result),
            catch: result.catch.bind(result),
            finally: result.finally?.bind(result),
          };
          return chain;
        };

        const createMaybeSingle = () =>
          Promise.resolve({
            data: {
              id: 'patrol-1',
              team_name: 'Vlci',
              category: mockedPatrolCategory,
              sex: 'H',
              patrol_code: mockedPatrolCode,
            },
            error: null,
          });

        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => createMaybeSingle(),
              }),
              order: () => createOrderChain(),
            }),
            order: () => createOrderChain(),
          }),
        };
      }
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
      refreshSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
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

  return { supabase, setSupabaseAccessToken: vi.fn() };
});

vi.mock('../components/QRScanner', () => ({
  default: () => <div data-testid="qr-scanner" />,
}));

type CategoryKey = 'N' | 'M' | 'S' | 'R';

let mockedStationCode = 'X';
let mockedPatrolCode: string | null = 'N-01';
let mockedPatrolCategory: CategoryKey = 'N';
let mockedAllowedCategories: CategoryKey[] = ['N', 'M', 'S', 'R'];
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
      category: mockedPatrolCategory,
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
        name: mockedStationCode === 'T' ? 'Výpočetka' : 'Stanoviště X',
      },
      event: { id: 'event-test', name: 'Test Event', scoringLocked: false },
      allowedCategories: mockedAllowedCategories,
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

async function selectPatrolCode(
  user: ReturnType<typeof userEvent.setup>,
  {
    category,
    type,
    number,
  }: {
    category: 'N' | 'M' | 'S' | 'R';
    type: 'H' | 'D';
    number: string;
  },
) {
  const categoryGroup = screen.getByRole('listbox', { name: 'Kategorie' });
  const typeGroup = screen.getByRole('listbox', { name: 'Pohlaví (H = hoši, D = dívky)' });
  const numberGroup = screen.getByRole('listbox', { name: 'Číslo hlídky' });

  await user.click(within(categoryGroup).getByRole('option', { name: category }));
  await user.click(within(typeGroup).getByRole('option', { name: type }));
  const paddedNumber = number.padStart(2, '0');
  await user.click(within(numberGroup).getByRole('option', { name: paddedNumber }));
}

async function loadPatrolAndOpenForm(
  user: ReturnType<typeof userEvent.setup>,
  code: { category: 'N' | 'M' | 'S' | 'R'; type: 'H' | 'D'; number: string } = {
    category: 'N',
    type: 'H',
    number: '1',
  },
) {
  await selectPatrolCode(user, code);
  await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

  const serveButton = await screen.findByRole('button', { name: 'Obsluhovat' });
  await user.click(serveButton);

  if (mockedStationCode !== 'T') {
    const doneButton = await screen.findByRole('button', { name: 'Hotovo' });
    await user.click(doneButton);
  }
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
    window.history.replaceState({}, '', ROUTE_PREFIX);
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
    mockedPatrolCategory = 'N';
    mockedAllowedCategories = ['N', 'M', 'S', 'R'];
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

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

    await loadPatrolAndOpenForm(user);

    const pointsPicker = await screen.findByRole('listbox', { name: 'Body (0 až 12)' });
    await user.click(within(pointsPicker).getByRole('option', { name: '10 bodů' }));

    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    expect(await screen.findByText(/Záznam uložen do fronty/)).toBeInTheDocument();
    expect(await screen.findByText(/Čeká na odeslání: 1/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zobrazit frontu' }));

    const queueLabel = await screen.findByText('Vlci (N-01)');
    expect(queueLabel).toBeInTheDocument();
    expect(screen.getByText('Manuální body')).toBeInTheDocument();
    expect(screen.getByText(/Chyba:/)).toBeInTheDocument();
  });

  it('prevents loading patrols from disallowed categories', async () => {
    mockedStationCode = 'A';
    mockedAllowedCategories = ['M', 'S', 'R'];
    mockedPatrolCategory = 'N';
    mockedPatrolCode = 'NH-01';

    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

    await selectPatrolCode(user, { category: 'M', type: 'H', number: '1' });

    const categoryGroup = screen.getByRole('listbox', { name: 'Kategorie' });
    await user.click(within(categoryGroup).getByRole('option', { name: 'N' }));

    const loadButton = screen.getByRole('button', { name: 'Načíst hlídku' });
    expect(loadButton).toBeDisabled();

    await waitFor(() =>
      expect(
        screen.queryByText('Vyber kategorii, pohlaví a číslo hlídky.'),
      ).not.toBeInTheDocument(),
    );

    expect(screen.queryByRole('button', { name: 'Obsluhovat' })).not.toBeInTheDocument();
  });

  it('prevents loading patrols that already passed through the station', async () => {
    supabaseMock.__setMock(
      'station_passages',
      () => ({
        select: () => ({
          eq: () => ({
            eq: () =>
              Promise.resolve({
                data: [{ patrol_id: 'patrol-1' }],
                error: null,
              }),
          }),
        }),
        upsert: vi.fn(),
      }),
    );

    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

    await selectPatrolCode(user, { category: 'N', type: 'H', number: '1' });
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    expect(await screen.findByText('Hlídka už na stanovišti byla.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Obsluhovat' })).not.toBeInTheDocument();
  });

  it('allows loading patrols on Výpočetka even if already passed through', async () => {
    mockedStationCode = 'T';
    supabaseMock.__setMock('stations', () => createMaybeSingleResult({ code: 'T', name: 'Výpočetka' }));
    supabaseMock.__setMock(
      'station_passages',
      () => ({
        select: () => ({
          eq: () => ({
            eq: () =>
              Promise.resolve({
                data: [{ patrol_id: 'patrol-1' }],
                error: null,
              }),
          }),
        }),
        upsert: vi.fn(),
      }),
    );

    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

    await selectPatrolCode(user, { category: 'N', type: 'H', number: '1' });
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    await screen.findByRole('button', { name: 'Obsluhovat' });
    expect(screen.queryByText('Hlídka už na stanovišti byla.')).not.toBeInTheDocument();
  });

  it('rejects decimal values for manual scoring input', async () => {
    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

    await loadPatrolAndOpenForm(user);

    const pointsPicker = await screen.findByRole('listbox', { name: 'Body (0 až 12)' });

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    expect(
      await screen.findByText('Body musí být celé číslo v rozsahu 0 až 12.'),
    ).toBeInTheDocument();
    expect(within(pointsPicker).queryByRole('option', { selected: true })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Záznam uložen do fronty/)).not.toBeInTheDocument();
  });

  it('automatically scores target answers and saves quiz responses', async () => {
    mockedStationCode = 'T';
    supabaseMock.__setMock('stations', () => createMaybeSingleResult({ code: 'T', name: 'Výpočetka' }));
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

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());
    await loadPatrolAndOpenForm(user);

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
    expect(init?.headers?.Authorization).toBe('Bearer access-test');
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
    supabaseMock.__setMock('stations', () => createMaybeSingleResult({ code: 'T', name: 'Výpočetka' }));
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

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());
    await loadPatrolAndOpenForm(user);

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

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

    await loadPatrolAndOpenForm(user);

    const pointsPicker = await screen.findByRole('listbox', { name: 'Body (0 až 12)' });
    await user.click(within(pointsPicker).getByRole('option', { name: '10 bodů' }));

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    expect(await screen.findByText(/Čeká na odeslání: 1/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zobrazit frontu' }));
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

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

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

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

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

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

    await selectPatrolCode(user, { category: 'N', type: 'H', number: '1' });
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
