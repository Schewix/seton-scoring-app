import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_SUPABASE_URL = 'http://127.0.0.1:54321';
const DEFAULT_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

function readEnv(name, fallback = '') {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function readNumber(name, fallback) {
  const raw = readEnv(name, '');
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readInteger(name, fallback) {
  const raw = readEnv(name, '');
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function signKey(secret, role) {
  return jwt.sign({ role }, secret, { expiresIn: '10y' });
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((pct / 100) * sorted.length) - 1;
  const idx = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[idx];
}

const supabaseUrl = readEnv('SUPABASE_URL', DEFAULT_SUPABASE_URL).replace(/\/$/, '');
const jwtSecret = readEnv('SUPABASE_JWT_SECRET', readEnv('JWT_SECRET', DEFAULT_JWT_SECRET));
const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY', signKey(jwtSecret, 'service_role'));
const anonKey = readEnv('SUPABASE_ANON_KEY', signKey(jwtSecret, 'anon'));
const apiKey = readEnv('SPIKE_API_KEY', anonKey || serviceRoleKey);

const clients = readInteger('SPIKE_CLIENTS', 30);
const durationSec = readInteger('SPIKE_DURATION_SEC', 120);
const intervalMinMs = readInteger('SPIKE_INTERVAL_MIN_MS', 10000);
const intervalMaxMs = readInteger('SPIKE_INTERVAL_MAX_MS', 20000);
const retryRate = readNumber('SPIKE_RETRY_RATE', 0.08);
const quizRate = readNumber('SPIKE_QUIZ_RATE', 0.2);
const timingRate = readNumber('SPIKE_TIMING_RATE', 0.1);
const maxP95Ms = readInteger('SPIKE_MAX_P95_MS', 1000);
const maxErrorRate = readNumber('SPIKE_MAX_ERROR_RATE', 0.01);
const rngSeed = readInteger('SPIKE_RNG_SEED', 1337);
const endpoint = readEnv(
  'SPIKE_ENDPOINT',
  `${supabaseUrl.replace(/\/$/, '')}/functions/v1/submit-station-record`,
);

const rng = createRng(rngSeed);

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const eventId = crypto.randomUUID();
const stationId = crypto.randomUUID();
const judgeId = crypto.randomUUID();
const sessionId = crypto.randomUUID();

const accessToken = jwt.sign(
  {
    sub: judgeId,
    sessionId,
    eventId,
    stationId,
    role: 'authenticated',
    type: 'access',
  },
  jwtSecret,
  { expiresIn: '2h' },
);

const maxRequests = Math.ceil((durationSec * 1000) / intervalMinMs) * clients + clients;
const patrolCount = maxRequests + 10;

const patrolRows = Array.from({ length: patrolCount }, (_value, index) => ({
  id: crypto.randomUUID(),
  event_id: eventId,
  team_name: `Spike Patrol ${index + 1}`,
  category: 'M',
  sex: 'H',
  patrol_code: `MH-${index + 1}`,
  active: true,
}));

let patrolIndex = 0;
function nextPatrol() {
  if (patrolIndex >= patrolRows.length) {
    throw new Error('Ran out of pre-seeded patrols for spike test.');
  }
  const patrol = patrolRows[patrolIndex];
  patrolIndex += 1;
  return patrol;
}

function randomInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function shouldRetry() {
  return rng() < retryRate;
}

function shouldUseQuiz() {
  return rng() < quizRate;
}

function shouldUseTiming() {
  return rng() < timingRate;
}

function buildPayload({ patrol, clientEventId, createdAt, useQuiz, useTiming }) {
  return {
    client_event_id: clientEventId,
    client_created_at: createdAt,
    event_id: eventId,
    station_id: stationId,
    patrol_id: patrol.id,
    category: 'M',
    arrived_at: createdAt,
    wait_minutes: 1,
    points: useQuiz ? 4 : 7,
    note: 'Spike test',
    use_target_scoring: useQuiz,
    normalized_answers: useQuiz ? 'ABCD' : null,
    finish_time: useTiming ? createdAt : null,
    patrol_code: patrol.patrol_code,
    team_name: patrol.team_name,
    sex: patrol.sex,
  };
}

async function sendRequest(payload) {
  const start = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
      },
      body: JSON.stringify(payload),
    });
    const duration = performance.now() - start;
    return { ok: response.ok, status: response.status, duration };
  } catch (error) {
    const duration = performance.now() - start;
    return { ok: false, status: 0, duration, error };
  }
}

async function seed() {
  const assertNoError = (error, context) => {
    if (error) {
      const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : String(error);
      throw new Error(`Seed ${context} failed: ${message}`);
    }
  };

  const { error: eventError } = await supabaseAdmin
    .from('events')
    .insert({ id: eventId, name: 'Spike Test', scoring_locked: false });
  assertNoError(eventError, 'events');

  const { error: stationError } = await supabaseAdmin
    .from('stations')
    .insert({ id: stationId, event_id: eventId, code: 'Z', name: 'Spike Station' });
  assertNoError(stationError, 'stations');

  for (let i = 0; i < patrolRows.length; i += 200) {
    const chunk = patrolRows.slice(i, i + 200);
    const { error: patrolError } = await supabaseAdmin.from('patrols').insert(chunk);
    assertNoError(patrolError, 'patrols');
  }

  const { error: judgeError } = await supabaseAdmin.from('judges').insert({
    id: judgeId,
    email: `spike-${judgeId}@example.com`,
    password_hash: 'hash',
    display_name: 'Spike Judge',
  });
  assertNoError(judgeError, 'judges');

  const { error: assignmentError } = await supabaseAdmin.from('judge_assignments').insert({
    judge_id: judgeId,
    station_id: stationId,
    event_id: eventId,
    allowed_categories: ['M'],
    allowed_tasks: [],
  });
  assertNoError(assignmentError, 'judge_assignments');

  const { error: sessionError } = await supabaseAdmin.from('judge_sessions').insert({
    id: sessionId,
    judge_id: judgeId,
    station_id: stationId,
    device_salt: 'salt',
    public_key: 'pub',
    manifest_version: 1,
    refresh_token_hash: 'hash',
    refresh_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
  assertNoError(sessionError, 'judge_sessions');
}

async function cleanup() {
  await supabaseAdmin.from('station_quiz_responses').delete().eq('event_id', eventId);
  await supabaseAdmin.from('station_scores').delete().eq('event_id', eventId);
  await supabaseAdmin.from('station_passages').delete().eq('event_id', eventId);
  await supabaseAdmin.from('timings').delete().eq('event_id', eventId);
  await supabaseAdmin.from('judge_assignments').delete().eq('event_id', eventId);
  await supabaseAdmin.from('judge_sessions').delete().eq('id', sessionId);
  await supabaseAdmin.from('stations').delete().eq('event_id', eventId);
  await supabaseAdmin.from('patrols').delete().eq('event_id', eventId);
  await supabaseAdmin.from('judges').delete().eq('id', judgeId);
  await supabaseAdmin.from('events').delete().eq('id', eventId);
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return duplicates;
}

async function run() {
  console.log('[spike] seeding data...');
  await seed();

  const durationMs = durationSec * 1000;
  const startTime = Date.now();

  const submissions = new Map();
  const successfulIds = new Set();
  const durations = [];
  let totalRequests = 0;
  let totalErrors = 0;

  async function runClient(index) {
    await delay(randomInt(0, intervalMinMs));
    while (Date.now() - startTime < durationMs) {
      const patrol = nextPatrol();
      const clientEventId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const useQuiz = shouldUseQuiz();
      const useTiming = shouldUseTiming();
      const payload = buildPayload({ patrol, clientEventId, createdAt, useQuiz, useTiming });

      submissions.set(clientEventId, { useQuiz, useTiming });

      const result = await sendRequest(payload);
      totalRequests += 1;
      durations.push(result.duration);
      if (result.ok) {
        successfulIds.add(clientEventId);
      } else {
        totalErrors += 1;
      }

      if (shouldRetry()) {
        await delay(randomInt(150, 600));
        const retryResult = await sendRequest(payload);
        totalRequests += 1;
        durations.push(retryResult.duration);
        if (retryResult.ok) {
          successfulIds.add(clientEventId);
        } else {
          totalErrors += 1;
        }
      }

      await delay(randomInt(intervalMinMs, intervalMaxMs));
    }

    console.log(`[spike] client ${index} done`);
  }

  console.log(
    `[spike] start ${clients} clients for ${durationSec}s, interval ${intervalMinMs}-${intervalMaxMs}ms, retries ${(retryRate * 100).toFixed(1)}%`,
  );

  await Promise.all(Array.from({ length: clients }, (_value, index) => runClient(index + 1)));

  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const errorRate = totalRequests === 0 ? 0 : totalErrors / totalRequests;

  console.log('[spike] requests:', totalRequests);
  console.log('[spike] errors:', totalErrors, `(${(errorRate * 100).toFixed(2)}%)`);
  console.log('[spike] p50:', Math.round(p50), 'ms');
  console.log('[spike] p95:', Math.round(p95), 'ms');

  await delay(500);

  const { data: scores } = await supabaseAdmin
    .from('station_scores')
    .select('client_event_id')
    .eq('event_id', eventId);
  const { data: passages } = await supabaseAdmin
    .from('station_passages')
    .select('client_event_id')
    .eq('event_id', eventId);
  const { data: quizzes } = await supabaseAdmin
    .from('station_quiz_responses')
    .select('client_event_id')
    .eq('event_id', eventId);
  const { data: timings } = await supabaseAdmin
    .from('timings')
    .select('client_event_id')
    .eq('event_id', eventId);

  const scoreIds = (scores ?? []).map((row) => row.client_event_id);
  const passageIds = (passages ?? []).map((row) => row.client_event_id);
  const quizIds = (quizzes ?? []).map((row) => row.client_event_id);
  const timingIds = (timings ?? []).map((row) => row.client_event_id);

  const scoreDupes = findDuplicates(scoreIds);
  const passageDupes = findDuplicates(passageIds);
  const quizDupes = findDuplicates(quizIds);
  const timingDupes = findDuplicates(timingIds);

  const expectedScoreCount = successfulIds.size;
  const expectedQuizCount = Array.from(successfulIds).filter((id) => submissions.get(id)?.useQuiz).length;
  const expectedTimingCount = Array.from(successfulIds).filter((id) => submissions.get(id)?.useTiming).length;

  const failures = [];
  if (errorRate > maxErrorRate) {
    failures.push(`error rate ${(errorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%`);
  }
  if (p95 > maxP95Ms) {
    failures.push(`p95 ${Math.round(p95)}ms > ${maxP95Ms}ms`);
  }
  if (scoreDupes.size || passageDupes.size || quizDupes.size || timingDupes.size) {
    failures.push('found duplicate client_event_id entries');
  }
  if ((scores ?? []).length !== expectedScoreCount) {
    failures.push(`station_scores count ${(scores ?? []).length} != expected ${expectedScoreCount}`);
  }
  if ((passages ?? []).length !== expectedScoreCount) {
    failures.push(`station_passages count ${(passages ?? []).length} != expected ${expectedScoreCount}`);
  }
  if ((quizzes ?? []).length !== expectedQuizCount) {
    failures.push(`station_quiz_responses count ${(quizzes ?? []).length} != expected ${expectedQuizCount}`);
  }
  if ((timings ?? []).length !== expectedTimingCount) {
    failures.push(`timings count ${(timings ?? []).length} != expected ${expectedTimingCount}`);
  }

  if (failures.length) {
    console.error('[spike] FAIL', failures);
    process.exitCode = 1;
  } else {
    console.log('[spike] PASS');
  }
}

try {
  await run();
} finally {
  await cleanup();
}
