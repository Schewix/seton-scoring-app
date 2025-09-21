import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra || {};
export const supabase = createClient(
  extra.EXPO_PUBLIC_SUPABASE_URL,
  extra.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
);
