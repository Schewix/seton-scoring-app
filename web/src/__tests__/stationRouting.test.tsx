import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AuthStatus } from '../auth/types';
import { getStationPath } from '../routing';

let useStationRouting: (status: AuthStatus) => void;

type HookProps = { status: AuthStatus };

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  ({ useStationRouting } = await import('../App'));
});

describe('useStationRouting', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('redirects to station path after authentication', () => {
    const initialStatus: AuthStatus = { state: 'loading' };
    const stationStatus: AuthStatus = {
      state: 'authenticated',
      manifest: {
        judge: { id: 'judge-1', email: 'judge@example.com', displayName: 'Test Judge' },
        station: { id: 'station-123', code: 'X', name: 'Stanoviště X' },
        event: { id: 'event-1', name: 'Test Event' },
        allowedCategories: [],
        allowedTasks: [],
        manifestVersion: 1,
      },
      patrols: [],
      deviceKey: new Uint8Array(0),
      tokens: {
        accessToken: 'access',
        accessTokenExpiresAt: Date.now() + 1,
        refreshToken: 'refresh',
        sessionId: 'session',
      },
    };

    const { rerender } = renderHook<void, HookProps>(({ status }) => {
      useStationRouting(status);
    }, {
      initialProps: { status: initialStatus },
    });

    rerender({ status: stationStatus });

    expect(window.location.pathname).toBe(getStationPath('Stanoviště X'));
  });

  it('creates slug from station name with diacritics', () => {
    expect(getStationPath('Střelba z foukačky')).toBe(
      '/setonuv-zavod/stanoviste/strelba-z-foukacky',
    );
  });

  it('clears station path when returning to login', () => {
    const stationStatus: AuthStatus = {
      state: 'authenticated',
      manifest: {
        judge: { id: 'judge-1', email: 'judge@example.com', displayName: 'Test Judge' },
        station: { id: 'station-123', code: 'X', name: 'Stanoviště X' },
        event: { id: 'event-1', name: 'Test Event' },
        allowedCategories: [],
        allowedTasks: [],
        manifestVersion: 1,
      },
      patrols: [],
      deviceKey: new Uint8Array(0),
      tokens: {
        accessToken: 'access',
        accessTokenExpiresAt: Date.now() + 1,
        refreshToken: 'refresh',
        sessionId: 'session',
      },
    };

    const unauthStatus: AuthStatus = { state: 'unauthenticated' };

    const { rerender } = renderHook<void, HookProps>(({ status }) => {
      useStationRouting(status);
    }, {
      initialProps: { status: stationStatus },
    });

    expect(window.location.pathname).toBe(getStationPath('Stanoviště X'));

    rerender({ status: unauthStatus });

    expect(window.location.pathname).toBe('/');
  });
});
