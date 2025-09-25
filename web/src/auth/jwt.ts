interface JwtPayload {
  [key: string]: unknown;
}

export function decodeJwt<T extends JwtPayload = JwtPayload>(token: string): T {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid token');
  }
  const payload = parts[1];
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(base64);
  return JSON.parse(json) as T;
}
