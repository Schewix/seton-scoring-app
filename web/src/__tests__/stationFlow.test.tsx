import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import localforage from 'localforage';

vi.stubEnv('VITE_EVENT_ID', 'event-test');
vi.stubEnv('VITE_STATION_ID', 'station-test');
vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test');

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

import { supabase } from '../supabaseClient';

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

const QUEUE_KEY = 'web_pending_station_submissions_v1_station-test';

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
    supabaseMock.__resetMocks();
    vi.clearAllMocks();
    await localforage.clear();
    window.localStorage.clear();
  });

  it('stores offline submissions with queue preview details', async () => {
    const { default: App } = await import('../App');
    const user = userEvent.setup();

    render(<App />);

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('např. NH-15'), 'N-01');
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    await screen.findAllByText(/Vlci/);

    await user.type(screen.getByPlaceholderText('Jméno'), 'Honza');
    const pointsInput = screen.getByLabelText('Body (0 až 12)');
    await user.clear(pointsInput);
    await user.type(pointsInput, '10');

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    expect(await screen.findByText(/Čeká na odeslání: 1/)).toBeInTheDocument();

    expect(await screen.findByText(/Vlci/)).toBeInTheDocument();
    expect(screen.getByText(/N-01/)).toBeInTheDocument();
    expect(screen.getByText('Manuální body')).toBeInTheDocument();
  });

  it('automatically scores target answers and saves quiz responses', async () => {
    supabaseMock.__setMock('stations', () => createMaybeSingleResult({ code: 'T', name: 'Terčové stanoviště' }));
    supabaseMock.__setMock(
      'station_category_answers',
      () => createSelectResult([{ category: 'N', correct_answers: 'ABCDABCDABCD' }])
    );

    const passagesUpsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_passages', () => ({
      upsert: passagesUpsert,
    }));

    const scoresUpsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_scores', () => {
      const base = supabaseMock.__getDefault('station_scores') as Record<string, unknown>;
      return {
        ...base,
        upsert: scoresUpsert,
      };
    });

    const quizUpsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_quiz_responses', () => {
      const base = supabaseMock.__getDefault('station_quiz_responses') as Record<string, unknown>;
      return {
        ...base,
        upsert: quizUpsert,
      };
    });

    const { default: App } = await import('../App');
    const user = userEvent.setup();

    render(<App />);

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());
    await screen.findByText('Správné odpovědi');

    await user.type(screen.getByPlaceholderText('např. NH-15'), 'N-01');
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    await screen.findAllByText(/Vlci/);

    await user.type(screen.getByPlaceholderText('Jméno'), 'Ivana');

    const answersInput = await screen.findByLabelText('Odpovědi hlídky (12)');
    await user.type(answersInput, 'A B C D A B C D A B C D');

    await screen.findByText('Správně: 12 / 12');

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    await screen.findByText(/Uloženo: Vlci \(12 b\)/);

    expect(passagesUpsert).toHaveBeenCalledTimes(1);
    expect(scoresUpsert).toHaveBeenCalledTimes(1);
    expect(quizUpsert).toHaveBeenCalledTimes(1);

    const [passagePayload] = passagesUpsert.mock.calls.at(-1)!;
    expect(passagePayload).toMatchObject({ wait_minutes: 0 });

    const [scorePayload] = scoresUpsert.mock.calls.at(-1)!;
    expect(scorePayload).toMatchObject({ points: 12, judge: 'Ivana' });

    const [quizPayload] = quizUpsert.mock.calls.at(-1)!;
    expect(quizPayload).toMatchObject({
      answers: 'ABCDABCDABCD',
      correct_count: 12,
      category: 'N',
      patrol_id: 'patrol-1',
    });

    const storedQueue = await localforage.getItem(QUEUE_KEY);
    expect(storedQueue).toBeNull();
  });

  it('queues target quiz response when Supabase quiz upsert fails', async () => {
    supabaseMock.__setMock('stations', () => createMaybeSingleResult({ code: 'T', name: 'Terčové stanoviště' }));
    supabaseMock.__setMock(
      'station_category_answers',
      () => createSelectResult([{ category: 'N', correct_answers: 'ABCDABCDABCD' }])
    );

    const passagesUpsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_passages', () => ({
      upsert: passagesUpsert,
    }));

    const scoresUpsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_scores', () => {
      const base = supabaseMock.__getDefault('station_scores') as Record<string, unknown>;
      return {
        ...base,
        upsert: scoresUpsert,
      };
    });

    const quizUpsert = vi.fn().mockResolvedValue({ error: new Error('Offline failure') });
    supabaseMock.__setMock('station_quiz_responses', () => {
      const base = supabaseMock.__getDefault('station_quiz_responses') as Record<string, unknown>;
      return {
        ...base,
        upsert: quizUpsert,
      };
    });

    const { default: App } = await import('../App');
    const user = userEvent.setup();

    render(<App />);

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());
    await screen.findByText('Správné odpovědi');

    await user.type(screen.getByPlaceholderText('např. NH-15'), 'N-01');
    await user.click(screen.getByRole('button', { name: 'Načíst hlídku' }));

    await screen.findAllByText(/Vlci/);

    await user.type(screen.getByPlaceholderText('Jméno'), 'Ivana');

    const answersInput = await screen.findByLabelText('Odpovědi hlídky (12)');
    await user.type(answersInput, 'A B C D A B C D A B C D');

    await screen.findByText('Správně: 12 / 12');

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    await screen.findByText('Offline: odpovědi uložené do fronty.');
    await screen.findByText(/Čeká na odeslání: 1/);

    expect(passagesUpsert).toHaveBeenCalledTimes(1);
    expect(scoresUpsert).toHaveBeenCalledTimes(1);
    expect(quizUpsert).toHaveBeenCalledTimes(1);

    const storedQueue = (await localforage.getItem(QUEUE_KEY)) as unknown[] | null;
    expect(storedQueue).not.toBeNull();
    expect(storedQueue).toHaveLength(1);

    const [queued] = storedQueue!;
    expect(queued).toMatchObject({
      useTargetScoring: true,
      normalizedAnswers: 'ABCDABCDABCD',
      shouldDeleteQuiz: false,
      judge: 'Ivana',
      points: 12,
    });
  });

  it('synchronizes pending queue when connectivity is restored', async () => {
    const pendingItem = {
      event_id: 'event-test',
      station_id: 'station-test',
      patrol_id: 'patrol-queued',
      category: 'N',
      arrived_at: new Date('2024-01-01T10:00:00Z').toISOString(),
      wait_minutes: 5,
      points: 7,
      judge: 'Jana',
      note: 'Offline záznam',
      useTargetScoring: false,
      normalizedAnswers: null,
      shouldDeleteQuiz: true,
      patrol_code: 'N-99',
      team_name: 'Rysi',
      sex: 'F',
    };

    await localforage.setItem(QUEUE_KEY, [pendingItem]);

    const passagesUpsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_passages', () => ({
      upsert: passagesUpsert,
    }));

    const scoresUpsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_scores', () => {
      const base = supabaseMock.__getDefault('station_scores') as Record<string, unknown>;
      return {
        ...base,
        upsert: scoresUpsert,
      };
    });

    const deleteMatch = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_quiz_responses', () => {
      const base = supabaseMock.__getDefault('station_quiz_responses') as Record<string, unknown>;
      return {
        ...base,
        delete: () => ({
          match: (filters: unknown) => deleteMatch(filters),
        }),
      };
    });

    const { default: App } = await import('../App');

    render(<App />);

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());
    await screen.findByText(/Synchronizováno 1 záznamů\./);

    expect(passagesUpsert).toHaveBeenCalledTimes(1);
    expect(scoresUpsert).toHaveBeenCalledTimes(1);
    expect(deleteMatch).toHaveBeenCalledTimes(1);

    const [passagePayload] = passagesUpsert.mock.calls[0];
    expect(passagePayload).toMatchObject({
      patrol_id: 'patrol-queued',
      wait_minutes: 5,
    });

    const [scorePayload] = scoresUpsert.mock.calls[0];
    expect(scorePayload).toMatchObject({
      patrol_id: 'patrol-queued',
      points: 7,
      judge: 'Jana',
    });

    expect(deleteMatch).toHaveBeenCalledWith({
      event_id: 'event-test',
      station_id: 'station-test',
      patrol_id: 'patrol-queued',
    });

    const storedQueue = await localforage.getItem(QUEUE_KEY);
    expect(storedQueue).toBeNull();
  });

  it('uploads queued target quiz responses during synchronization', async () => {
    const pendingItem = {
      event_id: 'event-test',
      station_id: 'station-test',
      patrol_id: 'patrol-target',
      category: 'N',
      arrived_at: new Date('2024-02-01T09:15:00Z').toISOString(),
      wait_minutes: 0,
      points: 11,
      judge: 'Roman',
      note: 'Terč offline',
      useTargetScoring: true,
      normalizedAnswers: 'ABCDABCDABCD',
      shouldDeleteQuiz: false,
      patrol_code: 'N-77',
      team_name: 'Ještěrky',
      sex: 'F',
    };

    await localforage.setItem(QUEUE_KEY, [pendingItem]);

    const passagesUpsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_passages', () => ({
      upsert: passagesUpsert,
    }));

    const scoresUpsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_scores', () => {
      const base = supabaseMock.__getDefault('station_scores') as Record<string, unknown>;
      return {
        ...base,
        upsert: scoresUpsert,
      };
    });

    const quizUpsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.__setMock('station_quiz_responses', () => {
      const base = supabaseMock.__getDefault('station_quiz_responses') as Record<string, unknown>;
      return {
        ...base,
        upsert: quizUpsert,
      };
    });

    const { default: App } = await import('../App');

    render(<App />);

    await waitFor(() => expect(screen.getByText('Skener hlídek')).toBeInTheDocument());
    await screen.findByText(/Synchronizováno 1 záznamů\./);

    expect(passagesUpsert).toHaveBeenCalledTimes(1);
    expect(scoresUpsert).toHaveBeenCalledTimes(1);
    expect(quizUpsert).toHaveBeenCalledTimes(1);

    const [quizPayload] = quizUpsert.mock.calls.at(-1)!;
    expect(quizPayload).toMatchObject({
      event_id: 'event-test',
      station_id: 'station-test',
      patrol_id: 'patrol-target',
      answers: 'ABCDABCDABCD',
      correct_count: 11,
      category: 'N',
    });

    const storedQueue = await localforage.getItem(QUEUE_KEY);
    expect(storedQueue).toBeNull();
  });
});
