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
const apiKey = readEnv('STRESS_API_KEY', anonKey || serviceRoleKey);

const seed = readInteger('SEED', 1337);
const rng = createRng(seed);
const seedRng = createRng(seed ^ 0x9e3779b9);

const durationMinutes = readInteger('STRESS_DURATION_MINUTES', 60);
const durationMs = durationMinutes * 60 * 1000;
const writers = readInteger('WRITERS', 30);
const readers = readInteger('READERS', 10);
const writeMinIntervalMs = readInteger('WRITE_MIN_INTERVAL_MS', 10000);
const writeMaxIntervalMs = readInteger('WRITE_MAX_INTERVAL_MS', 30000);
const readIntervalMs = readInteger('READ_INTERVAL_MS', 2000);
const chaosTimeoutRate = readNumber('CHAOS_TIMEOUT_RATE', 0);
const chaosTimeoutMs = readInteger('CHAOS_TIMEOUT_MS', 4000);
const chaos429Rate = readNumber('CHAOS_429_RATE', 0);
const chaosJitterMsMax = readInteger('CHAOS_JITTER_MS_MAX', 0);
const endpoint = readEnv('TARGET_URL', `${supabaseUrl}/functions/v1/submit-station-record`);
const scoreboardTemplate = readEnv('SCOREBOARD_URL', '');

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
  logPrefix: 'stress-scoreboard',
});

const config = {
  durationMinutes,
  writers,
  readers,
  writeMinIntervalMs,
  writeMaxIntervalMs,
  readIntervalMs,
  endpoint,
  scoreboardTemplate: scoreboardTemplate || '(supabase rest)',
  chaosTimeoutRate,
  chaosTimeoutMs,
  chaos429Rate,
  chaosJitterMsMax,
  seed,
};

function resolveScoreboardUrl() {
  if (!scoreboardTemplate) {
    const encodedEventId = encodeURIComponent(eventId);
    return `${supabaseUrl}/rest/v1/scoreboard_view?select=*&event_id=eq.${encodedEventId}` +
      `&order=category.asc,sex.asc,rank_in_bracket.asc`;
  }
  return scoreboardTemplate.replace(/\{eventId\}/g, eventId);
}

const scoreboardUrl = resolveScoreboardUrl();

const maxWritesPerClient = Math.ceil(durationMs / writeMinIntervalMs) + 3;
const expectedUniqueWrites = writers * maxWritesPerClient;
const patrolRows = buildPatrolRows({
  count: expectedUniqueWrites + 25,
  eventId,
  rng: seedRng,
  prefix: 'Scoreboard Patrol',
});

let patrolIndex = 0;
function nextPatrol() {
  if (patrolIndex >= patrolRows.length) {
    throw new Error('Ran out of patrol rows for scoreboard stress. Increase seed count.');
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
    .insert({ id: eventId, name: 'Scoreboard Stress', scoring_locked: false });
  assertNoError(eventError, 'events');

  const { error: stationError } = await supabaseAdmin
    .from('stations')
    .insert({ id: stationId, event_id: eventId, code: 'S', name: 'Scoreboard Station' });
  assertNoError(stationError, 'stations');

  for (let i = 0; i < patrolRows.length; i += 200) {
    const chunk = patrolRows.slice(i, i + 200);
    const { error: patrolError } = await supabaseAdmin.from('patrols').insert(chunk);
    assertNoError(patrolError, 'patrols');
  }

  const { error: judgeError } = await supabaseAdmin.from('judges').insert({
    id: judgeId,
    email: `scoreboard-${judgeId}@example.com`,
    password_hash: 'hash',
    display_name: 'Scoreboard Judge',
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
let inFlightRequests = 0;
let maxInFlight = 0;

function recordFailure(message) {
  failureReason = message;
  stopRequested = true;
  process.exitCode = 1;
}

const memoryLogger = setupMemoryLogging({
  label: 'stress-scoreboard',
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
  onRequestStart: () => {
    inFlightRequests += 1;
    maxInFlight = Math.max(maxInFlight, inFlightRequests);
  },
  onRequestEnd: () => {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
  },
});

const writeMetrics = {
  attempts: 0,
  success: 0,
  fail: 0,
  durations: [],
  windowDurations: [],
  windowAttempts: 0,
  windowSuccess: 0,
  windowFail: 0,
};

const readMetrics = {
  attempts: 0,
  success: 0,
  fail: 0,
  durations: [],
  windowDurations: [],
  windowAttempts: 0,
  windowSuccess: 0,
  windowFail: 0,
  windowBytes: [],
  totalBytes: 0,
};

const history = [];

function logMinuteMetrics() {
  const writeP50 = percentile(writeMetrics.windowDurations, 50);
  const writeP95 = percentile(writeMetrics.windowDurations, 95);
  const writeErrorRate = writeMetrics.windowAttempts === 0 ? 0 : writeMetrics.windowFail / writeMetrics.windowAttempts;

  const readP50 = percentile(readMetrics.windowDurations, 50);
  const readP95 = percentile(readMetrics.windowDurations, 95);
  const readErrorRate = readMetrics.windowAttempts === 0 ? 0 : readMetrics.windowFail / readMetrics.windowAttempts;
  const readAvgBytes = readMetrics.windowBytes.length
    ? Math.round(readMetrics.windowBytes.reduce((sum, value) => sum + value, 0) / readMetrics.windowBytes.length)
    : 0;

  history.push({
    timestamp: new Date().toISOString(),
    write_window_attempts: writeMetrics.windowAttempts,
    write_window_success: writeMetrics.windowSuccess,
    write_window_fail: writeMetrics.windowFail,
    write_window_error_rate: writeErrorRate,
    write_window_p50_ms: Math.round(writeP50),
    write_window_p95_ms: Math.round(writeP95),
    read_window_attempts: readMetrics.windowAttempts,
    read_window_success: readMetrics.windowSuccess,
    read_window_fail: readMetrics.windowFail,
    read_window_error_rate: readErrorRate,
    read_window_p50_ms: Math.round(readP50),
    read_window_p95_ms: Math.round(readP95),
    read_window_avg_bytes: readAvgBytes,
    write_total_attempts: writeMetrics.attempts,
    write_total_success: writeMetrics.success,
    write_total_fail: writeMetrics.fail,
    read_total_attempts: readMetrics.attempts,
    read_total_success: readMetrics.success,
    read_total_fail: readMetrics.fail,
  });

  console.log(
    `[stress-scoreboard] +1m write ok ${writeMetrics.windowSuccess}/${writeMetrics.windowAttempts} err ${(writeErrorRate * 100).toFixed(2)}% ` +
      `p50 ${Math.round(writeP50)}ms p95 ${Math.round(writeP95)}ms | ` +
      `read ok ${readMetrics.windowSuccess}/${readMetrics.windowAttempts} err ${(readErrorRate * 100).toFixed(2)}% ` +
      `p50 ${Math.round(readP50)}ms p95 ${Math.round(readP95)}ms avg ${readAvgBytes}B`,
  );

  writeMetrics.windowDurations = [];
  writeMetrics.windowAttempts = 0;
  writeMetrics.windowSuccess = 0;
  writeMetrics.windowFail = 0;

  readMetrics.windowDurations = [];
  readMetrics.windowAttempts = 0;
  readMetrics.windowSuccess = 0;
  readMetrics.windowFail = 0;
  readMetrics.windowBytes = [];
}

async function readScoreboard() {
  const start = performance.now();
  try {
    const response = await fetch(scoreboardUrl, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const body = await response.text();
    const duration = performance.now() - start;
    const size = Buffer.byteLength(body, 'utf8');

    readMetrics.attempts += 1;
    readMetrics.windowAttempts += 1;
    readMetrics.durations.push(duration);
    readMetrics.windowDurations.push(duration);

    if (response.ok) {
      readMetrics.success += 1;
      readMetrics.windowSuccess += 1;
      readMetrics.totalBytes += size;
      readMetrics.windowBytes.push(size);
    } else {
      readMetrics.fail += 1;
      readMetrics.windowFail += 1;
    }

    return response.ok;
  } catch (error) {
    const duration = performance.now() - start;
    readMetrics.attempts += 1;
    readMetrics.windowAttempts += 1;
    readMetrics.durations.push(duration);
    readMetrics.windowDurations.push(duration);
    readMetrics.fail += 1;
    readMetrics.windowFail += 1;
    return false;
  }
}

async function runWriter() {
  await delay(randomInt(rng, 0, writeMinIntervalMs));
  while (!stopRequested && Date.now() - runStartTime < durationMs) {
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
      note: 'Scoreboard stress',
      category: 'M',
      waitMinutes: 1,
    });

    submissions.set(clientEventId, { useQuiz, useTiming });

    const result = await sendWithChaos(payload);
    writeMetrics.attempts += 1;
    writeMetrics.windowAttempts += 1;
    writeMetrics.durations.push(result.duration);
    writeMetrics.windowDurations.push(result.duration);

    if (result.ok) {
      successfulIds.add(clientEventId);
      writeMetrics.success += 1;
      writeMetrics.windowSuccess += 1;
    } else {
      writeMetrics.fail += 1;
      writeMetrics.windowFail += 1;
    }

    await delay(randomInt(rng, writeMinIntervalMs, writeMaxIntervalMs));
  }
}

async function runReader() {
  await delay(randomInt(rng, 0, readIntervalMs));
  while (!stopRequested && Date.now() - runStartTime < durationMs) {
    await readScoreboard();
    await delay(readIntervalMs);
  }
}

let runStartTime = Date.now();

async function run() {
  console.log('[stress-scoreboard] config', config);
  console.log('[stress-scoreboard] seeding data...');
  await seed();

  runStartTime = Date.now();
  const logTimer = setInterval(logMinuteMetrics, 60 * 1000);

  try {
    await Promise.all([
      ...Array.from({ length: writers }, () => runWriter()),
      ...Array.from({ length: readers }, () => runReader()),
    ]);
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
    logPrefix: 'stress-scoreboard',
  });

  if (!invariant.ok) {
    recordFailure('Invariant failure');
  }

  const writeP50 = percentile(writeMetrics.durations, 50);
  const writeP95 = percentile(writeMetrics.durations, 95);
  const readP50 = percentile(readMetrics.durations, 50);
  const readP95 = percentile(readMetrics.durations, 95);

  const summary = {
    write_attempts: writeMetrics.attempts,
    write_success: writeMetrics.success,
    write_fail: writeMetrics.fail,
    write_error_rate: writeMetrics.attempts === 0 ? 0 : writeMetrics.fail / writeMetrics.attempts,
    write_p50_ms: Math.round(writeP50),
    write_p95_ms: Math.round(writeP95),
    read_attempts: readMetrics.attempts,
    read_success: readMetrics.success,
    read_fail: readMetrics.fail,
    read_error_rate: readMetrics.attempts === 0 ? 0 : readMetrics.fail / readMetrics.attempts,
    read_p50_ms: Math.round(readP50),
    read_p95_ms: Math.round(readP95),
    read_avg_bytes: readMetrics.success === 0 ? 0 : Math.round(readMetrics.totalBytes / readMetrics.success),
    unique_success: successfulIds.size,
    max_inflight: maxInFlight,
  };

  const csvFields = [
    'timestamp',
    'write_window_attempts',
    'write_window_success',
    'write_window_fail',
    'write_window_error_rate',
    'write_window_p50_ms',
    'write_window_p95_ms',
    'read_window_attempts',
    'read_window_success',
    'read_window_fail',
    'read_window_error_rate',
    'read_window_p50_ms',
    'read_window_p95_ms',
    'read_window_avg_bytes',
    'write_total_attempts',
    'write_total_success',
    'write_total_fail',
    'read_total_attempts',
    'read_total_success',
    'read_total_fail',
  ];

  const failures = [];
  if (failureReason) {
    failures.push({ message: failureReason });
  }
  if (!invariant.ok) {
    failures.push(...invariant.failures);
  }

  await writeReport({
    label: 'stress-scoreboard',
    status: failures.length ? 'failed' : 'completed',
    runStartTime,
    config,
    summary,
    history,
    csvFields,
    failures: failures.length ? failures : null,
    memory: {
      summary: memoryLogger.getSummary(),
      samples: memoryLogger.samples,
    },
  });
}

process.on('SIGINT', () => {
  console.log('[stress-scoreboard] SIGINT received, stopping...');
  stopRequested = true;
});
process.on('SIGTERM', () => {
  console.log('[stress-scoreboard] SIGTERM received, stopping...');
  stopRequested = true;
});

try {
  await run();
} finally {
  memoryLogger.stop();
  await cleanup();
}
