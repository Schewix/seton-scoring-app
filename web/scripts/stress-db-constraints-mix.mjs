import { createClient } from '@supabase/supabase-js';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DEFAULT_JWT_SECRET,
  DEFAULT_SUPABASE_URL,
  buildPatrolRows,
  buildStationRecordPayload,
  computeBackoffMs,
  createAccessTokenProvider,
  createChaosSender,
  createRng,
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
const apiKey = readEnv('MIX_API_KEY', anonKey || serviceRoleKey);

const seed = readInteger('SEED', 1337);
const rng = createRng(seed);
const seedRng = createRng(seed ^ 0x9e3779b9);

const durationMinutes = readInteger('MIX_DURATION_MINUTES', 10);
const durationMs = durationMinutes * 60 * 1000;
const mixClients = readInteger('MIX_CLIENTS', 20);
const intervalMinMs = readInteger('MIX_MIN_INTERVAL_MS', 5000);
const intervalMaxMs = readInteger('MIX_MAX_INTERVAL_MS', 15000);
const updateRate = readNumber('UPDATE_RATE', 0.4);
const quizRate = readNumber('QUIZ_RATE', 0.3);
const timingRate = readNumber('TIMING_RATE', 0.2);
const dupClientEventRate = readNumber('DUP_CLIENT_EVENT_RATE', 0.1);
const chaosTimeoutRate = readNumber('CHAOS_TIMEOUT_RATE', 0.03);
const chaosTimeoutMs = readInteger('CHAOS_TIMEOUT_MS', 4000);
const chaos429Rate = readNumber('CHAOS_429_RATE', 0.02);
const chaosJitterMsMax = readInteger('CHAOS_JITTER_MS_MAX', 1200);
const endpoint = readEnv('TARGET_URL', `${supabaseUrl}/functions/v1/submit-station-record`);

const config = {
  durationMinutes,
  mixClients,
  intervalMinMs,
  intervalMaxMs,
  updateRate,
  quizRate,
  timingRate,
  dupClientEventRate,
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
  logPrefix: 'stress-dbmix',
});

const expectedSubmissions = mixClients * (Math.ceil(durationMs / intervalMinMs) + 2);
const updatePatrolCount = readInteger('UPDATE_PATROLS', Math.max(10, mixClients * 2));
const insertPatrolCount = readInteger(
  'INSERT_PATROLS',
  Math.max(20, Math.ceil(expectedSubmissions * (1 - updateRate)) + 10),
);

const patrolRows = buildPatrolRows({
  count: updatePatrolCount + insertPatrolCount,
  eventId,
  rng: seedRng,
  prefix: 'DB Mix Patrol',
});

const updatePatrols = patrolRows.slice(0, updatePatrolCount);
const insertPatrols = patrolRows.slice(updatePatrolCount);

let insertIndex = 0;
function nextInsertPatrol() {
  if (insertIndex >= insertPatrols.length) {
    insertIndex = 0;
  }
  const patrol = insertPatrols[insertIndex];
  insertIndex += 1;
  return patrol;
}

async function seedData() {
  const assertNoError = (error, context) => {
    if (error) {
      const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : String(error);
      throw new Error(`Seed ${context} failed: ${message}`);
    }
  };

  await cleanup();

  const { error: eventError } = await supabaseAdmin
    .from('events')
    .insert({ id: eventId, name: 'DB Mix Stress', scoring_locked: false });
  assertNoError(eventError, 'events');

  const { error: stationError } = await supabaseAdmin
    .from('stations')
    .insert({ id: stationId, event_id: eventId, code: 'X', name: 'DB Mix Station' });
  assertNoError(stationError, 'stations');

  for (let i = 0; i < patrolRows.length; i += 200) {
    const chunk = patrolRows.slice(i, i + 200);
    const { error: patrolError } = await supabaseAdmin.from('patrols').insert(chunk);
    assertNoError(patrolError, 'patrols');
  }

  const { error: judgeError } = await supabaseAdmin.from('judges').insert({
    id: judgeId,
    email: `dbmix-${judgeId}@example.com`,
    password_hash: 'hash',
    display_name: 'DB Mix Judge',
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

const latestByPatrol = new Map();
const touchedPatrols = new Set();
const lastClientEventByPatrol = new Map();
let stopRequested = false;
let failureReason = null;

function recordFailure(message) {
  failureReason = message;
  stopRequested = true;
  process.exitCode = 1;
}

const memoryLogger = setupMemoryLogging({
  label: 'stress-dbmix',
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
  retries: 0,
  durations: [],
  windowDurations: [],
  windowAttempts: 0,
  windowSuccess: 0,
  windowFail: 0,
  windowRetries: 0,
};

const history = [];

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
    unique_patrols: touchedPatrols.size,
    total_attempts: metrics.attempts,
    total_success: metrics.success,
    total_fail: metrics.fail,
    total_error_rate: totalErrorRate,
    total_retries: metrics.retries,
  });

  console.log(
    `[stress-dbmix] +1m ok ${metrics.windowSuccess}/${metrics.windowAttempts} err ${(windowErrorRate * 100).toFixed(2)}% ` +
      `p50 ${Math.round(windowP50)}ms p95 ${Math.round(windowP95)}ms patrols ${touchedPatrols.size}`,
  );

  metrics.windowDurations = [];
  metrics.windowAttempts = 0;
  metrics.windowSuccess = 0;
  metrics.windowFail = 0;
  metrics.windowRetries = 0;
}

function pickClientEventId(patrolId) {
  const previous = lastClientEventByPatrol.get(patrolId);
  if (previous && rng() < dupClientEventRate) {
    return previous;
  }
  const id = randomUuid(rng);
  lastClientEventByPatrol.set(patrolId, id);
  return id;
}

async function runClient(startTime) {
  await delay(randomInt(rng, 0, intervalMinMs));
  while (!stopRequested && Date.now() - startTime < durationMs) {
    const useUpdate = rng() < updateRate;
    const patrol = useUpdate
      ? updatePatrols[randomInt(rng, 0, updatePatrols.length - 1)]
      : nextInsertPatrol();

    const clientEventId = pickClientEventId(patrol.id);
    const nowMs = Date.now();
    const createdAtMs = nowMs - randomInt(rng, 0, 120000);
    const createdAt = new Date(createdAtMs).toISOString();
    const useQuiz = rng() < quizRate;
    const useTiming = rng() < timingRate;
    const points = randomInt(rng, 0, 12);

    const payload = buildStationRecordPayload({
      eventId,
      stationId,
      patrol,
      clientEventId,
      createdAt,
      useQuiz,
      useTiming,
      points,
      note: 'DB mix',
      category: 'M',
      waitMinutes: 1,
    });

    const result = await sendWithChaos(payload);
    metrics.attempts += 1;
    metrics.windowAttempts += 1;
    metrics.durations.push(result.duration);
    metrics.windowDurations.push(result.duration);

    if (result.ok) {
      metrics.success += 1;
      metrics.windowSuccess += 1;
      touchedPatrols.add(patrol.id);
      const current = latestByPatrol.get(patrol.id);
      if (!current || createdAtMs >= current.createdAtMs) {
        latestByPatrol.set(patrol.id, {
          createdAtMs,
          points,
          useQuiz,
          useTiming,
          clientEventId,
        });
      }
    } else {
      metrics.fail += 1;
      metrics.windowFail += 1;
      metrics.retries += 1;
      metrics.windowRetries += 1;
      await delay(computeBackoffMs(rng, 1));
    }

    await delay(randomInt(rng, intervalMinMs, intervalMaxMs));
  }
}

let runStartTime = Date.now();

async function run() {
  console.log('[stress-dbmix] config', config);
  console.log('[stress-dbmix] seeding data...');
  await seedData();

  runStartTime = Date.now();
  const logTimer = setInterval(logMinuteMetrics, 60 * 1000);

  try {
    await Promise.all(Array.from({ length: mixClients }, () => runClient(runStartTime)));
  } finally {
    clearInterval(logTimer);
  }

  logMinuteMetrics();

  const { data: scores } = await supabaseAdmin
    .from('station_scores')
    .select('patrol_id, points, client_created_at, client_event_id')
    .eq('event_id', eventId);
  const { data: passages } = await supabaseAdmin
    .from('station_passages')
    .select('patrol_id, client_created_at, client_event_id')
    .eq('event_id', eventId);
  const { data: quizzes } = await supabaseAdmin
    .from('station_quiz_responses')
    .select('patrol_id, client_created_at, client_event_id')
    .eq('event_id', eventId);
  const { data: timings } = await supabaseAdmin
    .from('timings')
    .select('patrol_id, client_created_at, client_event_id')
    .eq('event_id', eventId);

  const scoreIds = (scores ?? []).map((row) => row.client_event_id);
  const passageIds = (passages ?? []).map((row) => row.client_event_id);
  const quizIds = (quizzes ?? []).map((row) => row.client_event_id);
  const timingIds = (timings ?? []).map((row) => row.client_event_id);

  const failures = [];
  const expectedScoreCount = touchedPatrols.size;
  const expectedQuizCount = Array.from(latestByPatrol.values()).filter((item) => item.useQuiz).length;
  const expectedTimingCount = Array.from(latestByPatrol.values()).filter((item) => item.useTiming).length;

  if ((scores ?? []).length !== expectedScoreCount) {
    failures.push({ message: 'station_scores count mismatch', expected: expectedScoreCount, actual: (scores ?? []).length });
  }
  if ((passages ?? []).length !== expectedScoreCount) {
    failures.push({ message: 'station_passages count mismatch', expected: expectedScoreCount, actual: (passages ?? []).length });
  }
  if ((quizzes ?? []).length !== expectedQuizCount) {
    failures.push({ message: 'station_quiz_responses count mismatch', expected: expectedQuizCount, actual: (quizzes ?? []).length });
  }
  if ((timings ?? []).length !== expectedTimingCount) {
    failures.push({ message: 'timings count mismatch', expected: expectedTimingCount, actual: (timings ?? []).length });
  }

  const scoreDupes = findDuplicates(scoreIds);
  const passageDupes = findDuplicates(passageIds);
  const quizDupes = findDuplicates(quizIds);
  const timingDupes = findDuplicates(timingIds);

  if (scoreDupes.size || passageDupes.size || quizDupes.size || timingDupes.size) {
    failures.push({
      message: 'duplicate client_event_id entries detected',
      scoreDupes: Array.from(scoreDupes).slice(0, 5),
      passageDupes: Array.from(passageDupes).slice(0, 5),
      quizDupes: Array.from(quizDupes).slice(0, 5),
      timingDupes: Array.from(timingDupes).slice(0, 5),
    });
  }

  const scoreByPatrol = new Map((scores ?? []).map((row) => [row.patrol_id, row]));
  const passageByPatrol = new Map((passages ?? []).map((row) => [row.patrol_id, row]));
  const quizByPatrol = new Map((quizzes ?? []).map((row) => [row.patrol_id, row]));
  const timingByPatrol = new Map((timings ?? []).map((row) => [row.patrol_id, row]));

  for (const patrolId of touchedPatrols) {
    const expected = latestByPatrol.get(patrolId);
    const scoreRow = scoreByPatrol.get(patrolId);
    const passageRow = passageByPatrol.get(patrolId);

    if (!scoreRow) {
      failures.push({ message: 'missing station_scores row', patrol_id: patrolId });
      continue;
    }
    if (!passageRow) {
      failures.push({ message: 'missing station_passages row', patrol_id: patrolId });
      continue;
    }

    if (expected) {
      const scoreCreatedAt = new Date(scoreRow.client_created_at).getTime();
      const passageCreatedAt = new Date(passageRow.client_created_at).getTime();
      if (scoreRow.points !== expected.points) {
        failures.push({
          message: 'LWW points mismatch',
          patrol_id: patrolId,
          expected_points: expected.points,
          actual_points: scoreRow.points,
        });
      }
      if (scoreCreatedAt !== expected.createdAtMs) {
        failures.push({
          message: 'LWW score timestamp mismatch',
          patrol_id: patrolId,
          expected_ms: expected.createdAtMs,
          actual_ms: scoreCreatedAt,
        });
      }
      if (passageCreatedAt !== expected.createdAtMs) {
        failures.push({
          message: 'LWW passage timestamp mismatch',
          patrol_id: patrolId,
          expected_ms: expected.createdAtMs,
          actual_ms: passageCreatedAt,
        });
      }

      if (expected.useQuiz) {
        const quizRow = quizByPatrol.get(patrolId);
        if (!quizRow) {
          failures.push({ message: 'expected quiz response missing', patrol_id: patrolId });
        } else {
          const quizCreatedAt = new Date(quizRow.client_created_at).getTime();
          if (quizCreatedAt !== expected.createdAtMs) {
            failures.push({
              message: 'quiz timestamp mismatch',
              patrol_id: patrolId,
              expected_ms: expected.createdAtMs,
              actual_ms: quizCreatedAt,
            });
          }
        }
      } else if (quizByPatrol.has(patrolId)) {
        failures.push({ message: 'quiz response should be deleted', patrol_id: patrolId });
      }

      if (expected.useTiming) {
        const timingRow = timingByPatrol.get(patrolId);
        if (!timingRow) {
          failures.push({ message: 'expected timing missing', patrol_id: patrolId });
        } else {
          const timingCreatedAt = new Date(timingRow.client_created_at).getTime();
          if (timingCreatedAt !== expected.createdAtMs) {
            failures.push({
              message: 'timing timestamp mismatch',
              patrol_id: patrolId,
              expected_ms: expected.createdAtMs,
              actual_ms: timingCreatedAt,
            });
          }
        }
      } else if (timingByPatrol.has(patrolId)) {
        failures.push({ message: 'timing should be absent', patrol_id: patrolId });
      }
    }
  }

  if (failureReason) {
    failures.push({ message: failureReason });
  }

  if (failures.length) {
    console.error('[stress-dbmix] FAIL', failures);
    process.exitCode = 1;
  } else {
    console.log('[stress-dbmix] PASS');
  }

  const p50 = percentile(metrics.durations, 50);
  const p95 = percentile(metrics.durations, 95);
  const summary = {
    attempts: metrics.attempts,
    success: metrics.success,
    fail: metrics.fail,
    error_rate: metrics.attempts === 0 ? 0 : metrics.fail / metrics.attempts,
    retries: metrics.retries,
    p50_ms: Math.round(p50),
    p95_ms: Math.round(p95),
    unique_patrols: touchedPatrols.size,
    expected_scores: expectedScoreCount,
    expected_quiz: expectedQuizCount,
    expected_timing: expectedTimingCount,
  };

  await writeReport({
    label: 'stress-dbmix',
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
      'unique_patrols',
      'total_attempts',
      'total_success',
      'total_fail',
      'total_error_rate',
      'total_retries',
    ],
    failures: failures.length ? failures : null,
    memory: {
      summary: memoryLogger.getSummary(),
      samples: memoryLogger.samples,
    },
  });
}

process.on('SIGINT', () => {
  console.log('[stress-dbmix] SIGINT received, stopping...');
  stopRequested = true;
});
process.on('SIGTERM', () => {
  console.log('[stress-dbmix] SIGTERM received, stopping...');
  stopRequested = true;
});

try {
  await run();
} finally {
  memoryLogger.stop();
  await cleanup();
}
