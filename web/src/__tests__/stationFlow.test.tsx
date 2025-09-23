import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import localforage from 'localforage';

vi.stubEnv('VITE_EVENT_ID', 'event-test');
vi.stubEnv('VITE_STATION_ID', 'station-test');
vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test');

vi.mock('../supabaseClient', () => {
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

  const realtimeChannel = {
    on: () => realtimeChannel,
    subscribe: () => realtimeChannel,
  };

  return {
    supabase: {
      from(table: string) {
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
      },
      channel: () => realtimeChannel,
      removeChannel: () => undefined,
    },
  };
});

vi.mock('../components/QRScanner', () => ({
  default: () => <div data-testid="qr-scanner" />,
}));

describe('station workflow', () => {
  beforeEach(async () => {
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
    const pointsInput = screen.getByLabelText('Body (-12 až 12)');
    await user.clear(pointsInput);
    await user.type(pointsInput, '10');

    await user.click(screen.getByRole('button', { name: 'Uložit záznam' }));

    expect(await screen.findByText(/Čeká na odeslání: 1/)).toBeInTheDocument();

    expect(await screen.findByText(/Vlci/)).toBeInTheDocument();
    expect(screen.getByText(/N-01/)).toBeInTheDocument();
    expect(screen.getByText('Manuální body')).toBeInTheDocument();
  });
});
