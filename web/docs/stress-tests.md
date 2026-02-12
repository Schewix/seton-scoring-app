# Stress + chaos tests (manual)

These scripts are **manual-only** (not in CI). Run them from the `web` package with `pnpm -C web ...`. Each script logs progress every minute and writes JSON/CSV reports to `web/test-results/`.

## Shared env

- `SUPABASE_URL` (default `http://127.0.0.1:54321`)
- `SUPABASE_JWT_SECRET` (default from scripts)
- `SUPABASE_SERVICE_ROLE_KEY` (optional, otherwise generated from JWT secret)
- `TARGET_URL` (defaults to local Edge Function URL)
- `SEED` (deterministic RNG seed)
- `MEMORY_LOG_INTERVAL_MINUTES` (default `10`, set `0` to disable)
- `MAX_HEAP_DELTA_MB` (optional guard; if exceeded, script fails)

## Recommended profiles

### Race (realistic)
Use when you want a stable overnight run with mild chaos.

```
CHAOS_TIMEOUT_RATE=0.02 \
CHAOS_TIMEOUT_MS=5000 \
CHAOS_429_RATE=0.01 \
CHAOS_JITTER_MS_MAX=1000 \
MEMORY_LOG_INTERVAL_MINUTES=10 \
MAX_HEAP_DELTA_MB=200
```

### Torture (aggressive)
Use for short 15–60 min abuse runs.

```
CHAOS_TIMEOUT_RATE=0.10 \
CHAOS_TIMEOUT_MS=2500 \
CHAOS_429_RATE=0.10 \
CHAOS_JITTER_MS_MAX=3000 \
MEMORY_LOG_INTERVAL_MINUTES=10 \
MAX_HEAP_DELTA_MB=300
```

## Scripts

### 1) Scoreboard read + write
- Writers submit station records while readers pull `scoreboard_view`.
- Invariants: no duplicate `client_event_id`, consistent row counts.

```
pnpm -C web test:stress:scoreboard
```

Key env:
- `STRESS_DURATION_MINUTES` (default `60`)
- `WRITERS` (default `30`)
- `READERS` (default `10`)
- `WRITE_MIN_INTERVAL_MS` / `WRITE_MAX_INTERVAL_MS`
- `READ_INTERVAL_MS`
- `SCOREBOARD_URL` (optional; supports `{eventId}` placeholder)

### 2) Massive outbox flush
- Generates 500–1000 pending items (with duplicates) and flushes them.
- Pass: outbox drains before deadline, no duplicates, no partial writes.

```
pnpm -C web test:stress:outbox
```

Key env:
- `OUTBOX_ITEMS` (default `800`)
- `OUTBOX_DUP_RATE` (default `0.15`)
- `FLUSH_CONCURRENCY` (default `8`)
- `FLUSH_DEADLINE_MINUTES` (default `15`)

### 3) Thundering herd restart
- Clients restart simultaneously and flush pending queues + new submits.
- Pass: outbox drains, invariants hold, in-flight stays under limit.

```
pnpm -C web test:stress:herd
```

Key env:
- `HERD_CLIENTS` (default `30`)
- `HERD_PENDING_PER_CLIENT` (default `20`)
- `HERD_NEW_SUBMITS` (default `3`)
- `HERD_DEADLINE_MINUTES` (default `15`)
- `HERD_MAX_INFLIGHT` (default `HERD_CLIENTS * 4`)

### 4) DB constraints mix
- Mixes inserts + updates, quiz on/off, timing, duplicate client_event_id.
- Pass: LWW by `client_created_at`, quiz delete works, no partial writes.

```
pnpm -C web test:stress:dbmix
```

Key env:
- `MIX_DURATION_MINUTES` (default `10`)
- `MIX_CLIENTS` (default `20`)
- `MIX_MIN_INTERVAL_MS` / `MIX_MAX_INTERVAL_MS`
- `UPDATE_RATE` / `QUIZ_RATE` / `TIMING_RATE`
- `DUP_CLIENT_EVENT_RATE`

### 5) Cold start stress
- Idle N minutes, then burst M requests. Repeats for N rounds.
- Report includes cold-start latency overhead.

```
pnpm -C web test:stress:coldstart
```

Key env:
- `IDLE_MINUTES` (default `5`)
- `BURST_REQUESTS` (default `60`)
- `BURST_ROUNDS` (default `5`)

### 6) Rate limit test
- Fires a burst of requests in a tight window with bounded retries.
- Pass: no retry runaway, invariants hold.

```
pnpm -C web test:stress:ratelimit
```

Key env:
- `RATE_LIMIT_REQUESTS` (default `200`)
- `RATE_LIMIT_WINDOW_MS` (default `2000`)
- `RETRY_MAX_ATTEMPTS` (default `3`)
- `CHAOS_JITTER_MS_MAX` (default `500`)

## Reports

All scripts write JSON/CSV reports to:
- `web/test-results/<script>-report-<timestamp>.json`
- `web/test-results/<script>-report-<timestamp>.csv`

Report fields include:
- `summary` with attempts, error rate, p50/p95 (and cold-start overhead where relevant)
- `history` entries logged every minute
- `memory` samples + min/max/delta (if enabled)
- `failures` when invariants or guards are violated
