import jwt from 'jsonwebtoken';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const DEFAULT_SUPABASE_URL = 'http://127.0.0.1:54321';
export const DEFAULT_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

export function readEnv(name, fallback = '') {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export function readNumber(name, fallback) {
  const raw = readEnv(name, '');
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readInteger(name, fallback) {
  const raw = readEnv(name, '');
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function signKey(secret, role) {
  return jwt.sign({ role }, secret, { expiresIn: '10y' });
}

export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

export function randomInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((pct / 100) * sorted.length) - 1;
  const idx = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[idx];
}

export function randomUuid(rng) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(rng() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function findDuplicates(values) {
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

export function computeBackoffMs(rng, attempts, base = 1000, max = 30000, jitterRatio = 0.3) {
  const exp = Math.min(max, base * 2 ** Math.max(0, attempts - 1));
  const jitter = Math.floor(rng() * exp * jitterRatio);
  return Math.min(max, exp + jitter);
}

export function buildStationRecordPayload({
  eventId,
  stationId,
  patrol,
  clientEventId,
  createdAt,
  useQuiz,
  useTiming,
  points,
  waitMinutes = 1,
  note = '',
  category = 'M',
}) {
  return {
    client_event_id: clientEventId,
    client_created_at: createdAt,
    event_id: eventId,
    station_id: stationId,
    patrol_id: patrol.id,
    category,
    arrived_at: createdAt,
    wait_minutes: waitMinutes,
    points,
    note,
    use_target_scoring: useQuiz,
    normalized_answers: useQuiz ? 'ABCD' : null,
    finish_time: useTiming ? createdAt : null,
    patrol_code: patrol.patrol_code,
    team_name: patrol.team_name,
    sex: patrol.sex,
  };
}

export function buildPatrolRows({ count, eventId, rng, prefix = 'Stress Patrol', category = 'M', sex = 'H' }) {
  return Array.from({ length: count }, (_value, index) => ({
    id: randomUuid(rng),
    event_id: eventId,
    team_name: `${prefix} ${index + 1}`,
    category,
    sex,
    patrol_code: `${category}${sex}-${String(index + 1).padStart(2, '0')}`,
    active: true,
  }));
}

export async function seedStationData({
  supabaseAdmin,
  eventId,
  eventName = 'Stress Test',
  stationId,
  stationCode = 'Z',
  stationName = 'Stress Station',
  patrolRows,
  judgeId,
  sessionId,
  judgeEmail,
  allowedCategories = ['M'],
  allowedTasks = [],
}) {
  const assertNoError = (error, context) => {
    if (error) {
      const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : String(error);
      throw new Error(`Seed ${context} failed: ${message}`);
    }
  };

  await cleanupStationData({ supabaseAdmin, eventId, stationId, judgeId, sessionId });

  const { error: eventError } = await supabaseAdmin
    .from('events')
    .insert({ id: eventId, name: eventName, scoring_locked: false });
  assertNoError(eventError, 'events');

  const { error: stationError } = await supabaseAdmin
    .from('stations')
    .insert({ id: stationId, event_id: eventId, code: stationCode, name: stationName });
  assertNoError(stationError, 'stations');

  for (let i = 0; i < patrolRows.length; i += 200) {
    const chunk = patrolRows.slice(i, i + 200);
    const { error: patrolError } = await supabaseAdmin.from('patrols').insert(chunk);
    assertNoError(patrolError, 'patrols');
  }

  const { error: judgeError } = await supabaseAdmin.from('judges').insert({
    id: judgeId,
    email: judgeEmail ?? `stress-${judgeId}@example.com`,
    password_hash: 'hash',
    display_name: 'Stress Judge',
  });
  assertNoError(judgeError, 'judges');

  const { error: assignmentError } = await supabaseAdmin.from('judge_assignments').insert({
    judge_id: judgeId,
    station_id: stationId,
    event_id: eventId,
    allowed_categories: allowedCategories,
    allowed_tasks: allowedTasks,
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

export async function cleanupStationData({ supabaseAdmin, eventId, stationId, judgeId, sessionId }) {
  await supabaseAdmin.from('station_quiz_responses').delete().eq('event_id', eventId);
  await supabaseAdmin.from('station_scores').delete().eq('event_id', eventId);
  await supabaseAdmin.from('station_passages').delete().eq('event_id', eventId);
  await supabaseAdmin.from('timings').delete().eq('event_id', eventId);
  await supabaseAdmin.from('judge_assignments').delete().eq('event_id', eventId);
  if (sessionId) {
    await supabaseAdmin.from('judge_sessions').delete().eq('id', sessionId);
  }
  if (stationId) {
    await supabaseAdmin.from('stations').delete().eq('event_id', eventId);
  }
  await supabaseAdmin.from('patrols').delete().eq('event_id', eventId);
  if (judgeId) {
    await supabaseAdmin.from('judges').delete().eq('id', judgeId);
  }
  await supabaseAdmin.from('events').delete().eq('id', eventId);
}

export function createAccessTokenProvider({
  jwtSecret,
  judgeId,
  sessionId,
  eventId,
  stationId,
  ttlMs = 2 * 60 * 60 * 1000,
  refreshSkewMs = 5 * 60 * 1000,
  logPrefix = 'stress',
}) {
  let accessToken = '';
  let accessTokenExpiresAtMs = 0;

  function issueAccessToken() {
    accessToken = jwt.sign(
      {
        sub: judgeId,
        sessionId,
        eventId,
        stationId,
        role: 'authenticated',
        type: 'access',
      },
      jwtSecret,
      { expiresIn: Math.floor(ttlMs / 1000) },
    );
    accessTokenExpiresAtMs = Date.now() + ttlMs;
  }

  function getAccessToken() {
    if (!accessToken || Date.now() >= accessTokenExpiresAtMs - refreshSkewMs) {
      issueAccessToken();
      console.log(`[${logPrefix}] refreshed access token`);
    }
    return accessToken;
  }

  issueAccessToken();

  return { getAccessToken };
}

export function createChaosSender({
  rng,
  endpoint,
  getAccessToken,
  apiKey,
  chaosTimeoutRate = 0,
  chaosTimeoutMs = 4000,
  chaos429Rate = 0,
  chaosJitterMsMax = 0,
  onRequestStart,
  onRequestEnd,
}) {
  return async function sendWithChaos(payload) {
    if (chaosJitterMsMax > 0) {
      await delay(randomInt(rng, 0, chaosJitterMsMax));
    }

    if (chaos429Rate > 0 && rng() < chaos429Rate) {
      return { ok: false, status: 429, duration: 0, simulated429: true };
    }

    if (onRequestStart) {
      onRequestStart();
    }

    const shouldTimeout = chaosTimeoutRate > 0 && rng() < chaosTimeoutRate;
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
          Authorization: `Bearer ${getAccessToken()}`,
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
      if (onRequestEnd) {
        onRequestEnd();
      }
    }
  };
}

export async function checkStationInvariants({
  supabaseAdmin,
  eventId,
  expectedScoreCount,
  expectedQuizCount,
  expectedTimingCount,
  reason,
  logPrefix = 'stress',
}) {
  const failures = [];

  const { data: scores, error: scoresError } = await supabaseAdmin
    .from('station_scores')
    .select('client_event_id')
    .eq('event_id', eventId);
  const { data: passages, error: passagesError } = await supabaseAdmin
    .from('station_passages')
    .select('client_event_id')
    .eq('event_id', eventId);
  const { data: quizzes, error: quizzesError } = await supabaseAdmin
    .from('station_quiz_responses')
    .select('client_event_id')
    .eq('event_id', eventId);
  const { data: timings, error: timingsError } = await supabaseAdmin
    .from('timings')
    .select('client_event_id')
    .eq('event_id', eventId);

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

  const scoreIds = (scores ?? []).map((row) => row.client_event_id);
  const passageIds = (passages ?? []).map((row) => row.client_event_id);
  const quizIds = (quizzes ?? []).map((row) => row.client_event_id);
  const timingIds = (timings ?? []).map((row) => row.client_event_id);

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

  if (typeof expectedScoreCount === 'number' && (scores ?? []).length !== expectedScoreCount) {
    failures.push({
      message: 'station_scores count mismatch',
      expected: expectedScoreCount,
      actual: (scores ?? []).length,
    });
  }

  if (typeof expectedScoreCount === 'number' && (passages ?? []).length !== expectedScoreCount) {
    failures.push({
      message: 'station_passages count mismatch',
      expected: expectedScoreCount,
      actual: (passages ?? []).length,
    });
  }

  if (typeof expectedQuizCount === 'number' && (quizzes ?? []).length !== expectedQuizCount) {
    failures.push({
      message: 'station_quiz_responses count mismatch',
      expected: expectedQuizCount,
      actual: (quizzes ?? []).length,
    });
  }

  if (typeof expectedTimingCount === 'number' && (timings ?? []).length !== expectedTimingCount) {
    failures.push({
      message: 'timings count mismatch',
      expected: expectedTimingCount,
      actual: (timings ?? []).length,
    });
  }

  const scoreSet = new Set(scoreIds);
  const passageSet = new Set(passageIds);
  const missingPassage = scoreIds.filter((id) => !passageSet.has(id));
  const missingScore = passageIds.filter((id) => !scoreSet.has(id));

  if (missingPassage.length || missingScore.length) {
    failures.push({
      message: 'station_scores/station_passages mismatch',
      missing_passage: missingPassage.slice(0, 5),
      missing_score: missingScore.slice(0, 5),
    });
  }

  if (failures.length) {
    console.error(`[${logPrefix}] invariant failure ${reason}`, failures);
  } else {
    console.log(`[${logPrefix}] invariants OK`, {
      reason,
      expectedScoreCount,
      expectedQuizCount,
      expectedTimingCount,
    });
  }

  return { ok: failures.length === 0, failures };
}

function formatCsvValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  const raw = typeof value === 'string' ? value : String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export async function writeReport({
  label,
  status,
  runStartTime,
  config,
  summary,
  history,
  csvFields,
  failures,
  memory,
}) {
  const endTime = Date.now();
  const report = {
    status,
    started_at: new Date(runStartTime).toISOString(),
    ended_at: new Date(endTime).toISOString(),
    duration_ms: endTime - runStartTime,
    config,
    summary,
    failures: failures ?? null,
    memory: memory ?? null,
    history,
  };

  const reportDir = path.join(process.cwd(), 'test-results');
  await mkdir(reportDir, { recursive: true });
  const stamp = new Date(runStartTime).toISOString().replace(/[:.]/g, '-');
  const baseName = `${label}-report-${stamp}`;
  const jsonPath = path.join(reportDir, `${baseName}.json`);
  const csvPath = path.join(reportDir, `${baseName}.csv`);

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const fields = csvFields ?? (history.length ? Object.keys(history[0]) : []);
  const csvHeader = fields.join(',');
  const csvLines = history.map((row) => fields.map((field) => formatCsvValue(row[field])).join(','));
  await writeFile(csvPath, `${csvHeader}\n${csvLines.join('\n')}\n`, 'utf8');

  console.log(`[${label}] report saved`, { jsonPath, csvPath });

  return { jsonPath, csvPath };
}

export function setupMemoryLogging({ label, intervalMinutes = 10, maxHeapDeltaMb = 0, onViolation }) {
  const samples = [];
  let timer = null;
  const startHeapUsed = process.memoryUsage().heapUsed;

  function recordSample() {
    const usage = process.memoryUsage();
    const sample = {
      timestamp: new Date().toISOString(),
      rss_mb: Math.round((usage.rss / 1024 / 1024) * 100) / 100,
      heap_used_mb: Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100,
      heap_total_mb: Math.round((usage.heapTotal / 1024 / 1024) * 100) / 100,
    };
    samples.push(sample);
    console.log(
      `[${label}] memory rss ${sample.rss_mb}MB heap ${sample.heap_used_mb}/${sample.heap_total_mb}MB`,
    );

    if (maxHeapDeltaMb > 0) {
      const deltaMb = (usage.heapUsed - startHeapUsed) / 1024 / 1024;
      if (deltaMb > maxHeapDeltaMb && onViolation) {
        onViolation(`Heap delta ${deltaMb.toFixed(2)}MB exceeded ${maxHeapDeltaMb}MB`);
      }
    }
  }

  if (intervalMinutes > 0) {
    recordSample();
    timer = setInterval(recordSample, intervalMinutes * 60 * 1000);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
    }
  }

  function getSummary() {
    if (!samples.length) return null;
    const heapValues = samples.map((sample) => sample.heap_used_mb);
    const rssValues = samples.map((sample) => sample.rss_mb);
    return {
      heap_used_min_mb: Math.min(...heapValues),
      heap_used_max_mb: Math.max(...heapValues),
      heap_used_delta_mb: heapValues[heapValues.length - 1] - heapValues[0],
      rss_min_mb: Math.min(...rssValues),
      rss_max_mb: Math.max(...rssValues),
    };
  }

  return { samples, stop, getSummary };
}
