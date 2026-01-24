import { getLocalforage } from '../storage/localforage';
import type { StationManifest, PatrolSummary } from './types';

const MANIFEST_KEY = 'auth_manifest_v1';
const PATROLS_KEY = 'auth_patrols_v1';
const TOKENS_KEY = 'auth_tokens_v1';
const DEVICE_KEY_KEY = 'auth_device_key_v1';
const PIN_KEY = 'auth_pin_hash_v1';

export interface StoredTokens {
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  refreshToken: string;
  sessionId: string;
}

export interface StoredDeviceKey {
  ciphertext: string;
  iv: string;
  deviceSalt: string;
}

export function setManifest(manifest: StationManifest | null) {
  const localforage = getLocalforage();
  if (manifest) {
    return localforage.setItem(MANIFEST_KEY, manifest);
  }
  return localforage.removeItem(MANIFEST_KEY);
}

export function getManifest() {
  const localforage = getLocalforage();
  return localforage.getItem<StationManifest | null>(MANIFEST_KEY);
}

export function setPatrols(patrols: PatrolSummary[]) {
  const localforage = getLocalforage();
  return localforage.setItem(PATROLS_KEY, patrols);
}

export function getPatrols() {
  const localforage = getLocalforage();
  return localforage.getItem<PatrolSummary[]>(PATROLS_KEY);
}

export function setTokens(tokens: StoredTokens | null) {
  const localforage = getLocalforage();
  if (tokens) {
    return localforage.setItem(TOKENS_KEY, tokens);
  }
  return localforage.removeItem(TOKENS_KEY);
}

export function getTokens() {
  const localforage = getLocalforage();
  return localforage.getItem<StoredTokens | null>(TOKENS_KEY);
}

export async function getAccessToken() {
  const tokens = await getTokens();
  const accessToken = tokens?.accessToken ?? null;
  if (!accessToken) {
    return null;
  }
  const expiresAt = tokens?.accessTokenExpiresAt ?? null;
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    const now = Date.now();
    if (now >= expiresAt - 10_000) {
      return null;
    }
  }
  return accessToken;
}

export function setDeviceKeyPayload(payload: StoredDeviceKey | null) {
  const localforage = getLocalforage();
  if (payload) {
    return localforage.setItem(DEVICE_KEY_KEY, payload);
  }
  return localforage.removeItem(DEVICE_KEY_KEY);
}

export function getDeviceKeyPayload() {
  const localforage = getLocalforage();
  return localforage.getItem<StoredDeviceKey | null>(DEVICE_KEY_KEY);
}

export function setPinHash(hash: string | null) {
  const localforage = getLocalforage();
  if (hash) {
    return localforage.setItem(PIN_KEY, hash);
  }
  return localforage.removeItem(PIN_KEY);
}

export function getPinHash() {
  const localforage = getLocalforage();
  return localforage.getItem<string | null>(PIN_KEY);
}
