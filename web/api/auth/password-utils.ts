import { pbkdf2 as pbkdf2Callback, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);

export const PBKDF2_ITERATIONS = 210_000;
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateTemporaryPassword(length = 12): string {
  if (length <= 0) {
    throw new Error('Invalid password length');
  }

  const bytes = randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return password;
}

export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error('Missing password');
  }

  const salt = randomBytes(16);
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}
