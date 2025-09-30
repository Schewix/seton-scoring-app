import { fromBase64, hexToBytes, toBase64, utf8Encode } from './base64';
import { canonicalStringify } from './canonical';

const PBKDF2_ITERATIONS = 150_000;

export async function deriveWrappingKey(refreshToken: string, deviceSalt: string) {
  const baseKey = await crypto.subtle.importKey('raw', utf8Encode(refreshToken), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const saltBytes = hexToBytes(deviceSalt);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function generateDeviceKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytes;
}

export async function encryptDeviceKey(deviceKey: Uint8Array, wrappingKey: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(deviceKey);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, data);
  return {
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

export async function decryptDeviceKey(payload: { iv: string; ciphertext: string }, wrappingKey: CryptoKey) {
  const ivBytes = new Uint8Array(fromBase64(payload.iv));
  const cipherBytes = new Uint8Array(fromBase64(payload.ciphertext));
  // ensure we pass a clean ArrayBuffer (without view offset) to WebCrypto
  const dataBuf =
    cipherBytes.byteOffset === 0 && cipherBytes.byteLength === cipherBytes.buffer.byteLength
      ? cipherBytes.buffer
      : cipherBytes.buffer.slice(cipherBytes.byteOffset, cipherBytes.byteOffset + cipherBytes.byteLength);
  const plain = (await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, wrappingKey, dataBuf)) as ArrayBuffer;
  return new Uint8Array(plain);
}

export async function digestPin(pin: string) {
  const data = utf8Encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64(digest);
}

export async function signPayload(deviceKey: Uint8Array, payload: unknown) {
  const canonical = canonicalStringify(payload);
  const rawKey = new Uint8Array(deviceKey);
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, utf8Encode(canonical));
  const signature = toBase64(signatureBuffer);
  return { signature, canonical };
}
