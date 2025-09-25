import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { supabase } from './supabase.js';
import { createAccessToken, createRefreshToken, hashRefreshToken, randomToken, verifyAccessToken } from './tokens.js';
import { env } from './env.js';
import { StationManifest, PatrolSummary } from './types.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  devicePublicKey: z.string().min(1).optional(),
});

const authRouter = Router();

function toIso(date: Date) {
  return date.toISOString();
}

authRouter.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const { email, password, devicePublicKey } = parse.data;
  const lowerEmail = email.toLowerCase();

  const { data: judge, error: judgeError } = await supabase
    .from('judges')
    .select('*')
    .eq('email', lowerEmail)
    .maybeSingle();

  if (judgeError || !judge) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const passwordOk = await argon2.verify(judge.password_hash, password);
  if (!passwordOk) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('judge_assignments')
    .select('*')
    .eq('judge_id', judge.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (assignmentError || !assignment) {
    return res.status(403).json({ error: 'Judge has no assignment' });
  }

  const [{ data: station }, { data: event }] = await Promise.all([
    supabase
      .from('stations')
      .select('id, code, name')
      .eq('id', assignment.station_id)
      .maybeSingle(),
    supabase
      .from('events')
      .select('id, name')
      .eq('id', assignment.event_id)
      .maybeSingle(),
  ]);

  if (!station || !event) {
    return res.status(500).json({ error: 'Failed to resolve assignment details' });
  }

  const manifest: StationManifest = {
    judge: {
      id: judge.id,
      email: judge.email,
      displayName: judge.display_name,
    },
    station: {
      id: station.id,
      code: station.code,
      name: station.name,
    },
    event: {
      id: event.id,
      name: event.name,
    },
    allowedCategories: assignment.allowed_categories ?? [],
    allowedTasks: assignment.allowed_tasks ?? [],
    manifestVersion: 1,
  };

  const { data: patrolsData, error: patrolsError } = await supabase
    .from('patrols')
    .select('id, team_name, category, sex, patrol_code')
    .eq('event_id', assignment.event_id)
    .eq('active', true)
    .order('patrol_code', { ascending: true });

  if (patrolsError) {
    return res.status(500).json({ error: 'Failed to load patrols' });
  }

  const patrols = (patrolsData ?? []) as PatrolSummary[];

  const sessionId = randomToken(16);
  const deviceSalt = randomToken(24);
  const refreshToken = createRefreshToken({
    sub: judge.id,
    stationId: station.id,
    sessionId,
    eventId: event.id,
  });
  const accessToken = createAccessToken({
    sub: judge.id,
    stationId: station.id,
    sessionId,
    eventId: event.id,
  });

  const refreshTokenHash = hashRefreshToken(refreshToken);
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  const insertPayload = {
    id: sessionId,
    judge_id: judge.id,
    station_id: station.id,
    device_salt: deviceSalt,
    public_key: devicePublicKey ?? null,
    manifest_version: manifest.manifestVersion,
    refresh_token_hash: refreshTokenHash,
    refresh_token_expires_at: toIso(refreshExpiresAt),
  };

  const { error: sessionError } = await supabase.from('judge_sessions').insert(insertPayload);

  if (sessionError) {
    return res.status(500).json({ error: 'Failed to initialise session' });
  }

  res.json({
    access_token: accessToken,
    access_token_expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    refresh_token_expires_in: env.REFRESH_TOKEN_TTL_SECONDS,
    device_salt: deviceSalt,
    manifest,
    patrols,
  });
});

export async function manifestHandler(req: Request, res: Response) {
  const authHeader = req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    if (payload.type !== 'access') {
      throw new Error('Invalid token type');
    }

    const [{ data: session }, { data: judge }, { data: assignment }] = await Promise.all([
      supabase
        .from('judge_sessions')
        .select('*')
        .eq('id', payload.sessionId)
        .eq('judge_id', payload.sub)
        .maybeSingle(),
      supabase
        .from('judges')
        .select('*')
        .eq('id', payload.sub)
        .maybeSingle(),
      supabase
        .from('judge_assignments')
        .select('*')
        .eq('judge_id', payload.sub)
        .eq('station_id', payload.stationId)
        .eq('event_id', payload.eventId)
        .maybeSingle(),
    ]);

    if (!session || session.revoked_at) {
      return res.status(401).json({ error: 'Session revoked' });
    }

    if (!judge || !assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const [{ data: station }, { data: event }] = await Promise.all([
      supabase
        .from('stations')
        .select('id, code, name')
        .eq('id', assignment.station_id)
        .maybeSingle(),
      supabase
        .from('events')
        .select('id, name')
        .eq('id', assignment.event_id)
        .maybeSingle(),
    ]);

    if (!station || !event) {
      return res.status(500).json({ error: 'Failed to resolve assignment' });
    }

    const manifest: StationManifest = {
      judge: {
        id: judge.id,
        email: judge.email,
        displayName: judge.display_name,
      },
      station: {
        id: station.id,
        code: station.code,
        name: station.name,
      },
      event: {
        id: event.id,
        name: event.name,
      },
      allowedCategories: assignment.allowed_categories ?? [],
      allowedTasks: assignment.allowed_tasks ?? [],
    manifestVersion: session.manifest_version ?? 1,
    };

    res.json({ manifest, device_salt: session.device_salt });
  } catch (error) {
    console.error('Failed to issue manifest', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

authRouter.get('/manifest', manifestHandler);

export default authRouter;
