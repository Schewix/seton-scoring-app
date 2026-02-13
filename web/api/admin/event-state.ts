import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { getAuthConfig } from '../../api-lib/authTokens.js';

type TokenClaims = {
  sub?: string;
  sessionId?: string;
  event_id?: string;
  eventId?: string;
  station_id?: string;
  stationId?: string;
  type?: string;
};

function getSupabaseAdminConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable.');
  }

  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
  }

  return { supabaseUrl, serviceRoleKey };
}

function respond(res: any, status: number, message: string, detail?: string) {
  if (status >= 500) {
    console.error('[api/admin/event-state]', message, detail ? { detail } : {});
  }
  return res.status(status).json(detail ? { error: message, detail } : { error: message });
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

async function requireCalcSession(req: any, res: any) {
  const authHeader = req.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing session' });
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();

  let authConfig;
  try {
    authConfig = getAuthConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing auth configuration.';
    respond(res, 500, message, 'auth-config');
    return null;
  }

  let claims: TokenClaims;
  try {
    claims = jwt.verify(token, authConfig.jwtSecret) as TokenClaims;
  } catch {
    res.status(401).json({ error: 'Invalid JWT' });
    return null;
  }

  if (claims.type !== 'access') {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }

  const resolveClaimString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : '');
  const sessionId = resolveClaimString(claims.sessionId);
  const judgeId = resolveClaimString(claims.sub);
  const tokenEventId = resolveClaimString(claims.event_id) || resolveClaimString(claims.eventId);
  const tokenStationId = resolveClaimString(claims.station_id) || resolveClaimString(claims.stationId);

  if (!sessionId || !judgeId || !tokenEventId || !tokenStationId) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }

  let supabaseConfig;
  try {
    supabaseConfig = getSupabaseAdminConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing Supabase configuration.';
    respond(res, 500, message, 'supabase-config');
    return null;
  }

  const supabaseAdmin = createClient(supabaseConfig.supabaseUrl, supabaseConfig.serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('judge_sessions')
    .select('id, judge_id, revoked_at')
    .eq('id', sessionId)
    .eq('judge_id', judgeId)
    .maybeSingle();

  if (sessionError) {
    respond(res, 500, 'Session lookup failed', sessionError.message);
    return null;
  }

  if (!session || session.revoked_at) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from('judge_assignments')
    .select('id')
    .eq('judge_id', judgeId)
    .eq('station_id', tokenStationId)
    .eq('event_id', tokenEventId)
    .maybeSingle();

  if (assignmentError) {
    respond(res, 500, 'Assignment lookup failed', assignmentError.message);
    return null;
  }

  if (!assignment) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  const { data: station, error: stationError } = await supabaseAdmin
    .from('stations')
    .select('code')
    .eq('id', tokenStationId)
    .eq('event_id', tokenEventId)
    .maybeSingle();

  if (stationError) {
    respond(res, 500, 'Station lookup failed', stationError.message);
    return null;
  }

  const stationCode = (station?.code ?? '').trim().toUpperCase();
  if (stationCode !== 'T') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return {
    supabaseAdmin,
    eventId: tokenEventId,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = await requireCalcSession(req, res);
  if (!session) {
    return;
  }

  const { supabaseAdmin, eventId } = session;

  if (req.method === 'POST') {
    let rawBody: unknown = req.body;
    if (typeof rawBody === 'string') {
      try {
        rawBody = JSON.parse(rawBody);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }

    const locked = (rawBody as { locked?: unknown })?.locked;
    if (!isBoolean(locked)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const { error: updateError } = await supabaseAdmin
      .from('events')
      .update({ scoring_locked: locked })
      .eq('id', eventId);

    if (updateError) {
      return respond(res, 500, 'Failed to update event state', updateError.message);
    }
  }

  const { data: eventRow, error: eventError } = await supabaseAdmin
    .from('events')
    .select('name, scoring_locked')
    .eq('id', eventId)
    .maybeSingle();

  if (eventError || !eventRow) {
    return respond(res, 500, 'Failed to load event state', eventError?.message);
  }

  return res.json({
    eventName: eventRow.name,
    scoringLocked: Boolean(eventRow.scoring_locked),
  });
}
