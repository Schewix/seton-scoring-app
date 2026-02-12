import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import {
  getManifest,
  getPatrols,
  getTokens,
  getDeviceKeyPayload,
  setManifest,
  setPatrols,
  setTokens,
  setDeviceKeyPayload,
  setPinHash,
  getPinHash,
} from './storage';
import type {
  AuthStatus,
  LoginRequiresPasswordChangeResponse,
  LoginResponse,
  LoginSuccessResponse,
  PatrolSummary,
  StationManifest,
} from './types';
import { AuthRefreshError, fetchManifest, loginRequest, refreshSessionRequest } from './api';
import { deriveWrappingKey, encryptDeviceKey, generateDeviceKey, decryptDeviceKey, digestPin } from './crypto';
import { toBase64 } from './base64';
import { decodeJwt } from './jwt';
import { env } from '../envVars';
import { ACCESS_DENIED_MESSAGE, INVALID_JWT_MESSAGE } from './messages';

interface AuthContextValue {
  status: AuthStatus;
  login: (params: { email: string; password: string; pin?: string }) => Promise<void>;
  unlock: (pin?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateManifest: (manifest: StationManifest, patrols: PatrolSummary[]) => Promise<void>;
  refreshManifest: () => Promise<void>;
  refreshTokens: (options?: { force?: boolean; reason?: string }) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_BYPASS = env.VITE_AUTH_BYPASS === '1' || env.VITE_AUTH_BYPASS === 'true';
const AUTH_BYPASS_TOKEN = env.VITE_AUTH_BYPASS_TOKEN ?? '';
const AUTH_BYPASS_CLAIMS = (() => {
  if (!AUTH_BYPASS_TOKEN) return null;
  try {
    return decodeJwt<SupabaseJwtClaims>(AUTH_BYPASS_TOKEN);
  } catch {
    return null;
  }
})();
const AUTH_BYPASS_EVENT_ID =
  AUTH_BYPASS_CLAIMS?.event_id ?? AUTH_BYPASS_CLAIMS?.eventId ?? env.VITE_EVENT_ID ?? 'event-test';
const AUTH_BYPASS_STATION_ID =
  AUTH_BYPASS_CLAIMS?.station_id ?? AUTH_BYPASS_CLAIMS?.stationId ?? env.VITE_STATION_ID ?? 'station-test';
const AUTH_BYPASS_JUDGE_ID = AUTH_BYPASS_CLAIMS?.sub ?? 'judge-test';
const AUTH_BYPASS_JUDGE_EMAIL = AUTH_BYPASS_CLAIMS?.email ?? 'test@example.com';
const AUTH_BYPASS_SESSION_ID = AUTH_BYPASS_CLAIMS?.sessionId ?? 'session-test';
const AUTH_BYPASS_PATROLS_RAW = env.VITE_AUTH_BYPASS_PATROLS ?? '';
const AUTH_BYPASS_PATROLS: PatrolSummary[] = (() => {
  if (!AUTH_BYPASS_PATROLS_RAW) return [];
  try {
    const parsed = JSON.parse(AUTH_BYPASS_PATROLS_RAW);
    return Array.isArray(parsed) ? (parsed as PatrolSummary[]) : [];
  } catch {
    return [];
  }
})();

const ACCESS_REFRESH_SKEW_MS = 5 * 60 * 1000;

type SupabaseJwtClaims = {
  sub?: string;
  role?: string;
  email?: string;
  event_id?: string;
  eventId?: string;
  station_id?: string;
  stationId?: string;
  exp?: number;
  sessionId?: string;
  type?: string;
};

function isPasswordChangeResponse(
  response: LoginResponse,
): response is LoginRequiresPasswordChangeResponse {
  return 'must_change_password' in response && response.must_change_password === true;
}

function isLoginSuccessResponse(response: LoginResponse): response is LoginSuccessResponse {
  return 'access_token' in response && typeof response.access_token === 'string';
}

function validateSupabaseAccessToken(token: string) {
  let claims: SupabaseJwtClaims;
  try {
    claims = decodeJwt<SupabaseJwtClaims>(token);
  } catch (error) {
    throw new Error(INVALID_JWT_MESSAGE);
  }

  const resolveClaimString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);
  const sub = resolveClaimString(claims.sub);
  const role = resolveClaimString(claims.role);
  const tokenType = resolveClaimString(claims.type);
  const eventId = resolveClaimString(claims.event_id) ?? resolveClaimString(claims.eventId);
  const stationId = resolveClaimString(claims.station_id) ?? resolveClaimString(claims.stationId);

  if (!sub || !eventId || !stationId) {
    throw new Error(ACCESS_DENIED_MESSAGE);
  }

  if (role) {
    if (role !== 'authenticated' && role !== 'service_role') {
      throw new Error(ACCESS_DENIED_MESSAGE);
    }
  } else if (tokenType && tokenType !== 'access') {
    throw new Error(ACCESS_DENIED_MESSAGE);
  }

  return claims;
}

function logAccessTokenClaims(token: string, source: string) {
  if (!import.meta.env.DEV) {
    return;
  }
  try {
    const claims = decodeJwt<SupabaseJwtClaims>(token);
    console.debug('[auth] token claims', {
      source,
      sub: claims.sub,
      role: claims.role,
      type: claims.type,
      event_id: claims.event_id ?? claims.eventId,
      station_id: claims.station_id ?? claims.stationId,
      exp: claims.exp,
    });
  } catch (error) {
    console.debug('[auth] token decode failed', { source, error });
  }
}

function isTokenValidationError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message === ACCESS_DENIED_MESSAGE ||
    error.message === INVALID_JWT_MESSAGE ||
    error.message === 'Chybí přístupový token.'
  );
}

async function bootstrap(): Promise<
  | {
      manifest: StationManifest;
      patrols: PatrolSummary[];
      tokens: { refreshToken: string; accessToken: string | null; accessTokenExpiresAt: number | null; sessionId: string };
      encryptedDeviceKey: { ciphertext: string; iv: string; deviceSalt: string };
      pinHash: string | null;
    }
  | null
> {
  const [manifest, patrols, tokens, encryptedDeviceKey, pinHash] = await Promise.all([
    getManifest(),
    getPatrols(),
    getTokens(),
    getDeviceKeyPayload(),
    getPinHash(),
  ]);

  if (!manifest || !patrols || !tokens || !encryptedDeviceKey || !tokens.sessionId) {
    return null;
  }

  return {
    manifest,
    patrols,
    tokens,
    encryptedDeviceKey,
    pinHash,
  };
}

function useInitialization(setStatus: (status: AuthStatus) => void) {
  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        if (AUTH_BYPASS) {
          if (!cancelled) {
            setStatus({
              state: 'authenticated',
              manifest: {
                judge: { id: AUTH_BYPASS_JUDGE_ID, email: AUTH_BYPASS_JUDGE_EMAIL, displayName: 'Test Judge' },
                station: {
                  id: AUTH_BYPASS_STATION_ID,
                  code: 'X',
                  name: 'Testovací stanoviště',
                },
                event: {
                  id: AUTH_BYPASS_EVENT_ID,
                  name: 'Test Event',
                  scoringLocked: false,
                },
                allowedCategories: ['N', 'M', 'S', 'R'],
                allowedTasks: [],
                manifestVersion: 1,
              },
              patrols: AUTH_BYPASS_PATROLS,
              deviceKey: new Uint8Array(32),
              tokens: {
                accessToken: AUTH_BYPASS_TOKEN,
                accessTokenExpiresAt: Date.now() + 3600 * 1000,
                refreshToken: 'test-refresh',
                sessionId: AUTH_BYPASS_SESSION_ID,
              },
            });
          }
          return;
        }

        if (!cancelled) {
          setStatus({ state: 'loading' });
        }

        const cached = await bootstrap();
        if (cancelled) return;
        if (!cached) {
          setStatus({ state: 'unauthenticated' });
          return;
        }

        const { manifest, patrols, tokens, encryptedDeviceKey, pinHash } = cached;
        try {
          if (tokens.accessToken) {
            logAccessTokenClaims(tokens.accessToken, 'bootstrap');
          }
          const wrappingKey = await deriveWrappingKey(tokens.refreshToken, encryptedDeviceKey.deviceSalt);
          const deviceKey = await decryptDeviceKey(
            {
              iv: encryptedDeviceKey.iv,
              ciphertext: encryptedDeviceKey.ciphertext,
            },
            wrappingKey,
          );

          if (cancelled) return;

          if (pinHash) {
            setStatus({ state: 'locked', requiresPin: true });
          } else {
            if (!tokens.accessToken) {
              if (import.meta.env.DEV) {
                console.debug('[auth] missing access token (bootstrap)');
              }
              throw new Error('Chybí přístupový token.');
            }
            validateSupabaseAccessToken(tokens.accessToken);
            setStatus({
              state: 'authenticated',
              manifest,
              patrols,
              deviceKey,
              tokens: {
                accessToken: tokens.accessToken || '',
                accessTokenExpiresAt: tokens.accessTokenExpiresAt || Date.now(),
                refreshToken: tokens.refreshToken,
                sessionId: tokens.sessionId,
              },
            });
          }
        } catch (error) {
          if (isTokenValidationError(error)) {
            console.error('Cached token invalid', error);
            if (!cancelled) {
              setStatus({
                state: 'error',
                message: error instanceof Error ? error.message : 'Neplatný přístupový token.',
              });
            }
            return;
          }
          console.error('Failed to decrypt device key', error);
          if (!cancelled) {
            setStatus({ state: 'locked', requiresPin: !!pinHash });
          }
        }
      } catch (error) {
        console.error('Auth initialization failed', error);
        if (!cancelled) {
          const message = error instanceof Error && error.message ? error.message : 'Nepodařilo se načíst aplikaci.';
          setStatus({ state: 'error', message });
        }
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [setStatus]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ state: 'loading' });
  const [cachedData, setCachedData] = useState<{
    manifest: StationManifest;
    patrols: PatrolSummary[];
    tokens: { refreshToken: string; accessToken: string | null; accessTokenExpiresAt: number | null; sessionId: string };
    encryptedDeviceKey: { ciphertext: string; iv: string; deviceSalt: string };
  } | null>(null);
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const pendingRefreshRef = useRef(false);

  const handleInitializationState = useCallback(
    async (state: AuthStatus) => {
      if (state.state === 'locked' || state.state === 'unauthenticated') {
        const data = await bootstrap();
        if (data) {
          setCachedData({
            manifest: data.manifest,
            patrols: data.patrols,
            tokens: data.tokens,
            encryptedDeviceKey: data.encryptedDeviceKey,
          });
        }
      } else if (state.state === 'error') {
        setCachedData(null);
      }
      setStatus(state);
    },
    [setCachedData, setStatus],
  );

  useInitialization(handleInitializationState);

  const login = useCallback(
    async ({ email, password, pin }: { email: string; password: string; pin?: string }) => {
      const deviceKey = await generateDeviceKey();
      const devicePublicKey = toBase64(deviceKey);
      const response = await loginRequest(email, password, devicePublicKey);

      if (isPasswordChangeResponse(response)) {
        setStatus({
          state: 'password-change-required',
          email,
          judgeId: response.id,
          pendingPin: pin,
        });
        return;
      }

      if (!isLoginSuccessResponse(response)) {
        throw new Error('Invalid login response');
      }

      const success = response;
      const accessClaims = decodeJwt<{ sessionId?: string }>(success.access_token);
      logAccessTokenClaims(success.access_token, 'login');
      validateSupabaseAccessToken(success.access_token);
      const sessionId = typeof accessClaims.sessionId === 'string' && accessClaims.sessionId.length
        ? accessClaims.sessionId
        : (() => {
            throw new Error('Missing session identifier');
          })();
      const wrappingKey = await deriveWrappingKey(success.refresh_token, success.device_salt);
      const encrypted = await encryptDeviceKey(deviceKey, wrappingKey);

      await Promise.all([
        setManifest(success.manifest),
        setPatrols(success.patrols),
        setTokens({
          refreshToken: success.refresh_token,
          accessToken: success.access_token,
          accessTokenExpiresAt: Date.now() + success.access_token_expires_in * 1000,
          sessionId,
        }),
        setDeviceKeyPayload({ ...encrypted, deviceSalt: success.device_salt }),
        setPinHash(pin ? await digestPin(pin) : null),
      ]);

      setCachedData({
        manifest: success.manifest,
        patrols: success.patrols,
        tokens: {
          refreshToken: success.refresh_token,
          accessToken: success.access_token,
          accessTokenExpiresAt: Date.now() + success.access_token_expires_in * 1000,
          sessionId,
        },
        encryptedDeviceKey: { ...encrypted, deviceSalt: success.device_salt },
      });

      setStatus({
        state: 'authenticated',
        manifest: success.manifest,
        patrols: success.patrols,
        deviceKey,
        tokens: {
          accessToken: success.access_token,
          accessTokenExpiresAt: Date.now() + success.access_token_expires_in * 1000,
          refreshToken: success.refresh_token,
          sessionId,
        },
      });
    },
    [],
  );

  const refreshTokens = useCallback(
    async (options?: { force?: boolean; reason?: string }) => {
      if (AUTH_BYPASS) {
        return true;
      }
      if (status.state !== 'authenticated') {
        return false;
      }
      const expiresAt = status.tokens.accessTokenExpiresAt;
      if (
        !options?.force &&
        typeof expiresAt === 'number' &&
        Number.isFinite(expiresAt) &&
        Date.now() < expiresAt - ACCESS_REFRESH_SKEW_MS
      ) {
        return false;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        pendingRefreshRef.current = true;
        return false;
      }
      if (refreshInFlightRef.current) {
        return refreshInFlightRef.current;
      }

      const refreshToken = status.tokens.refreshToken;
      if (!refreshToken) {
        return false;
      }

      const refreshPromise = (async () => {
        try {
          const response = await refreshSessionRequest(refreshToken);
          logAccessTokenClaims(response.access_token, 'refresh');
          const claims = validateSupabaseAccessToken(response.access_token);
          const sessionId =
            typeof claims.sessionId === 'string' && claims.sessionId.length
              ? claims.sessionId
              : status.tokens.sessionId;
          const accessTokenExpiresAt = Date.now() + response.access_token_expires_in * 1000;
          const nextTokens = {
            refreshToken: response.refresh_token,
            accessToken: response.access_token,
            accessTokenExpiresAt,
            sessionId,
          };

          await setTokens(nextTokens);

          const storedPayload = await getDeviceKeyPayload();
          if (storedPayload) {
            const wrappingKey = await deriveWrappingKey(nextTokens.refreshToken, storedPayload.deviceSalt);
            const encrypted = await encryptDeviceKey(status.deviceKey, wrappingKey);
            await setDeviceKeyPayload({ ...encrypted, deviceSalt: storedPayload.deviceSalt });
            setCachedData((prev) => {
              if (!prev) return prev;
              return { ...prev, encryptedDeviceKey: { ...encrypted, deviceSalt: storedPayload.deviceSalt } };
            });
          }

          setStatus((prev) => {
            if (prev.state !== 'authenticated') return prev;
            return { ...prev, tokens: nextTokens };
          });
          setCachedData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              tokens: {
                refreshToken: nextTokens.refreshToken,
                accessToken: nextTokens.accessToken,
                accessTokenExpiresAt,
                sessionId,
              },
            };
          });

          pendingRefreshRef.current = false;
          return true;
        } catch (error) {
          if (error instanceof AuthRefreshError && (error.status === 401 || error.status === 403)) {
            console.warn('[auth] refresh rejected', { status: error.status, message: error.message });
            await logout();
          } else {
            console.error('[auth] refresh failed', error);
          }
          return false;
        } finally {
          refreshInFlightRef.current = null;
        }
      })();

      refreshInFlightRef.current = refreshPromise;
      return refreshPromise;
    },
    [logout, status],
  );

  const refreshManifest = useCallback(async () => {
    if (status.state !== 'authenticated') {
      return;
    }

    const accessToken = status.tokens.accessToken;
    if (!accessToken) {
      return;
    }

    const refreshResult = await fetchManifest(accessToken);
    if (!refreshResult) {
      return;
    }
    const { manifest: nextManifest, device_salt: nextDeviceSalt } = refreshResult;

    await setManifest(nextManifest);

    setStatus((prev) => {
      if (prev.state !== 'authenticated') return prev;
      return { ...prev, manifest: nextManifest };
    });

    setCachedData((prev) => {
      if (!prev) return prev;
      return { ...prev, manifest: nextManifest };
    });

    if (nextDeviceSalt) {
      const storedPayload = await getDeviceKeyPayload();
      if (storedPayload && storedPayload.deviceSalt !== nextDeviceSalt) {
        const wrappingKey = await deriveWrappingKey(status.tokens.refreshToken, nextDeviceSalt);
        const encrypted = await encryptDeviceKey(status.deviceKey, wrappingKey);
        await setDeviceKeyPayload({ ...encrypted, deviceSalt: nextDeviceSalt });
        setCachedData((prev) => {
          if (!prev) return prev;
          return { ...prev, encryptedDeviceKey: { ...encrypted, deviceSalt: nextDeviceSalt } };
        });
      }
    }
  }, [status]);

  useEffect(() => {
    if (AUTH_BYPASS || status.state !== 'authenticated') {
      return undefined;
    }
    const expiresAt = status.tokens.accessTokenExpiresAt;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
      return undefined;
    }
    const refreshAt = expiresAt - ACCESS_REFRESH_SKEW_MS;
    if (refreshAt <= Date.now()) {
      void refreshTokens({ reason: 'expiry' });
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      void refreshTokens({ reason: 'expiry' });
    }, Math.max(0, refreshAt - Date.now()));
    return () => window.clearTimeout(timeoutId);
  }, [refreshTokens, status.state, status.tokens.accessTokenExpiresAt]);

  useEffect(() => {
    if (AUTH_BYPASS || typeof window === 'undefined') {
      return undefined;
    }
    const handleOnline = () => {
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void refreshTokens({ force: true, reason: 'online' });
        return;
      }
      if (status.state !== 'authenticated') {
        return;
      }
      const expiresAt = status.tokens.accessTokenExpiresAt;
      if (
        typeof expiresAt === 'number' &&
        Number.isFinite(expiresAt) &&
        Date.now() >= expiresAt - ACCESS_REFRESH_SKEW_MS
      ) {
        void refreshTokens({ reason: 'online' });
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [refreshTokens, status.state, status.tokens.accessTokenExpiresAt]);

  const unlock = useCallback(
    async (pin?: string) => {
      if (!cachedData) {
        setStatus({ state: 'unauthenticated' });
        return;
      }

      const storedPinHash = await getPinHash();
      if (storedPinHash) {
        if (!pin) throw new Error('PIN required');
        const providedHash = await digestPin(pin);
        if (providedHash !== storedPinHash) {
          throw new Error('Invalid PIN');
        }
      }

      const wrappingKey = await deriveWrappingKey(
        cachedData.tokens.refreshToken,
        cachedData.encryptedDeviceKey.deviceSalt,
      );
      const deviceKey = await decryptDeviceKey(
        {
          iv: cachedData.encryptedDeviceKey.iv,
          ciphertext: cachedData.encryptedDeviceKey.ciphertext,
        },
        wrappingKey,
      );

      const accessToken = cachedData.tokens.accessToken || '';
      if (!accessToken) {
        if (import.meta.env.DEV) {
          console.debug('[auth] missing access token (unlock)');
        }
        throw new Error('Chybí přístupový token.');
      }
      logAccessTokenClaims(accessToken, 'unlock');
      validateSupabaseAccessToken(accessToken);
      setStatus({
        state: 'authenticated',
        manifest: cachedData.manifest,
        patrols: cachedData.patrols,
        deviceKey,
        tokens: {
          accessToken: cachedData.tokens.accessToken || '',
          accessTokenExpiresAt: cachedData.tokens.accessTokenExpiresAt || Date.now(),
          refreshToken: cachedData.tokens.refreshToken,
          sessionId: cachedData.tokens.sessionId,
        },
      });
    },
    [cachedData],
  );

  const logout = useCallback(async () => {
    await Promise.all([
      setManifest(null),
      setPatrols([]),
      setTokens(null),
      setDeviceKeyPayload(null),
      setPinHash(null),
    ]);
    setCachedData(null);
    setStatus({ state: 'unauthenticated' });
  }, []);

  const updateManifest = useCallback(async (manifest: StationManifest, patrols: PatrolSummary[]) => {
    await Promise.all([setManifest(manifest), setPatrols(patrols)]);
    setStatus((prev) => {
      if (prev.state !== 'authenticated') return prev;
      return { ...prev, manifest, patrols };
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      login,
      unlock,
      logout,
      updateManifest,
      refreshManifest,
      refreshTokens,
    }),
    [status, login, unlock, logout, updateManifest, refreshManifest, refreshTokens],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
