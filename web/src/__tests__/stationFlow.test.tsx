import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import localforage from 'localforage';
import type { ReactNode } from 'react';
import type { OutboxEntry, StationScorePayload } from '../outbox';
import { buildOutboxEntry, buildStationScorePayload, readOutbox, writeOutboxEntry } from '../outbox';
import { AuthProvider } from '../auth/context';
import { ROUTE_PREFIX } from '../routing';
import { getOutboxStore } from '../storage/localforage';

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
              in: () => ({
                maybeSingle: () => createMaybeSingle(),
              }),
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

  return { supabase };
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
    refreshTokens: vitest.fn().mockResolvedValue(false),
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
  const manualInput = screen.getByLabelText('Zadání z klávesnice');
  const paddedNumber = number.padStart(2, '0');
  await user.clear(manualInput);
  await user.type(manualInput, `${category}${type}-${paddedNumber}`);
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

  const choiceDialog = await screen.findByRole('dialog');
  const serveButton = within(choiceDialog).getByRole('button', { name: 'Obsluhovat' });
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

type StationScorePayloadInput = Omit<StationScorePayload, 'client_event_id' | 'client_created_at'>;

function createOutboxEntry(
  payloadOverrides: Partial<StationScorePayloadInput> = {},
  entryOverrides: Partial<OutboxEntry> = {},
) {
  const nowIso = entryOverrides.created_at ?? new Date('2024-01-01T10:00:00Z').toISOString();
  const clientEventId = entryOverrides.client_event_id ?? `client-${Math.random().toString(16).slice(2)}`;
  const payload = buildStationScorePayload(
    {
      event_id: 'event-test',
      station_id: 'station-test',
      patrol_id: 'patrol-queued',
      category: 'N',
      arrived_at: nowIso,
      wait_minutes: 5,
      points: 7,
      note: 'Offline záznam',
      use_target_scoring: false,
      normalized_answers: null,
      finish_time: null,
      patrol_code: 'N-99',
      team_name: 'Rysi',
      sex: 'F',
      ...payloadOverrides,
    },
    clientEventId,
    nowIso,
  );
  const baseEntry = buildOutboxEntry(payload, nowIso);
  return {
    ...baseEntry,
    ...entryOverrides,
    client_event_id: clientEventId,
    payload,
    event_id: payload.event_id,
    station_id: payload.station_id,
    created_at: entryOverrides.created_at ?? baseEntry.created_at,
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
    await getOutboxStore().clear();
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

    const pointsInput = await screen.findByLabelText('Body (0 až 12)');
    await user.clear(pointsInput);
    await user.type(pointsInput, '10');

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
      if (url.includes('submit-station-record')) {
        throw new Error('offline');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      } as any;
    });

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    expect(await screen.findByText(/Záznam uložen do fronty/)).toBeInTheDocument();
    expect(await screen.findByText(/Čeká na odeslání: 1/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zobrazit frontu' }));

    const queueLabel = await screen.findByText('Vlci (N-01)');
    expect(queueLabel).toBeInTheDocument();
    expect(screen.getByText('Manuální body')).toBeInTheDocument();
    expect(await screen.findByText(/Chyba:/)).toBeInTheDocument();
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

    const manualInput = screen.getByLabelText('Zadání z klávesnice');
    await user.clear(manualInput);
    await user.type(manualInput, 'NH-01');

    const loadButton = screen.getByRole('button', { name: 'Načíst hlídku' });
    expect(loadButton).toBeDisabled();

    await waitFor(() =>
      expect(
        screen.queryByText('Vyber kategorii, pohlaví a číslo hlídky.'),
      ).not.toBeInTheDocument(),
    );

    expect(screen.queryAllByRole('button', { name: 'Obsluhovat' }).length).toBe(0);
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
    expect(screen.queryAllByRole('button', { name: 'Obsluhovat' }).length).toBe(0);
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

    const choiceDialog = await screen.findByRole('dialog');
    await within(choiceDialog).findByRole('button', { name: 'Obsluhovat' });
    expect(screen.queryByText('Hlídka už na stanovišti byla.')).not.toBeInTheDocument();
  });

  it('rejects decimal values for manual scoring input', async () => {
    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

    await loadPatrolAndOpenForm(user);

    const pointsInput = await screen.findByLabelText('Body (0 až 12)');

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    expect(
      await screen.findByText('Body musí být celé číslo v rozsahu 0 až 12.'),
    ).toBeInTheDocument();
    expect(pointsInput).toHaveValue('');
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

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as any);

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
    const body = JSON.parse((init?.body as string) ?? '{}');
    expect(body.use_target_scoring).toBe(true);
    expect(body.normalized_answers).toBe('ABCDABCDABCD');
    expect(body.client_event_id).toBeTruthy();

    await waitFor(async () => {
      const storedQueue = await readOutbox();
      expect(storedQueue).toHaveLength(0);
    });
  });

  it('queues submission when sync endpoint reports failure', async () => {
    mockedStationCode = 'T';
    supabaseMock.__setMock('stations', () => createMaybeSingleResult({ code: 'T', name: 'Výpočetka' }));
    supabaseMock.__setMock(
      'station_category_answers',
      () => createSelectResult([{ category: 'N', correct_answers: 'ABCDABCDABCD' }])
    );

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server-error' }),
    } as any);

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

    const storedQueue = await readOutbox();
    expect(storedQueue).toHaveLength(1);
    const [queued] = storedQueue;
    expect(queued.attempts).toBe(1);
    expect(queued.last_error).toBe('server-error');
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

    const pointsInput = await screen.findByLabelText('Body (0 až 12)');
    await user.clear(pointsInput);
    await user.type(pointsInput, '10');

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    expect(await screen.findByText(/Čeká na odeslání: 1/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zobrazit frontu' }));
    expect(await screen.findByText(/Chyba: Session revoked/)).toBeInTheDocument();
    expect(
      await screen.findByText('Pro odeslání fronty se přihlas (1 čeká na přihlášení).'),
    ).toBeInTheDocument();

    const storedQueue = await readOutbox();
    expect(storedQueue).toHaveLength(1);
    expect(storedQueue[0]?.last_error).toBe('Session revoked');

  });

  it('synchronizes pending queue when connectivity is restored', async () => {
    const pendingEntry = createOutboxEntry(
      {},
      { client_event_id: 'op-sync-test', created_at: new Date('2024-01-01T10:00:00Z').toISOString() },
    );

    await writeOutboxEntry(pendingEntry);

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
    const storedQueue = await readOutbox();
    expect(storedQueue).toHaveLength(0);
  });

  it('marks submissions from other stations as blocked', async () => {
    const staleEntry = createOutboxEntry(
      { station_id: 'station-other', patrol_id: 'patrol-stale', note: 'Stará relace' },
      { client_event_id: 'op-stale-session', created_at: new Date('2024-03-01T09:00:00Z').toISOString() },
    );

    await writeOutboxEntry(staleEntry);

    await renderApp();

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());

    expect(await screen.findByText('Jiná relace: 1')).toBeInTheDocument();

    await waitFor(async () => {
      const storedQueue = await readOutbox();
      expect(storedQueue).toHaveLength(1);
      expect(storedQueue[0]?.state).toBe('blocked_other_session');
    });
  });

  it('shows other-session records in queue details', async () => {
    const staleEntry = createOutboxEntry(
      {
        event_id: 'event-other',
        patrol_id: 'patrol-stale',
        note: 'Stará relace',
        team_name: 'Lišky',
        patrol_code: 'N-98',
      },
      { client_event_id: 'op-stale-session-signature', created_at: new Date('2024-03-01T09:00:00Z').toISOString() },
    );

    await writeOutboxEntry(staleEntry);

    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Zobrazit frontu' }));

    expect(await screen.findByText('Jiná relace')).toBeInTheDocument();
    expect(screen.getByText('Neodesíláme')).toBeInTheDocument();
    expect(screen.getByText(/Záznam patří k jiné relaci/)).toBeInTheDocument();
  });

  it('flushes queued target quiz submission via sync endpoint', async () => {
    const pendingEntry = createOutboxEntry(
      {
        patrol_id: 'patrol-target',
        arrived_at: new Date('2024-02-01T09:15:00Z').toISOString(),
        wait_minutes: 0,
        points: 11,
        note: 'Terč offline',
        use_target_scoring: true,
        normalized_answers: 'ABCDABCDABCD',
        patrol_code: 'N-77',
        team_name: 'Ještěrky',
        sex: 'F',
      },
      { client_event_id: 'op-target-sync', created_at: new Date('2024-02-01T09:15:00Z').toISOString() },
    );

    await writeOutboxEntry(pendingEntry);

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
    const storedQueue = await readOutbox();
    expect(storedQueue).toHaveLength(0);
  });

  it('generates temporary code when patrol lacks official code', async () => {
    mockedPatrolCode = null;

    const user = userEvent.setup();

    await renderApp();

    await waitFor(() => expect(screen.getByText('Načtení hlídek')).toBeInTheDocument());

    await selectPatrolCode(user, { category: 'N', type: 'H', number: '1' });
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    const choiceDialog = await screen.findByRole('dialog');
    const quickAddButton = within(choiceDialog).getByRole('button', { name: 'Čekat' });

    await user.click(quickAddButton);

    expect(await screen.findByText('TMP-001')).toBeInTheDocument();
  });

  it('shows offline queue health widget', async () => {
    const user = userEvent.setup();
    await renderApp();

    const menuButtons = await screen.findAllByRole('button', { name: 'Otevřít menu' });
    await user.click(menuButtons[0]);
    const menuDialog = await screen.findByRole('dialog');
    expect(within(menuDialog).getByText('Síť')).toBeInTheDocument();
    expect(within(menuDialog).getByText('Online')).toBeInTheDocument();
    expect(within(menuDialog).getByText('Fronta')).toBeInTheDocument();
    expect(within(menuDialog).getByText('prázdná')).toBeInTheDocument();
  });
});
