import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { fetchManifest, loginRequest } from './api';
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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_BYPASS = env.VITE_AUTH_BYPASS === '1' || env.VITE_AUTH_BYPASS === 'true';

type SupabaseJwtClaims = {
  sub?: string;
  role?: string;
  email?: string;
  event_id?: string;
  station_id?: string;
  exp?: number;
  sessionId?: string;
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

  const sub = typeof claims.sub === 'string' && claims.sub.length > 0 ? claims.sub : null;
  const role = typeof claims.role === 'string' && claims.role.length > 0 ? claims.role : null;
  const eventId = typeof claims.event_id === 'string' && claims.event_id.length > 0 ? claims.event_id : null;
  const stationId =
    typeof claims.station_id === 'string' && claims.station_id.length > 0 ? claims.station_id : null;

  if (!sub || !role || !eventId || !stationId) {
    throw new Error(ACCESS_DENIED_MESSAGE);
  }

  if (role !== 'authenticated' && role !== 'service_role') {
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
      event_id: claims.event_id,
      station_id: claims.station_id,
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
                judge: { id: 'judge-test', email: 'test@example.com', displayName: 'Test Judge' },
                station: {
                  id: env.VITE_STATION_ID || 'station-test',
                  code: 'X',
                  name: 'Testovací stanoviště',
                },
                event: {
                  id: env.VITE_EVENT_ID || 'event-test',
                  name: 'Test Event',
                  scoringLocked: false,
                },
                allowedCategories: ['N', 'M', 'S', 'R'],
                allowedTasks: [],
                manifestVersion: 1,
              },
              patrols: [],
              deviceKey: new Uint8Array(32),
              tokens: {
                accessToken: '',
                accessTokenExpiresAt: Date.now() + 3600 * 1000,
                refreshToken: 'test-refresh',
                sessionId: 'session-test',
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

  const refreshManifest = useCallback(async () => {
    if (status.state !== 'authenticated') {
      throw new Error('Cannot refresh manifest when unauthenticated');
    }

    const accessToken = status.tokens.accessToken;
    if (!accessToken) {
      throw new Error('Missing access token for manifest refresh');
    }

    const { manifest: nextManifest, device_salt: nextDeviceSalt } = await fetchManifest(accessToken);

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
    }),
    [status, login, unlock, logout, updateManifest, refreshManifest],
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
