import { createClient } from '@supabase/supabase-js';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DEFAULT_JWT_SECRET,
  DEFAULT_SUPABASE_URL,
  buildPatrolRows,
  buildStationRecordPayload,
  checkStationInvariants,
  createAccessTokenProvider,
  createChaosSender,
  createRng,
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
const apiKey = readEnv('COLDSTART_API_KEY', anonKey || serviceRoleKey);

const seed = readInteger('SEED', 1337);
const rng = createRng(seed);
const seedRng = createRng(seed ^ 0x9e3779b9);

const idleMinutes = readInteger('IDLE_MINUTES', 5);
const burstRequests = readInteger('BURST_REQUESTS', 60);
const burstRounds = readInteger('BURST_ROUNDS', 5);
const chaosTimeoutRate = readNumber('CHAOS_TIMEOUT_RATE', 0);
const chaosTimeoutMs = readInteger('CHAOS_TIMEOUT_MS', 4000);
const chaos429Rate = readNumber('CHAOS_429_RATE', 0);
const chaosJitterMsMax = readInteger('CHAOS_JITTER_MS_MAX', 0);
const endpoint = readEnv('TARGET_URL', `${supabaseUrl}/functions/v1/submit-station-record`);

const config = {
  idleMinutes,
  burstRequests,
  burstRounds,
  chaosTimeoutRate,
  chaosTimeoutMs,
  chaos429Rate,
  chaosJitterMsMax,
  endpoint,
  seed,
};

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
  logPrefix: 'stress-coldstart',
});

const patrolRows = buildPatrolRows({
  count: burstRounds * burstRequests + 20,
  eventId,
  rng: seedRng,
  prefix: 'Coldstart Patrol',
});

let patrolIndex = 0;
function nextPatrol() {
  if (patrolIndex >= patrolRows.length) {
    throw new Error('Ran out of patrol rows for cold start test.');
  }
  const patrol = patrolRows[patrolIndex];
  patrolIndex += 1;
  return patrol;
}

async function seed() {
  const assertNoError = (error, context) => {
    if (error) {
      const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : String(error);
      throw new Error(`Seed ${context} failed: ${message}`);
    }
  };

  await cleanup();

  const { error: eventError } = await supabaseAdmin
    .from('events')
    .insert({ id: eventId, name: 'Cold Start Stress', scoring_locked: false });
  assertNoError(eventError, 'events');

  const { error: stationError } = await supabaseAdmin
    .from('stations')
    .insert({ id: stationId, event_id: eventId, code: 'C', name: 'Cold Start Station' });
  assertNoError(stationError, 'stations');

  for (let i = 0; i < patrolRows.length; i += 200) {
    const chunk = patrolRows.slice(i, i + 200);
    const { error: patrolError } = await supabaseAdmin.from('patrols').insert(chunk);
    assertNoError(patrolError, 'patrols');
  }

  const { error: judgeError } = await supabaseAdmin.from('judges').insert({
    id: judgeId,
    email: `coldstart-${judgeId}@example.com`,
    password_hash: 'hash',
    display_name: 'Cold Start Judge',
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

const submissions = new Map();
const successfulIds = new Set();
let stopRequested = false;
let failureReason = null;

function recordFailure(message) {
  failureReason = message;
  stopRequested = true;
  process.exitCode = 1;
}

const memoryLogger = setupMemoryLogging({
  label: 'stress-coldstart',
  intervalMinutes: readInteger('MEMORY_LOG_INTERVAL_MINUTES', 10),
  maxHeapDeltaMb: readNumber('MAX_HEAP_DELTA_MB', 0),
  onViolation: (message) => recordFailure(message),
});

const sendWithChaos = createChaosSender({
  rng,
  endpoint,
  getAccessToken,
  apiKey,
  chaosTimeoutRate,
  chaosTimeoutMs,
  chaos429Rate,
  chaosJitterMsMax,
});

const metrics = {
  attempts: 0,
  success: 0,
  fail: 0,
  durations: [],
  windowDurations: [],
  windowAttempts: 0,
  windowSuccess: 0,
  windowFail: 0,
};

const history = [];
const coldStartDurations = [];

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
  });

  console.log(
    `[stress-coldstart] +1m ok ${metrics.windowSuccess}/${metrics.windowAttempts} err ${(windowErrorRate * 100).toFixed(2)}% ` +
      `p50 ${Math.round(windowP50)}ms p95 ${Math.round(windowP95)}ms`,
  );

  metrics.windowDurations = [];
  metrics.windowAttempts = 0;
  metrics.windowSuccess = 0;
  metrics.windowFail = 0;
}

async function runBurst(round) {
  const requests = [];
  for (let i = 0; i < burstRequests; i += 1) {
    const patrol = nextPatrol();
    const clientEventId = randomUuid(rng);
    const createdAt = new Date().toISOString();
    const useQuiz = rng() < 0.2;
    const useTiming = rng() < 0.1;
    const payload = buildStationRecordPayload({
      eventId,
      stationId,
      patrol,
      clientEventId,
      createdAt,
      useQuiz,
      useTiming,
      points: useQuiz ? 4 : 7,
      note: `Cold start burst ${round}`,
      category: 'M',
      waitMinutes: 1,
    });
    submissions.set(clientEventId, { useQuiz, useTiming });

    requests.push({ clientEventId, payload });
  }

  const results = await Promise.all(
    requests.map(async (entry, index) => {
      const result = await sendWithChaos(entry.payload);
      metrics.attempts += 1;
      metrics.windowAttempts += 1;
      metrics.durations.push(result.duration);
      metrics.windowDurations.push(result.duration);

      if (result.ok) {
        successfulIds.add(entry.clientEventId);
        metrics.success += 1;
        metrics.windowSuccess += 1;
      } else {
        metrics.fail += 1;
        metrics.windowFail += 1;
      }

      if (index === 0) {
        coldStartDurations.push(result.duration);
      }
      return result;
    }),
  );

  return results;
}

let runStartTime = Date.now();

async function run() {
  console.log('[stress-coldstart] config', config);
  console.log('[stress-coldstart] seeding data...');
  await seed();

  runStartTime = Date.now();
  const logTimer = setInterval(logMinuteMetrics, 60 * 1000);

  try {
    for (let round = 1; round <= burstRounds; round += 1) {
      if (stopRequested) break;
      if (round > 1) {
        console.log(`[stress-coldstart] idle ${idleMinutes} minutes before round ${round}`);
        await delay(idleMinutes * 60 * 1000);
      }
      console.log(`[stress-coldstart] burst ${round}/${burstRounds}`);
      await runBurst(round);
    }
  } finally {
    clearInterval(logTimer);
  }

  logMinuteMetrics();

  const expectedScoreCount = successfulIds.size;
  const expectedQuizCount = Array.from(successfulIds).filter((id) => submissions.get(id)?.useQuiz).length;
  const expectedTimingCount = Array.from(successfulIds).filter((id) => submissions.get(id)?.useTiming).length;

  const invariant = await checkStationInvariants({
    supabaseAdmin,
    eventId,
    expectedScoreCount,
    expectedQuizCount,
    expectedTimingCount,
    reason: 'final',
    logPrefix: 'stress-coldstart',
  });

  if (!invariant.ok) {
    recordFailure('Invariant failure');
  }

  const p50 = percentile(metrics.durations, 50);
  const p95 = percentile(metrics.durations, 95);
  const p99 = percentile(metrics.durations, 99);
  const coldP50 = percentile(coldStartDurations, 50);
  const coldP95 = percentile(coldStartDurations, 95);
  const coldMax = coldStartDurations.length ? Math.max(...coldStartDurations) : 0;

  const summary = {
    attempts: metrics.attempts,
    success: metrics.success,
    fail: metrics.fail,
    error_rate: metrics.attempts === 0 ? 0 : metrics.fail / metrics.attempts,
    p50_ms: Math.round(p50),
    p95_ms: Math.round(p95),
    p99_ms: Math.round(p99),
    cold_p50_ms: Math.round(coldP50),
    cold_p95_ms: Math.round(coldP95),
    cold_max_ms: Math.round(coldMax),
    cold_overhead_ms: Math.round(Math.max(0, coldP50 - p50)),
    unique_success: successfulIds.size,
  };

  const failures = [];
  if (failureReason) {
    failures.push({ message: failureReason });
  }
  if (!invariant.ok) {
    failures.push(...invariant.failures);
  }

  await writeReport({
    label: 'stress-coldstart',
    status: failures.length ? 'failed' : 'completed',
    runStartTime,
    config,
    summary,
    history,
    csvFields: [
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
    ],
    failures: failures.length ? failures : null,
    memory: {
      summary: memoryLogger.getSummary(),
      samples: memoryLogger.samples,
    },
  });
}

process.on('SIGINT', () => {
  console.log('[stress-coldstart] SIGINT received, stopping...');
  stopRequested = true;
});
process.on('SIGTERM', () => {
  console.log('[stress-coldstart] SIGTERM received, stopping...');
  stopRequested = true;
});

try {
  await run();
} finally {
  memoryLogger.stop();
  await cleanup();
}
