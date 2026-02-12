import { env } from '../envVars';
import type { LoginResponse, RefreshSuccessResponse, StationManifest } from './types';

const FALLBACK_BASE_URL = import.meta.env.PROD ? '/api' : env.VITE_SUPABASE_URL ?? '';
const BASE_URL = (env.VITE_AUTH_API_URL ?? FALLBACK_BASE_URL).replace(/\/$/, '');

if (!BASE_URL) {
  throw new Error('Missing VITE_AUTH_API_URL or VITE_SUPABASE_URL for auth API requests.');
}

if (import.meta.env.DEV) {
  console.debug('[auth] resolved API URLs', { baseUrl: BASE_URL });
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = 'Request failed';
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch (error) {
      // ignore
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

type ManifestFetchErrorKind = 'network' | 'http' | 'content-type' | 'parse';

export class ManifestFetchError extends Error {
  status?: number;
  url: string;
  contentType?: string;
  kind: ManifestFetchErrorKind;

  constructor(
    message: string,
    options: { url: string; status?: number; contentType?: string; kind: ManifestFetchErrorKind },
  ) {
    super(message);
    this.name = 'ManifestFetchError';
    this.status = options.status;
    this.url = options.url;
    this.contentType = options.contentType;
    this.kind = options.kind;
  }

  get isNotFound() {
    return this.status === 404;
  }

  get isHtmlResponse() {
    return typeof this.contentType === 'string' && this.contentType.includes('text/html');
  }
}

export class AuthRefreshError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AuthRefreshError';
    this.status = status;
  }
}

const loggedManifestWarnings = new Set<string>();

function logManifestWarningOnce(key: string, message: string, details: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return;
  }
  if (loggedManifestWarnings.has(key)) {
    return;
  }
  loggedManifestWarnings.add(key);
  console.warn(message, details);
}

export function loginRequest(email: string, password: string, devicePublicKey?: string) {
  const url = `${BASE_URL}/auth/login`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, devicePublicKey }),
  }).then((res) => handleResponse<LoginResponse>(res));
}

export function changePasswordRequest(params: { email?: string; id?: string; newPassword: string }) {
  const url = `${BASE_URL}/auth/change-password`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).then((res) => handleResponse<{ success: true }>(res));
}

export function requestPasswordReset(email: string) {
  const url = `${BASE_URL}/auth/reset-password`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }).then((res) => handleResponse<{ success: true }>(res));
}

export async function refreshSessionRequest(refreshToken: string) {
  const url = `${BASE_URL}/auth/refresh`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    let message = 'Refresh failed';
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new AuthRefreshError(message, response.status);
  }

  return response.json() as Promise<RefreshSuccessResponse>;
}

export async function fetchManifest(_accessToken: string) {
  logManifestWarningOnce('manifest-disabled', 'Manifest refresh is disabled; skipping fetch.', {});
  return null as { manifest: StationManifest; device_salt: string } | null;
}
