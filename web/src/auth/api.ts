import { env } from '../envVars';
import type { LoginResponse, StationManifest } from './types';

const BASE_URL = env.VITE_AUTH_API_URL?.replace(/\/$/, '') ?? '';

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

const loggedManifestWarnings = new Set<string>();

function logManifestWarningOnce(key: string, message: string, details: Record<string, unknown>) {
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

export async function fetchManifest(accessToken: string) {
  const url = `${BASE_URL}/manifest`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch (error) {
    throw new ManifestFetchError('Manifest request failed.', { url, kind: 'network' });
  }

  if (!response.ok) {
    let message = `Manifest request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch (error) {
      // ignore
    }

    if (response.status === 404) {
      logManifestWarningOnce('manifest-404', 'Manifest endpoint returned 404. Check API routing.', {
        status: response.status,
        url,
      });
    }

    throw new ManifestFetchError(message, { url, status: response.status, kind: 'http' });
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson =
    contentType.includes('application/manifest+json') || contentType.includes('application/json');
  if (!isJson) {
    if (contentType.includes('text/html')) {
      logManifestWarningOnce(
        'manifest-html',
        'Manifest response looks like HTML. Check API base URL and routing.',
        {
          status: response.status,
          url,
          contentType,
        },
      );
    } else {
      logManifestWarningOnce('manifest-content-type', 'Manifest response has unexpected content type.', {
        status: response.status,
        url,
        contentType,
      });
    }

    throw new ManifestFetchError('Manifest response has unexpected content type.', {
      url,
      status: response.status,
      contentType,
      kind: 'content-type',
    });
  }

  try {
    return (await response.json()) as { manifest: StationManifest; device_salt: string };
  } catch (error) {
    console.error('Manifest JSON parsing failed.', { status: response.status, url });
    throw new ManifestFetchError('Manifest response could not be parsed.', {
      url,
      status: response.status,
      contentType,
      kind: 'parse',
    });
  }
}
