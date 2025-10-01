import { createServerClient, type CookieOptions } from '@supabase/ssr/dist/main/index.js';
import type { CookieSerializeOptions } from 'cookie/index';
import { serialize } from 'cookie/index';

function parseCookieHeader(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return {} as Record<string, string>;
  }

  const pairs = cookieHeader.split(';');
  const store: Record<string, string> = {};

  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!name) continue;
    try {
      store[name] = decodeURIComponent(value);
    } catch {
      store[name] = value;
    }
  }

  return store;
}

function appendSetCookie(res: any, cookie: string) {
  const current = res.getHeader?.('Set-Cookie');
  if (!current) {
    res.setHeader?.('Set-Cookie', cookie);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader?.('Set-Cookie', [...current, cookie]);
    return;
  }
  res.setHeader?.('Set-Cookie', [current, cookie]);
}

const defaultCookieOptions: CookieOptions & CookieSerializeOptions = {
  path: '/',
  domain: '.zelenaliga.cz',
  sameSite: 'lax',
  secure: true,
};

export function createSupabaseServerClient(req: any, res: any) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable.');
  }

  if (!supabaseAnonKey) {
    throw new Error('Missing SUPABASE_ANON_KEY environment variable.');
  }

  const requestCookies: Record<string, string> =
    typeof req?.cookies === 'object' && req.cookies
      ? req.cookies
      : parseCookieHeader(typeof req?.headers?.cookie === 'string' ? req.headers.cookie : undefined);

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return requestCookies[name];
      },
      set(name: string, value: string, options?: CookieSerializeOptions) {
        const cookie = serialize(name, value, {
          ...defaultCookieOptions,
          ...options,
        });
        appendSetCookie(res, cookie);
      },
      remove(name: string, options?: CookieSerializeOptions) {
        const cookie = serialize(name, '', {
          ...defaultCookieOptions,
          ...options,
          maxAge: 0,
        });
        appendSetCookie(res, cookie);
      },
    },
    cookieOptions: defaultCookieOptions,
  });
}
