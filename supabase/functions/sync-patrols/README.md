# `sync-patrols` Edge Function

Pulls roster data published as CSV from Google Sheets and upserts it into the
`patrols` table (plus optional start times into `timings`). Designed to replace
the legacy Apps Script synchronisation.

## Deployment

```bash
supabase functions deploy sync-patrols
```

Add a cron job (Supabase Scheduled Functions or any external scheduler) to call
the deployed endpoint periodically.

## Required secrets

Set these secrets before deploying:

```bash
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  SYNC_EVENT_ID=<uuid-of-event> \
  SHEET_EXPORTS=$'N_H=https://...\nN_D=https://...\nM_H=https://...'
```

Optional secrets:

- `SYNC_SECRET` – bearer token required in the `Authorization` header.

`SUPABASE_URL` is injected automatically inside Supabase Edge Functions.

### `SHEET_EXPORTS`

`SHEET_EXPORTS` is a newline-separated list of sheet identifiers and published
CSV URLs. The identifier must follow `CATEGORY_SEX` (`N|M|S|R` + `H|D`).

Example:

```
N_H=https://docs.google.com/spreadsheets/d/.../pub?gid=123&single=true&output=csv
N_D=https://docs.google.com/spreadsheets/d/.../pub?gid=456&single=true&output=csv
```

Each CSV must contain these headers (case-insensitive):

- `team_name` (required)
- `patrol_code` (optional, generated if empty)
- `child1`, `child2`, `child3`
- `start_time`
- `note`
- `active`

## Manual trigger

```bash
supabase functions invoke sync-patrols --no-verify-jwt --request-body '{}' \
  --header 'Authorization: Bearer <SYNC_SECRET>'
```

The function responds with the number of patrols processed and timing rows
upserted.
