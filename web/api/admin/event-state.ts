import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { getAuthConfig } from '../../api-lib/authTokens.js';
import { generateTemporaryPassword, hashPassword } from '../../api-lib/auth/password-utils.js';

type TokenClaims = {
  sub?: string;
  sessionId?: string;
  event_id?: string;
  eventId?: string;
  station_id?: string;
  stationId?: string;
  type?: string;
};

type StationCategoryKey = 'NH' | 'ND' | 'MH' | 'MD' | 'SH' | 'SD' | 'RH' | 'RD';

const CATEGORY_KEYS = ['N', 'M', 'S', 'R'] as const;
type BaseCategoryKey = (typeof CATEGORY_KEYS)[number];
const STATION_CATEGORY_KEYS: StationCategoryKey[] = ['NH', 'ND', 'MH', 'MD', 'SH', 'SD', 'RH', 'RD'];
const MAX_PATROLS_PER_CATEGORY = 300;
const DEFAULT_ANNOUNCED_PLACES: Record<BaseCategoryKey, number> = {
  N: 5,
  M: 6,
  S: 6,
  R: 3,
};
const DEFAULT_ANNOUNCED_PLACES_BY_STATION_CATEGORY: Record<StationCategoryKey, number> = {
  NH: DEFAULT_ANNOUNCED_PLACES.N,
  ND: DEFAULT_ANNOUNCED_PLACES.N,
  MH: DEFAULT_ANNOUNCED_PLACES.M,
  MD: DEFAULT_ANNOUNCED_PLACES.M,
  SH: DEFAULT_ANNOUNCED_PLACES.S,
  SD: DEFAULT_ANNOUNCED_PLACES.S,
  RH: DEFAULT_ANNOUNCED_PLACES.R,
  RD: DEFAULT_ANNOUNCED_PLACES.R,
};
const DEFAULT_TIME_LIMIT_MINUTES: Record<BaseCategoryKey, number> = {
  N: 110,
  M: 140,
  S: 140,
  R: 140,
};
const DEFAULT_TIME_PENALTY_STEP_MINUTES = 20;
const DEFAULT_TARGET_ANSWER_OPTION_COUNT = 4;
const EVENT_SCORING_SETTINGS_SELECT =
  'announced_places_n,announced_places_m,announced_places_s,announced_places_r,announced_places_nh,announced_places_nd,announced_places_mh,announced_places_md,announced_places_sh,announced_places_sd,announced_places_rh,announced_places_rd,time_limit_n_minutes,time_limit_m_minutes,time_limit_s_minutes,time_limit_r_minutes,time_penalty_step_minutes,target_answer_option_count,participating_troops';

const PRAGUE_TIME_ZONE = 'Europe/Prague';

function getSupabaseAdminConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable.');
  }

  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.');
  }

  return { supabaseUrl, serviceRoleKey };
}

function respond(res: any, status: number, message: string, detail?: string) {
  if (status >= 500) {
    console.error('[api/admin/event-state]', message, detail ? { detail } : {});
  }
  return res.status(status).json(detail ? { error: message, detail } : { error: message });
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeStationCode(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

function normalizePatrolMembers(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(/\r\n?/g, '\n');
  const compact = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return compact.length > 0 ? compact : null;
}

function hasAtLeastOneFullName(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const people = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((line) => line.split(/[;,|]/g))
    .map((item) => item.trim())
    .filter(Boolean);
  return people.some((person) => {
    const words = person.split(/\s+/).filter(Boolean);
    return words.length >= 2 && words[0].length >= 2 && words[1].length >= 2;
  });
}

function toNonNegativeInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return Math.max(0, Math.round(fallback));
}

function toPositiveInt(value: unknown, fallback: number, max = 1_000): number {
  const next = toNonNegativeInt(value, fallback);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, next));
}

type EventScoringSettings = {
  announced_places_n: number;
  announced_places_m: number;
  announced_places_s: number;
  announced_places_r: number;
  announced_places_nh: number;
  announced_places_nd: number;
  announced_places_mh: number;
  announced_places_md: number;
  announced_places_sh: number;
  announced_places_sd: number;
  announced_places_rh: number;
  announced_places_rd: number;
  time_limit_n_minutes: number;
  time_limit_m_minutes: number;
  time_limit_s_minutes: number;
  time_limit_r_minutes: number;
  time_penalty_step_minutes: number;
  target_answer_option_count: 3 | 4;
  participating_troops: string[];
};

function normalizeTargetAnswerOptionCount(value: unknown): 3 | 4 {
  return value === 3 || value === '3' ? 3 : 4;
}

function normalizeTroopList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((entry) => {
    const troopName = normalizeText(entry).replace(/\s+/g, ' ');
    if (!troopName) {
      return;
    }
    const key = troopName.toLocaleLowerCase('cs');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(troopName.slice(0, 120));
  });
  return result.sort((a, b) => a.localeCompare(b, 'cs', { sensitivity: 'base' }));
}

function normalizeEventScoringSettings(source: Record<string, unknown> | null | undefined): EventScoringSettings {
  const values = source ?? {};
  const announcedPlacesNH = toPositiveInt(
    values.announced_places_nh ?? values.announced_places_n,
    DEFAULT_ANNOUNCED_PLACES_BY_STATION_CATEGORY.NH,
    100,
  );
  const announcedPlacesND = toPositiveInt(
    values.announced_places_nd ?? values.announced_places_n,
    DEFAULT_ANNOUNCED_PLACES_BY_STATION_CATEGORY.ND,
    100,
  );
  const announcedPlacesMH = toPositiveInt(
    values.announced_places_mh ?? values.announced_places_m,
    DEFAULT_ANNOUNCED_PLACES_BY_STATION_CATEGORY.MH,
    100,
  );
  const announcedPlacesMD = toPositiveInt(
    values.announced_places_md ?? values.announced_places_m,
    DEFAULT_ANNOUNCED_PLACES_BY_STATION_CATEGORY.MD,
    100,
  );
  const announcedPlacesSH = toPositiveInt(
    values.announced_places_sh ?? values.announced_places_s,
    DEFAULT_ANNOUNCED_PLACES_BY_STATION_CATEGORY.SH,
    100,
  );
  const announcedPlacesSD = toPositiveInt(
    values.announced_places_sd ?? values.announced_places_s,
    DEFAULT_ANNOUNCED_PLACES_BY_STATION_CATEGORY.SD,
    100,
  );
  const announcedPlacesRH = toPositiveInt(
    values.announced_places_rh ?? values.announced_places_r,
    DEFAULT_ANNOUNCED_PLACES_BY_STATION_CATEGORY.RH,
    100,
  );
  const announcedPlacesRD = toPositiveInt(
    values.announced_places_rd ?? values.announced_places_r,
    DEFAULT_ANNOUNCED_PLACES_BY_STATION_CATEGORY.RD,
    100,
  );
  return {
    announced_places_n: toPositiveInt(
      values.announced_places_n ?? Math.max(announcedPlacesNH, announcedPlacesND),
      DEFAULT_ANNOUNCED_PLACES.N,
      100,
    ),
    announced_places_m: toPositiveInt(
      values.announced_places_m ?? Math.max(announcedPlacesMH, announcedPlacesMD),
      DEFAULT_ANNOUNCED_PLACES.M,
      100,
    ),
    announced_places_s: toPositiveInt(
      values.announced_places_s ?? Math.max(announcedPlacesSH, announcedPlacesSD),
      DEFAULT_ANNOUNCED_PLACES.S,
      100,
    ),
    announced_places_r: toPositiveInt(
      values.announced_places_r ?? Math.max(announcedPlacesRH, announcedPlacesRD),
      DEFAULT_ANNOUNCED_PLACES.R,
      100,
    ),
    announced_places_nh: announcedPlacesNH,
    announced_places_nd: announcedPlacesND,
    announced_places_mh: announcedPlacesMH,
    announced_places_md: announcedPlacesMD,
    announced_places_sh: announcedPlacesSH,
    announced_places_sd: announcedPlacesSD,
    announced_places_rh: announcedPlacesRH,
    announced_places_rd: announcedPlacesRD,
    time_limit_n_minutes: toPositiveInt(values.time_limit_n_minutes, DEFAULT_TIME_LIMIT_MINUTES.N, 24 * 60),
    time_limit_m_minutes: toPositiveInt(values.time_limit_m_minutes, DEFAULT_TIME_LIMIT_MINUTES.M, 24 * 60),
    time_limit_s_minutes: toPositiveInt(values.time_limit_s_minutes, DEFAULT_TIME_LIMIT_MINUTES.S, 24 * 60),
    time_limit_r_minutes: toPositiveInt(values.time_limit_r_minutes, DEFAULT_TIME_LIMIT_MINUTES.R, 24 * 60),
    time_penalty_step_minutes: toPositiveInt(values.time_penalty_step_minutes, DEFAULT_TIME_PENALTY_STEP_MINUTES, 24 * 60),
    target_answer_option_count: normalizeTargetAnswerOptionCount(
      values.target_answer_option_count ?? DEFAULT_TARGET_ANSWER_OPTION_COUNT,
    ),
    participating_troops: normalizeTroopList(values.participating_troops),
  };
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function normalizeAllowedCategories(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  const normalized = values
    .map((entry) => normalizeText(entry).toUpperCase())
    .filter((entry) => CATEGORY_KEYS.includes(entry as (typeof CATEGORY_KEYS)[number]));
  const unique = Array.from(new Set(normalized));
  unique.sort();
  return unique;
}

function normalizeStationSplitCategories(value: unknown): BaseCategoryKey[] {
  const normalized = normalizeAllowedCategories(value);
  return CATEGORY_KEYS.filter((category) => normalized.includes(category));
}

function normalizeAllowedTasks(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  const normalized = values.map((entry) => normalizeText(entry)).filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeStationCodeList(value: unknown): string[] {
  const asArray =
    Array.isArray(value) && value.length > 0
      ? value
      : typeof value === 'string'
        ? value
            .split(/[^A-Za-z0-9]+/)
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of asArray) {
    const code = normalizeStationCode(raw);
    if (!code || seen.has(code)) {
      continue;
    }
    seen.add(code);
    list.push(code);
  }
  return list;
}

function normalizeStationOrderPayload(payload: Record<string, unknown>) {
  const rawOrders =
    payload.category_orders && typeof payload.category_orders === 'object'
      ? (payload.category_orders as Record<string, unknown>)
      : {};
  const rawSeparators =
    payload.separator_before_by_category && typeof payload.separator_before_by_category === 'object'
      ? (payload.separator_before_by_category as Record<string, unknown>)
      : {};

  const categoryOrders: Record<StationCategoryKey, string[]> = {
    NH: [],
    ND: [],
    MH: [],
    MD: [],
    SH: [],
    SD: [],
    RH: [],
    RD: [],
  };
  const separatorBeforeByCategory: Partial<Record<StationCategoryKey, string>> = {};

  STATION_CATEGORY_KEYS.forEach((category) => {
    categoryOrders[category] = normalizeStationCodeList(rawOrders[category]);
    const separator = normalizeStationCode(rawSeparators[category]);
    if (separator) {
      separatorBeforeByCategory[category] = separator;
    }
  });

  return {
    categoryOrders,
    separatorBeforeByCategory,
  };
}

function parseIsoOrNull(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function mapPatrolCategoryKey(key: StationCategoryKey): { category: string; sex: string } {
  return {
    category: key.slice(0, 1),
    sex: key.slice(1, 2),
  };
}

function parsePatrolCategoryNumber(rawCode: unknown, fallbackCategory?: unknown): { category: string; number: number } | null {
  const code = normalizeStationCode(rawCode);
  const match = code.match(/^([NMSR])(?:[HD])?[- ]?(\d{1,3})$/);
  if (match) {
    const number = Number.parseInt(match[2], 10);
    if (Number.isFinite(number) && number > 0) {
      return { category: match[1], number };
    }
  }
  const fallback = normalizeStationCode(fallbackCategory);
  const fallbackMatch = code.match(/^([NMSR])([HD])[- ]?(\d{1,3})$/);
  if (fallback && CATEGORY_KEYS.includes(fallback as (typeof CATEGORY_KEYS)[number]) && fallbackMatch) {
    const number = Number.parseInt(fallbackMatch[3], 10);
    if (Number.isFinite(number) && number > 0) {
      return { category: fallback, number };
    }
  }
  return null;
}

function buildPatrolCodeLookupVariants(rawCode: unknown): string[] {
  const code = normalizeStationCode(rawCode);
  if (!code) {
    return [];
  }
  const match = code.match(/^([NMSR])([HD])?[- ]?(\d{1,3})$/);
  if (!match) {
    return [code];
  }

  const category = match[1];
  const sex = match[2] ? match[2] : '';
  const number = Number.parseInt(match[3], 10);
  if (!Number.isFinite(number) || number <= 0) {
    return [code];
  }

  const noPad = String(number);
  const pad2 = noPad.padStart(2, '0');
  const seen = new Set<string>();
  const variants: string[] = [];
  const push = (value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    variants.push(normalized);
  };

  if (sex) {
    push(`${category}${sex}-${noPad}`);
    push(`${category}${sex}-${pad2}`);
    push(`${category}-${noPad}`);
    push(`${category}-${pad2}`);
    return variants;
  }

  push(`${category}-${noPad}`);
  push(`${category}-${pad2}`);
  push(`${category}H-${noPad}`);
  push(`${category}H-${pad2}`);
  push(`${category}D-${noPad}`);
  push(`${category}D-${pad2}`);
  return variants;
}

function parseSexedPatrolCode(rawCode: unknown): { category: string; sex: string; number: number } | null {
  const code = normalizeStationCode(rawCode);
  const match = code.match(/^([NMSR])([HD])[- ]?(\d{1,3})$/);
  if (!match) {
    return null;
  }
  const number = Number.parseInt(match[3], 10);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return {
    category: match[1],
    sex: match[2],
    number,
  };
}

function buildCounterpartPatrolCode(rawCode: unknown): string | null {
  const parsed = parseSexedPatrolCode(rawCode);
  if (!parsed) {
    return null;
  }
  const oppositeSex = parsed.sex === 'H' ? 'D' : 'H';
  return `${parsed.category}${oppositeSex}-${parsed.number}`;
}

async function resolvePatrolByCode(
  supabaseAdmin: any,
  eventId: string,
  rawCode: unknown,
): Promise<
  | {
      row: {
        id: string;
        patrol_code: string | null;
        category: string | null;
        sex: string | null;
        team_name: string | null;
        patrol_members?: string | null;
        note?: string | null;
      };
      ambiguous: false;
    }
  | {
      ambiguous: true;
      options: string[];
    }
  | null
> {
  const variants = buildPatrolCodeLookupVariants(rawCode);
  if (!variants.length) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from('patrols')
    .select('id, patrol_code, category, sex, team_name, patrol_members, note, active')
    .eq('event_id', eventId)
    .in('patrol_code', variants);

  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as Array<{
    id: string;
    patrol_code: string | null;
    category: string | null;
    sex: string | null;
    team_name: string | null;
    patrol_members?: string | null;
    note?: string | null;
    active?: boolean | null;
  }>).filter((row) => row.active !== false);

  if (rows.length === 0) {
    return null;
  }

  const exactNormalized = normalizeStationCode(rawCode);
  const exact = rows.filter((row) => normalizeStationCode(row.patrol_code) === exactNormalized);
  if (exact.length === 1) {
    return { ambiguous: false, row: exact[0] };
  }
  if (rows.length === 1) {
    return { ambiguous: false, row: rows[0] };
  }

  const withProfile = rows.filter((row) => {
    const members = normalizePatrolMembers(row.patrol_members ?? row.note ?? null);
    return hasAtLeastOneFullName(members ?? '');
  });
  if (withProfile.length === 1) {
    return { ambiguous: false, row: withProfile[0] };
  }

  return {
    ambiguous: true,
    options: rows
      .map((row) => normalizeStationCode(row.patrol_code))
      .filter(Boolean)
      .slice(0, 8),
  };
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
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? '0');
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

function buildDefaultLockAtIso(now = new Date()) {
  const dayParts = getDatePartsInTimeZone(now, PRAGUE_TIME_ZONE);
  const closingAtIso = zonedTimeToUtcIso(PRAGUE_TIME_ZONE, {
    year: dayParts.year,
    month: dayParts.month,
    day: dayParts.day,
    hour: 16,
    minute: 0,
    second: 0,
  });
  const closingAtMs = Date.parse(closingAtIso);
  const lockAtMs = Number.isFinite(closingAtMs) ? Math.min(now.getTime(), closingAtMs) : now.getTime();
  return new Date(lockAtMs).toISOString();
}

async function requireCalcSession(req: any, res: any) {
  const authHeader = req.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing session' });
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();

  let authConfig;
  try {
    authConfig = getAuthConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing auth configuration.';
    respond(res, 500, message, 'auth-config');
    return null;
  }

  let claims: TokenClaims;
  try {
    claims = jwt.verify(token, authConfig.jwtSecret) as TokenClaims;
  } catch {
    res.status(401).json({ error: 'Invalid JWT' });
    return null;
  }

  if (claims.type !== 'access') {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }

  const resolveClaimString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : '');
  const sessionId = resolveClaimString(claims.sessionId);
  const judgeId = resolveClaimString(claims.sub);
  const tokenEventId = resolveClaimString(claims.event_id) || resolveClaimString(claims.eventId);
  const tokenStationId = resolveClaimString(claims.station_id) || resolveClaimString(claims.stationId);

  if (!sessionId || !judgeId || !tokenEventId || !tokenStationId) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }

  let supabaseConfig;
  try {
    supabaseConfig = getSupabaseAdminConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing Supabase configuration.';
    respond(res, 500, message, 'supabase-config');
    return null;
  }

  const supabaseAdmin = createClient(supabaseConfig.supabaseUrl, supabaseConfig.serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('judge_sessions')
    .select('id, judge_id, revoked_at')
    .eq('id', sessionId)
    .eq('judge_id', judgeId)
    .maybeSingle();

  if (sessionError) {
    respond(res, 500, 'Session lookup failed', sessionError.message);
    return null;
  }

  if (!session || session.revoked_at) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from('judge_assignments')
    .select('id')
    .eq('judge_id', judgeId)
    .eq('station_id', tokenStationId)
    .eq('event_id', tokenEventId)
    .maybeSingle();

  if (assignmentError) {
    respond(res, 500, 'Assignment lookup failed', assignmentError.message);
    return null;
  }

  if (!assignment) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  const { data: station, error: stationError } = await supabaseAdmin
    .from('stations')
    .select('code')
    .eq('id', tokenStationId)
    .eq('event_id', tokenEventId)
    .maybeSingle();

  if (stationError) {
    respond(res, 500, 'Station lookup failed', stationError.message);
    return null;
  }

  const stationCode = (station?.code ?? '').trim().toUpperCase();
  if (stationCode !== 'T') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return {
    supabaseAdmin,
    eventId: tokenEventId,
  };
}

async function loadSetupData(supabaseAdmin: any, currentEventId: string, res: any) {
  const [eventsRes, stationsRes, judgesRes, assignmentsRes, orderRes] = await Promise.all([
    supabaseAdmin
      .from('events')
      .select(`id,name,starts_at,ends_at,scoring_locked,${EVENT_SCORING_SETTINGS_SELECT}`)
      .order('starts_at', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('stations')
      .select('id,event_id,code,name,is_split,split_categories,is_closed')
      .order('event_id', { ascending: true })
      .order('code', { ascending: true }),
    supabaseAdmin.from('judges').select('id,email,display_name,created_at').order('display_name', { ascending: true }),
    supabaseAdmin
      .from('judge_assignments')
      .select('id,judge_id,station_id,event_id,allowed_categories,allowed_tasks,judge_display_name,created_at')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('event_station_orders')
      .select('event_id,category_orders,separator_before_by_category,updated_at')
      .order('updated_at', { ascending: false }),
  ]);

  if (eventsRes.error || stationsRes.error || judgesRes.error || assignmentsRes.error || orderRes.error) {
    return respond(res, 500, 'Failed to load setup data', [
      eventsRes.error?.message,
      stationsRes.error?.message,
      judgesRes.error?.message,
      assignmentsRes.error?.message,
      orderRes.error?.message,
    ]
      .filter(Boolean)
      .join(' | '));
  }

  return res.status(200).json({
    current_event_id: currentEventId,
    events: eventsRes.data ?? [],
    stations: stationsRes.data ?? [],
    judges: judgesRes.data ?? [],
    assignments: assignmentsRes.data ?? [],
    station_orders: orderRes.data ?? [],
  });
}

async function handleSetupAction(
  supabaseAdmin: any,
  currentEventId: string,
  payload: Record<string, unknown>,
  res: any,
) {
  const action = normalizeText(payload.action);
  if (!action) {
    return res.status(400).json({ error: 'Missing action.' });
  }

  if (action === 'create_event') {
    const eventName = normalizeText(payload.name);
    if (!eventName) {
      return res.status(400).json({ error: 'Event name is required.' });
    }

    const startsAt = parseIsoOrNull(payload.starts_at);
    const endsAt = parseIsoOrNull(payload.ends_at);
    const hasSourceEventId = Object.prototype.hasOwnProperty.call(payload, 'copy_stations_from_event_id');
    const sourceEventId = hasSourceEventId
      ? normalizeText(payload.copy_stations_from_event_id)
      : currentEventId;
    let nextEventSettings = normalizeEventScoringSettings(null);

    if (sourceEventId) {
      const { data: sourceEventSettings, error: sourceEventSettingsError } = await supabaseAdmin
        .from('events')
        .select(EVENT_SCORING_SETTINGS_SELECT)
        .eq('id', sourceEventId)
        .maybeSingle();

      if (sourceEventSettingsError) {
        return respond(
          res,
          500,
          'Failed to load source event scoring settings',
          sourceEventSettingsError.message,
        );
      }

      if (sourceEventSettings) {
        nextEventSettings = normalizeEventScoringSettings(sourceEventSettings as Record<string, unknown>);
      }
    }

    const { data: insertedEvent, error: insertEventError } = await supabaseAdmin
      .from('events')
      .insert({
        name: eventName,
        starts_at: startsAt,
        ends_at: endsAt,
        scoring_locked: false,
        scoring_locked_at: null,
        ...nextEventSettings,
      })
      .select(`id,name,starts_at,ends_at,scoring_locked,${EVENT_SCORING_SETTINGS_SELECT}`)
      .single();

    if (insertEventError || !insertedEvent) {
      return respond(res, 500, 'Failed to create event', insertEventError?.message);
    }

    if (sourceEventId) {
      const { data: sourceStations, error: sourceStationsError } = await supabaseAdmin
        .from('stations')
        .select('code,name,is_split,split_categories,is_closed')
        .eq('event_id', sourceEventId)
        .order('code', { ascending: true });

      if (sourceStationsError) {
        return respond(res, 500, 'Event created, but failed to load source stations', sourceStationsError.message);
      }

      const stationRows = (sourceStations ?? [])
        .map((row: {
          code?: string | null;
          name?: string | null;
          is_split?: boolean | null;
          split_categories?: unknown;
          is_closed?: boolean | null;
        }) => ({
          event_id: insertedEvent.id,
          code: normalizeStationCode(row.code),
          name: normalizeText(row.name),
          is_split: row.is_split === true,
          split_categories: row.is_split === true ? normalizeStationSplitCategories(row.split_categories) : [],
          is_closed: row.is_closed === true,
        }))
        .filter((row: { code: string; name: string }) => row.code && row.name);

      if (stationRows.length > 0) {
        const { error: stationInsertError } = await supabaseAdmin
          .from('stations')
          .insert(stationRows);
        if (stationInsertError) {
          return respond(res, 500, 'Event created, but failed to copy stations', stationInsertError.message);
        }
      }

      const { data: sourceOrder, error: sourceOrderError } = await supabaseAdmin
        .from('event_station_orders')
        .select('category_orders,separator_before_by_category')
        .eq('event_id', sourceEventId)
        .maybeSingle();

      if (!sourceOrderError && sourceOrder) {
        const { error: copyOrderError } = await supabaseAdmin.from('event_station_orders').upsert(
          {
            event_id: insertedEvent.id,
            category_orders: sourceOrder.category_orders ?? {},
            separator_before_by_category: sourceOrder.separator_before_by_category ?? {},
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'event_id' },
        );
        if (copyOrderError) {
          return respond(res, 500, 'Event created, but failed to copy station order', copyOrderError.message);
        }
      }
    }

    return res.status(200).json({ ok: true, event: insertedEvent });
  }

  if (action === 'save_station_order') {
    const targetEventId = normalizeText(payload.event_id);
    if (!targetEventId) {
      return res.status(400).json({ error: 'Missing event_id.' });
    }

    const normalized = normalizeStationOrderPayload(payload);
    const { error } = await supabaseAdmin.from('event_station_orders').upsert(
      {
        event_id: targetEventId,
        category_orders: normalized.categoryOrders,
        separator_before_by_category: normalized.separatorBeforeByCategory,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'event_id' },
    );

    if (error) {
      return respond(res, 500, 'Failed to save station order', error.message);
    }

    return res.status(200).json({
      ok: true,
      event_id: targetEventId,
      category_orders: normalized.categoryOrders,
      separator_before_by_category: normalized.separatorBeforeByCategory,
    });
  }

  if (action === 'save_event_scoring_config') {
    const targetEventId = normalizeText(payload.event_id);
    if (!targetEventId) {
      return res.status(400).json({ error: 'Missing event_id.' });
    }

    const { data: existingSettings, error: existingSettingsError } = await supabaseAdmin
      .from('events')
      .select(EVENT_SCORING_SETTINGS_SELECT)
      .eq('id', targetEventId)
      .maybeSingle();

    if (existingSettingsError) {
      return respond(res, 500, 'Failed to load current event scoring settings', existingSettingsError.message);
    }
    if (!existingSettings) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const normalizedSettings = normalizeEventScoringSettings({
      ...(existingSettings as Record<string, unknown>),
      ...payload,
    });

    const { error: updateSettingsError } = await supabaseAdmin
      .from('events')
      .update(normalizedSettings)
      .eq('id', targetEventId);

    if (updateSettingsError) {
      return respond(res, 500, 'Failed to save event scoring settings', updateSettingsError.message);
    }

    return res.status(200).json({
      ok: true,
      event_id: targetEventId,
      ...normalizedSettings,
    });
  }

  if (action === 'save_station_split_config') {
    const targetEventId = normalizeText(payload.event_id);
    if (!targetEventId) {
      return res.status(400).json({ error: 'Missing event_id.' });
    }

    const rawUpdates = Array.isArray(payload.updates) ? payload.updates : [];
    if (rawUpdates.length === 0) {
      return res.status(400).json({ error: 'Missing station updates.' });
    }

    const updates: Array<{
      station_id: string;
      is_split: boolean;
      split_categories: BaseCategoryKey[];
    }> = [];
    const stationIds: string[] = [];
    let hasInvalidSplitCategories = false;

    rawUpdates.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const row = entry as Record<string, unknown>;
      const stationId = normalizeText(row.station_id);
      if (!stationId) {
        return;
      }
      const isSplit = row.is_split === true;
      const splitCategories = normalizeStationSplitCategories(row.split_categories);
      if (isSplit && splitCategories.length === 0) {
        hasInvalidSplitCategories = true;
        return;
      }
      updates.push({
        station_id: stationId,
        is_split: isSplit,
        split_categories: isSplit ? splitCategories : [],
      });
      stationIds.push(stationId);
    });

    if (hasInvalidSplitCategories) {
      return res.status(400).json({ error: 'Split station must have at least one category.' });
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Invalid station split configuration.' });
    }

    const uniqueStationIds = Array.from(new Set(stationIds));
    const { data: existingStations, error: existingStationsError } = await supabaseAdmin
      .from('stations')
      .select('id')
      .eq('event_id', targetEventId)
      .in('id', uniqueStationIds);

    if (existingStationsError) {
      return respond(res, 500, 'Failed to validate station split configuration', existingStationsError.message);
    }

    const existingStationIdSet = new Set(
      ((existingStations ?? []) as Array<{ id?: string | null }>)
        .map((row) => normalizeText(row.id))
        .filter(Boolean),
    );
    const invalidStationId = uniqueStationIds.find((stationId) => !existingStationIdSet.has(stationId));
    if (invalidStationId) {
      return res.status(400).json({ error: 'Invalid station for selected event.' });
    }

    for (const update of updates) {
      const { error: updateError } = await supabaseAdmin
        .from('stations')
        .update({
          is_split: update.is_split,
          split_categories: update.split_categories,
        })
        .eq('event_id', targetEventId)
        .eq('id', update.station_id);

      if (updateError) {
        return respond(res, 500, 'Failed to save station split configuration', updateError.message);
      }
    }

    return res.status(200).json({
      ok: true,
      event_id: targetEventId,
      updated: updates.length,
    });
  }

  if (action === 'set_station_closed') {
    const targetEventId = normalizeText(payload.event_id);
    const stationId = normalizeText(payload.station_id);
    const isClosed = payload.closed === true;

    if (!targetEventId || !stationId) {
      return res.status(400).json({ error: 'Missing event_id or station_id.' });
    }

    const { data: station, error: stationLookupError } = await supabaseAdmin
      .from('stations')
      .select('id')
      .eq('event_id', targetEventId)
      .eq('id', stationId)
      .maybeSingle();

    if (stationLookupError) {
      return respond(res, 500, 'Failed to validate station', stationLookupError.message);
    }
    if (!station) {
      return res.status(400).json({ error: 'Invalid station for selected event.' });
    }

    const { error: updateError } = await supabaseAdmin
      .from('stations')
      .update({ is_closed: isClosed })
      .eq('event_id', targetEventId)
      .eq('id', stationId);

    if (updateError) {
      return respond(res, 500, 'Failed to update station closed state', updateError.message);
    }

    return res.status(200).json({
      ok: true,
      event_id: targetEventId,
      station_id: stationId,
      closed: isClosed,
    });
  }

  if (action === 'assign_judge') {
    const targetEventId = normalizeText(payload.event_id);
    const email = normalizeEmail(payload.email);
    const displayNameInput = normalizeText(payload.display_name);
    const stationCode = normalizeStationCode(payload.station_code);
    const allowedCategories = normalizeAllowedCategories(payload.allowed_categories);
    const allowedTasks = normalizeAllowedTasks(payload.allowed_tasks);

    if (!targetEventId || !email || !stationCode) {
      return res.status(400).json({ error: 'Missing required fields (event, email, station).' });
    }

    const { data: station, error: stationError } = await supabaseAdmin
      .from('stations')
      .select('id,code,name')
      .eq('event_id', targetEventId)
      .eq('code', stationCode)
      .maybeSingle();

    if (stationError) {
      return respond(res, 500, 'Failed to load station', stationError.message);
    }
    if (!station) {
      return res.status(400).json({ error: `Station ${stationCode} does not exist in selected event.` });
    }

    const { data: existingJudge, error: judgeLookupError } = await supabaseAdmin
      .from('judges')
      .select('id,email,display_name')
      .ilike('email', email)
      .limit(1)
      .maybeSingle();

    if (judgeLookupError) {
      return respond(res, 500, 'Failed to lookup judge account', judgeLookupError.message);
    }

    const nowIso = new Date().toISOString();
    let judgeId = '';
    let judgeDisplayName = displayNameInput || email;
    let createdJudge = false;
    let temporaryPassword: string | null = null;

    if (!existingJudge) {
      temporaryPassword = generateTemporaryPassword(12);
      const passwordHash = await hashPassword(temporaryPassword);
      const { data: insertedJudge, error: insertJudgeError } = await supabaseAdmin
        .from('judges')
        .insert({
          email,
          display_name: judgeDisplayName,
          password_hash: passwordHash,
          must_change_password: true,
          password_rotated_at: nowIso,
          updated_at: nowIso,
        })
        .select('id,display_name')
        .single();
      if (insertJudgeError || !insertedJudge) {
        return respond(res, 500, 'Failed to create judge account', insertJudgeError?.message);
      }
      judgeId = insertedJudge.id;
      judgeDisplayName = normalizeText(insertedJudge.display_name) || judgeDisplayName;
      createdJudge = true;
    } else {
      judgeId = existingJudge.id;
      const nextDisplayName = displayNameInput || normalizeText(existingJudge.display_name) || email;
      if (nextDisplayName !== normalizeText(existingJudge.display_name)) {
        const { error: updateJudgeError } = await supabaseAdmin
          .from('judges')
          .update({
            display_name: nextDisplayName,
            updated_at: nowIso,
          })
          .eq('id', judgeId);
        if (updateJudgeError) {
          return respond(res, 500, 'Failed to update judge profile', updateJudgeError.message);
        }
      }
      judgeDisplayName = nextDisplayName;
    }

    const { error: upsertAssignmentError } = await supabaseAdmin.from('judge_assignments').upsert(
      {
        judge_id: judgeId,
        station_id: station.id,
        event_id: targetEventId,
        role: 'judge',
        judge_display_name: judgeDisplayName,
        allowed_categories: allowedCategories,
        allowed_tasks: allowedTasks,
      },
      { onConflict: 'judge_id,station_id,event_id' },
    );

    if (upsertAssignmentError) {
      return respond(res, 500, 'Failed to save judge assignment', upsertAssignmentError.message);
    }

    return res.status(200).json({
      ok: true,
      created_judge: createdJudge,
      temporary_password: temporaryPassword,
      assignment: {
        judge_id: judgeId,
        event_id: targetEventId,
        station_id: station.id,
        station_code: station.code,
        allowed_categories: allowedCategories,
        allowed_tasks: allowedTasks,
        judge_display_name: judgeDisplayName,
        email,
      },
    });
  }

  if (action === 'upsert_patrol_profile') {
    const targetEventId = normalizeText(payload.event_id);
    const patrolId = normalizeText(payload.patrol_id);
    const patrolCode = normalizeText(payload.patrol_code);
    const patrolCodeInput = normalizeText(payload.patrol_code_input);
    const cleanupSharedNumber = payload.cleanup_shared_number === true;
    const teamName = normalizeText(payload.team_name);
    const patrolMembers = normalizePatrolMembers(payload.patrol_members);

    if (!targetEventId) {
      return res.status(400).json({ error: 'Missing event_id.' });
    }
    if (!patrolId && !patrolCode) {
      return res.status(400).json({ error: 'Missing patrol reference (patrol_id or patrol_code).' });
    }
    if (!teamName) {
      return res.status(400).json({ error: 'Team name is required.' });
    }

    let resolvedPatrolId = patrolId;
    if (!resolvedPatrolId) {
      let resolved;
      try {
        resolved = await resolvePatrolByCode(supabaseAdmin, targetEventId, patrolCode);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return respond(res, 500, 'Failed to resolve patrol code', detail);
      }
      if (!resolved) {
        return res.status(404).json({ error: 'Patrol not found for this event.' });
      }
      if (resolved.ambiguous) {
        return res.status(409).json({
          error: `Ambiguous patrol code. Matches: ${resolved.options.join(', ')}`,
          options: resolved.options,
        });
      }
      resolvedPatrolId = resolved.row.id;
    }

    const { data: updatedPatrol, error: updateError } = await supabaseAdmin
      .from('patrols')
      .update({
        team_name: teamName,
        patrol_members: patrolMembers,
      })
      .eq('event_id', targetEventId)
      .eq('id', resolvedPatrolId)
      .select('id, patrol_code, team_name, patrol_members, category, sex')
      .maybeSingle();

    if (updateError) {
      return respond(res, 500, 'Failed to update patrol profile', updateError.message);
    }
    if (!updatedPatrol) {
      return res.status(404).json({ error: 'Patrol not found for this event.' });
    }

    let removedSharedPatrolId: string | null = null;
    if (cleanupSharedNumber) {
      const cleanupReferenceCode = patrolCodeInput || updatedPatrol.patrol_code || patrolCode;
      const counterpartCode = buildCounterpartPatrolCode(cleanupReferenceCode);
      if (counterpartCode) {
        const counterpartVariants = buildPatrolCodeLookupVariants(counterpartCode);
        if (counterpartVariants.length > 0) {
          const expectedCounterpart = parseSexedPatrolCode(counterpartCode);
          const { data: counterpartRows, error: counterpartLookupError } = await supabaseAdmin
            .from('patrols')
            .select('id, patrol_code, active')
            .eq('event_id', targetEventId)
            .in('patrol_code', counterpartVariants)
            .neq('id', resolvedPatrolId);

          if (counterpartLookupError) {
            return respond(res, 500, 'Failed to find counterpart patrol', counterpartLookupError.message);
          }

          const exactCounterpart = ((counterpartRows ?? []) as Array<{
            id: string;
            patrol_code?: string | null;
            active?: boolean | null;
          }>)
            .filter((row) => row.active !== false)
            .find((row) => {
              const parsed = parseSexedPatrolCode(row.patrol_code);
              return Boolean(
                parsed
                && expectedCounterpart
                && parsed.category === expectedCounterpart.category
                && parsed.sex === expectedCounterpart.sex
                && parsed.number === expectedCounterpart.number,
              );
            });

          if (exactCounterpart?.id) {
            const { error: deleteCounterpartError } = await supabaseAdmin
              .from('patrols')
              .delete()
              .eq('event_id', targetEventId)
              .eq('id', exactCounterpart.id);

            if (deleteCounterpartError) {
              return respond(res, 500, 'Failed to remove counterpart patrol', deleteCounterpartError.message);
            }
            removedSharedPatrolId = exactCounterpart.id;
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      patrol: updatedPatrol,
      removed_shared_patrol_id: removedSharedPatrolId,
    });
  }

  if (action === 'cleanup_incomplete_patrols') {
    const targetEventId = normalizeText(payload.event_id);
    if (!targetEventId) {
      return res.status(400).json({ error: 'Missing event_id.' });
    }

    const { data: patrols, error: patrolsError } = await supabaseAdmin
      .from('patrols')
      .select('id, patrol_code, team_name, patrol_members, note')
      .eq('event_id', targetEventId)
      .eq('active', true);

    if (patrolsError) {
      return respond(res, 500, 'Failed to load patrols', patrolsError.message);
    }

    const candidates = ((patrols ?? []) as Array<{
      id: string;
      patrol_code?: string | null;
      team_name?: string | null;
      patrol_members?: string | null;
      note?: string | null;
    }>).filter((row) => {
      const members = normalizePatrolMembers(row.patrol_members ?? row.note ?? null);
      return !hasAtLeastOneFullName(members ?? '');
    });

    if (candidates.length === 0) {
      return res.status(200).json({ ok: true, deleted: 0, skipped: 0 });
    }

    const candidateIds = candidates.map((row) => row.id);
    const [scoresRes, passagesRes, timingsRes] = await Promise.all([
      supabaseAdmin
        .from('station_scores')
        .select('patrol_id')
        .eq('event_id', targetEventId)
        .in('patrol_id', candidateIds),
      supabaseAdmin
        .from('station_passages')
        .select('patrol_id')
        .eq('event_id', targetEventId)
        .in('patrol_id', candidateIds),
      supabaseAdmin
        .from('timings')
        .select('patrol_id')
        .eq('event_id', targetEventId)
        .in('patrol_id', candidateIds),
    ]);

    if (scoresRes.error || passagesRes.error || timingsRes.error) {
      return respond(res, 500, 'Failed to verify patrol usage before cleanup', [
        scoresRes.error?.message,
        passagesRes.error?.message,
        timingsRes.error?.message,
      ]
        .filter(Boolean)
        .join(' | '));
    }

    const lockedIds = new Set<string>();
    ((scoresRes.data ?? []) as Array<{ patrol_id?: string | null }>).forEach((row) => {
      const id = normalizeText(row.patrol_id);
      if (id) {
        lockedIds.add(id);
      }
    });
    ((passagesRes.data ?? []) as Array<{ patrol_id?: string | null }>).forEach((row) => {
      const id = normalizeText(row.patrol_id);
      if (id) {
        lockedIds.add(id);
      }
    });
    ((timingsRes.data ?? []) as Array<{ patrol_id?: string | null }>).forEach((row) => {
      const id = normalizeText(row.patrol_id);
      if (id) {
        lockedIds.add(id);
      }
    });

    const deletableIds = candidateIds.filter((id) => !lockedIds.has(id));
    if (deletableIds.length === 0) {
      return res.status(200).json({
        ok: true,
        deleted: 0,
        skipped: candidateIds.length,
      });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('patrols')
      .delete()
      .eq('event_id', targetEventId)
      .in('id', deletableIds);

    if (deleteError) {
      return respond(res, 500, 'Failed to delete incomplete patrols', deleteError.message);
    }

    return res.status(200).json({
      ok: true,
      deleted: deletableIds.length,
      skipped: candidateIds.length - deletableIds.length,
    });
  }

  if (action === 'create_patrols') {
    const targetEventId = normalizeText(payload.event_id);
    if (!targetEventId) {
      return res.status(400).json({ error: 'Missing event_id.' });
    }

    const rawCounts =
      payload.counts && typeof payload.counts === 'object' ? (payload.counts as Record<string, unknown>) : {};
    const rawStarts =
      payload.start_numbers && typeof payload.start_numbers === 'object'
        ? (payload.start_numbers as Record<string, unknown>)
        : {};

    const rows: Array<{
      event_id: string;
      team_name: string;
      category: string;
      sex: string;
      patrol_code: string;
      note: string | null;
      active: boolean;
      disqualified: boolean;
    }> = [];

    for (const bracketKey of STATION_CATEGORY_KEYS) {
      const count = Math.min(toNonNegativeInt(rawCounts[bracketKey], 0), MAX_PATROLS_PER_CATEGORY);
      const start = Math.max(1, toNonNegativeInt(rawStarts[bracketKey], 1));
      const { category, sex } = mapPatrolCategoryKey(bracketKey);
      for (let i = 0; i < count; i += 1) {
        const number = start + i;
        const code = `${bracketKey}-${number}`;
        rows.push({
          event_id: targetEventId,
          team_name: `Hlídka ${code}`,
          category,
          sex,
          patrol_code: code,
          note: null,
          active: true,
          disqualified: false,
        });
      }
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No patrols requested.' });
    }

    const requestedCategoryNumbers = new Set<string>();
    const duplicateCategoryNumbers: string[] = [];
    rows.forEach((row) => {
      const parsed = parsePatrolCategoryNumber(row.patrol_code, row.category);
      if (!parsed) {
        return;
      }
      const key = `${parsed.category}-${parsed.number}`;
      if (requestedCategoryNumbers.has(key)) {
        duplicateCategoryNumbers.push(key);
        return;
      }
      requestedCategoryNumbers.add(key);
    });

    if (duplicateCategoryNumbers.length > 0) {
      const sample = Array.from(new Set(duplicateCategoryNumbers)).slice(0, 12);
      return res.status(409).json({
        error: `Duplicate patrol numbers across H/D in same category are not allowed (e.g. ${sample.join(', ')}).`,
      });
    }

    if (requestedCategoryNumbers.size > 0) {
      const { data: existingPatrols, error: existingPatrolsError } = await supabaseAdmin
        .from('patrols')
        .select('patrol_code, category, active')
        .eq('event_id', targetEventId);

      if (existingPatrolsError) {
        return respond(res, 500, 'Failed to validate category patrol numbers', existingPatrolsError.message);
      }

      const overlappingCategoryNumbers: string[] = [];
      ((existingPatrols ?? []) as Array<{
        patrol_code?: string | null;
        category?: string | null;
        active?: boolean | null;
      }>).forEach((row) => {
        if (row.active === false) {
          return;
        }
        const parsed = parsePatrolCategoryNumber(row.patrol_code, row.category);
        if (!parsed) {
          return;
        }
        const key = `${parsed.category}-${parsed.number}`;
        if (requestedCategoryNumbers.has(key)) {
          overlappingCategoryNumbers.push(key);
        }
      });

      if (overlappingCategoryNumbers.length > 0) {
        const sample = Array.from(new Set(overlappingCategoryNumbers)).slice(0, 12);
        return res.status(409).json({
          error: `Patrol numbers already exist in selected categories (e.g. ${sample.join(', ')}).`,
        });
      }
    }

    const duplicateCodes: string[] = [];
    const codeList = rows.map((row) => row.patrol_code);
    const chunkSize = 400;
    for (let offset = 0; offset < codeList.length; offset += chunkSize) {
      const slice = codeList.slice(offset, offset + chunkSize);
      const { data, error } = await supabaseAdmin
        .from('patrols')
        .select('patrol_code')
        .eq('event_id', targetEventId)
        .in('patrol_code', slice);
      if (error) {
        return respond(res, 500, 'Failed to check existing patrol codes', error.message);
      }
      (data ?? []).forEach((row: { patrol_code?: string | null }) => {
        const code = normalizeStationCode(row.patrol_code);
        if (code) {
          duplicateCodes.push(code);
        }
      });
    }

    if (duplicateCodes.length > 0) {
      const sample = Array.from(new Set(duplicateCodes)).slice(0, 12);
      return res.status(409).json({
        error: `Patrol codes already exist in this event (e.g. ${sample.join(', ')}).`,
      });
    }

    const { error: insertError } = await supabaseAdmin.from('patrols').insert(rows);
    if (insertError) {
      return respond(res, 500, 'Failed to create patrols', insertError.message);
    }

    return res.status(200).json({ ok: true, created: rows.length });
  }

  if (action === 'clear_event_points') {
    const targetEventId = normalizeText(payload.event_id);
    if (!targetEventId) {
      return res.status(400).json({ error: 'Missing event_id.' });
    }

    const tables = ['station_quiz_responses', 'station_scores', 'station_passages', 'timings'];
    for (const table of tables) {
      const { error } = await supabaseAdmin.from(table).delete().eq('event_id', targetEventId);
      if (error) {
        return respond(res, 500, 'Failed to clear event points', `${table}: ${error.message}`);
      }
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: `Unsupported action "${action}".` });
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = await requireCalcSession(req, res);
  if (!session) {
    return;
  }

  const { supabaseAdmin, eventId } = session;

  const setupMode = req.query?.setup === '1' || req.query?.setup === 'true';

  if (req.method === 'GET' && setupMode) {
    return loadSetupData(supabaseAdmin, eventId, res);
  }

  if (req.method === 'POST') {
    let rawBody: unknown = req.body;
    if (typeof rawBody === 'string') {
      try {
        rawBody = JSON.parse(rawBody);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }

    const payload = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;

    if (setupMode || normalizeText(payload.action)) {
      return handleSetupAction(supabaseAdmin, eventId, payload, res);
    }

    const locked = payload.locked;
    if (!isBoolean(locked)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const { data: currentEvent, error: currentEventError } = await supabaseAdmin
      .from('events')
      .select('scoring_locked_at')
      .eq('id', eventId)
      .maybeSingle();

    if (currentEventError || !currentEvent) {
      return respond(res, 500, 'Failed to load current event state', currentEventError?.message);
    }

    const updatePayload = locked
      ? {
          scoring_locked: true,
          scoring_locked_at: currentEvent.scoring_locked_at ?? buildDefaultLockAtIso(),
        }
      : {
          scoring_locked: false,
          scoring_locked_at: null,
        };

    const { error: updateError } = await supabaseAdmin
      .from('events')
      .update(updatePayload)
      .eq('id', eventId);

    if (updateError) {
      return respond(res, 500, 'Failed to update event state', updateError.message);
    }
  }

  const { data: eventRow, error: eventError } = await supabaseAdmin
    .from('events')
    .select('name, scoring_locked')
    .eq('id', eventId)
    .maybeSingle();

  if (eventError || !eventRow) {
    return respond(res, 500, 'Failed to load event state', eventError?.message);
  }

  return res.json({
    eventName: eventRow.name,
    scoringLocked: Boolean(eventRow.scoring_locked),
  });
}
