import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

function randomInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((pct / 100) * sorted.length) - 1;
  const idx = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[idx];
}

function randomUuid(rng) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(rng() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

function shuffleInPlace(rng, values) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
}

function printHelp() {
  console.log(`
Usage:
  SOAK_DURATION_MINUTES=60 SOAK_CLIENTS=30 pnpm -C web test:soak

Profiles (set SOAK_PROFILE=race|torture; env overrides still apply):

ZAVOD (race, realistic):
  SOAK_DURATION_MINUTES=720 SOAK_CLIENTS=30 \\
  SOAK_MIN_INTERVAL_MS=45000 SOAK_MAX_INTERVAL_MS=120000 \\
  SOAK_RETRY_RATE=0.05 SOAK_RELOAD_RATE=0.01 \\
  CHAOS_TIMEOUT_RATE=0.02 CHAOS_TIMEOUT_MS=5000 \\
  CHAOS_429_RATE=0.01 CHAOS_JITTER_MS_MAX=1000 \\
  CHAOS_BURST_EVERY_MINUTES=30 DB_CHECK_EVERY_UNIQUE_SUCCESSES=300 \\
  pnpm -C web test:soak

TORTURE (aggressive):
  SOAK_DURATION_MINUTES=60 SOAK_CLIENTS=60 \\
  SOAK_MIN_INTERVAL_MS=5000 SOAK_MAX_INTERVAL_MS=15000 \\
  SOAK_RETRY_RATE=0.20 SOAK_RELOAD_RATE=0.05 \\
  CHAOS_TIMEOUT_RATE=0.10 CHAOS_TIMEOUT_MS=2500 \\
  CHAOS_429_RATE=0.10 CHAOS_JITTER_MS_MAX=3000 \\
  CHAOS_BURST_EVERY_MINUTES=5 DB_CHECK_EVERY_UNIQUE_SUCCESSES=100 \\
  pnpm -C web test:soak
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const supabaseUrl = readEnv('SUPABASE_URL', DEFAULT_SUPABASE_URL).replace(/\/$/, '');
const jwtSecret = readEnv('SUPABASE_JWT_SECRET', readEnv('JWT_SECRET', DEFAULT_JWT_SECRET));
const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY', signKey(jwtSecret, 'service_role'));
const anonKey = readEnv('SUPABASE_ANON_KEY', signKey(jwtSecret, 'anon'));
const apiKey = readEnv('SOAK_API_KEY', readEnv('SPIKE_API_KEY', anonKey || serviceRoleKey));

const seed = readInteger('SEED', 1337);
const rng = createRng(seed);
const seedRng = createRng(seed ^ 0x9e3779b9);

const soakProfile = readEnv('SOAK_PROFILE', '').toLowerCase();
const profileDefaults = {
  race: {
    durationMinutes: 720,
    clients: 30,
    intervalMinMs: 45000,
    intervalMaxMs: 120000,
    retryRate: 0.05,
    reloadRate: 0.01,
    chaosTimeoutRate: 0.02,
    chaosTimeoutMs: 5000,
    chaos429Rate: 0.01,
    chaosJitterMsMax: 1000,
    burstEveryMinutes: 30,
    checkEvery: 300,
  },
  torture: {
    durationMinutes: 60,
    clients: 60,
    intervalMinMs: 5000,
    intervalMaxMs: 15000,
    retryRate: 0.2,
    reloadRate: 0.05,
    chaosTimeoutRate: 0.1,
    chaosTimeoutMs: 2500,
    chaos429Rate: 0.1,
    chaosJitterMsMax: 3000,
    burstEveryMinutes: 5,
    checkEvery: 100,
  },
};

const selectedDefaults = profileDefaults[soakProfile] ?? {};

const durationMinutes = readInteger('SOAK_DURATION_MINUTES', selectedDefaults.durationMinutes ?? 720);
const durationMs = durationMinutes * 60 * 1000;
const clients = readInteger('SOAK_CLIENTS', selectedDefaults.clients ?? 30);
const intervalMinMs = readInteger('SOAK_MIN_INTERVAL_MS', selectedDefaults.intervalMinMs ?? 30000);
const intervalMaxMs = readInteger('SOAK_MAX_INTERVAL_MS', selectedDefaults.intervalMaxMs ?? 90000);
const retryRate = readNumber('SOAK_RETRY_RATE', selectedDefaults.retryRate ?? 0.1);
const reloadRate = readNumber('SOAK_RELOAD_RATE', selectedDefaults.reloadRate ?? 0.02);
const quizRate = readNumber('SOAK_QUIZ_RATE', 0.2);
const timingRate = readNumber('SOAK_TIMING_RATE', 0.1);
const checkEvery = readInteger(
  'DB_CHECK_EVERY_UNIQUE_SUCCESSES',
  readInteger('SOAK_CHECK_EVERY', selectedDefaults.checkEvery ?? 200),
);
const chaosTimeoutRate = readNumber('CHAOS_TIMEOUT_RATE', selectedDefaults.chaosTimeoutRate ?? 0.05);
const chaosTimeoutMs = readInteger('CHAOS_TIMEOUT_MS', selectedDefaults.chaosTimeoutMs ?? 4000);
const chaos429Rate = readNumber('CHAOS_429_RATE', selectedDefaults.chaos429Rate ?? 0.05);
const chaosJitterMsMax = readInteger('CHAOS_JITTER_MS_MAX', selectedDefaults.chaosJitterMsMax ?? 2000);
const burstEveryMinutes = readInteger(
  'CHAOS_BURST_EVERY_MINUTES',
  selectedDefaults.burstEveryMinutes ?? 20,
);
const mode = readEnv('SOAK_MODE', 'standard');
const endpoint = readEnv(
  'TARGET_URL',
  readEnv('SOAK_TARGET_URL', `${supabaseUrl.replace(/\/$/, '')}/functions/v1/submit-station-record`),
);

const outboxStressTotal = 2000;
const outboxStressDuplicateRate = 0.2;

const config = {
  durationMinutes,
  clients,
  intervalMinMs,
  intervalMaxMs,
  retryRate,
  reloadRate,
  quizRate,
  timingRate,
  checkEvery,
  chaosTimeoutRate,
  chaosTimeoutMs,
  chaos429Rate,
  chaosJitterMsMax,
  burstEveryMinutes,
  mode,
  endpoint,
  seed,
  profile: soakProfile || 'custom',
};

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const eventId = randomUuid(seedRng);
const stationId = randomUuid(seedRng);
const judgeId = randomUuid(seedRng);
const sessionId = randomUuid(seedRng);

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

const maxSubmissionsPerClient = Math.ceil(durationMs / intervalMinMs) + 5;
const burstCount = burstEveryMinutes > 0 ? Math.ceil(durationMinutes / burstEveryMinutes) : 0;
const expectedUnique = clients * (maxSubmissionsPerClient + burstCount);
const patrolCount = Math.max(expectedUnique + 50, outboxStressTotal + 20);

const patrolRows = Array.from({ length: patrolCount }, (_value, index) => ({
  id: randomUuid(seedRng),
  event_id: eventId,
  team_name: `Soak Patrol ${index + 1}`,
  category: 'M',
  sex: 'H',
  patrol_code: `MH-${String(index + 1).padStart(2, '0')}`,
  active: true,
}));

let patrolIndex = 0;
function nextPatrol() {
  if (patrolIndex >= patrolRows.length) {
    throw new Error('Ran out of pre-seeded patrols for soak test.');
  }
  const patrol = patrolRows[patrolIndex];
  patrolIndex += 1;
  return patrol;
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
    note: 'Soak test',
    use_target_scoring: useQuiz,
    normalized_answers: useQuiz ? 'ABCD' : null,
    finish_time: useTiming ? createdAt : null,
    patrol_code: patrol.patrol_code,
    team_name: patrol.team_name,
    sex: patrol.sex,
  };
}

function computeBackoffMs(attempts) {
  const base = 1000;
  const max = 30000;
  const exp = Math.min(max, base * 2 ** Math.max(0, attempts - 1));
  const jitter = Math.floor(rng() * exp * 0.3);
  return Math.min(max, exp + jitter);
}

async function sendWithChaos(payload) {
  if (chaosJitterMsMax > 0) {
    await delay(randomInt(rng, 0, chaosJitterMsMax));
  }

  if (rng() < chaos429Rate) {
    return { ok: false, status: 429, duration: 0, simulated429: true };
  }

  const shouldTimeout = rng() < chaosTimeoutRate;
  const controller = shouldTimeout ? new AbortController() : null;
  const timeoutId = shouldTimeout
    ? setTimeout(() => {
        controller.abort();
      }, chaosTimeoutMs)
    : null;

  const start = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(apiKey ? { apikey: apiKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });
    const duration = performance.now() - start;
    return { ok: response.ok, status: response.status, duration };
  } catch (error) {
    const duration = performance.now() - start;
    const timedOut = Boolean(controller?.signal.aborted);
    return { ok: false, status: 0, duration, timedOut, error };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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
    .insert({ id: eventId, name: 'Soak Test', scoring_locked: false });
  assertNoError(eventError, 'events');

  const { error: stationError } = await supabaseAdmin
    .from('stations')
    .insert({ id: stationId, event_id: eventId, code: 'Z', name: 'Soak Station' });
  assertNoError(stationError, 'stations');

  for (let i = 0; i < patrolRows.length; i += 200) {
    const chunk = patrolRows.slice(i, i + 200);
    const { error: patrolError } = await supabaseAdmin.from('patrols').insert(chunk);
    assertNoError(patrolError, 'patrols');
  }

  const { error: judgeError } = await supabaseAdmin.from('judges').insert({
    id: judgeId,
    email: `soak-${judgeId}@example.com`,
    password_hash: 'hash',
    display_name: 'Soak Judge',
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

const submissions = new Map();
const successfulIds = new Set();

const metrics = {
  attempts: 0,
  success: 0,
  fail: 0,
  retries: 0,
  duplicateSuccess: 0,
  simulated429: 0,
  timeouts: 0,
  networkErrors: 0,
  serverErrors: 0,
  clientErrors: 0,
  durations: [],
  windowDurations: [],
  windowAttempts: 0,
  windowSuccess: 0,
  windowFail: 0,
  windowRetries: 0,
  windowSimulated429: 0,
  windowTimeouts: 0,
  windowNetworkErrors: 0,
};

const history = [];
let stopRequested = false;
let failureReason = null;
let reloadCount = 0;
let lastInvariantCheck = 0;
let invariantCheckInFlight = false;
let nextInvariantCheck = checkEvery;

let burstId = 0;
const burstWaiters = new Set();
function triggerBurst() {
  burstId += 1;
  for (const waiter of burstWaiters) {
    waiter(burstId);
  }
  burstWaiters.clear();
}

function waitForBurst(currentId) {
  if (burstId !== currentId) {
    return Promise.resolve(burstId);
  }
  return new Promise((resolve) => {
    burstWaiters.add(resolve);
  });
}

async function waitForDelayOrBurst(delayMs, currentBurstId) {
  if (burstEveryMinutes <= 0) {
    await delay(delayMs);
    return { type: 'delay', burstId: currentBurstId };
  }
  const result = await Promise.race([
    delay(delayMs).then(() => ({ type: 'delay', burstId: currentBurstId })),
    waitForBurst(currentBurstId).then((id) => ({ type: 'burst', burstId: id })),
  ]);
  return result;
}

function recordFailure(message) {
  failureReason = message;
  stopRequested = true;
  process.exitCode = 1;
}

function buildEntry(now, allowDuplicateAfterSuccess = true) {
  const patrol = nextPatrol();
  const clientEventId = randomUuid(rng);
  const createdAt = new Date(now).toISOString();
  const useQuiz = rng() < quizRate;
  const useTiming = rng() < timingRate;
  const payload = buildPayload({ patrol, clientEventId, createdAt, useQuiz, useTiming });
  submissions.set(clientEventId, { useQuiz, useTiming });
  return {
    client_event_id: clientEventId,
    payload,
    attempts: 0,
    next_attempt_at: now,
    duplicateAfterSuccess: allowDuplicateAfterSuccess && rng() < retryRate,
    duplicateSent: false,
    isDuplicate: false,
    useQuiz,
    useTiming,
  };
}

async function checkInvariants(reason) {
  if (invariantCheckInFlight) {
    return;
  }
  invariantCheckInFlight = true;
  lastInvariantCheck = Date.now();

  const fetchClientEventIds = async (table) => {
    const pageSize = 1000;
    let from = 0;
    let rows = [];
    for (;;) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('client_event_id')
        .eq('event_id', eventId)
        .order('client_event_id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        return { data: rows, error };
      }
      rows = rows.concat(data ?? []);
      if (!data || data.length < pageSize) {
        break;
      }
      from += pageSize;
    }
    return { data: rows, error: null };
  };

  const { data: scores, error: scoresError } = await fetchClientEventIds('station_scores');
  const { data: passages, error: passagesError } = await fetchClientEventIds('station_passages');
  const { data: quizzes, error: quizzesError } = await fetchClientEventIds('station_quiz_responses');
  const { data: timings, error: timingsError } = await fetchClientEventIds('timings');

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
  if (scoresError) {
    failures.push({ message: 'station_scores query failed', detail: scoresError.message });
  }
  if (passagesError) {
    failures.push({ message: 'station_passages query failed', detail: passagesError.message });
  }
  if (quizzesError) {
    failures.push({ message: 'station_quiz_responses query failed', detail: quizzesError.message });
  }
  if (timingsError) {
    failures.push({ message: 'timings query failed', detail: timingsError.message });
  }
  if (scoreDupes.size || passageDupes.size || quizDupes.size || timingDupes.size) {
    failures.push({
      message: 'duplicate client_event_id entries detected',
      scoreDupes: Array.from(scoreDupes).slice(0, 5),
      passageDupes: Array.from(passageDupes).slice(0, 5),
      quizDupes: Array.from(quizDupes).slice(0, 5),
      timingDupes: Array.from(timingDupes).slice(0, 5),
    });
  }
  if ((scores ?? []).length !== expectedScoreCount) {
    failures.push({
      message: 'station_scores count mismatch',
      expected: expectedScoreCount,
      actual: (scores ?? []).length,
    });
  }
  if ((passages ?? []).length !== expectedScoreCount) {
    failures.push({
      message: 'station_passages count mismatch',
      expected: expectedScoreCount,
      actual: (passages ?? []).length,
    });
  }
  if ((quizzes ?? []).length !== expectedQuizCount) {
    failures.push({
      message: 'station_quiz_responses count mismatch',
      expected: expectedQuizCount,
      actual: (quizzes ?? []).length,
    });
  }
  if ((timings ?? []).length !== expectedTimingCount) {
    failures.push({
      message: 'timings count mismatch',
      expected: expectedTimingCount,
      actual: (timings ?? []).length,
    });
  }

  if (failures.length) {
    console.error('[soak] invariant failure', reason, failures);
    recordFailure(`Invariant failure: ${failures[0]?.message ?? 'unknown'}`);
  } else {
    console.log('[soak] invariants OK', { reason, expectedScoreCount, expectedQuizCount, expectedTimingCount });
  }

  invariantCheckInFlight = false;
}

async function writeReport(status, reportFailures) {
  const endTime = Date.now();
  const p50 = percentile(metrics.durations, 50);
  const p95 = percentile(metrics.durations, 95);
  const errorRate = metrics.attempts === 0 ? 0 : metrics.fail / metrics.attempts;
  const pending = clientsState.reduce((sum, client) => sum + client.queue.length, 0);
  const report = {
    status,
    started_at: new Date(runStartTime).toISOString(),
    ended_at: new Date(endTime).toISOString(),
    duration_ms: endTime - runStartTime,
    config,
    summary: {
      attempts: metrics.attempts,
      success: metrics.success,
      fail: metrics.fail,
      error_rate: errorRate,
      retries: metrics.retries,
      duplicate_success: metrics.duplicateSuccess,
      simulated_429: metrics.simulated429,
      timeouts: metrics.timeouts,
      network_errors: metrics.networkErrors,
      server_errors: metrics.serverErrors,
      client_errors: metrics.clientErrors,
      p50_ms: Math.round(p50),
      p95_ms: Math.round(p95),
      unique_success: successfulIds.size,
      pending_outbox: pending,
      reloads: reloadCount,
      last_invariant_check_ms: lastInvariantCheck ? endTime - lastInvariantCheck : null,
    },
    failures: reportFailures ?? null,
    history,
  };

  const reportDir = path.join(process.cwd(), 'test-results');
  await mkdir(reportDir, { recursive: true });
  const stamp = new Date(runStartTime).toISOString().replace(/[:.]/g, '-');
  const baseName = `soak-report-${stamp}`;
  const jsonPath = path.join(reportDir, `${baseName}.json`);
  const csvPath = path.join(reportDir, `${baseName}.csv`);

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const csvHeader = [
    'timestamp',
    'window_attempts',
    'window_success',
    'window_fail',
    'window_error_rate',
    'window_p50_ms',
    'window_p95_ms',
    'pending_outbox',
    'unique_success',
    'total_attempts',
    'total_success',
    'total_fail',
    'total_error_rate',
    'total_retries',
  ].join(',');
  const csvLines = history.map((row) =>
    [
      row.timestamp,
      row.window_attempts,
      row.window_success,
      row.window_fail,
      row.window_error_rate.toFixed(4),
      row.window_p50_ms,
      row.window_p95_ms,
      row.pending_outbox,
      row.unique_success,
      row.total_attempts,
      row.total_success,
      row.total_fail,
      row.total_error_rate.toFixed(4),
      row.total_retries,
    ].join(','),
  );
  await writeFile(csvPath, `${csvHeader}\n${csvLines.join('\n')}\n`, 'utf8');

  console.log('[soak] report saved', { jsonPath, csvPath });
}

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
    unique_success: successfulIds.size,
    total_attempts: metrics.attempts,
    total_success: metrics.success,
    total_fail: metrics.fail,
    total_error_rate: totalErrorRate,
    total_retries: metrics.retries,
  });

  console.log(
    `[soak] +1m ok ${metrics.windowSuccess}/${metrics.windowAttempts} err ${(windowErrorRate * 100).toFixed(2)}% ` +
      `p50 ${Math.round(windowP50)}ms p95 ${Math.round(windowP95)}ms pending ${pending} unique ${successfulIds.size}`,
  );

  metrics.windowDurations = [];
  metrics.windowAttempts = 0;
  metrics.windowSuccess = 0;
  metrics.windowFail = 0;
  metrics.windowRetries = 0;
  metrics.windowSimulated429 = 0;
  metrics.windowTimeouts = 0;
  metrics.windowNetworkErrors = 0;
}

const clientsState = Array.from({ length: clients }, (_value, index) => ({
  id: index + 1,
  queue: [],
  nextCreateAt: Date.now() + randomInt(rng, intervalMinMs, intervalMaxMs),
  lastBurstId: 0,
}));

async function runClient(client, startTime) {
  await delay(randomInt(rng, 0, intervalMinMs));

  while (!stopRequested && Date.now() - startTime < durationMs) {
    const now = Date.now();
    if (mode === 'outbox-stress') {
      const pending = clientsState.reduce((sum, item) => sum + item.queue.length, 0);
      if (pending === 0) {
        stopRequested = true;
        break;
      }
    }

    if (mode !== 'outbox-stress' && now >= client.nextCreateAt) {
      client.queue.push(buildEntry(now, true));
      client.nextCreateAt = now + randomInt(rng, intervalMinMs, intervalMaxMs);
    }

    const readyIndex = pickReadyEntry(client.queue, now);
    if (readyIndex === -1) {
      const nextRetry = nextRetryAt(client.queue);
      const nextCreate = mode === 'outbox-stress' ? Infinity : client.nextCreateAt;
      const nextEvent = Math.min(nextRetry, nextCreate);
      const waitMs = Number.isFinite(nextEvent) ? Math.max(100, nextEvent - now) : 250;
      const result = await waitForDelayOrBurst(waitMs, client.lastBurstId);
      if (result.type === 'burst') {
        client.lastBurstId = result.burstId;
        if (mode !== 'outbox-stress') {
          const burstNow = Date.now();
          client.queue.push(buildEntry(burstNow, true));
          client.nextCreateAt = burstNow + randomInt(rng, intervalMinMs, intervalMaxMs);
        }
      }
      continue;
    }

    const entry = client.queue[readyIndex];
    entry.attempts += 1;
    const isRetryAttempt = entry.attempts > 1 || entry.isDuplicate;
    if (isRetryAttempt) {
      metrics.retries += 1;
      metrics.windowRetries += 1;
    }

    const result = await sendWithChaos(entry.payload);
    metrics.attempts += 1;
    metrics.windowAttempts += 1;
    if (result.duration) {
      metrics.durations.push(result.duration);
      metrics.windowDurations.push(result.duration);
    }

    if (result.simulated429) {
      metrics.simulated429 += 1;
      metrics.windowSimulated429 += 1;
    }
    if (result.timedOut) {
      metrics.timeouts += 1;
      metrics.windowTimeouts += 1;
    }
    if (result.status === 0 && !result.simulated429 && !result.timedOut) {
      metrics.networkErrors += 1;
      metrics.windowNetworkErrors += 1;
    }

    if (result.ok) {
      metrics.success += 1;
      metrics.windowSuccess += 1;
      if (successfulIds.has(entry.client_event_id)) {
        metrics.duplicateSuccess += 1;
      } else {
        successfulIds.add(entry.client_event_id);
        if (successfulIds.size >= nextInvariantCheck) {
          const target = nextInvariantCheck;
          nextInvariantCheck += checkEvery;
          await checkInvariants(`after-${target}`);
        }
      }

      if (entry.duplicateAfterSuccess && !entry.duplicateSent) {
        entry.duplicateSent = true;
        const duplicateEntry = {
          ...entry,
          attempts: 0,
          next_attempt_at: Date.now() + randomInt(rng, 200, 1200),
          isDuplicate: true,
          duplicateAfterSuccess: false,
          duplicateSent: true,
        };
        client.queue.push(duplicateEntry);
      }

      client.queue.splice(readyIndex, 1);
    } else {
      metrics.fail += 1;
      metrics.windowFail += 1;
      if (result.status >= 500) {
        metrics.serverErrors += 1;
      } else if (result.status > 0 && result.status < 500 && result.status !== 429) {
        metrics.clientErrors += 1;
      }

      const retryable =
        result.simulated429 ||
        result.status === 0 ||
        result.status === 429 ||
        (result.status >= 500 && result.status < 600);
      if (retryable) {
        entry.next_attempt_at = Date.now() + computeBackoffMs(entry.attempts);
      } else {
        client.queue.splice(readyIndex, 1);
      }
    }

    if (rng() < reloadRate) {
      reloadCount += 1;
      client.lastBurstId = burstId;
      client.nextCreateAt = Date.now() + randomInt(rng, intervalMinMs, intervalMaxMs);
    }

    if (mode === 'outbox-stress') {
      const pending = clientsState.reduce((sum, item) => sum + item.queue.length, 0);
      if (pending === 0) {
        stopRequested = true;
      }
    }
  }

  console.log(`[soak] client ${client.id} done`);
}

async function prepareOutboxStress() {
  const uniqueCount = Math.round(outboxStressTotal * (1 - outboxStressDuplicateRate));
  const entries = [];
  for (let i = 0; i < uniqueCount; i += 1) {
    entries.push(buildEntry(Date.now(), false));
  }
  const duplicatesNeeded = outboxStressTotal - uniqueCount;
  for (let i = 0; i < duplicatesNeeded; i += 1) {
    const original = entries[randomInt(rng, 0, entries.length - 1)];
    entries.push({
      ...original,
      attempts: 0,
      next_attempt_at: Date.now(),
      isDuplicate: true,
      duplicateAfterSuccess: false,
      duplicateSent: true,
    });
  }
  shuffleInPlace(rng, entries);
  let cursor = 0;
  for (const client of clientsState) {
    const chunk = entries.slice(cursor, cursor + Math.ceil(entries.length / clients));
    client.queue.push(...chunk);
    cursor += chunk.length;
  }
}

async function run() {
  console.log('[soak] config', config);
  console.log('[soak] seeding data...');
  await seedData();

  if (endpoint.includes('/api/submit-station-record')) {
    console.log('[soak] using API endpoint; ensure server has JWT_SECRET/REFRESH_TOKEN_SECRET configured');
  }

  if (mode === 'outbox-stress') {
    await prepareOutboxStress();
    console.log(
      `[soak] outbox-stress prepared ${outboxStressTotal} pending entries (${outboxStressDuplicateRate * 100}% duplicates)`,
    );
  }

  runStartTime = Date.now();
  const burstIntervalMs = burstEveryMinutes > 0 ? burstEveryMinutes * 60 * 1000 : 0;
  let burstTimer = null;
  if (burstIntervalMs > 0) {
    burstTimer = setInterval(() => {
      triggerBurst();
      console.log('[soak] burst', burstId);
    }, burstIntervalMs);
  }
  const logTimer = setInterval(() => {
    logMinuteMetrics();
  }, 60 * 1000);

  try {
    await Promise.all(clientsState.map((client) => runClient(client, runStartTime)));
  } finally {
    if (burstTimer) {
      clearInterval(burstTimer);
    }
    clearInterval(logTimer);
  }

  await checkInvariants('final');

  const status = failureReason ? 'failed' : 'completed';
  await writeReport(status, failureReason ? [{ message: failureReason }] : null);
}

process.on('SIGINT', () => {
  console.log('[soak] SIGINT received, stopping...');
  stopRequested = true;
});
process.on('SIGTERM', () => {
  console.log('[soak] SIGTERM received, stopping...');
  stopRequested = true;
});

let runStartTime = Date.now();
try {
  await run();
} catch (error) {
  console.error('[soak] fatal error', error);
  recordFailure(error instanceof Error ? error.message : String(error));
  await writeReport('failed', [{ message: failureReason ?? 'fatal error' }]);
} finally {
  await cleanup();
}
