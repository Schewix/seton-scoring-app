import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { verifyAccessToken } from './tokens.js';
import { supabase } from './supabase.js';

const router = Router();

interface AdminContext {
  eventId: string;
  stationId: string;
  judgeId: string;
  stationCode: string;
}

function unauthorized(res: Response) {
  return res.status(401).json({ error: 'Unauthorized' });
}

async function resolveAdminContext(req: Request, res: Response): Promise<AdminContext | null> {
  const authHeader = req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    unauthorized(res);
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    if (payload.type !== 'access') {
      throw new Error('Invalid token type');
    }

    const [{ data: session }, { data: station }] = await Promise.all([
      supabase
        .from('judge_sessions')
        .select('id, judge_id, station_id, event_id, revoked_at')
        .eq('id', payload.sessionId)
        .eq('judge_id', payload.sub)
        .maybeSingle(),
      supabase
        .from('stations')
        .select('id, code')
        .eq('id', payload.stationId)
        .maybeSingle(),
    ]);

    if (!session || session.revoked_at) {
      unauthorized(res);
      return null;
    }

    if (!station) {
      res.status(404).json({ error: 'Station not found' });
      return null;
    }

    return {
      eventId: payload.eventId,
      stationId: payload.stationId,
      judgeId: payload.sub,
      stationCode: (station.code || '').trim().toUpperCase(),
    };
  } catch (error) {
    console.error('Failed to resolve admin context', error);
    unauthorized(res);
    return null;
  }
}

type AdminRequest = Request & { adminContext: AdminContext };

const requireCalcStation: RequestHandler = async (req, res, next) => {
  const context = await resolveAdminContext(req, res);
  if (!context) {
    return;
  }

  if (context.stationCode !== 'T') {
    res.status(403).json({ error: 'Access restricted to station T' });
    return;
  }

  (req as AdminRequest).adminContext = context;
  next();
};

router.use(requireCalcStation);

router.get('/event-state', async (req: Request, res: Response) => {
  const { eventId } = (req as AdminRequest).adminContext;
  const { data: event, error } = await supabase
    .from('events')
    .select('id, name, scoring_locked')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !event) {
    console.error('Failed to load event state', error);
    res.status(500).json({ error: 'Failed to load event state' });
    return;
  }

  res.json({
    eventId: event.id,
    eventName: event.name,
    scoringLocked: !!event.scoring_locked,
  });
});

const updateSchema = z.object({
  locked: z.boolean(),
});

const disqualifySchema = z.object({
  patrol_code: z.string().trim().min(1),
  disqualified: z.boolean().optional(),
});

const PRAGUE_TIME_ZONE = 'Europe/Prague';

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function zonedTimeToUtcIso(
  timeZone: string,
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
) {
  const utcGuess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );
  const zoned = getDatePartsInTimeZone(utcGuess, timeZone);
  const zonedAsUtcMs = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second,
  );
  const shiftMs = zonedAsUtcMs - utcGuess.getTime();
  return new Date(utcGuess.getTime() - shiftMs).toISOString();
}

function buildDefaultLockAtIso(now = new Date()) {
  const dayParts = getDatePartsInTimeZone(now, PRAGUE_TIME_ZONE);
  const closingAtIso = zonedTimeToUtcIso(PRAGUE_TIME_ZONE, {
    year: dayParts.year,
    month: dayParts.month,
    day: dayParts.day,
    hour: 16,
    minute: 0,
    second: 0,
  });
  const closingAtMs = Date.parse(closingAtIso);
  const lockAtMs = Number.isFinite(closingAtMs) ? Math.min(now.getTime(), closingAtMs) : now.getTime();
  return new Date(lockAtMs).toISOString();
}

router.post('/event-state', async (req: Request, res: Response) => {
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid body' });
    return;
  }

  const { locked } = parse.data;
  const { eventId } = (req as AdminRequest).adminContext;

  const { data: currentEvent, error: currentEventError } = await supabase
    .from('events')
    .select('scoring_locked_at')
    .eq('id', eventId)
    .maybeSingle();

  if (currentEventError || !currentEvent) {
    console.error('Failed to load current event state', currentEventError);
    res.status(500).json({ error: 'Failed to load event state' });
    return;
  }

  const updatePayload = locked
    ? {
        scoring_locked: true,
        scoring_locked_at: currentEvent.scoring_locked_at ?? buildDefaultLockAtIso(),
      }
    : {
        scoring_locked: false,
        scoring_locked_at: null,
      };

  const { error } = await supabase
    .from('events')
    .update(updatePayload)
    .eq('id', eventId);

  if (error) {
    console.error('Failed to update scoring lock', error);
    res.status(500).json({ error: 'Failed to update event' });
    return;
  }

  res.json({ success: true, scoringLocked: locked });
});

router.post('/patrol-disqualify', async (req: Request, res: Response) => {
  const parse = disqualifySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid body' });
    return;
  }

  const { eventId } = (req as AdminRequest).adminContext;
  const code = parse.data.patrol_code.trim().toUpperCase();
  if (!code) {
    res.status(400).json({ error: 'Invalid patrol code' });
    return;
  }

  const disqualified = parse.data.disqualified ?? true;

  const { data, error } = await supabase
    .from('patrols')
    .update({ disqualified })
    .eq('event_id', eventId)
    .eq('patrol_code', code)
    .select('id, patrol_code, team_name, category, sex, disqualified')
    .maybeSingle();

  if (error) {
    console.error('Failed to update patrol disqualification', error);
    res.status(500).json({ error: 'Failed to update patrol' });
    return;
  }

  if (!data) {
    res.status(404).json({ error: 'Patrol not found' });
    return;
  }

  res.json({
    patrol: {
      id: data.id,
      patrolCode: data.patrol_code,
      teamName: data.team_name,
      category: data.category,
      sex: data.sex,
      disqualified: data.disqualified,
    },
  });
});

export default router;
