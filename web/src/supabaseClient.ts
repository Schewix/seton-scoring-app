import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url) {
  throw new Error('Missing VITE_SUPABASE_URL environment variable.');
}

if (!anon) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY environment variable.');
}

function createSupabaseClient(accessToken?: string | null) {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
    global: {
      headers,
    },
  });
}

export let supabase = createSupabaseClient();

export function setSupabaseAccessToken(accessToken: string | null) {
  supabase = createSupabaseClient(accessToken);
  if (accessToken) {
    supabase.realtime.setAuth(accessToken);
  } else {
    supabase.realtime.setAuth('');
  }
}
