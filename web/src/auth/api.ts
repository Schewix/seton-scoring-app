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

export function fetchManifest(accessToken: string) {
  const url = `${BASE_URL}/manifest`;
  return fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((res) => handleResponse<{ manifest: StationManifest; device_salt: string }>(res));
}
