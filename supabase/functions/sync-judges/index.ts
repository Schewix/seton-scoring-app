/// <reference path="../types.d.ts" />

import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { parse } from 'https://deno.land/std@0.224.0/csv/mod.ts';


const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const EVENT_ID = Deno.env.get('SYNC_EVENT_ID') ?? Deno.env.get('EVENT_ID');
const JUDGES_SHEET_URL = Deno.env.get('JUDGES_SHEET_URL');
const BOARD_JUDGES_SHEET_URL = Deno.env.get('BOARD_JUDGES_SHEET_URL');
const BOARD_JUDGES_SHEET_NAME = Deno.env.get('BOARD_JUDGES_SHEET_NAME') || 'deskovky';
const BOARD_EVENT_ID = Deno.env.get('BOARD_EVENT_ID');
const BOARD_EVENT_SLUG = Deno.env.get('BOARD_EVENT_SLUG');
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
  displayName: string;
  email: string;
  phone: string | null;
  allowedCategories: string[];
};

type BoardJudgeRow = {
  gameNameRaw: string;
  gameNameKey: string;
  categoryNameRaw: string | null;
  displayName: string;
  email: string;
  phone: string | null;
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

type BoardSetup = {
  boardEventId: string;
  gameIdByKey: Map<string, string>;
  categoryIdByKey: Map<string, string>;
};

type BoardAssignmentResult = 'created' | 'unchanged';

const BOARD_GAME_ALIASES: Record<string, string> = {
  kriskros: 'kris kros',
  kriskrosy: 'kris kros',
  kris: 'kris kros',
  tvc: 'tajna vyprava carodeju',
  tajnavyprava: 'tajna vyprava carodeju',
  tajnavypravacarodeju: 'tajna vyprava carodeju',
  hop: 'hop',
  'milostny dopis': 'dominion',
  milostnydopis: 'dominion',
  loveletter: 'dominion',
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

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 210_000; // OWASP range; adjust if too slow on Edge
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    key,
    256 // 32 bytes
  );
  const encoded = `pbkdf2$sha256$${iterations}$${toBase64(salt.buffer)}$${toBase64(derived)}`;
  return encoded;
}

function parseAllowedCategories(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const parts = raw
    .split(/[^A-Za-z0-9]+/)
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

function normalizeHeaderKey(column: string): string {
  return column
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBoardGameKey(value: string): string {
  const key = normalizeLookupKey(value);
  return BOARD_GAME_ALIASES[key] ?? key;
}

function findHeaderIndex(normalizedHeader: string[], ...candidates: string[]): number {
  const normalizedCandidates = candidates
    .map((candidate) => normalizeHeaderKey(candidate))
    .filter((candidate) => candidate.length > 0);

  for (const candidate of normalizedCandidates) {
    const exactIdx = normalizedHeader.indexOf(candidate);
    if (exactIdx !== -1) {
      return exactIdx;
    }
  }

  // Fallback for sheets where first data token leaked into header, e.g. "stanoviste_A".
  for (const candidate of normalizedCandidates) {
    const looseIdx = normalizedHeader.findIndex(
      (column) => column.startsWith(`${candidate}_`) || column.endsWith(`_${candidate}`),
    );
    if (looseIdx !== -1) {
      return looseIdx;
    }
  }

  return -1;
}

function parseCsv(text: string): JudgeRow[] {
  const rows = parse(text) as string[][];
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const normalizedHeader = header.map((column) => normalizeHeaderKey(column));

  const idxStation = findHeaderIndex(normalizedHeader, 'stanoviste', 'stanoviště', 'station', 'station_code');
  const idxFirst = findHeaderIndex(normalizedHeader, 'jmeno', 'jméno', 'first_name');
  const idxLast = findHeaderIndex(normalizedHeader, 'prijmeni', 'příjmení', 'last_name');
  const idxEmail = findHeaderIndex(normalizedHeader, 'email', 'e-mail');
  const idxPhone = findHeaderIndex(normalizedHeader, 'telefon', 'phone');
  const idxCategories = findHeaderIndex(normalizedHeader, 'allowed_categories', 'allowed categories', 'categories');

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
      displayName: buildDisplayName(firstName, lastName),
      email,
      phone: phone || null,
      allowedCategories: parseAllowedCategories(categoriesRaw),
    });
  }

  return result;
}

function parseBoardCsv(text: string): BoardJudgeRow[] {
  const rows = parse(text) as string[][];
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const normalizedHeader = header.map((column) => normalizeHeaderKey(column));

  const idxGame = findHeaderIndex(normalizedHeader, 'deskovka', 'hra', 'game', 'board_game');
  const idxFirst = findHeaderIndex(normalizedHeader, 'jmeno', 'jméno', 'first_name');
  const idxLast = findHeaderIndex(normalizedHeader, 'prijmeni', 'příjmení', 'last_name');
  const idxEmail = findHeaderIndex(normalizedHeader, 'email', 'e-mail');
  const idxPhone = findHeaderIndex(normalizedHeader, 'telefon', 'phone');
  const idxCategory = findHeaderIndex(normalizedHeader, 'kategorie', 'category');

  if (idxGame === -1 || idxEmail === -1) {
    throw new Error('Board sheet must contain columns "deskovka" and "email".');
  }

  const result: BoardJudgeRow[] = [];

  for (const row of dataRows) {
    if (!row || row.length === 0 || row.every((cell) => !cell || !cell.trim())) {
      continue;
    }

    const gameNameRaw = normalizeCell(row[idxGame]);
    const firstName = idxFirst !== -1 ? normalizeCell(row[idxFirst]) : '';
    const lastName = idxLast !== -1 ? normalizeCell(row[idxLast]) : '';
    const email = normalizeCell(row[idxEmail]).toLowerCase();
    const phone = idxPhone !== -1 ? normalizeCell(row[idxPhone]) : '';
    const categoryNameRaw = idxCategory !== -1 ? normalizeCell(row[idxCategory]) : '';
    const displayName = buildDisplayName(firstName, lastName) || email;

    if (!gameNameRaw || !email) {
      continue;
    }

    result.push({
      gameNameRaw,
      gameNameKey: normalizeBoardGameKey(gameNameRaw),
      categoryNameRaw: categoryNameRaw || null,
      displayName,
      email,
      phone: phone || null,
    });
  }

  return result;
}

function resolveBoardSheetUrl(): string | null {
  if (BOARD_JUDGES_SHEET_URL) {
    return BOARD_JUDGES_SHEET_URL;
  }

  try {
    const base = new URL(JUDGES_SHEET_URL as string);
    const sheetName = BOARD_JUDGES_SHEET_NAME || 'deskovky';
    const docMatch = base.pathname.match(/\/spreadsheets\/d\/([^/]+)/i);
    if (docMatch?.[1]) {
      return `https://docs.google.com/spreadsheets/d/${docMatch[1]}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    }

    if (base.pathname.includes('/gviz/tq')) {
      base.searchParams.set('tqx', 'out:csv');
      base.searchParams.set('sheet', sheetName);
      base.searchParams.delete('gid');
      return base.toString();
    }
  } catch {
    return null;
  }

  return null;
}

async function ensureJudge(
  client: SupabaseClient,
  row: Pick<JudgeRow, 'displayName' | 'email' | 'phone'>,
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
  params: { judgeId: string; stationId?: string | null; metadata: Record<string, unknown> },
  options: SyncOptions,
): Promise<void> {
  if (options.dryRun) {
    return;
  }
  const { error } = await client.from('judge_onboarding_events').insert({
    judge_id: params.judgeId,
    station_id: params.stationId ?? null,
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

async function resolveBoardSetup(client: SupabaseClient): Promise<BoardSetup | null> {
  let boardEventId = BOARD_EVENT_ID || '';

  if (!boardEventId && BOARD_EVENT_SLUG) {
    const { data: eventBySlug, error: slugError } = await client
      .from('board_event')
      .select('id')
      .eq('slug', BOARD_EVENT_SLUG)
      .maybeSingle();
    if (slugError) {
      throw new Error(`Failed to load board event by slug "${BOARD_EVENT_SLUG}": ${slugError.message}`);
    }
    boardEventId = eventBySlug?.id ?? '';
  }

  if (!boardEventId) {
    const { data: eventBySetonId, error: setonError } = await client
      .from('board_event')
      .select('id')
      .eq('id', EVENT_ID)
      .maybeSingle();
    if (setonError) {
      throw new Error(`Failed to load board event by id "${EVENT_ID}": ${setonError.message}`);
    }
    boardEventId = eventBySetonId?.id ?? '';
  }

  if (!boardEventId) {
    return null;
  }

  const [{ data: games, error: gamesError }, { data: categories, error: categoriesError }] = await Promise.all([
    client.from('board_game').select('id, name').eq('event_id', boardEventId),
    client.from('board_category').select('id, name').eq('event_id', boardEventId),
  ]);

  if (gamesError) {
    throw new Error(`Failed to load board games for event ${boardEventId}: ${gamesError.message}`);
  }
  if (categoriesError) {
    throw new Error(`Failed to load board categories for event ${boardEventId}: ${categoriesError.message}`);
  }

  const gameIdByKey = new Map<string, string>();
  for (const game of games ?? []) {
    if (!game?.id || !game?.name) {
      continue;
    }
    gameIdByKey.set(normalizeBoardGameKey(String(game.name)), String(game.id));
  }

  const categoryIdByKey = new Map<string, string>();
  for (const category of categories ?? []) {
    if (!category?.id || !category?.name) {
      continue;
    }
    categoryIdByKey.set(normalizeLookupKey(String(category.name)), String(category.id));
  }

  return {
    boardEventId,
    gameIdByKey,
    categoryIdByKey,
  };
}

async function ensureBoardAssignment(
  client: SupabaseClient,
  params: { boardEventId: string; judgeId: string; gameId: string; categoryId: string | null },
  options: SyncOptions,
): Promise<BoardAssignmentResult> {
  let query = client
    .from('board_judge_assignment')
    .select('id')
    .eq('event_id', params.boardEventId)
    .eq('user_id', params.judgeId)
    .eq('game_id', params.gameId);

  query = params.categoryId ? query.eq('category_id', params.categoryId) : query.is('category_id', null);

  const { data: existing, error } = await query.maybeSingle();
  const errorCode = (error as { code?: string } | null)?.code;
  if (error && errorCode !== 'PGRST116') {
    throw new Error(`Failed to load board assignment for judge ${params.judgeId}: ${error.message}`);
  }

  if (existing?.id) {
    return 'unchanged';
  }

  if (!options.dryRun) {
    const { error: insertError } = await client.from('board_judge_assignment').insert({
      event_id: params.boardEventId,
      user_id: params.judgeId,
      game_id: params.gameId,
      category_id: params.categoryId,
    });
    if (insertError) {
      throw new Error(`Failed to create board assignment for judge ${params.judgeId}: ${insertError.message}`);
    }
  }

  return 'created';
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
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const csvText = await downloadSheet(JUDGES_SHEET_URL);
    const rows = parseCsv(csvText);
    const boardSheetUrl = resolveBoardSheetUrl();
    let boardRows: BoardJudgeRow[] = [];

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
      boardRows: number;
      boardProcessed: number;
      boardAssignmentsCreated: number;
      boardSheetUrl: string | null;
      boardEventId: string | null;
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
      boardRows: 0,
      boardProcessed: 0,
      boardAssignmentsCreated: 0,
      boardSheetUrl,
      boardEventId: null,
      generatedPasswords: includeOtps ? [] : undefined,
    };

    if (boardSheetUrl) {
      try {
        const boardCsv = await downloadSheet(boardSheetUrl);
        boardRows = parseBoardCsv(boardCsv);
        summary.boardRows = boardRows.length;
      } catch (error) {
        summary.errors.push(
          `Failed to load board judges sheet: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const stationMap = rows.length > 0 ? await fetchStations(supabase) : new Map<string, StationRecord>();

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
              metadata: { 
                type: 'initial-password-issued',
                email: row.email,
                password: judgeResult.generatedPassword
              },
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

    if (boardRows.length > 0) {
      const boardSetup = await resolveBoardSetup(supabase);
      if (!boardSetup) {
        summary.errors.push(
          'Board judges sheet provided, but no board_event found. Set BOARD_EVENT_ID or BOARD_EVENT_SLUG.',
        );
      } else {
        summary.boardEventId = boardSetup.boardEventId;
        const seenAssignments = new Set<string>();

        for (const row of boardRows) {
          try {
            const judgeResult = await ensureJudge(supabase, row, options);
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

            const gameId = boardSetup.gameIdByKey.get(row.gameNameKey);
            if (!gameId) {
              summary.errors.push(`Unknown board game "${row.gameNameRaw}" for ${row.email}`);
              continue;
            }

            let categoryId: string | null = null;
            if (row.categoryNameRaw) {
              categoryId = boardSetup.categoryIdByKey.get(normalizeLookupKey(row.categoryNameRaw)) ?? null;
              if (!categoryId) {
                summary.errors.push(`Unknown board category "${row.categoryNameRaw}" for ${row.email}`);
                continue;
              }
            }

            const dedupKey = `${judgeResult.id}|${gameId}|${categoryId ?? ''}`;
            if (seenAssignments.has(dedupKey)) {
              summary.skipped.push(`Duplicate board assignment skipped for ${row.email} (${row.gameNameRaw})`);
              continue;
            }
            seenAssignments.add(dedupKey);

            const boardAssignmentResult = await ensureBoardAssignment(
              supabase,
              {
                boardEventId: boardSetup.boardEventId,
                judgeId: judgeResult.id,
                gameId,
                categoryId,
              },
              options,
            );

            summary.boardProcessed += 1;
            if (boardAssignmentResult === 'created') {
              summary.boardAssignmentsCreated += 1;
            }

            if (judgeResult.status === 'created') {
              await recordOnboardingEvent(
                supabase,
                {
                  judgeId: judgeResult.id,
                  stationId: null,
                  metadata: {
                    type: 'initial-password-issued',
                    email: row.email,
                    password: judgeResult.generatedPassword,
                    source: 'deskovky',
                  },
                },
                options,
              );
            }
          } catch (error) {
            summary.errors.push(
              `Failed to sync board judge ${row.email}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
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
