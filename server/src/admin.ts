import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
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
      return res.status(404).json({ error: 'Station not found' });
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

async function requireCalcStation(req: Request, res: Response, next: NextFunction) {
  const context = await resolveAdminContext(req, res);
  if (!context) {
    return;
  }

  if (context.stationCode !== 'T') {
    res.status(403).json({ error: 'Access restricted to station T' });
    return;
  }

  (req as Request & { adminContext: AdminContext }).adminContext = context;
  next();
}

router.use(requireCalcStation);

router.get('/event-state', async (req: Request & { adminContext: AdminContext }, res: Response) => {
  const { eventId } = req.adminContext;
  const { data: event, error } = await supabase
    .from('events')
    .select('id, name, scoring_locked')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !event) {
    console.error('Failed to load event state', error);
    return res.status(500).json({ error: 'Failed to load event state' });
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

router.post('/event-state', async (req: Request & { adminContext: AdminContext }, res: Response) => {
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const { locked } = parse.data;
  const { eventId } = req.adminContext;

  const { error } = await supabase
    .from('events')
    .update({ scoring_locked: locked })
    .eq('id', eventId);

  if (error) {
    console.error('Failed to update scoring lock', error);
    return res.status(500).json({ error: 'Failed to update event' });
  }

  res.json({ success: true, scoringLocked: locked });
});

export default router;
