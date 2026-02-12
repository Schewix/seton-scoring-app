import { createClient } from '@supabase/supabase-js';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DEFAULT_JWT_SECRET,
  DEFAULT_SUPABASE_URL,
  buildPatrolRows,
  buildStationRecordPayload,
  checkStationInvariants,
  computeBackoffMs,
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
const apiKey = readEnv('HERD_API_KEY', anonKey || serviceRoleKey);

const seed = readInteger('SEED', 1337);
const rng = createRng(seed);
const seedRng = createRng(seed ^ 0x9e3779b9);

const herdClients = readInteger('HERD_CLIENTS', 30);
const pendingPerClient = readInteger('HERD_PENDING_PER_CLIENT', 20);
const newSubmitsPerClient = readInteger('HERD_NEW_SUBMITS', 3);
const herdDeadlineMinutes = readInteger('HERD_DEADLINE_MINUTES', 15);
const chaosTimeoutRate = readNumber('CHAOS_TIMEOUT_RATE', 0.08);
const chaosTimeoutMs = readInteger('CHAOS_TIMEOUT_MS', 4000);
const chaos429Rate = readNumber('CHAOS_429_RATE', 0.05);
const chaosJitterMsMax = readInteger('CHAOS_JITTER_MS_MAX', 2000);
const endpoint = readEnv('TARGET_URL', `${supabaseUrl}/functions/v1/submit-station-record`);
const maxInflight = readInteger('HERD_MAX_INFLIGHT', herdClients * 4);

const config = {
  herdClients,
  pendingPerClient,
  newSubmitsPerClient,
  herdDeadlineMinutes,
  chaosTimeoutRate,
  chaosTimeoutMs,
  chaos429Rate,
  chaosJitterMsMax,
  maxInflight,
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
  logPrefix: 'stress-herd',
});

const totalEntries = herdClients * (pendingPerClient + newSubmitsPerClient);
const patrolRows = buildPatrolRows({
  count: Math.max(totalEntries + 20, 200),
  eventId,
  rng: seedRng,
  prefix: 'Herd Patrol',
});

let patrolIndex = 0;
function nextPatrol() {
  if (patrolIndex >= patrolRows.length) {
    throw new Error('Ran out of patrol rows for thundering herd test.');
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
    .insert({ id: eventId, name: 'Herd Stress', scoring_locked: false });
  assertNoError(eventError, 'events');

  const { error: stationError } = await supabaseAdmin
    .from('stations')
    .insert({ id: stationId, event_id: eventId, code: 'H', name: 'Herd Station' });
  assertNoError(stationError, 'stations');

  for (let i = 0; i < patrolRows.length; i += 200) {
    const chunk = patrolRows.slice(i, i + 200);
    const { error: patrolError } = await supabaseAdmin.from('patrols').insert(chunk);
    assertNoError(patrolError, 'patrols');
  }

  const { error: judgeError } = await supabaseAdmin.from('judges').insert({
    id: judgeId,
    email: `herd-${judgeId}@example.com`,
    password_hash: 'hash',
    display_name: 'Herd Judge',
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
let maxInFlightSeen = 0;

function recordFailure(message) {
  failureReason = message;
  stopRequested = true;
  process.exitCode = 1;
}

const memoryLogger = setupMemoryLogging({
  label: 'stress-herd',
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
    maxInFlightSeen = Math.max(maxInFlightSeen, inFlightRequests);
    if (maxInFlightSeen > maxInflight) {
      recordFailure(`In-flight requests exceeded limit (${maxInFlightSeen} > ${maxInflight})`);
    }
  },
  onRequestEnd: () => {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
  },
});

const clientsState = Array.from({ length: herdClients }, (_value, index) => ({
  id: index + 1,
  queue: [],
}));

function createEntry() {
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
    note: 'Herd stress',
    category: 'M',
    waitMinutes: 1,
  });

  submissions.set(clientEventId, { useQuiz, useTiming });

  return {
    id: clientEventId,
    payload,
    attempts: 0,
    next_attempt_at: Date.now(),
  };
}

function prepareQueues() {
  for (const client of clientsState) {
    for (let i = 0; i < pendingPerClient; i += 1) {
      client.queue.push(createEntry());
    }
  }
}

function appendNewSubmits() {
  for (const client of clientsState) {
    for (let i = 0; i < newSubmitsPerClient; i += 1) {
      client.queue.push(createEntry());
    }
  }
}

function pickReadyEntry(queue, now) {
  let idx = -1;
  let nextAt = Infinity;
  for (let i = 0; i < queue.length; i += 1) {
    const entry = queue[i];
    if (entry.next_attempt_at <= now && entry.next_attempt_at < nextAt) {
      idx = i;
      nextAt = entry.next_attempt_at;
    }
  }
  return idx;
}

function nextRetryAt(queue) {
  let nextAt = Infinity;
  for (const entry of queue) {
    if (entry.next_attempt_at < nextAt) {
      nextAt = entry.next_attempt_at;
    }
  }
  return nextAt;
}

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
  const pending = clientsState.reduce((sum, client) => sum + client.queue.length, 0);

  history.push({
    timestamp: new Date().toISOString(),
    window_attempts: metrics.windowAttempts,
    window_success: metrics.windowSuccess,
    window_fail: metrics.windowFail,
    window_error_rate: windowErrorRate,
    window_p50_ms: Math.round(windowP50),
    window_p95_ms: Math.round(windowP95),
    pending_outbox: pending,
    max_inflight: maxInFlightSeen,
    total_attempts: metrics.attempts,
    total_success: metrics.success,
    total_fail: metrics.fail,
    total_error_rate: totalErrorRate,
    total_retries: metrics.retries,
  });

  console.log(
    `[stress-herd] +1m ok ${metrics.windowSuccess}/${metrics.windowAttempts} err ${(windowErrorRate * 100).toFixed(2)}% ` +
      `p50 ${Math.round(windowP50)}ms p95 ${Math.round(windowP95)}ms pending ${pending}`,
  );

  metrics.windowDurations = [];
  metrics.windowAttempts = 0;
  metrics.windowSuccess = 0;
  metrics.windowFail = 0;
  metrics.windowRetries = 0;
}

async function runClient(client, startTime, deadlineMs) {
  while (!stopRequested) {
    const now = Date.now();
    if (client.queue.length === 0) {
      return;
    }
    if (now - startTime > deadlineMs) {
      recordFailure('Herd flush deadline exceeded');
      return;
    }

    const readyIndex = pickReadyEntry(client.queue, now);
    if (readyIndex === -1) {
      const nextAt = nextRetryAt(client.queue);
      const waitMs = Number.isFinite(nextAt) ? Math.max(50, nextAt - now) : 100;
      await delay(Math.min(waitMs, 500));
      continue;
    }

    const entry = client.queue.splice(readyIndex, 1)[0];
    const result = await sendWithChaos(entry.payload);
    metrics.attempts += 1;
    metrics.windowAttempts += 1;
    metrics.durations.push(result.duration);
    metrics.windowDurations.push(result.duration);

    if (result.ok) {
      successfulIds.add(entry.id);
      metrics.success += 1;
      metrics.windowSuccess += 1;
    } else {
      metrics.fail += 1;
      metrics.windowFail += 1;
      metrics.retries += 1;
      metrics.windowRetries += 1;
      entry.attempts += 1;
      entry.next_attempt_at = Date.now() + computeBackoffMs(rng, entry.attempts);
      client.queue.push(entry);
    }
  }
}

let runStartTime = Date.now();

async function run() {
  console.log('[stress-herd] config', config);
  console.log('[stress-herd] seeding data...');
  await seed();

  prepareQueues();
  console.log(`[stress-herd] prepared ${herdClients * pendingPerClient} pending entries`);

  console.log('[stress-herd] restart triggered: adding new submits and flushing simultaneously');
  appendNewSubmits();

  runStartTime = Date.now();
  const deadlineMs = herdDeadlineMinutes * 60 * 1000;
  const logTimer = setInterval(logMinuteMetrics, 60 * 1000);

  try {
    await Promise.all(clientsState.map((client) => runClient(client, runStartTime, deadlineMs)));
  } finally {
    clearInterval(logTimer);
  }

  logMinuteMetrics();

  const pending = clientsState.reduce((sum, client) => sum + client.queue.length, 0);
  if (pending > 0) {
    recordFailure(`Pending outbox after herd flush: ${pending}`);
  }

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
    logPrefix: 'stress-herd',
  });

  if (!invariant.ok) {
    recordFailure('Invariant failure');
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
    pending_outbox: pending,
    unique_success: successfulIds.size,
    max_inflight: maxInFlightSeen,
  };

  const failures = [];
  if (failureReason) {
    failures.push({ message: failureReason });
  }
  if (!invariant.ok) {
    failures.push(...invariant.failures);
  }

  await writeReport({
    label: 'stress-herd',
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
      'pending_outbox',
      'max_inflight',
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
  console.log('[stress-herd] SIGINT received, stopping...');
  stopRequested = true;
});
process.on('SIGTERM', () => {
  console.log('[stress-herd] SIGTERM received, stopping...');
  stopRequested = true;
});

try {
  await run();
} finally {
  memoryLogger.stop();
  await cleanup();
}
