import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url) {
  throw new Error('Missing VITE_SUPABASE_URL environment variable.');
}

if (!anon) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY environment variable.');
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
