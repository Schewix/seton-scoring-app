/// <reference path="../types.d.ts" />

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { parse } from 'https://deno.land/std@0.224.0/csv/mod.ts';
import { hash as argon2Hash, ArgonType } from 'https://deno.land/x/argon2@v0.3.2/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const EVENT_ID = Deno.env.get('SYNC_EVENT_ID') ?? Deno.env.get('EVENT_ID');
const JUDGES_SHEET_URL = Deno.env.get('JUDGES_SHEET_URL');
const SYNC_SECRET = Deno.env.get('SYNC_SECRET');

if (!SUPABASE_URL) {
  throw new Error('Missing SUPABASE_URL environment variable.');
}

if (!SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
}

if (!EVENT_ID) {
  throw new Error('Missing SYNC_EVENT_ID (or EVENT_ID) environment variable.');
}

if (!JUDGES_SHEET_URL) {
  throw new Error('Missing JUDGES_SHEET_URL environment variable.');
}

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const VALID_CATEGORIES = ['N', 'M', 'S', 'R'] as const;
const CATEGORY_SET = new Set<string>(VALID_CATEGORIES);

type JudgeRow = {
  stationCode: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string | null;
  allowedCategories: string[];
};

type SyncOptions = {
  dryRun: boolean;
};

type JudgeResultStatus = 'created' | 'updated' | 'unchanged';

type JudgeResult = {
  id: string;
  status: JudgeResultStatus;
  generatedPassword?: string;
};

type AssignmentResult = 'created' | 'updated' | 'unchanged';

type StationRecord = {
  id: string;
  code: string;
};

function generatePassword(length = 12): string {
  const buffer = new Uint32Array(length);
  crypto.getRandomValues(buffer);
  let output = '';
  for (const value of buffer) {
    output += PASSWORD_CHARS[value % PASSWORD_CHARS.length];
  }
  return output;
}

async function hashPassword(password: string): Promise<string> {
  return await argon2Hash(password, { type: ArgonType.Argon2id });
}

function parseAllowedCategories(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const parts = raw
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)
    .filter((part) => CATEGORY_SET.has(part));
  const unique = Array.from(new Set(parts));
  unique.sort();
  return unique;
}

function buildDisplayName(firstName: string, lastName: string): string {
  const parts = [firstName.trim(), lastName.trim()].filter(Boolean);
  return parts.join(' ');
}

function normalizeCell(value: string | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function parseCsv(text: string): JudgeRow[] {
  const rows = parse(text) as string[][];
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const normalizedHeader = header.map((column) => column.trim().toLowerCase());
  const headerIndex = (column: string): number => normalizedHeader.indexOf(column);

  const idxStation = headerIndex('stanoviste');
  const idxFirst = headerIndex('jmeno');
  const idxLast = headerIndex('prijmeni');
  const idxEmail = headerIndex('email');
  const idxPhone = headerIndex('telefon');
  const idxCategories = headerIndex('allowed_categories');

  if (idxStation === -1 || idxFirst === -1 || idxEmail === -1) {
    throw new Error('Sheet must contain columns "stanoviste", "jmeno", "email".');
  }

  const result: JudgeRow[] = [];

  for (const row of dataRows) {
    if (!row || row.length === 0 || row.every((cell) => !cell || !cell.trim())) {
      continue;
    }

    const stationCode = normalizeCell(row[idxStation]).toUpperCase();
    const firstName = normalizeCell(row[idxFirst]);
    const lastName = idxLast !== -1 ? normalizeCell(row[idxLast]) : '';
    const email = normalizeCell(row[idxEmail]).toLowerCase();
    const phone = idxPhone !== -1 ? normalizeCell(row[idxPhone]) : '';
    const categoriesRaw = idxCategories !== -1 ? normalizeCell(row[idxCategories]) : '';

    if (!stationCode || !email || !firstName) {
      continue;
    }

    result.push({
      stationCode,
      firstName,
      lastName,
      displayName: buildDisplayName(firstName, lastName),
      email,
      phone: phone || null,
      allowedCategories: parseAllowedCategories(categoriesRaw),
    });
  }

  return result;
}

async function ensureJudge(
  client: SupabaseClient,
  row: JudgeRow,
  options: SyncOptions,
): Promise<JudgeResult> {
  const lowerEmail = row.email.toLowerCase();
  const { data: existing, error } = await client
    .from('judges')
    .select('id, display_name, metadata, must_change_password, onboarding_sent_at, password_rotated_at')
    .eq('email', lowerEmail)
    .maybeSingle();

  const errorCode = (error as { code?: string } | null)?.code;
  if (error && errorCode !== 'PGRST116') {
    throw new Error(`Failed to load judge "${lowerEmail}": ${error.message}`);
  }

  const nowIso = new Date().toISOString();

  if (!existing) {
    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    const metadata: Record<string, unknown> = {};
    if (row.phone) {
      metadata.phone = row.phone;
    }

    if (!options.dryRun) {
      const { data: inserted, error: insertError } = await client
        .from('judges')
        .insert({
          email: lowerEmail,
          display_name: row.displayName,
          password_hash: passwordHash,
          metadata,
          must_change_password: true,
          password_rotated_at: nowIso,
          onboarding_sent_at: nowIso,
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        throw new Error(`Failed to insert judge "${lowerEmail}": ${insertError?.message ?? 'unknown error'}`);
      }

      return { id: inserted.id, status: 'created', generatedPassword: password };
    }

    return { id: crypto.randomUUID(), status: 'created', generatedPassword: password };
  }

  const updates: Record<string, unknown> = {};
  if (existing.display_name !== row.displayName) {
    updates.display_name = row.displayName;
  }

  if (row.phone) {
    const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
    if (existingMetadata.phone !== row.phone) {
      updates.metadata = { ...existingMetadata, phone: row.phone };
    }
  }

  if (Object.keys(updates).length === 0) {
    return { id: existing.id, status: 'unchanged' };
  }

  updates.updated_at = nowIso;

  if (!options.dryRun) {
    const { error: updateError } = await client.from('judges').update(updates).eq('id', existing.id);
    if (updateError) {
      throw new Error(`Failed to update judge "${lowerEmail}": ${updateError.message}`);
    }
  }

  return { id: existing.id, status: 'updated' };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

async function ensureAssignment(
  client: SupabaseClient,
  judgeId: string,
  stationId: string,
  allowedCategories: string[],
  options: SyncOptions,
): Promise<AssignmentResult> {
  const { data: existing, error } = await client
    .from('judge_assignments')
    .select('id, allowed_categories, allowed_tasks')
    .eq('judge_id', judgeId)
    .eq('station_id', stationId)
    .eq('event_id', EVENT_ID)
    .maybeSingle();

  const errorCode = (error as { code?: string } | null)?.code;
  if (error && errorCode !== 'PGRST116') {
    throw new Error(`Failed to load assignment for judge ${judgeId}: ${error.message}`);
  }

  const categories = [...allowedCategories];
  categories.sort();

  if (!existing) {
    if (!options.dryRun) {
      const { error: insertError } = await client.from('judge_assignments').insert({
        judge_id: judgeId,
        station_id: stationId,
        event_id: EVENT_ID,
        allowed_categories: categories,
        allowed_tasks: [],
      });
      if (insertError) {
        throw new Error(`Failed to create assignment for judge ${judgeId}: ${insertError.message}`);
      }
    }
    return 'created';
  }

  const existingCategories = Array.isArray(existing.allowed_categories)
    ? [...(existing.allowed_categories as string[])]
    : [];
  existingCategories.sort();

  if (arraysEqual(existingCategories, categories)) {
    return 'unchanged';
  }

  if (!options.dryRun) {
    const { error: updateError } = await client
      .from('judge_assignments')
      .update({ allowed_categories: categories })
      .eq('id', existing.id);
    if (updateError) {
      throw new Error(`Failed to update assignment for judge ${judgeId}: ${updateError.message}`);
    }
  }

  return 'updated';
}

async function recordOnboardingEvent(
  client: SupabaseClient,
  params: { judgeId: string; stationId: string; metadata: Record<string, unknown> },
  options: SyncOptions,
): Promise<void> {
  if (options.dryRun) {
    return;
  }
  const { error } = await client.from('judge_onboarding_events').insert({
    judge_id: params.judgeId,
    station_id: params.stationId,
    event_id: EVENT_ID,
    delivery_channel: 'email',
    metadata: params.metadata,
  });
  if (error) {
    console.error('Failed to insert judge_onboarding_events record', error);
  }
}

async function fetchStations(client: SupabaseClient): Promise<Map<string, StationRecord>> {
  const { data, error } = await client
    .from('stations')
    .select('id, code')
    .eq('event_id', EVENT_ID);

  if (error) {
    throw new Error(`Failed to load stations for event ${EVENT_ID}: ${error.message}`);
  }

  const map = new Map<string, StationRecord>();
  for (const station of data ?? []) {
    if (!station.code || !station.id) {
      continue;
    }
    map.set(String(station.code).trim().toUpperCase(), {
      id: station.id,
      code: String(station.code).trim().toUpperCase(),
    });
  }
  return map;
}

async function downloadSheet(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download sheet: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (SYNC_SECRET) {
    const header = req.headers.get('authorization');
    if (!header || header !== `Bearer ${SYNC_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';
  const includeOtps = req.headers.get('x-include-otps') === 'true';
  const options: SyncOptions = { dryRun };

  try {
    const csvText = await downloadSheet(JUDGES_SHEET_URL);
    const rows = parseCsv(csvText);

    const summary: {
      totalRows: number;
      processed: number;
      createdJudges: number;
      updatedJudges: number;
      createdAssignments: number;
      updatedAssignments: number;
      passwordsIssued: number;
      dryRun: boolean;
      skipped: string[];
      errors: string[];
      generatedPasswords?: { email: string; password: string }[];
    } = {
      totalRows: rows.length,
      processed: 0,
      createdJudges: 0,
      updatedJudges: 0,
      createdAssignments: 0,
      updatedAssignments: 0,
      passwordsIssued: 0,
      dryRun,
      skipped: [],
      errors: [],
      generatedPasswords: includeOtps ? [] : undefined,
    };

    if (rows.length === 0) {
      return Response.json(summary);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const stationMap = await fetchStations(supabase);

    for (const row of rows) {
      if (!row.email) {
        summary.skipped.push('Row skipped – missing email');
        continue;
      }
      if (!row.stationCode) {
        summary.skipped.push(`Row for ${row.email} skipped – missing station code`);
        continue;
      }

      const station = stationMap.get(row.stationCode);
      if (!station) {
        summary.errors.push(`Unknown station code "${row.stationCode}" for ${row.email}`);
        continue;
      }

      try {
        const judgeResult = await ensureJudge(supabase, row, options);
        summary.processed += 1;
        if (judgeResult.status === 'created') {
          summary.createdJudges += 1;
        } else if (judgeResult.status === 'updated') {
          summary.updatedJudges += 1;
        }

        if (judgeResult.generatedPassword) {
          summary.passwordsIssued += 1;
          if (includeOtps && summary.generatedPasswords) {
            summary.generatedPasswords.push({ email: row.email, password: judgeResult.generatedPassword });
          }
        }

        const assignmentResult = await ensureAssignment(
          supabase,
          judgeResult.id,
          station.id,
          row.allowedCategories,
          options,
        );

        if (assignmentResult === 'created') {
          summary.createdAssignments += 1;
        } else if (assignmentResult === 'updated') {
          summary.updatedAssignments += 1;
        }

        if (judgeResult.status === 'created') {
          await recordOnboardingEvent(
            supabase,
            {
              judgeId: judgeResult.id,
              stationId: station.id,
              metadata: { type: 'initial-password-issued' },
            },
            options,
          );
        }
      } catch (error) {
        summary.errors.push(
          `Failed to sync judge ${row.email}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return Response.json(summary);
  } catch (error) {
    console.error('sync-judges error', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      },
    );
  }
});
