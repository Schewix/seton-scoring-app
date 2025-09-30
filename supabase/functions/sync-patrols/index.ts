/// <reference path="../types.d.ts" />

import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { parse } from 'https://deno.land/std@0.224.0/csv/mod.ts';

type SheetSource = {
  key: string;
  category: string;
  sex: string;
  url: string;
};

type PatrolRow = Partial<Record<
  'team_name' | 'patrol_code' | 'child1' | 'child2' | 'child3' | 'start_time' | 'note' | 'active',
  string
>>;

type ParsedRow = {
  patrol: {
    event_id: string;
    team_name: string;
    category: string;
    sex: string;
    patrol_code: string;
    note: string | null;
    active: boolean;
  };
  start_time?: string | null;
};

type EdgeSupabaseClient = SupabaseClient<any>;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const EVENT_ID = Deno.env.get('SYNC_EVENT_ID') ?? Deno.env.get('EVENT_ID');
const SHEET_CONFIG = Deno.env.get('SHEET_EXPORTS');
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

function parseSheetConfig(config: string | undefined): SheetSource[] {
  if (!config) {
    throw new Error('SHEET_EXPORTS environment variable is required.');
  }

  const entries = config
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length && !line.startsWith('#'));

  const sources: SheetSource[] = [];

  for (const entry of entries) {
    const eqIndex = entry.indexOf('=');
    if (eqIndex === -1) {
      throw new Error(`Invalid SHEET_EXPORTS entry: "${entry}". Expected format NAME=https://...`);
    }
    const key = entry.slice(0, eqIndex);
    const url = entry.slice(eqIndex + 1);
    const trimmedKey = key.trim();
    const trimmedUrl = url.trim();
    const [category, sex] = trimmedKey.split('_');
    if (!category || !sex) {
      throw new Error(`SHEET_EXPORTS key must be CATEGORY_SEX (e.g. N_H). Problem: ${trimmedKey}`);
    }

    const upperCategory = category.trim().toUpperCase();
    const upperSex = sex.trim().toUpperCase();

    if (!['N', 'M', 'S', 'R'].includes(upperCategory)) {
      throw new Error(`Unsupported category "${upperCategory}" in entry ${trimmedKey}`);
    }
    if (!['H', 'D'].includes(upperSex)) {
      throw new Error(`Unsupported sex "${upperSex}" in entry ${trimmedKey}`);
    }

    sources.push({
      key: trimmedKey,
      category: upperCategory,
      sex: upperSex,
      url: trimmedUrl,
    });
  }

  if (!sources.length) {
    throw new Error('SHEET_EXPORTS does not contain any valid entries.');
  }

  return sources;
}

function normalizeString(value: string | null | undefined): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseStartTime(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const timeMatch = trimmed.match(/^([0-2]?\d):([0-5]\d)(?::([0-5]\d))?$/);
  if (timeMatch) {
    const [, hours, minutes, seconds = '00'] = timeMatch;
    const today = new Date();
    const iso = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      Number.parseInt(hours, 10),
      Number.parseInt(minutes, 10),
      Number.parseInt(seconds, 10),
    );
    return iso.toISOString();
  }

  const asDate = new Date(trimmed);
  if (Number.isNaN(asDate.getTime())) {
    throw new Error(`Invalid start_time value: ${value}`);
  }
  return asDate.toISOString();
}

function isActive(value: string | undefined): boolean {
  if (!value) return true;
  const lowered = value.trim().toLowerCase();
  if (!lowered) return true;
  return ['yes', 'true', '1', 'ano', 'y'].includes(lowered);
}

function generateCode(existing: Set<string>, batch: Set<string>): string {
  for (let attempt = 0; attempt < 32; attempt++) {
    let candidate = '';
    for (let i = 0; i < 6; i++) {
      const idx = Math.floor(Math.random() * CODE_CHARS.length);
      candidate += CODE_CHARS[idx];
    }
    if (!existing.has(candidate) && !batch.has(candidate)) {
      return candidate;
    }
  }
  throw new Error('Unable to generate a unique patrol_code after multiple attempts.');
}

async function fetchCsv(url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download CSV from ${url} – ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

function parseCsvRows(text: string): PatrolRow[] {
  const rows = parse(text) as string[][];

  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const normalizedHeader = header.map((col) => col.trim().toLowerCase());

  const expectedColumns = ['team_name', 'patrol_code', 'child1', 'child2', 'child3', 'start_time', 'note', 'active'] as const;
  const columnIndex = new Map<string, number>();
  normalizedHeader.forEach((name, index) => {
    if (name) {
      columnIndex.set(name, index);
    }
  });

  if (!columnIndex.has('team_name')) {
    throw new Error('CSV header missing required "team_name" column.');
  }

  const getValue = (row: string[], key: string): string | undefined => {
    const index = columnIndex.get(key);
    if (index === undefined) return undefined;
    return row[index] ?? undefined;
  };

  const result: PatrolRow[] = [];

  for (const row of dataRows) {
    if (!row || row.every((cell) => !cell || !cell.trim())) {
      continue;
    }

    const entry: PatrolRow = {};

    for (const key of expectedColumns) {
      const value = getValue(row, key);
      if (value !== undefined) {
        entry[key] = value;
      }
    }

    result.push(entry);
  }

  return result;
}

function combineNote(children: string[], rawNote: string): string | null {
  const parts = [] as string[];
  const members = children.filter(Boolean).join(', ');
  if (members) parts.push(members);
  if (rawNote) parts.push(rawNote);
  if (!parts.length) return null;
  return parts.join('\n');
}

async function fetchExistingCodes(client: EdgeSupabaseClient, eventId: string): Promise<Set<string>> {
  const { data, error } = await client
    .from('patrols')
    .select('patrol_code')
    .eq('event_id', eventId);

  if (error) {
    throw new Error(`Failed to fetch existing patrol codes: ${error.message}`);
  }

  const codes = new Set<string>();
  for (const row of data ?? []) {
    if (row.patrol_code) {
      codes.add(row.patrol_code);
    }
  }
  return codes;
}

async function upsertPatrols(
  client: EdgeSupabaseClient,
  rows: ParsedRow[],
): Promise<number> {
  if (!rows.length) return 0;

  const payload = rows.map((row) => ({
    event_id: row.patrol.event_id,
    team_name: row.patrol.team_name,
    category: row.patrol.category,
    sex: row.patrol.sex,
    patrol_code: row.patrol.patrol_code,
    note: row.patrol.note,
    active: row.patrol.active,
  }));

  const { error } = await client
    .from('patrols')
    .upsert(payload, { onConflict: 'event_id,patrol_code' });

  if (error) {
    throw new Error(`Failed to upsert patrols: ${error.message}`);
  }

  return payload.length;
}

async function upsertTimings(
  client: EdgeSupabaseClient,
  eventId: string,
  rows: ParsedRow[],
): Promise<number> {
  const updates = rows.filter((row) => row.start_time != null);
  if (!updates.length) return 0;

  const codes = updates.map((row) => row.patrol.patrol_code);
  const { data, error } = await client
    .from('patrols')
    .select('id, patrol_code')
    .eq('event_id', eventId)
    .in('patrol_code', codes);

  if (error) {
    throw new Error(`Failed to fetch patrol ids for timings: ${error.message}`);
  }

  const idMap = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.patrol_code && row.id) {
      idMap.set(row.patrol_code, row.id);
    }
  }

  const timingRows = [] as { event_id: string; patrol_id: string; start_time: string | null }[];
  for (const update of updates) {
    const patrolId = idMap.get(update.patrol.patrol_code);
    if (!patrolId) continue;
    timingRows.push({ event_id: eventId, patrol_id: patrolId, start_time: update.start_time ?? null });
  }

  if (!timingRows.length) return 0;

  const { error: timingError } = await client
    .from('timings')
    .upsert(timingRows, { onConflict: 'event_id,patrol_id' });

  if (timingError) {
    throw new Error(`Failed to upsert timings: ${timingError.message}`);
  }

  return timingRows.length;
}

function buildRows(
  sources: SheetSource[],
  csvRecords: Map<string, PatrolRow[]>,
  eventId: string,
  existingCodes: Set<string>,
): ParsedRow[] {
  const results: ParsedRow[] = [];
  const batchCodes = new Set<string>();

  for (const source of sources) {
    const rows = csvRecords.get(source.key) ?? [];
    for (const raw of rows) {
      const teamName = normalizeString(raw.team_name);
      if (!teamName) {
        continue;
      }

      const prefix = `${source.category}${source.sex}`;
      let patrolCode = normalizeString(raw.patrol_code);
      if (patrolCode) {
        const numericMatch = patrolCode.match(/^(\d+)$/);
        if (numericMatch) {
          patrolCode = `${prefix}-${numericMatch[1]}`;
        } else {
          const upper = patrolCode.toUpperCase();
          if (upper.startsWith(prefix) && !upper.startsWith(`${prefix}-`)) {
            patrolCode = `${prefix}-${upper.slice(prefix.length).replace(/^[-\s]*/, '')}`;
          } else if (upper.startsWith(prefix)) {
            patrolCode = `${prefix}-${upper.slice(prefix.length + 1).trim()}`;
          }
        }
      }
      if (!patrolCode) {
        patrolCode = generateCode(existingCodes, batchCodes);
      }

      if (batchCodes.has(patrolCode)) {
        throw new Error(`Duplicate patrol_code detected in import batch: ${patrolCode}`);
      }

      batchCodes.add(patrolCode);
      existingCodes.add(patrolCode);

      const children = [normalizeString(raw.child1), normalizeString(raw.child2), normalizeString(raw.child3)];
      const rawNote = normalizeString(raw.note);
      const note = combineNote(children, rawNote);
      let startTime: string | null = null;
      if (raw.start_time) {
        startTime = parseStartTime(raw.start_time);
      }

      results.push({
        patrol: {
          event_id: eventId,
          team_name: teamName,
          category: source.category,
          sex: source.sex,
          patrol_code: patrolCode,
          note,
          active: isActive(raw.active),
        },
        start_time: startTime,
      });
    }
  }

  return results;
}

function messageFromError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return String(error);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (SYNC_SECRET) {
    const auth = req.headers.get('authorization');
    if (!auth || auth !== `Bearer ${SYNC_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const sources = parseSheetConfig(SHEET_CONFIG);

  const csvRecords = new Map<string, PatrolRow[]>();
  try {
    for (const source of sources) {
      const csvText = await fetchCsv(source.url);
      const rows = parseCsvRows(csvText);
      csvRecords.set(source.key, rows);
    }
  } catch (error) {
    console.error('Failed to fetch or parse CSV', error);
    return new Response(JSON.stringify({ error: messageFromError(error) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase: EdgeSupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let patrolRows: ParsedRow[];
  try {
    const existingCodes = await fetchExistingCodes(supabase, EVENT_ID);
    patrolRows = buildRows(sources, csvRecords, EVENT_ID, existingCodes);
  } catch (error) {
    console.error('Failed to build patrol rows', error);
    return new Response(JSON.stringify({ error: messageFromError(error) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const upserted = await upsertPatrols(supabase, patrolRows);
    const timings = await upsertTimings(supabase, EVENT_ID, patrolRows);
    const responseBody = {
      status: 'ok' as const,
      patrols_processed: patrolRows.length,
      patrols_upserted: upserted,
      timings_upserted: timings,
    };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to upsert data', error);
    return new Response(JSON.stringify({ error: messageFromError(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
