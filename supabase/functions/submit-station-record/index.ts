/// <reference path="../types.d.ts" />

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL) {
  throw new Error('Missing SUPABASE_URL environment variable.');
}

if (!SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SubmissionPayload = {
  client_event_id: string;
  client_created_at: string;
  event_id: string;
  station_id: string;
  patrol_id: string;
  category: string;
  arrived_at: string;
  wait_minutes: number;
  points: number;
  note: string;
  use_target_scoring: boolean;
  normalized_answers: string | null;
  finish_time: string | null;
  patrol_code: string;
  team_name?: string;
  sex?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json',
    },
  });
}

function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padding = payload.length % 4;
  if (padding) {
    payload = payload.padEnd(payload.length + (4 - padding), '=');
  }
  try {
    const decoded = atob(payload);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch (_error) {
    return null;
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function ensurePayload(body: unknown): SubmissionPayload | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const payload = body as SubmissionPayload;
  if (!isString(payload.client_event_id) || !UUID_REGEX.test(payload.client_event_id)) {
    return null;
  }
  if (!isString(payload.event_id) || !isString(payload.station_id) || !isString(payload.patrol_id)) {
    return null;
  }
  if (!isString(payload.client_created_at) || !isString(payload.arrived_at)) {
    return null;
  }
  if (!isString(payload.category) || !isString(payload.patrol_code)) {
    return null;
  }
  if (typeof payload.points !== 'number' || !Number.isInteger(payload.points)) {
    return null;
  }
  if (typeof payload.wait_minutes !== 'number' || !Number.isInteger(payload.wait_minutes)) {
    return null;
  }
  if (typeof payload.use_target_scoring !== 'boolean') {
    return null;
  }
  if (payload.normalized_answers !== null && typeof payload.normalized_answers !== 'string') {
    return null;
  }
  if (payload.finish_time !== null && typeof payload.finish_time !== 'string') {
    return null;
  }
  if (typeof payload.note !== 'string') {
    return null;
  }
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing session' }, 401);
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'Invalid session' }, 401);
  }

  let body: SubmissionPayload | null = null;
  try {
    const rawBody = await req.json();
    body = ensurePayload(rawBody);
  } catch (_error) {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (!body) {
    return jsonResponse({ error: 'Invalid payload' }, 400);
  }

  if (body.points < 0 || body.points > 12) {
    return jsonResponse({ error: 'Invalid points' }, 400);
  }
  if (body.wait_minutes < 0) {
    return jsonResponse({ error: 'Invalid wait minutes' }, 400);
  }

  const claims = decodeJwt(token);
  if (!claims || claims.event_id !== body.event_id || claims.station_id !== body.station_id) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const { data: existingScore, error: existingError } = await supabaseAdmin
    .from('station_scores')
    .select('*')
    .eq('client_event_id', body.client_event_id)
    .maybeSingle();

  if (existingError) {
    return jsonResponse({ error: 'Lookup failed' }, 500);
  }

  if (existingScore) {
    return jsonResponse({ score: existingScore }, 200);
  }

  const submittedBy = userData.user.id;
  const { data: score, error: scoreError } = await supabaseAdmin
    .from('station_scores')
    .upsert(
      {
        event_id: body.event_id,
        station_id: body.station_id,
        patrol_id: body.patrol_id,
        points: body.points,
        note: body.note || null,
        client_event_id: body.client_event_id,
        client_created_at: body.client_created_at,
        submitted_by: submittedBy,
      },
      { onConflict: 'event_id,patrol_id,station_id' },
    )
    .select('*')
    .maybeSingle();

  if (scoreError) {
    return jsonResponse({ error: 'Score insert failed' }, 500);
  }

  const { error: passageError } = await supabaseAdmin
    .from('station_passages')
    .upsert(
      {
        event_id: body.event_id,
        station_id: body.station_id,
        patrol_id: body.patrol_id,
        arrived_at: body.arrived_at,
        wait_minutes: body.wait_minutes,
        client_event_id: body.client_event_id,
        client_created_at: body.client_created_at,
        submitted_by: submittedBy,
      },
      { onConflict: 'event_id,patrol_id,station_id' },
    );

  if (passageError) {
    return jsonResponse({ error: 'Passage upsert failed' }, 500);
  }

  if (body.finish_time) {
    const { error: timingError } = await supabaseAdmin
      .from('timings')
      .upsert(
        {
          event_id: body.event_id,
          patrol_id: body.patrol_id,
          finish_time: body.finish_time,
          client_event_id: body.client_event_id,
          client_created_at: body.client_created_at,
          submitted_by: submittedBy,
        },
        { onConflict: 'event_id,patrol_id' },
      );

    if (timingError) {
      return jsonResponse({ error: 'Timing upsert failed' }, 500);
    }
  }

  if (body.use_target_scoring && body.normalized_answers) {
    const { error: quizError } = await supabaseAdmin
      .from('station_quiz_responses')
      .upsert(
        {
          event_id: body.event_id,
          station_id: body.station_id,
          patrol_id: body.patrol_id,
          category: body.category,
          answers: body.normalized_answers,
          correct_count: body.points,
          client_event_id: body.client_event_id,
          client_created_at: body.client_created_at,
          submitted_by: submittedBy,
        },
        { onConflict: 'event_id,station_id,patrol_id' },
      );

    if (quizError) {
      return jsonResponse({ error: 'Quiz upsert failed' }, 500);
    }
  } else if (!body.use_target_scoring) {
    const { error: deleteError } = await supabaseAdmin
      .from('station_quiz_responses')
      .delete()
      .match({
        event_id: body.event_id,
        station_id: body.station_id,
        patrol_id: body.patrol_id,
      });

    if (deleteError) {
      return jsonResponse({ error: 'Quiz delete failed' }, 500);
    }
  }

  return jsonResponse({ score }, 200);
});
