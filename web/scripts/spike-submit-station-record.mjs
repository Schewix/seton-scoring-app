import { createClient } from '@supabase/supabase-js';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DEFAULT_JWT_SECRET,
  DEFAULT_SUPABASE_URL,
  buildStationRecordPayload,
  createRng,
  createAccessTokenProvider,
  findDuplicates,
  percentile,
  randomInt,
  randomUuid,
  readEnv,
  readInteger,
  readNumber,
  setupMemoryLogging,
  signKey,
  writeReport,
} from './stress-helpers.mjs';

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
const seedRng = createRng(rngSeed ^ 0x9e3779b9);

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const eventId = randomUuid(seedRng);
const stationId = randomUuid(seedRng);
const judgeId = randomUuid(seedRng);
const sessionId = randomUuid(seedRng);

const { getAccessToken } = createAccessTokenProvider({
  jwtSecret,
  judgeId,
  sessionId,
  eventId,
  stationId,
  ttlMs: 2 * 60 * 60 * 1000,
  refreshSkewMs: 5 * 60 * 1000,
  logPrefix: 'spike',
});

const maxRequests = Math.ceil((durationSec * 1000) / intervalMinMs) * clients + clients;
const patrolCount = maxRequests + 10;

const patrolRows = Array.from({ length: patrolCount }, (_value, index) => ({
  id: randomUuid(seedRng),
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
  return buildStationRecordPayload({
    eventId,
    stationId,
    patrol,
    clientEventId,
    createdAt,
    useQuiz,
    useTiming,
    points: useQuiz ? 4 : 7,
    note: 'Spike test',
    category: 'M',
    waitMinutes: 1,
  });
}

async function sendRequest(payload) {
  const start = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAccessToken()}`,
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

let failureReason = null;
function recordFailure(message) {
  if (!failureReason) {
    failureReason = message;
  }
  process.exitCode = 1;
}

const memoryLogger = setupMemoryLogging({
  label: 'spike',
  intervalMinutes: readInteger('MEMORY_LOG_INTERVAL_MINUTES', 10),
  maxHeapDeltaMb: readNumber('MAX_HEAP_DELTA_MB', 0),
  onViolation: (message) => recordFailure(message),
});

async function run() {
  console.log('[spike] seeding data...');
  await seed();

  const durationMs = durationSec * 1000;
  const startTime = Date.now();

  const submissions = new Map();
  const successfulIds = new Set();
  const history = [];
  const metrics = {
    attempts: 0,
    success: 0,
    fail: 0,
    retries: 0,
    durations: [],
    windowDurations: [],
    windowAttempts: 0,
    windowSuccess: 0,
    windowFail: 0,
    windowRetries: 0,
  };

  function logMinuteMetrics() {
    const windowP50 = percentile(metrics.windowDurations, 50);
    const windowP95 = percentile(metrics.windowDurations, 95);
    const windowErrorRate = metrics.windowAttempts === 0 ? 0 : metrics.windowFail / metrics.windowAttempts;
    const totalErrorRate = metrics.attempts === 0 ? 0 : metrics.fail / metrics.attempts;

    history.push({
      timestamp: new Date().toISOString(),
      window_attempts: metrics.windowAttempts,
      window_success: metrics.windowSuccess,
      window_fail: metrics.windowFail,
      window_error_rate: windowErrorRate,
      window_p50_ms: Math.round(windowP50),
      window_p95_ms: Math.round(windowP95),
      total_attempts: metrics.attempts,
      total_success: metrics.success,
      total_fail: metrics.fail,
      total_error_rate: totalErrorRate,
      total_retries: metrics.retries,
    });

    console.log(
      `[spike] +1m ok ${metrics.windowSuccess}/${metrics.windowAttempts} err ${(windowErrorRate * 100).toFixed(2)}% ` +
        `p50 ${Math.round(windowP50)}ms p95 ${Math.round(windowP95)}ms`,
    );

    metrics.windowDurations = [];
    metrics.windowAttempts = 0;
    metrics.windowSuccess = 0;
    metrics.windowFail = 0;
    metrics.windowRetries = 0;
  }

  const logTimer = setInterval(logMinuteMetrics, 60 * 1000);

  async function runClient(index) {
    await delay(randomInt(rng, 0, intervalMinMs));
    while (Date.now() - startTime < durationMs) {
      const patrol = nextPatrol();
      const clientEventId = randomUuid(rng);
      const createdAt = new Date().toISOString();
      const useQuiz = shouldUseQuiz();
      const useTiming = shouldUseTiming();
      const payload = buildPayload({ patrol, clientEventId, createdAt, useQuiz, useTiming });

      submissions.set(clientEventId, { useQuiz, useTiming });

      const result = await sendRequest(payload);
      metrics.attempts += 1;
      metrics.windowAttempts += 1;
      metrics.durations.push(result.duration);
      metrics.windowDurations.push(result.duration);
      if (result.ok) {
        successfulIds.add(clientEventId);
        metrics.success += 1;
        metrics.windowSuccess += 1;
      } else {
        metrics.fail += 1;
        metrics.windowFail += 1;
      }

      if (shouldRetry()) {
        metrics.retries += 1;
        metrics.windowRetries += 1;
        await delay(randomInt(rng, 150, 600));
        const retryResult = await sendRequest(payload);
        metrics.attempts += 1;
        metrics.windowAttempts += 1;
        metrics.durations.push(retryResult.duration);
        metrics.windowDurations.push(retryResult.duration);
        if (retryResult.ok) {
          successfulIds.add(clientEventId);
          metrics.success += 1;
          metrics.windowSuccess += 1;
        } else {
          metrics.fail += 1;
          metrics.windowFail += 1;
        }
      }

      await delay(randomInt(rng, intervalMinMs, intervalMaxMs));
    }

    console.log(`[spike] client ${index} done`);
  }

  console.log(
    `[spike] start ${clients} clients for ${durationSec}s, interval ${intervalMinMs}-${intervalMaxMs}ms, retries ${(retryRate * 100).toFixed(1)}%`,
  );

  try {
    await Promise.all(Array.from({ length: clients }, (_value, index) => runClient(index + 1)));
  } finally {
    clearInterval(logTimer);
  }

  logMinuteMetrics();

  const p50 = percentile(metrics.durations, 50);
  const p95 = percentile(metrics.durations, 95);
  const errorRate = metrics.attempts === 0 ? 0 : metrics.fail / metrics.attempts;

  console.log('[spike] requests:', metrics.attempts);
  console.log('[spike] errors:', metrics.fail, `(${(errorRate * 100).toFixed(2)}%)`);
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

  if (failureReason) {
    failures.push(failureReason);
  }

  if (failures.length) {
    console.error('[spike] FAIL', failures);
    recordFailure(failures[0]);
  } else {
    console.log('[spike] PASS');
  }

  const summary = {
    attempts: metrics.attempts,
    success: metrics.success,
    fail: metrics.fail,
    error_rate: errorRate,
    retries: metrics.retries,
    p50_ms: Math.round(p50),
    p95_ms: Math.round(p95),
    unique_success: successfulIds.size,
  };

  const csvFields = [
    'timestamp',
    'window_attempts',
    'window_success',
    'window_fail',
    'window_error_rate',
    'window_p50_ms',
    'window_p95_ms',
    'total_attempts',
    'total_success',
    'total_fail',
    'total_error_rate',
    'total_retries',
  ];

  await writeReport({
    label: 'spike',
    status: failures.length ? 'failed' : 'completed',
    runStartTime: startTime,
    config: {
      clients,
      duration_sec: durationSec,
      interval_min_ms: intervalMinMs,
      interval_max_ms: intervalMaxMs,
      retry_rate: retryRate,
      quiz_rate: quizRate,
      timing_rate: timingRate,
      max_p95_ms: maxP95Ms,
      max_error_rate: maxErrorRate,
      endpoint,
      seed: rngSeed,
    },
    summary,
    history,
    csvFields,
    failures: failures.length ? failures.map((message) => ({ message })) : null,
    memory: {
      summary: memoryLogger.getSummary(),
      samples: memoryLogger.samples,
    },
  });
}

try {
  await run();
} finally {
  memoryLogger.stop();
  await cleanup();
}
