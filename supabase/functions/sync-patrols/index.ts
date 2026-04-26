/// <reference path="../types.d.ts" />

import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { parse } from 'https://deno.land/std@0.224.0/csv/mod.ts';

type SheetSource = {
  key: string;
  defaultCategory?: string;
  defaultSex?: string;
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
const SYNC_TIME_ZONE = Deno.env.get('SYNC_TIME_ZONE') ?? 'Europe/Prague';

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
    if (!trimmedKey || !trimmedUrl) {
      throw new Error(`Invalid SHEET_EXPORTS entry: "${entry}". Key and URL are required.`);
    }

    const defaultMatch = trimmedKey.match(/^([NMSR])_([HD])$/i);
    const defaultCategory = defaultMatch ? defaultMatch[1].toUpperCase() : undefined;
    const defaultSex = defaultMatch ? defaultMatch[2].toUpperCase() : undefined;

    sources.push({
      key: trimmedKey,
      defaultCategory,
      defaultSex,
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

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function zonedTimeToUtcIso(
  timeZone: string,
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
) {
  const utcGuess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );
  const zoned = getDatePartsInTimeZone(utcGuess, timeZone);
  const zonedAsUtcMs = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second,
  );
  const shiftMs = zonedAsUtcMs - utcGuess.getTime();
  return new Date(utcGuess.getTime() - shiftMs).toISOString();
}

function parseStartTime(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const timeMatch = trimmed.match(/^([0-2]?\d):([0-5]\d)(?::([0-5]\d))?$/);
  if (timeMatch) {
    const [, hours, minutes, seconds = '00'] = timeMatch;
    const today = getDatePartsInTimeZone(new Date(), SYNC_TIME_ZONE);
    return zonedTimeToUtcIso(SYNC_TIME_ZONE, {
      year: today.year,
      month: today.month,
      day: today.day,
      hour: Number.parseInt(hours, 10),
      minute: Number.parseInt(minutes, 10),
      second: Number.parseInt(seconds, 10),
    });
  }

  const fullDateTimeMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T]([0-2]?\d):([0-5]\d)(?::([0-5]\d))?$/,
  );
  if (fullDateTimeMatch) {
    const [, year, month, day, hours, minutes, seconds = '00'] = fullDateTimeMatch;
    return zonedTimeToUtcIso(SYNC_TIME_ZONE, {
      year: Number.parseInt(year, 10),
      month: Number.parseInt(month, 10),
      day: Number.parseInt(day, 10),
      hour: Number.parseInt(hours, 10),
      minute: Number.parseInt(minutes, 10),
      second: Number.parseInt(seconds, 10),
    });
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

function parsePrefixedPatrolCode(rawCode: string): { patrolCode: string; category: string; sex: string } | null {
  const compact = rawCode.trim().toUpperCase().replace(/\s+/g, '');
  const match = compact.match(/^([NMSR])([HD])-?(.+)$/);
  if (!match) return null;

  const [, category, sex, rawSuffix] = match;
  const suffix = rawSuffix.replace(/^-+/, '');
  if (!suffix) {
    throw new Error(`Invalid patrol_code "${rawCode}". Expected format like NH-1.`);
  }

  return {
    patrolCode: `${category}${sex}-${suffix}`,
    category,
    sex,
  };
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

      let patrolCode = normalizeString(raw.patrol_code);
      let category = source.defaultCategory;
      let sex = source.defaultSex;
      if (patrolCode) {
        const prefixed = parsePrefixedPatrolCode(patrolCode);
        if (prefixed) {
          patrolCode = prefixed.patrolCode;
          category = prefixed.category;
          sex = prefixed.sex;
        } else {
          if (!source.defaultCategory || !source.defaultSex) {
            throw new Error(
              `patrol_code "${patrolCode}" must include full prefix (e.g. NH-1 or SD-1) when SHEET_EXPORTS key is not CATEGORY_SEX.`,
            );
          }

          const prefix = `${source.defaultCategory}${source.defaultSex}`;
          const compact = patrolCode.trim().toUpperCase().replace(/\s+/g, '');
          const numericMatch = compact.match(/^(\d+)$/);
          if (numericMatch) {
            patrolCode = `${prefix}-${numericMatch[1]}`;
          } else if (compact.startsWith(prefix)) {
            const suffix = compact.slice(prefix.length).replace(/^-+/, '');
            if (!suffix) {
              throw new Error(`Invalid patrol_code "${patrolCode}". Expected format like ${prefix}-1.`);
            }
            patrolCode = `${prefix}-${suffix}`;
          } else {
            patrolCode = compact;
          }
        }
      }
      if (!patrolCode) {
        if (!source.defaultCategory || !source.defaultSex) {
          throw new Error(
            `Missing patrol_code for team "${teamName}" in source "${source.key}". Use full patrol_code like NH-1 or SD-1.`,
          );
        }
        patrolCode = generateCode(existingCodes, batchCodes);
      }

      if (!category || !sex) {
        throw new Error(`Unable to determine category/sex for patrol_code "${patrolCode}".`);
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
          category,
          sex,
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
