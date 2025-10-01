import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { createSupabaseServerClient } from '../_lib/supabaseServer.js';

const REQUIRED_ENV_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];

for (const name of REQUIRED_ENV_VARS) {
  if (!process.env[name]) {
    throw new Error(`Missing environment variable ${name} for sync handler`);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

function applyCors(res: any) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

interface OperationBody {
  id: string;
  type: 'submission';
  signature: string;
  signature_payload: string;
  payload?: Record<string, unknown>;
}

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

interface OperationResult {
  id: string;
  status: 'done' | 'failed';
  error?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOperation(value: unknown): value is OperationBody {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    candidate.type === 'submission' &&
    isNonEmptyString(candidate.signature) &&
    isNonEmptyString(candidate.signature_payload) &&
    (candidate.payload === undefined || typeof candidate.payload === 'object')
  );
}

function parseOperations(body: any): OperationBody[] | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const operations = (body as Record<string, unknown>).operations;
  if (!Array.isArray(operations) || operations.length > 50) {
    return null;
  }

  const parsed: OperationBody[] = [];
  for (const op of operations) {
    if (!isOperation(op)) {
      return null;
    }
    parsed.push(op);
  }

  return parsed;
}

function computeSignature(payload: string, keyBase64: string) {
  const key = Buffer.from(keyBase64, 'base64');
  return createHmac('sha256', key).update(payload).digest('base64');
}

async function processSubmission(
  operation: OperationBody,
  signed: SignedSubmissionPayload,
  judgeDisplayName: string,
) {
  const submission = signed.data;

  const passageRes = await supabaseAdmin
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

  const scoreRes = await supabaseAdmin
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
    const timingRes = await supabaseAdmin
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
    const quizRes = await supabaseAdmin
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
    const deleteRes = await supabaseAdmin
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

export default async function handler(req: any, res: any) {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const supabaseClient = createSupabaseServerClient(req, res);
  const {
    data: { user },
    error: authError,
  } = await supabaseClient.auth.getUser();

  if (authError) {
    console.error('Failed to read auth session', authError);
    return res.status(500).json({ error: 'Auth error' });
  }

  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const operations = parseOperations(req.body);
  if (!operations) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  if (operations.length === 0) {
    return res.status(200).json({ results: [] });
  }

  const { data: judge, error: judgeError } = await supabaseAdmin
    .from('judges')
    .select('id, display_name')
    .eq('id', user.id)
    .maybeSingle();

  if (judgeError) {
    console.error('Failed to load judge record', judgeError);
    return res.status(500).json({ error: 'Failed to load judge' });
  }

  if (!judge) {
    return res.status(403).json({ error: 'Judge not found' });
  }

  const results: OperationResult[] = [];
  const sessionCache = new Map<string, any>();
  const assignmentCache = new Map<string, any>();

  for (const operation of operations) {
    try {
      const parsed: SignedSubmissionPayload = JSON.parse(operation.signature_payload);

      if (parsed.judge_id && parsed.judge_id !== user.id) {
        results.push({ id: operation.id, status: 'failed', error: 'judge-mismatch' });
        continue;
      }

      let session = sessionCache.get(parsed.session_id);
      if (!session) {
        const { data: sessionRow, error: sessionError } = await supabaseAdmin
          .from('judge_sessions')
          .select('*')
          .eq('id', parsed.session_id)
          .eq('judge_id', user.id)
          .maybeSingle();

        if (sessionError) {
          throw sessionError;
        }

        session = sessionRow;
        sessionCache.set(parsed.session_id, sessionRow);
      }

      if (!session || session.revoked_at) {
        results.push({ id: operation.id, status: 'failed', error: 'session-revoked' });
        continue;
      }

      if (!session.public_key) {
        results.push({ id: operation.id, status: 'failed', error: 'missing-device-key' });
        continue;
      }

      const expectedSignature = computeSignature(operation.signature_payload, session.public_key);
      if (expectedSignature !== operation.signature) {
        results.push({ id: operation.id, status: 'failed', error: 'invalid-signature' });
        continue;
      }

      if (parsed.manifest_version !== session.manifest_version) {
        results.push({ id: operation.id, status: 'failed', error: 'manifest-version-mismatch' });
        continue;
      }

      const assignmentKey = `${parsed.station_id}:${parsed.event_id}`;
      let assignment = assignmentCache.get(assignmentKey);
      if (!assignment) {
        const { data: assignmentRow, error: assignmentError } = await supabaseAdmin
          .from('judge_assignments')
          .select('*')
          .eq('judge_id', user.id)
          .eq('station_id', parsed.station_id)
          .eq('event_id', parsed.event_id)
          .maybeSingle();

        if (assignmentError) {
          throw assignmentError;
        }

        assignment = assignmentRow;
        assignmentCache.set(assignmentKey, assignmentRow);
      }

      if (!assignment) {
        results.push({ id: operation.id, status: 'failed', error: 'assignment-missing' });
        continue;
      }

      if (
        parsed.data.station_id !== assignment.station_id ||
        parsed.data.event_id !== assignment.event_id
      ) {
        results.push({ id: operation.id, status: 'failed', error: 'payload-mismatch' });
        continue;
      }

      const result = await processSubmission(operation, parsed, judge.display_name);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown-error';
      results.push({ id: operation.id, status: 'failed', error: message });
    }
  }

  return res.status(200).json({ results });
}
