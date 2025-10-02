import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { verifyAccessToken } from './tokens.js';
import { supabase } from './supabase.js';
import { normalizeAllowedCategories, normalizeCategory, CategoryKey } from './categories.js';

const syncRouter = Router();

const operationSchema = z.object({
  id: z.string().min(1),
  type: z.literal('submission'),
  signature: z.string().min(1),
  signature_payload: z.string().min(1),
  payload: z.record(z.any()).optional(),
});

const bodySchema = z.object({
  operations: z.array(operationSchema).max(50),
});

interface SignedSubmissionPayload {
  version: number;
  manifest_version: number;
  session_id: string;
  judge_id: string;
  station_id: string;
  event_id: string;
  signed_at: string;
  data: {
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
    team_name?: string | null;
    sex?: string | null;
  };
}

type OperationResult = {
  id: string;
  status: 'done' | 'failed';
  error?: string;
};

function computeSignature(payload: string, keyBase64: string) {
  const key = Buffer.from(keyBase64, 'base64');
  return crypto.createHmac('sha256', key).update(payload).digest('base64');
}

async function processSubmission(
  operation: z.infer<typeof operationSchema>,
  signed: SignedSubmissionPayload,
  judgeDisplayName: string,
) {
  const submission = signed.data;

  const passageRes = await supabase
    .from('station_passages')
    .upsert(
      {
        event_id: submission.event_id,
        station_id: submission.station_id,
        patrol_id: submission.patrol_id,
        arrived_at: submission.arrived_at,
        wait_minutes: submission.wait_minutes,
      },
      { onConflict: 'event_id,patrol_id,station_id' },
    );

  if (passageRes.error) {
    throw passageRes.error;
  }

  const scoreRes = await supabase
    .from('station_scores')
    .upsert(
      {
        event_id: submission.event_id,
        station_id: submission.station_id,
        patrol_id: submission.patrol_id,
        points: submission.points,
        judge: judgeDisplayName,
        note: submission.note,
      },
      { onConflict: 'event_id,patrol_id,station_id' },
    );

  if (scoreRes.error) {
    throw scoreRes.error;
  }

  if (submission.finish_time) {
    const timingRes = await supabase
      .from('timings')
      .upsert(
        {
          event_id: submission.event_id,
          patrol_id: submission.patrol_id,
          finish_time: submission.finish_time,
        },
        { onConflict: 'event_id,patrol_id' },
      );

    if (timingRes.error) {
      throw timingRes.error;
    }
  }

  if (submission.use_target_scoring && submission.normalized_answers) {
    const quizRes = await supabase
      .from('station_quiz_responses')
      .upsert(
        {
          event_id: submission.event_id,
          station_id: submission.station_id,
          patrol_id: submission.patrol_id,
          category: submission.category,
          answers: submission.normalized_answers,
          correct_count: submission.points,
        },
        { onConflict: 'event_id,station_id,patrol_id' },
      );

    if (quizRes.error) {
      throw quizRes.error;
    }
  } else {
    const deleteRes = await supabase
      .from('station_quiz_responses')
      .delete()
      .match({
        event_id: submission.event_id,
        station_id: submission.station_id,
        patrol_id: submission.patrol_id,
      });

    if (deleteRes.error) {
      throw deleteRes.error;
    }
  }

  return <OperationResult>{ id: operation.id, status: 'done' };
}

async function handleSyncRequest(req: Request, res: Response) {
  const authHeader = req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const tokenStr = authHeader.slice('Bearer '.length).trim();
  let tokenPayload: ReturnType<typeof verifyAccessToken>;
  try {
    tokenPayload = verifyAccessToken(tokenStr);
    if (tokenPayload.type !== 'access') {
      throw new Error('Invalid token type');
    }
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const parsedBody = bodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const operations = parsedBody.data.operations;
  if (operations.length === 0) {
    return res.json({ results: [] });
  }

  const [{ data: session }, { data: judge }, { data: assignment }] = await Promise.all([
    supabase
      .from('judge_sessions')
      .select('*')
      .eq('id', tokenPayload.sessionId)
      .eq('judge_id', tokenPayload.sub)
      .maybeSingle(),
    supabase
      .from('judges')
      .select('id, display_name')
      .eq('id', tokenPayload.sub)
      .maybeSingle(),
    supabase
      .from('judge_assignments')
      .select('*')
      .eq('judge_id', tokenPayload.sub)
      .eq('station_id', tokenPayload.stationId)
      .eq('event_id', tokenPayload.eventId)
      .maybeSingle(),
  ]);

  if (!session || session.revoked_at) {
    return res.status(401).json({ error: 'Session revoked' });
  }

  if (!judge || !assignment) {
    return res.status(403).json({ error: 'Judge assignment not found' });
  }

  if (!session.public_key) {
    return res.status(400).json({ error: 'Missing device key' });
  }

  const { data: station, error: stationError } = await supabase
    .from('stations')
    .select('id, code')
    .eq('id', assignment.station_id)
    .maybeSingle();

  if (stationError || !station) {
    return res.status(500).json({ error: 'Failed to resolve station' });
  }

  const allowedCategories = normalizeAllowedCategories(assignment.allowed_categories, station.code);
  const allowedCategorySet = new Set<CategoryKey>(allowedCategories);
  const allowAllCategories = allowedCategorySet.size === 0;
  const isCategoryAllowed = (category: CategoryKey | null) =>
    !!category && (allowAllCategories || allowedCategorySet.has(category));

  const patrolCategoryCache = new Map<string, CategoryKey>();

  const results: OperationResult[] = [];

  for (const operation of operations) {
    try {
      const expectedSignature = computeSignature(operation.signature_payload, session.public_key);
      if (expectedSignature !== operation.signature) {
        results.push({ id: operation.id, status: 'failed', error: 'invalid-signature' });
        continue;
      }

      const parsed: SignedSubmissionPayload = JSON.parse(operation.signature_payload);

      if (parsed.session_id !== session.id) {
        results.push({ id: operation.id, status: 'failed', error: 'session-mismatch' });
        continue;
      }

      if (parsed.manifest_version !== session.manifest_version) {
        results.push({ id: operation.id, status: 'failed', error: 'manifest-version-mismatch' });
        continue;
      }

      if (parsed.station_id !== assignment.station_id || parsed.event_id !== assignment.event_id) {
        results.push({ id: operation.id, status: 'failed', error: 'assignment-mismatch' });
        continue;
      }

      if (parsed.data.station_id !== assignment.station_id || parsed.data.event_id !== assignment.event_id) {
        results.push({ id: operation.id, status: 'failed', error: 'payload-mismatch' });
        continue;
      }

      const normalizedSubmissionCategory = normalizeCategory(parsed.data.category);
      if (!normalizedSubmissionCategory) {
        results.push({ id: operation.id, status: 'failed', error: 'invalid-category' });
        continue;
      }

      if (!isCategoryAllowed(normalizedSubmissionCategory)) {
        results.push({ id: operation.id, status: 'failed', error: 'category-not-allowed' });
        continue;
      }

      const patrolId = parsed.data.patrol_id;
      let patrolCategory = patrolCategoryCache.get(patrolId);

      if (!patrolCategory) {
        const { data: patrol, error: patrolError } = await supabase
          .from('patrols')
          .select('category')
          .eq('id', patrolId)
          .maybeSingle();

        if (patrolError) {
          results.push({ id: operation.id, status: 'failed', error: 'patrol-fetch-failed' });
          continue;
        }

        if (!patrol) {
          results.push({ id: operation.id, status: 'failed', error: 'patrol-not-found' });
          continue;
        }

        const normalizedPatrolCategory = normalizeCategory(patrol.category);

        if (!normalizedPatrolCategory) {
          results.push({ id: operation.id, status: 'failed', error: 'patrol-category-invalid' });
          continue;
        }

        if (!isCategoryAllowed(normalizedPatrolCategory)) {
          results.push({ id: operation.id, status: 'failed', error: 'category-not-allowed' });
          continue;
        }

        patrolCategory = normalizedPatrolCategory;
        patrolCategoryCache.set(patrolId, normalizedPatrolCategory);
      }

      if (patrolCategory !== normalizedSubmissionCategory) {
        results.push({ id: operation.id, status: 'failed', error: 'category-mismatch' });
        continue;
      }

      const result = await processSubmission(operation, parsed, judge.display_name);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown-error';
      results.push({ id: operation.id, status: 'failed', error: message });
    }
  }
  res.json({ results });
}

syncRouter.post('/sync', handleSyncRequest);
syncRouter.post('/auth/sync', handleSyncRequest);

export default syncRouter;
