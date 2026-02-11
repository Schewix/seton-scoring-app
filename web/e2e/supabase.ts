import { createClient } from '@supabase/supabase-js';
import { seedData } from './seedData';
import { ensureTestSupabaseEnv } from '../src/test/testEnv';

const { supabaseUrl, serviceRoleKey } = ensureTestSupabaseEnv();

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

export async function clearStationData() {
  await supabaseAdmin.from('station_quiz_responses').delete().eq('event_id', seedData.eventId);
  await supabaseAdmin.from('station_scores').delete().eq('event_id', seedData.eventId);
  await supabaseAdmin.from('station_passages').delete().eq('event_id', seedData.eventId);
  await supabaseAdmin.from('timings').delete().eq('event_id', seedData.eventId);
}
