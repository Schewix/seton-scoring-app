import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import ExcelJS from 'exceljs';
import './AdminApp.css';
import { useAuth } from '../auth/context';
import LoginScreen from '../auth/LoginScreen';
import ChangePasswordScreen from '../auth/ChangePasswordScreen';
import AppFooter from '../components/AppFooter';
import type { AuthStatus } from '../auth/types';
import { supabase } from '../supabaseClient';
import {
  ANSWER_CATEGORIES,
  CategoryKey,
  formatAnswersForInput,
  isCategoryKey,
  normalizeAnswersInput,
  packAnswersForStorage,
  parseAnswerLetters,
  type TargetAnswerOptionCount,
} from '../utils/targetAnswers';
import { env } from '../envVars';
import {
  ADMIN_ROUTE_PREFIX,
  MAPA_PROCHODU_ROUTE,
} from '../routing';
import {
  createStationCategoryRecord,
  getStationAllowedBaseCategories,
  getAllowedStationCategories,
  STATION_PASSAGE_CATEGORIES,
  StationCategoryKey,
  toStationCategoryKey,
} from '../utils/stationCategories';
import { normalisePatrolCode } from '../components/PatrolCodeInput';
import AdminLoginScreen from './AdminLoginScreen';
import {
  EMPTY_RACE_DASHBOARD_SUMMARY,
  toAdminSectionId,
  type RaceDashboardSummary,
} from './adminSections';
import {
  buildAdminRoutePath,
  detectAdminRoutePrefix,
  parseAdminRoute,
  type AdminPageKey,
} from './adminRoutes';
import AdminSectionNav from './components/AdminSectionNav';
import {
  AdminExportsOverviewSection,
  AdminLiveMapSection,
  AdminLiveOverviewSection,
  AdminPatrolsOverviewSection,
  AdminQueuesSection,
  AdminResultsSection,
  AdminStartsSection,
  AdminStatsSection,
} from './components/AdminOverviewSections';
import AdminStationHealthPanel, {
  type AdminJudgeAssignmentSummary,
  type AdminStationHealthCard,
} from './components/AdminStationHealthPanel';

const API_BASE_URL = env.VITE_AUTH_API_URL?.replace(/\/$/, '') ?? '';
const SETUP_SELECTED_EVENT_STORAGE_KEY = 'admin.setup.selectedEventId';
const BRACKET_EXPORT_ORDER = ['NH', 'ND', 'MH', 'MD', 'SH', 'SD', 'RH', 'RD'] as const;
const BRACKET_EXPORT_ORDER_INDEX = new Map(BRACKET_EXPORT_ORDER.map((value, index) => [value, index] as const));
const BASE_CATEGORY_ORDER = ['N', 'M', 'S', 'R'] as const;
const ZL_BAND_POINTS = [16, 12, 9, 6, 4, 2, 1] as const;
const ZL_GAUSS_CENTER_INDEX = 2;
const ZL_GAUSS_SIGMA = 1.35;
const ZL_GAUSS_RATIO_PENALTY_WEIGHT = 0.35;
const ZL_GAUSS_DROPPED_PENALTY_WEIGHT = 0.08;
const ADMIN_PAGE_TITLE: Record<AdminPageKey, string> = {
  live: 'Živý průběh',
  patrols: 'Hlídky',
  stations: 'Stanoviště',
  results: 'Výsledky',
  statistics: 'Statistiky',
  settings: 'Nastavení',
};

type PtoTroopRegistryEntry = {
  canonicalName: string;
  numbers: number[];
  aliases?: string[];
};

const PTO_TROOP_REGISTRY: ReadonlyArray<PtoTroopRegistryEntry> = [
  { canonicalName: '2. PTO Poutníci', numbers: [2], aliases: ['PTO Poutníci', 'Poutníci'] },
  { canonicalName: '6. PTO Nibowaka', numbers: [6], aliases: ['PTO Nibowaka', 'Nibowaka'] },
  { canonicalName: '8. PTO Mustangové', numbers: [8], aliases: ['PTO Mustangové', 'Mustangové'] },
  { canonicalName: '10. PTO Severka', numbers: [10], aliases: ['10 PTO Severka'] },
  { canonicalName: '11. PTO Iktomi', numbers: [11], aliases: ['PTO Iktomi', 'Iktomi'] },
  { canonicalName: '15. PTO Vatra', numbers: [15], aliases: ['PTO Vatra', 'Vatra'] },
  { canonicalName: '21. PTO Hády', numbers: [21], aliases: ['PTO Hády', 'Hady'] },
  {
    canonicalName: 'ZS PCV',
    numbers: [14, 24, 25, 26, 27],
    aliases: [
      'ZS PCV',
      'ZSPCV',
      '14. TSP Zeměpisná společnost PCV',
      '14. TSP Zemepisna spolecnost PCV',
      'TSP Zeměpisná společnost PCV',
      'TSP Zemepisna spolecnost PCV',
      'Zeměpisná společnost PCV',
      'Zemepisna spolecnost PCV',
      '24. PTO života v přírodě',
      '25. PTO Ochrany přírody',
      '26. PTO Kulturní historie',
      '27. PTO Lesní moudrosti',
      'života v přírodě',
      'ochrany přírody',
      'kulturní historie',
      'lesní moudrosti',
    ],
  },
  { canonicalName: '32. PTO Severka', numbers: [32], aliases: ['32 PTO Severka'] },
  { canonicalName: '34. PTO Tulák', numbers: [34], aliases: ['PTO Tulák', 'Tulák'] },
  { canonicalName: '41. PTO Dráčata', numbers: [41], aliases: ['PTO Dráčata', 'Dracata'] },
  { canonicalName: '48. PTO Stezka', numbers: [48], aliases: ['PTO Stezka', 'Stezka'] },
  { canonicalName: '61. PTO Tuhas', numbers: [61], aliases: ['PTO Tuhas', 'Tuhas'] },
  { canonicalName: '63. PTO Phoenix', numbers: [63], aliases: ['PTO Phoenix', 'Phoenix'] },
  { canonicalName: '64. PTO Lorien', numbers: [64], aliases: ['PTO Lorien', 'Lorien'] },
  { canonicalName: '66. PTO Brabrouci', numbers: [66], aliases: ['PTO Brabrouci', 'Brabrouci'] },
  { canonicalName: '99. PTO Kamzíci', numbers: [99], aliases: ['PTO Kamzíci', 'Kamzici'] },
  { canonicalName: '111. PTO Vinohrady', numbers: [111], aliases: ['PTO Vinohrady', 'Vinohrady'] },
  { canonicalName: '172. PTO Pegas', numbers: [172], aliases: ['PTO Pegas', 'Pegas'] },
  { canonicalName: '176. PTO Vlčata', numbers: [176], aliases: ['PTO Vlčata', 'Vlcata'] },
  {
    canonicalName: 'PTO Žabky Jedovnice',
    numbers: [],
    aliases: ['PTO Žabky Jedovnice', 'Žabky Jedovnice', 'Zabky Jedovnice', 'Žabky'],
  },
];

type AuthenticatedState = Extract<AuthStatus, { state: 'authenticated' }>;

type AnswersFormState = Record<CategoryKey, string>;

type AnswersSummary = Record<CategoryKey, { letters: string[]; updatedAt: string | null }>;

type PatrolSummary = {
  id: string;
  code: string;
  teamName: string;
  category: CategoryKey;
};

type DisqualifyPatrol = {
  id: string;
  code: string;
  teamName: string;
  category: string;
  sex: string;
  disqualified: boolean;
};

type StationPassageRow = {
  stationId: string;
  stationCode: string;
  stationName: string;
  lastPassageAt: string | null;
  categories: CategoryKey[];
  totals: Record<CategoryKey, number>;
  expectedTotals: Record<CategoryKey, number>;
  totalPassed: number;
  totalExpected: number;
  missing: Record<CategoryKey, PatrolSummary[]>;
  totalMissing: PatrolSummary[];
};

type EventState = {
  name: string;
  scoringLocked: boolean;
};

type MissingDialogState = {
  stationCode: string;
  stationName: string;
  category: CategoryKey | 'TOTAL';
  missing: PatrolSummary[];
  expected: number;
};

type SetupEventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  scoring_locked?: boolean | null;
  announced_places_n?: number | null;
  announced_places_nh?: number | null;
  announced_places_nd?: number | null;
  announced_places_m?: number | null;
  announced_places_mh?: number | null;
  announced_places_md?: number | null;
  announced_places_s?: number | null;
  announced_places_sh?: number | null;
  announced_places_sd?: number | null;
  announced_places_r?: number | null;
  announced_places_rh?: number | null;
  announced_places_rd?: number | null;
  time_limit_n_minutes?: number | null;
  time_limit_m_minutes?: number | null;
  time_limit_s_minutes?: number | null;
  time_limit_r_minutes?: number | null;
  time_penalty_step_minutes?: number | null;
  target_answer_option_count?: number | null;
  participating_troops?: string[] | null;
};

type SetupStationRow = {
  id: string;
  event_id: string;
  code: string | null;
  name: string | null;
};

type SetupJudgeRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at?: string | null;
};

type SetupAssignmentRow = {
  id: string;
  judge_id: string;
  station_id: string;
  event_id: string;
  allowed_categories: string[] | null;
  allowed_tasks?: string[] | null;
  judge_display_name?: string | null;
  created_at?: string | null;
};

type SetupStationOrderRow = {
  event_id: string;
  category_orders?: Record<string, unknown> | null;
  separator_before_by_category?: Record<string, unknown> | null;
  updated_at?: string | null;
};

type SetupStationOrderPayload = {
  category_orders: Partial<Record<StationCategoryKey, string[]>>;
  separator_before_by_category: Partial<Record<StationCategoryKey, string>>;
};

type PatrolCountsState = Record<StationCategoryKey, number>;
type PatrolStartsState = Record<StationCategoryKey, number>;
type CategoryToggleState = Record<CategoryKey, boolean>;
type SetupEventScoringConfig = {
  announcedPlaces: Record<StationCategoryKey, number>;
  timeLimitMinutes: Record<CategoryKey, number>;
  timePenaltyStepMinutes: number;
  targetAnswerOptionCount: TargetAnswerOptionCount;
  participatingTroops: string[];
};

type SelectedSetupAssignmentSummary = AdminJudgeAssignmentSummary & {
  createdAt: string;
};

const SETUP_CATEGORY_ORDER_DEFAULTS: Record<StationCategoryKey, readonly string[]> = {
  NH: ['F', 'U', 'C', 'O', 'B', 'Z', 'K', 'P', 'J', 'R'],
  ND: ['F', 'U', 'C', 'O', 'B', 'Z', 'K', 'P', 'J', 'R'],
  MH: ['F', 'U', 'C', 'O', 'B', 'S', 'Z', 'M', 'A', 'K', 'P', 'J', 'R'],
  MD: ['R', 'J', 'P', 'K', 'A', 'M', 'Z', 'S', 'B', 'O', 'C', 'U', 'F'],
  SH: ['F', 'U', 'C', 'B', 'S', 'Z', 'M', 'V', 'N', 'O', 'A', 'P', 'J', 'R'],
  SD: ['R', 'J', 'P', 'A', 'O', 'N', 'V', 'M', 'Z', 'S', 'B', 'C', 'U', 'F'],
  RH: ['A', 'B', 'C', 'D', 'F', 'J', 'M', 'N', 'O', 'P', 'R', 'S', 'U', 'V', 'Z'],
  RD: ['A', 'B', 'C', 'D', 'F', 'J', 'M', 'N', 'O', 'P', 'R', 'S', 'U', 'V', 'Z'],
};

const SETUP_SEPARATOR_DEFAULTS: Partial<Record<StationCategoryKey, string>> = {
  NH: 'R',
  ND: 'R',
  MH: 'R',
  MD: 'J',
  SH: 'R',
  SD: 'J',
};

const DEFAULT_SETUP_ANNOUNCED_PLACES: Record<CategoryKey, number> = {
  N: 5,
  M: 6,
  S: 6,
  R: 3,
};

const DEFAULT_SETUP_ANNOUNCED_PLACES_BY_STATION_CATEGORY: Record<StationCategoryKey, number> = {
  NH: DEFAULT_SETUP_ANNOUNCED_PLACES.N,
  ND: DEFAULT_SETUP_ANNOUNCED_PLACES.N,
  MH: DEFAULT_SETUP_ANNOUNCED_PLACES.M,
  MD: DEFAULT_SETUP_ANNOUNCED_PLACES.M,
  SH: DEFAULT_SETUP_ANNOUNCED_PLACES.S,
  SD: DEFAULT_SETUP_ANNOUNCED_PLACES.S,
  RH: DEFAULT_SETUP_ANNOUNCED_PLACES.R,
  RD: DEFAULT_SETUP_ANNOUNCED_PLACES.R,
};

const DEFAULT_SETUP_TIME_LIMITS_MINUTES: Record<CategoryKey, number> = {
  N: 110,
  M: 140,
  S: 140,
  R: 140,
};

const DEFAULT_SETUP_TIME_PENALTY_STEP_MINUTES = 20;
const DEFAULT_TARGET_ANSWER_OPTION_COUNT: TargetAnswerOptionCount = 4;
const DEFAULT_SETUP_TROOP_OPTIONS = PTO_TROOP_REGISTRY.map((entry) => entry.canonicalName).sort(compareTroopSheetOrder);
function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumeric(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveInt(value: unknown, fallback: number, max = 1000): number {
  const parsed = toNumeric(value);
  if (parsed === null) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.round(parsed)));
}

function toTargetAnswerOptionCount(value: unknown, fallback: TargetAnswerOptionCount = DEFAULT_TARGET_ANSWER_OPTION_COUNT): TargetAnswerOptionCount {
  if (value === 3 || value === '3') {
    return 3;
  }
  if (value === 4 || value === '4') {
    return 4;
  }
  return fallback;
}

function formatMinutesAsTimeInput(totalMinutes: number): string {
  const safeMinutes = Math.max(1, Math.min(24 * 60, Math.round(totalMinutes)));
  const normalizedMinutes = Math.min(23 * 60 + 59, safeMinutes);
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseTimeInputToMinutes(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return Math.max(1, hours * 60 + minutes);
}

function normalizeTroopName(value: string | null | undefined): string {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeTroopList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  list.forEach((entry) => {
    const troopName = normalizeTroopName(typeof entry === 'string' ? entry : '');
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
  return result.sort(compareTroopSheetOrder);
}

function createDefaultSetupEventScoringConfig(): SetupEventScoringConfig {
  return {
    announcedPlaces: { ...DEFAULT_SETUP_ANNOUNCED_PLACES_BY_STATION_CATEGORY },
    timeLimitMinutes: { ...DEFAULT_SETUP_TIME_LIMITS_MINUTES },
    timePenaltyStepMinutes: DEFAULT_SETUP_TIME_PENALTY_STEP_MINUTES,
    targetAnswerOptionCount: DEFAULT_TARGET_ANSWER_OPTION_COUNT,
    participatingTroops: [],
  };
}

function normalizeSetupEventScoringConfig(source: SetupEventRow | null | undefined): SetupEventScoringConfig {
  const defaults = createDefaultSetupEventScoringConfig();
  if (!source) {
    return defaults;
  }
  return {
    announcedPlaces: {
      NH: toPositiveInt(
        source.announced_places_nh ?? source.announced_places_n,
        defaults.announcedPlaces.NH,
        100,
      ),
      ND: toPositiveInt(
        source.announced_places_nd ?? source.announced_places_n,
        defaults.announcedPlaces.ND,
        100,
      ),
      MH: toPositiveInt(
        source.announced_places_mh ?? source.announced_places_m,
        defaults.announcedPlaces.MH,
        100,
      ),
      MD: toPositiveInt(
        source.announced_places_md ?? source.announced_places_m,
        defaults.announcedPlaces.MD,
        100,
      ),
      SH: toPositiveInt(
        source.announced_places_sh ?? source.announced_places_s,
        defaults.announcedPlaces.SH,
        100,
      ),
      SD: toPositiveInt(
        source.announced_places_sd ?? source.announced_places_s,
        defaults.announcedPlaces.SD,
        100,
      ),
      RH: toPositiveInt(
        source.announced_places_rh ?? source.announced_places_r,
        defaults.announcedPlaces.RH,
        100,
      ),
      RD: toPositiveInt(
        source.announced_places_rd ?? source.announced_places_r,
        defaults.announcedPlaces.RD,
        100,
      ),
    },
    timeLimitMinutes: {
      N: toPositiveInt(source.time_limit_n_minutes, defaults.timeLimitMinutes.N, 24 * 60),
      M: toPositiveInt(source.time_limit_m_minutes, defaults.timeLimitMinutes.M, 24 * 60),
      S: toPositiveInt(source.time_limit_s_minutes, defaults.timeLimitMinutes.S, 24 * 60),
      R: toPositiveInt(source.time_limit_r_minutes, defaults.timeLimitMinutes.R, 24 * 60),
    },
    timePenaltyStepMinutes: toPositiveInt(
      source.time_penalty_step_minutes,
      defaults.timePenaltyStepMinutes,
      24 * 60,
    ),
    targetAnswerOptionCount: toTargetAnswerOptionCount(
      source.target_answer_option_count,
      defaults.targetAnswerOptionCount,
    ),
    participatingTroops: normalizeTroopList(source.participating_troops),
  };
}

function toBracketKey(category: string | null | undefined, sex: string | null | undefined): string | null {
  const normalizedCategory = normalizeText(category).toUpperCase();
  const normalizedSex = normalizeText(sex).toUpperCase();
  if (!normalizedCategory || !normalizedSex) {
    return null;
  }
  const key = `${normalizedCategory}${normalizedSex}`;
  return BRACKET_EXPORT_ORDER_INDEX.has(key as (typeof BRACKET_EXPORT_ORDER)[number]) ? key : null;
}

function parsePatrolCodeParts(code: string | null | undefined) {
  const normalizedCode = normalizeText(code).toUpperCase();
  if (!normalizedCode) {
    return { normalizedCode: '', bracketKey: null as string | null, numericPart: null as number | null };
  }
  const match = normalizedCode.match(/^([NMSR])([HD])[- ]?(\d{1,3})$/);
  if (!match) {
    return { normalizedCode, bracketKey: null as string | null, numericPart: null as number | null };
  }
  return {
    normalizedCode,
    bracketKey: `${match[1]}${match[2]}`,
    numericPart: Number.parseInt(match[3], 10),
  };
}

function comparePatrolOrder(
  a: { patrol_code: string | null; category?: string | null; sex?: string | null },
  b: { patrol_code: string | null; category?: string | null; sex?: string | null },
) {
  const aCode = parsePatrolCodeParts(a.patrol_code);
  const bCode = parsePatrolCodeParts(b.patrol_code);
  const aBracket = toBracketKey(a.category, a.sex) ?? aCode.bracketKey;
  const bBracket = toBracketKey(b.category, b.sex) ?? bCode.bracketKey;
  const aBracketOrder = aBracket ? (BRACKET_EXPORT_ORDER_INDEX.get(aBracket as (typeof BRACKET_EXPORT_ORDER)[number]) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  const bBracketOrder = bBracket ? (BRACKET_EXPORT_ORDER_INDEX.get(bBracket as (typeof BRACKET_EXPORT_ORDER)[number]) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  if (aBracketOrder !== bBracketOrder) {
    return aBracketOrder - bBracketOrder;
  }
  if (aCode.numericPart !== null && bCode.numericPart !== null && aCode.numericPart !== bCode.numericPart) {
    return aCode.numericPart - bCode.numericPart;
  }
  if (aCode.numericPart === null && bCode.numericPart !== null) {
    return 1;
  }
  if (aCode.numericPart !== null && bCode.numericPart === null) {
    return -1;
  }
  return aCode.normalizedCode.localeCompare(bCode.normalizedCode, 'cs');
}

function stripTroopMetadataFromMember(value: string) {
  return value.replace(/\s*\{oddil:[^}]+\}\s*$/i, '').trim();
}

function extractPatrolMembers(rawNote: string | null | undefined): string[] {
  const normalizedNote = normalizeText(rawNote);
  if (!normalizedNote) {
    return [];
  }

  const lines = normalizedNote
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return [];
  }

  const splitLine = (line: string) => line
    .split(/;|\||,/g)
    .map((value) => stripTroopMetadataFromMember(value))
    .filter(Boolean);

  const firstLineMembers = splitLine(lines[0]);
  if (lines.length === 1) {
    return firstLineMembers;
  }

  if (firstLineMembers.length > 1) {
    return firstLineMembers;
  }

  const allMembers = lines
    .flatMap((line) => splitLine(line))
    .filter((value) => value !== '—' && value !== '-');

  if (allMembers.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  return allMembers.filter((member) => {
    const key = member.toLocaleLowerCase('cs');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseTroopNumber(value: string): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^(\d{1,4})\s*\.?/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function troopNameQualityScore(value: string, troopNumber: number) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return -1;
  }
  const withoutNumber = normalized.replace(new RegExp(`^${troopNumber}\\s*\\.?\\s*`, 'i'), '').trim();
  if (!withoutNumber) {
    return 0;
  }
  if (/^PTO$/i.test(withoutNumber)) {
    return 1;
  }
  if (/^PTO\b/i.test(withoutNumber)) {
    return 10 + withoutNumber.length;
  }
  return 5 + withoutNumber.length;
}

function pickCanonicalTroopName(troopNumber: number, candidates: readonly string[]) {
  let bestName = '';
  let bestScore = -1;
  candidates.forEach((candidate) => {
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedCandidate) {
      return;
    }
    const score = troopNameQualityScore(normalizedCandidate, troopNumber);
    if (score > bestScore || (score === bestScore && normalizedCandidate.length > bestName.length)) {
      bestName = normalizedCandidate;
      bestScore = score;
    }
  });
  if (bestScore <= 0 || !bestName) {
    return `${troopNumber}. PTO`;
  }
  return bestName;
}

function compareTroopSheetOrder(a: string, b: string) {
  const aNumber = parseTroopNumber(a);
  const bNumber = parseTroopNumber(b);
  if (aNumber !== null && bNumber !== null) {
    if (aNumber !== bNumber) {
      return aNumber - bNumber;
    }
    return a.localeCompare(b, 'cs', { sensitivity: 'base' });
  }
  if (aNumber !== null) {
    return -1;
  }
  if (bNumber !== null) {
    return 1;
  }
  return a.localeCompare(b, 'cs', { sensitivity: 'base' });
}

function isMixedTroopPlaceholder(value: string) {
  return /^(?:sm[ií]s(?:en[áa]?|ene?)?|sm[ií]šen[áaýy]?\s+hl[ií]dka|mix(?:ed)?)$/i.test(value.trim());
}

function splitMixedTroopNames(rawTeamName: string | null | undefined): string[] {
  const normalized = normalizeText(rawTeamName);
  if (!normalized) {
    return ['Bez oddílu'];
  }

  const hasMultipleNumberedTroops = (normalized.match(/\d+\s*\.?\s*PTO/gi) ?? []).length >= 2;
  const splitPattern = hasMultipleNumberedTroops
    ? /\s*(?:\+|\/|&|;|\|)\s*|\s+\ba\b\s+|\s+\band\b\s+|,\s*(?=\d+\s*\.?)/gi
    : /\s*(?:\+|\/|&|;|\|)\s*|,\s*(?=\d+\s*\.?)/gi;
  const parts = normalized
    .split(splitPattern)
    .map((part) =>
      part
        .replace(/^\(?\s*(?:sm[ií]šen[áaýy]?\s+hl[ií]dka|sm[ií]s(?:en[áa]?|ene?)?|mix(?:ed)?)\s*[:\-]?\s*/i, '')
        .replace(/\s*\)?$/, '')
        .trim(),
    )
    .filter((part) => Boolean(part) && !isMixedTroopPlaceholder(part));

  if (!parts.length) {
    return ['Bez oddílu'];
  }

  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = part.toLocaleLowerCase('cs');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function toWorksheetBaseName(value: string, fallback: string) {
  const normalized = normalizeText(value).replace(/[\\/*?:[\]]+/g, ' ').replace(/\s+/g, ' ');
  const cleaned = normalized.trim();
  if (!cleaned) {
    return fallback;
  }
  return cleaned.slice(0, 31);
}

function toUniqueWorksheetName(baseName: string, usedNames: Set<string>) {
  const fallback = baseName || 'List';
  let candidate = fallback;
  let index = 2;
  while (usedNames.has(candidate)) {
    const suffix = ` (${index})`;
    const trimmedBase = fallback.slice(0, Math.max(1, 31 - suffix.length)).trimEnd();
    candidate = `${trimmedBase}${suffix}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function toExportFileName(eventName: string | null | undefined, exportLabel: string) {
  const safeEventName = normalizeText(eventName)
    .replace(/[\\/?%*:|"<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '-');
  const safeLabel = exportLabel
    .trim()
    .replace(/[\\/?%*:|"<>]/g, ' ')
    .replace(/\s+/g, '-');
  const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
  return `${safeEventName || 'seton'}-${safeLabel || 'export'}-${timestamp}.xlsx`;
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, fileName: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildPatrolCodeVariants(raw: string) {
  const normalized = normalisePatrolCode(raw);
  if (!normalized) {
    return [];
  }
  const match = normalized.match(/^([NMSR])([HD])-(\d{1,2})$/);
  if (!match) {
    return [normalized];
  }
  const parsed = Number.parseInt(match[3], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return [normalized];
  }
  const noPad = `${match[1]}${match[2]}-${parsed}`;
  const pad = `${match[1]}${match[2]}-${String(parsed).padStart(2, '0')}`;
  return noPad === pad ? [noPad] : [noPad, pad];
}

function parsePatrolMembersForExport(rawMembers: string | null | undefined): string[] {
  const normalized = normalizeText(rawMembers);
  if (!normalized) {
    return [];
  }

  const semicolonParts = normalized
    .split(/;|\r?\n/g)
    .map((value) => stripTroopMetadataFromMember(value))
    .filter(Boolean);

  if (semicolonParts.length > 1) {
    return semicolonParts;
  }

  const commaParts = normalized
    .split(',')
    .map((value) => stripTroopMetadataFromMember(value))
    .filter(Boolean);

  if (commaParts.length > 1) {
    return commaParts;
  }

  return [stripTroopMetadataFromMember(normalized)];
}

function formatSecondsForExport(seconds: number | null): string {
  if (seconds === null) {
    return '—';
  }
  const safeSeconds = Math.max(0, Math.round(seconds));
  const totalMinutes = Math.floor(safeSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatDateTimeForExport(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '—';
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  return parsed.toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeTroopLookupKey(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PTO_TROOP_BY_NUMBER = new Map<number, string>();
const ptoTroopAliasCandidates = new Map<string, Set<string>>();

PTO_TROOP_REGISTRY.forEach((entry) => {
  entry.numbers.forEach((number) => {
    PTO_TROOP_BY_NUMBER.set(number, entry.canonicalName);
  });

  const aliases = [entry.canonicalName, ...(entry.aliases ?? [])];
  aliases.forEach((alias) => {
    const normalizedAlias = normalizeTroopLookupKey(alias);
    if (!normalizedAlias) {
      return;
    }
    if (!ptoTroopAliasCandidates.has(normalizedAlias)) {
      ptoTroopAliasCandidates.set(normalizedAlias, new Set<string>());
    }
    ptoTroopAliasCandidates.get(normalizedAlias)!.add(entry.canonicalName);
  });
});

const PTO_TROOP_ALIAS_ENTRIES: Array<{ alias: string; canonicalName: string }> = [];
ptoTroopAliasCandidates.forEach((canonicalNames, alias) => {
  if (canonicalNames.size !== 1) {
    return;
  }
  const [canonicalName] = Array.from(canonicalNames);
  PTO_TROOP_ALIAS_ENTRIES.push({ alias, canonicalName });
});
PTO_TROOP_ALIAS_ENTRIES.sort((a, b) => b.alias.length - a.alias.length || a.alias.localeCompare(b.alias, 'cs'));

function extractPtoTroopsFromText(value: string | null | undefined): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  const found = new Set<string>();

  const numberMatches = normalized.match(/\b\d{1,3}\b/g) ?? [];
  numberMatches.forEach((rawNumber) => {
    const parsed = Number.parseInt(rawNumber, 10);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const canonicalName = PTO_TROOP_BY_NUMBER.get(parsed);
    if (canonicalName) {
      found.add(canonicalName);
    }
  });

  const lookupSource = normalizeTroopLookupKey(normalized);
  if (lookupSource) {
    PTO_TROOP_ALIAS_ENTRIES.forEach(({ alias, canonicalName }) => {
      if (lookupSource.includes(alias)) {
        found.add(canonicalName);
      }
    });
  }

  return Array.from(found);
}

function extractPtoTroopsFromPatrol(
  teamName: string | null | undefined,
  members: readonly string[],
): string[] {
  const found = new Map<string, string>();
  const addTroopsFromText = (rawText: string | null | undefined) => {
    extractPtoTroopsFromText(rawText).forEach((troopName) => {
      const key = troopName.toLocaleLowerCase('cs');
      if (!found.has(key)) {
        found.set(key, troopName);
      }
    });
  };

  splitMixedTroopNames(teamName).forEach((part) => addTroopsFromText(part));
  addTroopsFromText(teamName);
  members.forEach((member) => addTroopsFromText(member));

  return Array.from(found.values()).sort(compareTroopSheetOrder);
}

function extractTroopMemberWeights(
  teamName: string | null | undefined,
  members: readonly string[],
): Array<{ troopName: string; memberWeight: number }> {
  const patrolTroops = extractPtoTroopsFromPatrol(teamName, members);
  const weights = new Map<string, { troopName: string; memberWeight: number }>();

  const setWeight = (troopName: string, memberWeight: number) => {
    const key = troopName.toLocaleLowerCase('cs');
    const previous = weights.get(key);
    weights.set(key, {
      troopName: previous?.troopName ?? troopName,
      memberWeight,
    });
  };

  const addWeight = (troopName: string, memberWeight: number) => {
    const key = troopName.toLocaleLowerCase('cs');
    const previous = weights.get(key);
    setWeight(troopName, (previous?.memberWeight ?? 0) + memberWeight);
  };

  members.forEach((member) => {
    const detectedTroops = extractPtoTroopsFromText(member);
    if (detectedTroops.length !== 1) {
      return;
    }
    addWeight(detectedTroops[0], 1);
  });

  let totalWeight = Array.from(weights.values()).reduce((sum, item) => sum + item.memberWeight, 0);

  if (totalWeight > 0 && totalWeight < 3) {
    if (patrolTroops.length === 1) {
      setWeight(patrolTroops[0], 3);
      totalWeight = 3;
    } else if (patrolTroops.length > 1) {
      const missingTroops = patrolTroops.filter((troopName) => !weights.has(troopName.toLocaleLowerCase('cs')));
      if (missingTroops.length === 1) {
        addWeight(missingTroops[0], 3 - totalWeight);
        totalWeight = 3;
      }
    }
  }

  if (totalWeight <= 0) {
    if (!patrolTroops.length) {
      return [];
    }
    const fallbackWeight = 3 / patrolTroops.length;
    return patrolTroops.map((troopName) => ({ troopName, memberWeight: fallbackWeight }));
  }

  if (totalWeight > 3 + 1e-9) {
    const scale = 3 / totalWeight;
    Array.from(weights.values()).forEach((item) => {
      setWeight(item.troopName, item.memberWeight * scale);
    });
  }

  return Array.from(weights.values())
    .filter((item) => item.memberWeight > 0)
    .sort((a, b) => compareTroopSheetOrder(a.troopName, b.troopName));
}

function normalizeSheetNameKey(value: string): string | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const compact = normalized.toUpperCase().replace(/\s+/g, '');
  if (/^[NMSR][HD]$/.test(compact)) {
    return compact;
  }
  if (/^[NMSR]$/.test(compact)) {
    return compact;
  }
  return null;
}

function normalizeHeaderKey(value: string): string {
  return stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getObjectProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return (value as { [property: string]: unknown })[key];
}

function excelCellValueToText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .join('')
      .trim();
  }

  const richText = getObjectProperty(value, 'richText');
  if (Array.isArray(richText)) {
    const merged = richText
      .map((part) => {
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .join('')
      .trim();
    if (merged) {
      return merged;
    }
  }

  const text = getObjectProperty(value, 'text');
  if (typeof text === 'string') {
    return text.trim();
  }

  const result = getObjectProperty(value, 'result');
  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return String(result).trim();
  }

  return '';
}

function excelCellValueToNumber(value: ExcelJS.CellValue | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = excelCellValueToText(value);
  if (!text) {
    return null;
  }
  return toNumeric(text.replace(/\s+/g, '').replace(',', '.'));
}

function createEmptyAnswers(): AnswersFormState {
  return { N: '', M: '', S: '', R: '' };
}

function createEmptySummary(): AnswersSummary {
  return {
    N: { letters: [], updatedAt: null },
    M: { letters: [], updatedAt: null },
    S: { letters: [], updatedAt: null },
    R: { letters: [], updatedAt: null },
  };
}

function createDefaultOrderTextState(): Record<StationCategoryKey, string> {
  return STATION_PASSAGE_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = SETUP_CATEGORY_ORDER_DEFAULTS[category].join(', ');
      return acc;
    },
    {} as Record<StationCategoryKey, string>,
  );
}

function createDefaultSeparatorState(): Partial<Record<StationCategoryKey, string>> {
  return { ...SETUP_SEPARATOR_DEFAULTS };
}

function createDefaultPatrolCounts(): PatrolCountsState {
  return STATION_PASSAGE_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = 0;
      return acc;
    },
    {} as PatrolCountsState,
  );
}

function createDefaultPatrolStarts(): PatrolStartsState {
  return STATION_PASSAGE_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = 1;
      return acc;
    },
    {} as PatrolStartsState,
  );
}

function createDefaultCategoryToggleState(): CategoryToggleState {
  return {
    N: true,
    M: true,
    S: true,
    R: true,
  };
}

function createBaseCategoryRecord<T>(factory: () => T): Record<CategoryKey, T> {
  return {
    N: factory(),
    M: factory(),
    S: factory(),
    R: factory(),
  };
}

function normalizeSetupStationOrder(raw: unknown): SetupStationOrderPayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const source = raw as {
    category_orders?: unknown;
    separator_before_by_category?: unknown;
  };
  const rawOrders =
    source.category_orders && typeof source.category_orders === 'object'
      ? (source.category_orders as Record<string, unknown>)
      : {};
  const rawSeparators =
    source.separator_before_by_category && typeof source.separator_before_by_category === 'object'
      ? (source.separator_before_by_category as Record<string, unknown>)
      : {};

  const categoryOrders: Partial<Record<StationCategoryKey, string[]>> = {};
  const separatorBeforeByCategory: Partial<Record<StationCategoryKey, string>> = {};

  STATION_PASSAGE_CATEGORIES.forEach((category) => {
    const list = Array.isArray(rawOrders[category]) ? rawOrders[category] : [];
    const seen = new Set<string>();
    const normalizedList: string[] = [];
    list.forEach((entry) => {
      const code = normalizeText(typeof entry === 'string' ? entry : '').toUpperCase();
      if (!code || seen.has(code)) {
        return;
      }
      seen.add(code);
      normalizedList.push(code);
    });
    if (normalizedList.length > 0) {
      categoryOrders[category] = normalizedList;
    }

    const separator = normalizeText(typeof rawSeparators[category] === 'string' ? rawSeparators[category] : '').toUpperCase();
    if (separator) {
      separatorBeforeByCategory[category] = separator;
    }
  });

  return {
    category_orders: categoryOrders,
    separator_before_by_category: separatorBeforeByCategory,
  };
}

function AdminDashboard({
  auth,
  refreshManifest,
  logout,
}: {
  auth: AuthenticatedState;
  refreshManifest: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  const manifest = auth.manifest;
  const stationCode = manifest.station.code?.trim().toUpperCase() ?? '';
  const isCalcStation = stationCode === 'T';
  const eventId = manifest.event.id;
  const stationId = manifest.station.id;
  const accessToken = auth.tokens.accessToken;

  const [answersForm, setAnswersForm] = useState<AnswersFormState>(() => createEmptyAnswers());
  const [answersSummary, setAnswersSummary] = useState<AnswersSummary>(() => createEmptySummary());
  const [answersLoading, setAnswersLoading] = useState(false);
  const [answersSaving, setAnswersSaving] = useState(false);
  const [answersError, setAnswersError] = useState<string | null>(null);
  const [answersSuccess, setAnswersSuccess] = useState<string | null>(null);

  const [stationRows, setStationRows] = useState<StationPassageRow[]>([]);
  const [stationLoading, setStationLoading] = useState(false);
  const [stationError, setStationError] = useState<string | null>(null);
  const [missingDialog, setMissingDialog] = useState<MissingDialogState | null>(null);

  const [eventState, setEventState] = useState<EventState>({
    name: manifest.event.name,
    scoringLocked: manifest.event.scoringLocked,
  });
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [lockUpdating, setLockUpdating] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [disqualifyCode, setDisqualifyCode] = useState('');
  const [disqualifyTarget, setDisqualifyTarget] = useState<DisqualifyPatrol | null>(null);
  const [disqualifyLoading, setDisqualifyLoading] = useState(false);
  const [disqualifySaving, setDisqualifySaving] = useState(false);
  const [disqualifyError, setDisqualifyError] = useState<string | null>(null);
  const [disqualifySuccess, setDisqualifySuccess] = useState<string | null>(null);
  const [exportingNames, setExportingNames] = useState(false);
  const [exportingLeague, setExportingLeague] = useState(false);
  const [leagueImportFile, setLeagueImportFile] = useState<File | null>(null);
  const [processingLeagueImport, setProcessingLeagueImport] = useState(false);
  const [leagueImportError, setLeagueImportError] = useState<string | null>(null);
  const [leagueImportSuccess, setLeagueImportSuccess] = useState<string | null>(null);

  const [setupLoading, setSetupLoading] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSuccess, setSetupSuccess] = useState<string | null>(null);
  const [setupEvents, setSetupEvents] = useState<SetupEventRow[]>([]);
  const [setupStations, setSetupStations] = useState<SetupStationRow[]>([]);
  const [setupJudges, setSetupJudges] = useState<SetupJudgeRow[]>([]);
  const [setupAssignments, setSetupAssignments] = useState<SetupAssignmentRow[]>([]);
  const [setupOrders, setSetupOrders] = useState<Record<string, SetupStationOrderPayload>>({});
  const [selectedSetupEventId, setSelectedSetupEventId] = useState(() => {
    if (typeof window === 'undefined') {
      return eventId;
    }
    return window.localStorage.getItem(SETUP_SELECTED_EVENT_STORAGE_KEY) || eventId;
  });
  const [showStatsSection, setShowStatsSection] = useState(false);
  const [showExportsSection, setShowExportsSection] = useState(false);
  const [activeAdminPage, setActiveAdminPage] = useState<AdminPageKey>(() => {
    if (typeof window === 'undefined') {
      return 'live';
    }
    return parseAdminRoute(window.location.pathname).page;
  });
  const [adminRoutePrefix, setAdminRoutePrefix] = useState(() => {
    if (typeof window === 'undefined') {
      return ADMIN_ROUTE_PREFIX;
    }
    return detectAdminRoutePrefix(window.location.pathname);
  });
  const [pageTransitioning, setPageTransitioning] = useState(false);
  const [raceDashboardSummary, setRaceDashboardSummary] = useState<RaceDashboardSummary>(
    EMPTY_RACE_DASHBOARD_SUMMARY,
  );
  const [setupEventScoringConfig, setSetupEventScoringConfig] = useState<SetupEventScoringConfig>(
    () => createDefaultSetupEventScoringConfig(),
  );
  const [setupTroopDraft, setSetupTroopDraft] = useState('');
  const [answersTargetOptionCount, setAnswersTargetOptionCount] = useState<TargetAnswerOptionCount>(
    () => (manifest.event.targetAnswerOptionCount === 3 ? 3 : DEFAULT_TARGET_ANSWER_OPTION_COUNT),
  );
  const targetAnswerInputPattern = answersTargetOptionCount === 3 ? '[A-Ca-c]*' : '[A-Da-d]*';
  const targetAnswerInputHint = answersTargetOptionCount === 3 ? 'A-C' : 'A-D';

  const [createEventName, setCreateEventName] = useState('');
  const [createEventStartsAt, setCreateEventStartsAt] = useState('');
  const [createEventEndsAt, setCreateEventEndsAt] = useState('');
  const [copyStationsFromCurrentEvent, setCopyStationsFromCurrentEvent] = useState(true);

  const [orderInputs, setOrderInputs] = useState<Record<StationCategoryKey, string>>(() => createDefaultOrderTextState());
  const [separatorInputs, setSeparatorInputs] = useState<Partial<Record<StationCategoryKey, string>>>(
    () => createDefaultSeparatorState(),
  );

  const [judgeEmailInput, setJudgeEmailInput] = useState('');
  const [judgeDisplayNameInput, setJudgeDisplayNameInput] = useState('');
  const [judgeStationCodeInput, setJudgeStationCodeInput] = useState('');
  const [judgeCategoryToggle, setJudgeCategoryToggle] = useState<CategoryToggleState>(() => createDefaultCategoryToggleState());
  const [judgeTasksInput, setJudgeTasksInput] = useState('score-review');
  const [judgeTemporaryPassword, setJudgeTemporaryPassword] = useState<string | null>(null);

  const [patrolCounts, setPatrolCounts] = useState<PatrolCountsState>(() => createDefaultPatrolCounts());
  const [patrolStarts, setPatrolStarts] = useState<PatrolStartsState>(() => createDefaultPatrolStarts());

  useEffect(() => {
    setEventState({ name: manifest.event.name, scoringLocked: manifest.event.scoringLocked });
  }, [manifest.event.name, manifest.event.scoringLocked]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!selectedSetupEventId) {
      window.localStorage.removeItem(SETUP_SELECTED_EVENT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(SETUP_SELECTED_EVENT_STORAGE_KEY, selectedSetupEventId);
  }, [selectedSetupEventId]);

  const loadAnswers = useCallback(async () => {
    const answersEventId = selectedSetupEventId || eventId;
    const answersEventName =
      setupEvents.find((row) => row.id === answersEventId)?.name ?? answersEventId;
    const targetStation = setupStations.find(
      (station) =>
        station.event_id === answersEventId &&
        normalizeText(station.code).toUpperCase() === 'T',
    );
    const answersStationId = targetStation?.id || (answersEventId === eventId ? stationId : '');

    if (!answersStationId) {
      setAnswersError(`Pro ročník "${answersEventName}" chybí stanoviště T.`);
      setAnswersForm(createEmptyAnswers());
      setAnswersSummary(createEmptySummary());
      return;
    }

    setAnswersLoading(true);
    setAnswersError(null);
    const { data, error } = await supabase
      .from('station_category_answers')
      .select('category, correct_answers, updated_at')
      .eq('event_id', answersEventId)
      .eq('station_id', answersStationId);
    setAnswersLoading(false);

    if (error) {
      console.error('Failed to load category answers', error);
      setAnswersError('Nepodařilo se načíst správné odpovědi.');
      return;
    }

    const form = createEmptyAnswers();
    const summary = createEmptySummary();
    (data ?? []).forEach((row) => {
      const category = typeof row.category === 'string' ? row.category.trim().toUpperCase() : '';
      if (!isCategoryKey(category)) {
        return;
      }
      const packed = typeof row.correct_answers === 'string' ? row.correct_answers : '';
      form[category] = formatAnswersForInput(packed, { maxOptionCount: answersTargetOptionCount });
      summary[category] = {
        letters: parseAnswerLetters(packed, { maxOptionCount: answersTargetOptionCount }),
        updatedAt: row.updated_at ?? null,
      };
    });

    setAnswersForm(form);
    setAnswersSummary(summary);
    setAnswersSuccess(null);
  }, [answersTargetOptionCount, eventId, selectedSetupEventId, setupEvents, setupStations, stationId]);

  const loadStationStats = useCallback(async () => {
    setStationLoading(true);
    setStationError(null);
    setMissingDialog(null);

    const [stationsRes, passagesRes, patrolsRes] = await Promise.all([
      supabase
        .from('stations')
        .select('id, code, name')
        .eq('event_id', eventId)
        .order('code'),
      supabase
        .from('station_passages')
        .select('station_id, patrol_id, arrived_at, left_at, client_created_at, patrols(category, sex)')
        .eq('event_id', eventId),
      supabase
        .from('patrols')
        .select('id, category, sex, patrol_code, team_name, active')
        .eq('event_id', eventId),
    ]);

    setStationLoading(false);

    if (stationsRes.error || passagesRes.error || patrolsRes.error) {
      console.error(
        'Failed to load station passages overview',
        stationsRes.error,
        passagesRes.error,
        patrolsRes.error,
      );
      setStationError('Nepodařilo se načíst průchody stanovišť.');
      setStationRows([]);
      setRaceDashboardSummary((previous) => ({
        ...previous,
        problematicStations: Math.max(1, previous.problematicStations),
      }));
      return;
    }

    const stations = new Map<string, { code: string; name: string }>();
    ((stationsRes.data ?? []) as { id: string; code: string; name: string }[]).forEach((station) => {
      const code = (station.code || '').trim().toUpperCase();
      if (code === 'R') {
        return;
      }
      stations.set(station.id, {
        code,
        name: station.name,
      });
    });

    const categoryPatrols = createBaseCategoryRecord<PatrolSummary[]>(() => []);
    const allPatrols: PatrolSummary[] = [];

    type PatrolRow = {
      id: string;
      category: string | null;
      sex: string | null;
      patrol_code: string | null;
      team_name: string | null;
      active: boolean | null;
    };

    ((patrolsRes.data ?? []) as PatrolRow[]).forEach((patrol) => {
      if (patrol.active === false) {
        return;
      }
      const stationCategory = toStationCategoryKey(patrol.category, patrol.sex);
      if (!stationCategory) {
        return;
      }
      const summary: PatrolSummary = {
        id: patrol.id,
        code: normalizeText(patrol.patrol_code).toUpperCase(),
        teamName: normalizeText(patrol.team_name),
        category: stationCategory.slice(0, 1) as CategoryKey,
      };
      categoryPatrols[summary.category].push(summary);
      allPatrols.push(summary);
    });

    BASE_CATEGORY_ORDER.forEach((category) => {
      categoryPatrols[category].sort((a, b) => a.code.localeCompare(b.code, 'cs'));
    });

    type StationAccumulator = {
      stationId: string;
      stationCode: string;
      stationName: string;
      lastPassageAt: string | null;
      totals: Record<CategoryKey, number>;
      passed: Record<CategoryKey, Set<string>>;
    };

    const totals = new Map<string, StationAccumulator>();
    stations.forEach((station, id) => {
      totals.set(id, {
        stationId: id,
        stationCode: station.code,
        stationName: station.name,
        lastPassageAt: null,
        totals: createBaseCategoryRecord<number>(() => 0),
        passed: createBaseCategoryRecord<Set<string>>(() => new Set<string>()),
      });
    });

    type PassageRow = {
      station_id: string;
      patrol_id: string;
      arrived_at?: string | null;
      left_at?: string | null;
      client_created_at?: string | null;
      patrols?: { category?: string | null; sex?: string | null } | null;
    };

    ((passagesRes.data ?? []) as PassageRow[]).forEach((row) => {
      const station = totals.get(row.station_id);
      if (!station) {
        return;
      }
      const stationCategory = toStationCategoryKey(row.patrols?.category ?? null, row.patrols?.sex ?? null);
      if (!stationCategory) {
        return;
      }

      const maybeLatest = normalizeText(row.left_at) || normalizeText(row.arrived_at) || normalizeText(row.client_created_at);
      if (maybeLatest) {
        const latestTs = Date.parse(maybeLatest);
        const currentTs = Date.parse(station.lastPassageAt ?? '');
        if (Number.isFinite(latestTs) && (!Number.isFinite(currentTs) || latestTs > currentTs)) {
          station.lastPassageAt = maybeLatest;
        }
      }

      const baseCategory = stationCategory.slice(0, 1) as CategoryKey;
      station.totals[baseCategory] += 1;
      station.passed[baseCategory].add(row.patrol_id);
    });

    const sorted = Array.from(totals.values()).sort((a, b) =>
      a.stationCode.localeCompare(b.stationCode, 'cs'),
    );

    const rows: StationPassageRow[] = sorted.map((station) => {
      const categories = Array.from(
        new Set(
          getAllowedStationCategories(station.stationCode).map(
            (stationCategory) => stationCategory.slice(0, 1) as CategoryKey,
          ),
        ),
      );
      const allowedCategorySet = new Set<CategoryKey>(categories);
      const missing = createBaseCategoryRecord<PatrolSummary[]>(() => []);
      const expectedTotals = createBaseCategoryRecord<number>(() => 0);
      const passedOverall = new Set<string>();

      categories.forEach((category) => {
        const passed = station.passed[category];
        passed.forEach((id) => passedOverall.add(id));
        expectedTotals[category] = categoryPatrols[category].length;
        missing[category] = categoryPatrols[category].filter((patrol) => !passed.has(patrol.id));
      });

      const totalMissing = allPatrols.filter(
        (patrol) => allowedCategorySet.has(patrol.category) && !passedOverall.has(patrol.id),
      );

      const totalPassed = categories.reduce((sum, category) => sum + station.totals[category], 0);
      const totalExpected = categories.reduce((sum, category) => sum + expectedTotals[category], 0);

      return {
        stationId: station.stationId,
        stationCode: station.stationCode,
        stationName: station.stationName,
        lastPassageAt: station.lastPassageAt,
        categories,
        totals: station.totals,
        expectedTotals,
        totalPassed,
        totalExpected,
        missing,
        totalMissing,
      };
    });

    setStationRows(rows);
    const activePatrolIds = new Set(allPatrols.map((patrol) => patrol.id));
    const patrolsSeenOnCourse = new Set<string>();
    const patrolsFinished = new Set<string>();
    ((passagesRes.data ?? []) as PassageRow[]).forEach((row) => {
      if (!activePatrolIds.has(row.patrol_id)) {
        return;
      }
      const station = stations.get(row.station_id);
      if (!station) {
        return;
      }
      patrolsSeenOnCourse.add(row.patrol_id);
      if (station.code === 'T') {
        patrolsFinished.add(row.patrol_id);
      }
    });
    const registeredPatrols = activePatrolIds.size;
    const patrolsSeen = patrolsSeenOnCourse.size;
    const finished = patrolsFinished.size;
    const waitingForStart = Math.max(0, registeredPatrols - patrolsSeen);
    const onCourse = Math.max(0, patrolsSeen - finished);
    const syncConflicts = rows.filter((row) => row.totalExpected > 0 && row.totalPassed > row.totalExpected).length;
    const problematicStations = rows.filter(
      (row) => row.totalExpected > 0 && row.totalPassed === 0 && patrolsSeen > 0,
    ).length;
    setRaceDashboardSummary({
      registeredPatrols,
      patrolsSeenOnCourse: patrolsSeen,
      patrolsOnCourse: onCourse,
      patrolsFinished: finished,
      patrolsWaitingForStart: waitingForStart,
      problematicStations,
      syncConflicts,
      missingLongPatrols: 0,
      overdueNoFinishPatrols: 0,
      lastSyncAt: new Date().toISOString(),
    });
  }, [eventId]);

  const handleOpenStationMissing = useCallback(
    (row: StationPassageRow, category: CategoryKey | 'TOTAL') => {
      if (category === 'TOTAL') {
        setMissingDialog({
          stationCode: row.stationCode,
          stationName: row.stationName,
          category,
          missing: row.totalMissing,
          expected: row.totalExpected,
        });
        return;
      }

      setMissingDialog({
        stationCode: row.stationCode,
        stationName: row.stationName,
        category,
        missing: row.missing[category],
        expected: row.expectedTotals[category],
      });
    },
    [],
  );

  const handleCloseMissingDialog = useCallback(() => {
    setMissingDialog(null);
  }, []);

  const loadEventState = useCallback(async () => {
    if (!API_BASE_URL) {
      setEventError('Chybí konfigurace API (VITE_AUTH_API_URL).');
      return;
    }
    if (!accessToken) {
      setEventError('Chybí přístupový token.');
      return;
    }

    setEventLoading(true);
    setEventError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/admin/event-state`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error || 'Nepodařilo se načíst stav závodu.';
        throw new Error(message);
      }

      const payload = (await response.json()) as { eventName: string; scoringLocked: boolean };
      setEventState({ name: payload.eventName, scoringLocked: payload.scoringLocked });
    } catch (error) {
      console.error('Failed to load event state', error);
      setEventError(
        error instanceof Error && error.message ? error.message : 'Nepodařilo se načíst stav závodu.',
      );
    } finally {
      setEventLoading(false);
    }
  }, [accessToken]);

  const loadSetupData = useCallback(async () => {
    if (!API_BASE_URL) {
      setSetupError('Chybí konfigurace API (VITE_AUTH_API_URL).');
      return;
    }
    if (!accessToken) {
      setSetupError('Chybí přístupový token.');
      return;
    }

    setSetupLoading(true);
    setSetupError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/admin/event-state?setup=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error || 'Nepodařilo se načíst nastavení ročníků.';
        throw new Error(message);
      }

      const payload = (await response.json()) as {
        current_event_id?: string;
        events?: SetupEventRow[];
        stations?: SetupStationRow[];
        judges?: SetupJudgeRow[];
        assignments?: SetupAssignmentRow[];
        station_orders?: SetupStationOrderRow[];
      };

      const events = Array.isArray(payload.events) ? payload.events : [];
      const stations = Array.isArray(payload.stations) ? payload.stations : [];
      const judges = Array.isArray(payload.judges) ? payload.judges : [];
      const assignments = Array.isArray(payload.assignments) ? payload.assignments : [];
      const stationOrders = Array.isArray(payload.station_orders) ? payload.station_orders : [];
      const currentEventId = normalizeText(payload.current_event_id) || eventId;

      const orderByEvent: Record<string, SetupStationOrderPayload> = {};
      stationOrders.forEach((row) => {
        const targetEventId = normalizeText(row.event_id);
        if (!targetEventId) {
          return;
        }
        const normalized = normalizeSetupStationOrder({
          category_orders: row.category_orders ?? {},
          separator_before_by_category: row.separator_before_by_category ?? {},
        });
        if (normalized) {
          orderByEvent[targetEventId] = normalized;
        }
      });

      setSetupEvents(events);
      setSetupStations(stations);
      setSetupJudges(judges);
      setSetupAssignments(assignments);
      setSetupOrders(orderByEvent);
      setSelectedSetupEventId((prev) => {
        if (prev && events.some((eventRow) => eventRow.id === prev)) {
          return prev;
        }
        if (events.some((eventRow) => eventRow.id === currentEventId)) {
          return currentEventId;
        }
        return events[0]?.id ?? currentEventId;
      });
    } catch (error) {
      console.error('Failed to load event setup data', error);
      setSetupError(
        error instanceof Error && error.message
          ? error.message
          : 'Nepodařilo se načíst nastavení ročníků.',
      );
    } finally {
      setSetupLoading(false);
    }
  }, [accessToken, eventId]);

  const postSetupAction = useCallback(
    async (action: string, payload: Record<string, unknown>) => {
      if (!API_BASE_URL) {
        throw new Error('Chybí konfigurace API (VITE_AUTH_API_URL).');
      }
      if (!accessToken) {
        throw new Error('Chybí přístupový token.');
      }
      const response = await fetch(`${API_BASE_URL}/admin/event-state?setup=1`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body?.error || `Akce ${action} selhala.`;
        throw new Error(message);
      }
      return body;
    },
    [accessToken],
  );

  const selectedSetupStations = useMemo(
    () =>
      setupStations
        .filter((station) => station.event_id === selectedSetupEventId)
        .map((station) => ({
          id: station.id,
          code: normalizeText(station.code).toUpperCase(),
          name: normalizeText(station.name),
        }))
        .filter((station) => station.code),
    [selectedSetupEventId, setupStations],
  );

  const selectedSetupEvent = useMemo(
    () => setupEvents.find((row) => row.id === selectedSetupEventId) ?? null,
    [selectedSetupEventId, setupEvents],
  );

  const setupTroopOptions = useMemo(() => {
    const merged = normalizeTroopList([
      ...DEFAULT_SETUP_TROOP_OPTIONS,
      ...setupEventScoringConfig.participatingTroops,
    ]);
    return merged;
  }, [setupEventScoringConfig.participatingTroops]);

  useEffect(() => {
    const currentEventSettings =
      setupEvents.find((row) => row.id === selectedSetupEventId) ??
      setupEvents.find((row) => row.id === eventId);
    if (!currentEventSettings) {
      return;
    }
    setAnswersTargetOptionCount((prev) =>
      toTargetAnswerOptionCount(currentEventSettings.target_answer_option_count, prev),
    );
  }, [eventId, selectedSetupEventId, setupEvents]);

  const selectedSetupAssignments = useMemo<SelectedSetupAssignmentSummary[]>(() => {
    const judgeById = new Map(setupJudges.map((judge) => [judge.id, judge]));
    const stationById = new Map(
      setupStations
        .filter((station) => station.event_id === selectedSetupEventId)
        .map((station) => [station.id, station]),
    );
    return setupAssignments
      .filter((assignment) => assignment.event_id === selectedSetupEventId)
      .map((assignment) => {
        const judge = judgeById.get(assignment.judge_id);
        const station = stationById.get(assignment.station_id);
        return {
          id: assignment.id,
          email: normalizeText(judge?.email),
          displayName:
            normalizeText(assignment.judge_display_name) ||
            normalizeText(judge?.display_name) ||
            normalizeText(judge?.email),
          stationCode: normalizeText(station?.code).toUpperCase(),
          stationName: normalizeText(station?.name),
          categories: Array.isArray(assignment.allowed_categories)
            ? assignment.allowed_categories.filter((value) => typeof value === 'string')
            : [],
          createdAt: normalizeText(assignment.created_at),
        };
      })
      .sort((a, b) => a.stationCode.localeCompare(b.stationCode, 'cs') || a.displayName.localeCompare(b.displayName, 'cs'));
  }, [selectedSetupEventId, setupAssignments, setupJudges, setupStations]);

  const stationHealthCards = useMemo<AdminStationHealthCard[]>(() => {
    const assignmentCountByStationCode = new Map<string, number>();
    selectedSetupAssignments.forEach((assignment) => {
      const key = normalizeText(assignment.stationCode).toUpperCase();
      if (!key) {
        return;
      }
      assignmentCountByStationCode.set(key, (assignmentCountByStationCode.get(key) ?? 0) + 1);
    });

    const rowByStationCode = new Map(
      stationRows.map((row) => [normalizeText(row.stationCode).toUpperCase(), row] as const),
    );

    const baseStations = selectedSetupStations.length > 0
      ? selectedSetupStations
      : stationRows.map((row) => ({
          id: row.stationId,
          code: row.stationCode,
          name: row.stationName,
        }));

    return baseStations.map((station) => {
      const stationCode = normalizeText(station.code).toUpperCase();
      const row = rowByStationCode.get(stationCode) ?? null;
      const judgeCount = assignmentCountByStationCode.get(stationCode) ?? 0;
      const passed = row?.totalPassed ?? 0;
      const expected = row?.totalExpected ?? 0;
      const missing = row?.totalMissing.length ?? 0;
      const hasCourseData = raceDashboardSummary.patrolsSeenOnCourse > 0;

      let status: AdminStationHealthCard['status'] = 'unknown';
      let statusLabel = 'Bez dat';
      if (row) {
        if (expected > 0 && passed === 0 && hasCourseData) {
          status = 'offline';
          statusLabel = 'Podezření offline';
        } else if (missing > 0) {
          status = 'warning';
          statusLabel = 'Vyžaduje kontrolu';
        } else if (passed > 0 || expected === 0) {
          status = 'online';
          statusLabel = 'Aktivní';
        } else {
          status = 'unknown';
          statusLabel = 'Bez průchodů';
        }
      }

      return {
        stationId: station.id,
        stationCode,
        stationName: normalizeText(station.name),
        status,
        statusLabel,
        judgeCount,
        queueLabel: 'TODO',
        lastPassageAt: row?.lastPassageAt ?? null,
        passed,
        expected,
        missing,
      };
    });
  }, [raceDashboardSummary.patrolsSeenOnCourse, selectedSetupAssignments, selectedSetupStations, stationRows]);

  useEffect(() => {
    setSetupEventScoringConfig(normalizeSetupEventScoringConfig(selectedSetupEvent));
    setSetupTroopDraft('');
  }, [selectedSetupEvent]);

  useEffect(() => {
    const order = setupOrders[selectedSetupEventId];
    const defaults = createDefaultOrderTextState();
    const nextOrderInputs = { ...defaults };
    STATION_PASSAGE_CATEGORIES.forEach((category) => {
      const list = order?.category_orders?.[category];
      if (Array.isArray(list) && list.length > 0) {
        nextOrderInputs[category] = list.join(', ');
      }
    });
    setOrderInputs(nextOrderInputs);

    const nextSeparators = createDefaultSeparatorState();
    STATION_PASSAGE_CATEGORIES.forEach((category) => {
      const separator = order?.separator_before_by_category?.[category];
      if (separator) {
        nextSeparators[category] = separator;
      }
    });
    setSeparatorInputs(nextSeparators);
  }, [selectedSetupEventId, setupOrders]);

  useEffect(() => {
    if (!selectedSetupStations.length) {
      setJudgeStationCodeInput('');
      return;
    }
    const currentCode = judgeStationCodeInput.trim().toUpperCase();
    if (currentCode && selectedSetupStations.some((station) => station.code === currentCode)) {
      return;
    }
    setJudgeStationCodeInput(selectedSetupStations[0].code);
  }, [judgeStationCodeInput, selectedSetupStations]);

  const navigateAdminPage = useCallback(
    (page: AdminPageKey, options?: { replace?: boolean }) => {
      setActiveAdminPage(page);
      if (typeof window === 'undefined') {
        return;
      }

      const nextPrefix = detectAdminRoutePrefix(window.location.pathname);
      setAdminRoutePrefix(nextPrefix);
      const targetPath = buildAdminRoutePath({
        prefix: nextPrefix || adminRoutePrefix,
        eventId,
        page,
      });
      const currentPath = window.location.pathname.replace(/\/$/, '') || '/';

      if (currentPath !== targetPath) {
        const method = options?.replace ? 'replaceState' : 'pushState';
        window.history[method](window.history.state, '', targetPath);
      }

      setPageTransitioning(true);
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'auto' });
        setPageTransitioning(false);
      });
    },
    [adminRoutePrefix, eventId],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePopState = () => {
      const parsed = parseAdminRoute(window.location.pathname);
      setAdminRoutePrefix(parsed.prefix);
      setActiveAdminPage(parsed.page);
      setPageTransitioning(false);
      window.scrollTo({ top: 0, behavior: 'auto' });
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!isCalcStation || typeof window === 'undefined') {
      return;
    }

    const parsed = parseAdminRoute(window.location.pathname);
    const prefix = parsed.prefix || adminRoutePrefix;
    const expectedPath = buildAdminRoutePath({
      prefix,
      eventId,
      page: activeAdminPage,
    });
    const currentPath = window.location.pathname.replace(/\/$/, '') || '/';

    if (currentPath !== expectedPath) {
      window.history.replaceState(window.history.state, '', expectedPath);
    }
    if (parsed.page !== activeAdminPage) {
      setActiveAdminPage(parsed.page);
    }
    if (prefix !== adminRoutePrefix) {
      setAdminRoutePrefix(prefix);
    }
  }, [activeAdminPage, adminRoutePrefix, eventId, isCalcStation]);

  useEffect(() => {
    if (activeAdminPage === 'statistics' && !showStatsSection) {
      setShowStatsSection(true);
    }
    if (activeAdminPage === 'settings' && !showExportsSection) {
      setShowExportsSection(true);
    }
  }, [activeAdminPage, showExportsSection, showStatsSection]);

  const handleLookupPatrol = useCallback(async () => {
    setDisqualifyError(null);
    setDisqualifySuccess(null);

    const variants = buildPatrolCodeVariants(disqualifyCode);
    if (!variants.length) {
      setDisqualifyTarget(null);
      setDisqualifyError('Zadej kód hlídky.');
      return;
    }

    setDisqualifyLoading(true);
    try {
      const { data, error } = await supabase
        .from('patrols')
        .select('id, patrol_code, team_name, category, sex, disqualified')
        .eq('event_id', eventId)
        .in('patrol_code', variants)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        setDisqualifyTarget(null);
        setDisqualifyError('Hlídka nebyla nalezena.');
        return;
      }

      setDisqualifyTarget({
        id: data.id,
        code: normalizeText(data.patrol_code).toUpperCase(),
        teamName: normalizeText(data.team_name),
        category: normalizeText(data.category).toUpperCase(),
        sex: normalizeText(data.sex).toUpperCase(),
        disqualified: !!data.disqualified,
      });
    } catch (error) {
      console.error('Failed to load patrol', error);
      setDisqualifyError('Nepodařilo se načíst hlídku.');
      setDisqualifyTarget(null);
    } finally {
      setDisqualifyLoading(false);
    }
  }, [disqualifyCode, eventId]);

  const handleDisqualifyPatrol = useCallback(async () => {
    setDisqualifyError(null);
    setDisqualifySuccess(null);

    if (!disqualifyTarget) {
      setDisqualifyError('Nejprve načti hlídku.');
      return;
    }
    if (disqualifyTarget.disqualified) {
      setDisqualifySuccess('Hlídka je už diskvalifikovaná.');
      return;
    }
    if (!API_BASE_URL) {
      setDisqualifyError('Chybí konfigurace API (VITE_AUTH_API_URL).');
      return;
    }
    if (!accessToken) {
      setDisqualifyError('Chybí přístupový token.');
      return;
    }

    const confirmed = window.confirm(`Opravdu diskvalifikovat hlídku ${disqualifyTarget.code}?`);
    if (!confirmed) {
      return;
    }

    setDisqualifySaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/admin/patrol-disqualify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ patrol_code: disqualifyTarget.code, disqualified: true }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error || 'Diskvalifikace se nepodařila.';
        throw new Error(message);
      }

      setDisqualifyTarget((prev) => (prev ? { ...prev, disqualified: true } : prev));
      setDisqualifySuccess(`Hlídka ${disqualifyTarget.code} byla diskvalifikována.`);
    } catch (error) {
      console.error('Failed to disqualify patrol', error);
      setDisqualifyError(
        error instanceof Error && error.message ? error.message : 'Diskvalifikace se nepodařila.',
      );
    } finally {
      setDisqualifySaving(false);
    }
  }, [accessToken, disqualifyTarget]);

  useEffect(() => {
    if (!isCalcStation) {
      return;
    }
    loadStationStats();
    loadEventState();
    loadSetupData();
  }, [isCalcStation, loadStationStats, loadEventState, loadSetupData]);

  useEffect(() => {
    if (!isCalcStation) {
      return;
    }
    loadAnswers();
  }, [isCalcStation, loadAnswers]);

  const handleSaveAnswers = useCallback(async () => {
    setAnswersError(null);
    setAnswersSuccess(null);

    const answersEventId = selectedSetupEventId || eventId;
    const targetStation = setupStations.find(
      (station) =>
        station.event_id === answersEventId &&
        normalizeText(station.code).toUpperCase() === 'T',
    );
    const answersStationId = targetStation?.id || (answersEventId === eventId ? stationId : '');
    if (!answersStationId) {
      setAnswersError(`Pro ročník "${selectedSetupEvent?.name ?? answersEventId}" chybí stanoviště T.`);
      return;
    }

    const updates: { event_id: string; station_id: string; category: string; correct_answers: string }[] = [];
    const deletions: string[] = [];

    for (const category of ANSWER_CATEGORIES) {
      const packed = packAnswersForStorage(answersForm[category], { maxOptionCount: answersTargetOptionCount });
      if (!packed) {
        if (answersSummary[category].letters.length) {
          deletions.push(category);
        }
        continue;
      }
      if (packed.length !== 12) {
        setAnswersError(`Kategorie ${category} musí mít 12 odpovědí.`);
        return;
      }
      updates.push({
        event_id: answersEventId,
        station_id: answersStationId,
        category,
        correct_answers: packed,
      });
    }

    setAnswersSaving(true);

    try {
      await postSetupAction('save_event_scoring_config', {
        event_id: answersEventId,
        target_answer_option_count: answersTargetOptionCount,
      });

      if (updates.length) {
        const { error } = await supabase
          .from('station_category_answers')
          .upsert(updates, { onConflict: 'event_id,station_id,category' });
        if (error) {
          throw error;
        }
      }

      if (deletions.length) {
        const { error } = await supabase
          .from('station_category_answers')
          .delete()
          .in('category', deletions)
          .eq('event_id', answersEventId)
          .eq('station_id', answersStationId);
        if (error) {
          throw error;
        }
      }

      setAnswersSuccess('Správné odpovědi a počet možností byly uloženy.');
      await loadAnswers();
      await loadSetupData();
    } catch (error) {
      console.error('Failed to save category answers', error);
      setAnswersError('Uložení správných odpovědí nebo nastavení možností selhalo.');
    } finally {
      setAnswersSaving(false);
    }
  }, [
    answersForm,
    answersSummary,
    eventId,
    loadAnswers,
    loadSetupData,
    postSetupAction,
    selectedSetupEvent,
    selectedSetupEventId,
    setupStations,
    stationId,
    answersTargetOptionCount,
  ]);

  const handleToggleLock = useCallback(
    async (locked: boolean) => {
      if (!API_BASE_URL) {
        setLockMessage('Chybí konfigurace API (VITE_AUTH_API_URL).');
        return;
      }
      if (!accessToken) {
        setLockMessage('Chybí přístupový token.');
        return;
      }

      setLockUpdating(true);
      setLockMessage(null);

      try {
        const response = await fetch(`${API_BASE_URL}/admin/event-state`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ locked }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const message = body?.error || 'Nepodařilo se aktualizovat stav závodu.';
          throw new Error(message);
        }

        setEventState((prev) => ({ ...prev, scoringLocked: locked }));
        setLockMessage(locked ? 'Závod byl ukončen.' : 'Zapisování bodů bylo znovu povoleno.');
        await refreshManifest();
      } catch (error) {
        console.error('Failed to update scoring lock', error);
        setLockMessage(
          error instanceof Error && error.message
            ? error.message
            : 'Nepodařilo se aktualizovat stav závodu.',
        );
      } finally {
        setLockUpdating(false);
      }
    },
    [accessToken, refreshManifest],
  );

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadAnswers(),
      loadStationStats(),
      loadEventState(),
      loadSetupData(),
      refreshManifest(),
    ]).catch((error) => {
      console.error('Admin refresh failed', error);
    });
    setRefreshing(false);
  }, [loadAnswers, loadStationStats, loadEventState, loadSetupData, refreshManifest]);

  const handleCreateEvent = useCallback(async () => {
    setSetupError(null);
    setSetupSuccess(null);
    setJudgeTemporaryPassword(null);

    if (!createEventName.trim()) {
      setSetupError('Název ročníku je povinný.');
      return;
    }

    setSetupSaving(true);
    try {
      const payload = await postSetupAction('create_event', {
        name: createEventName.trim(),
        starts_at: createEventStartsAt || null,
        ends_at: createEventEndsAt || null,
        copy_stations_from_event_id: copyStationsFromCurrentEvent ? eventId : null,
      });
      setSetupSuccess(`Ročník ${payload?.event?.name ?? createEventName.trim()} byl vytvořen.`);
      setCreateEventName('');
      setCreateEventStartsAt('');
      setCreateEventEndsAt('');
      await loadSetupData();
      const nextEventId = normalizeText(payload?.event?.id);
      if (nextEventId) {
        setSelectedSetupEventId(nextEventId);
      }
    } catch (error) {
      console.error('Failed to create event', error);
      setSetupError(error instanceof Error ? error.message : 'Vytvoření ročníku selhalo.');
    } finally {
      setSetupSaving(false);
    }
  }, [
    copyStationsFromCurrentEvent,
    createEventEndsAt,
    createEventName,
    createEventStartsAt,
    eventId,
    loadSetupData,
    postSetupAction,
  ]);

  const handleSaveStationOrder = useCallback(async () => {
    setSetupError(null);
    setSetupSuccess(null);
    setJudgeTemporaryPassword(null);

    if (!selectedSetupEventId) {
      setSetupError('Vyber ročník, pro který se má pořadí uložit.');
      return;
    }

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

    STATION_PASSAGE_CATEGORIES.forEach((category) => {
      const values = orderInputs[category]
        .split(/[^A-Za-z0-9]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);
      const dedup = Array.from(new Set(values));
      categoryOrders[category] = dedup;

      const separator = normalizeText(separatorInputs[category]).toUpperCase();
      if (separator) {
        separatorBeforeByCategory[category] = separator;
      }
    });

    setSetupSaving(true);
    try {
      await postSetupAction('save_station_order', {
        event_id: selectedSetupEventId,
        category_orders: categoryOrders,
        separator_before_by_category: separatorBeforeByCategory,
      });
      setSetupSuccess('Pořadí stanovišť bylo uloženo.');
      await loadSetupData();
    } catch (error) {
      console.error('Failed to save station order', error);
      setSetupError(error instanceof Error ? error.message : 'Uložení pořadí selhalo.');
    } finally {
      setSetupSaving(false);
    }
  }, [loadSetupData, orderInputs, postSetupAction, selectedSetupEventId, separatorInputs]);

  const handleSaveEventScoringConfig = useCallback(async () => {
    setSetupError(null);
    setSetupSuccess(null);
    setJudgeTemporaryPassword(null);

    if (!selectedSetupEventId) {
      setSetupError('Vyber ročník.');
      return;
    }

    setSetupSaving(true);
    try {
      await postSetupAction('save_event_scoring_config', {
        event_id: selectedSetupEventId,
        announced_places_nh: setupEventScoringConfig.announcedPlaces.NH,
        announced_places_nd: setupEventScoringConfig.announcedPlaces.ND,
        announced_places_mh: setupEventScoringConfig.announcedPlaces.MH,
        announced_places_md: setupEventScoringConfig.announcedPlaces.MD,
        announced_places_sh: setupEventScoringConfig.announcedPlaces.SH,
        announced_places_sd: setupEventScoringConfig.announcedPlaces.SD,
        announced_places_rh: setupEventScoringConfig.announcedPlaces.RH,
        announced_places_rd: setupEventScoringConfig.announcedPlaces.RD,
        time_limit_n_minutes: setupEventScoringConfig.timeLimitMinutes.N,
        time_limit_m_minutes: setupEventScoringConfig.timeLimitMinutes.M,
        time_limit_s_minutes: setupEventScoringConfig.timeLimitMinutes.S,
        time_limit_r_minutes: setupEventScoringConfig.timeLimitMinutes.R,
        time_penalty_step_minutes: setupEventScoringConfig.timePenaltyStepMinutes,
        target_answer_option_count: setupEventScoringConfig.targetAnswerOptionCount,
        participating_troops: setupEventScoringConfig.participatingTroops,
      });
      setSetupSuccess('Nastavení vyhlašovaných míst a času bylo uloženo.');
      await loadSetupData();
    } catch (error) {
      console.error('Failed to save event scoring config', error);
      setSetupError(error instanceof Error ? error.message : 'Uložení nastavení selhalo.');
    } finally {
      setSetupSaving(false);
    }
  }, [loadSetupData, postSetupAction, selectedSetupEventId, setupEventScoringConfig]);

  const handleToggleSetupTroop = useCallback((troopName: string) => {
    const normalized = normalizeTroopName(troopName);
    if (!normalized) {
      return;
    }
    setSetupEventScoringConfig((prev) => {
      const hasTroop = prev.participatingTroops.some(
        (item) => item.toLocaleLowerCase('cs') === normalized.toLocaleLowerCase('cs'),
      );
      const nextTroops = hasTroop
        ? prev.participatingTroops.filter(
            (item) => item.toLocaleLowerCase('cs') !== normalized.toLocaleLowerCase('cs'),
          )
        : [...prev.participatingTroops, normalized];
      return {
        ...prev,
        participatingTroops: normalizeTroopList(nextTroops),
      };
    });
  }, []);

  const handleAddSetupTroop = useCallback(() => {
    const normalized = normalizeTroopName(setupTroopDraft);
    if (!normalized) {
      return;
    }
    setSetupEventScoringConfig((prev) => ({
      ...prev,
      participatingTroops: normalizeTroopList([...prev.participatingTroops, normalized]),
    }));
    setSetupTroopDraft('');
  }, [setupTroopDraft]);

  const handleAssignJudgeToEvent = useCallback(async () => {
    setSetupError(null);
    setSetupSuccess(null);
    setJudgeTemporaryPassword(null);

    if (!selectedSetupEventId) {
      setSetupError('Vyber ročník.');
      return;
    }
    if (!judgeEmailInput.trim()) {
      setSetupError('E-mail rozhodčího je povinný.');
      return;
    }
    if (!judgeStationCodeInput.trim()) {
      setSetupError('Vyber stanoviště.');
      return;
    }

    const allowedCategories = (Object.entries(judgeCategoryToggle) as Array<[CategoryKey, boolean]>)
      .filter(([, enabled]) => enabled)
      .map(([category]) => category);
    if (allowedCategories.length === 0) {
      setSetupError('Vyber alespoň jednu kategorii.');
      return;
    }

    const allowedTasks = judgeTasksInput
      .split(/[,\n;]/)
      .map((item) => item.trim())
      .filter(Boolean);

    setSetupSaving(true);
    try {
      const result = await postSetupAction('assign_judge', {
        event_id: selectedSetupEventId,
        email: judgeEmailInput.trim(),
        display_name: judgeDisplayNameInput.trim(),
        station_code: judgeStationCodeInput.trim().toUpperCase(),
        allowed_categories: allowedCategories,
        allowed_tasks: allowedTasks,
      });
      if (result?.temporary_password) {
        setJudgeTemporaryPassword(String(result.temporary_password));
      } else {
        setJudgeTemporaryPassword(null);
      }
      setSetupSuccess(
        result?.created_judge
          ? `Rozhodčí byl vytvořen a přiřazen.`
          : `Rozhodčí byl přiřazen k vybranému ročníku.`,
      );
      await loadSetupData();
    } catch (error) {
      console.error('Failed to assign judge', error);
      setSetupError(error instanceof Error ? error.message : 'Přiřazení rozhodčího selhalo.');
    } finally {
      setSetupSaving(false);
    }
  }, [
    judgeCategoryToggle,
    judgeDisplayNameInput,
    judgeEmailInput,
    judgeStationCodeInput,
    judgeTasksInput,
    loadSetupData,
    postSetupAction,
    selectedSetupEventId,
  ]);

  const handleCreatePatrols = useCallback(async () => {
    setSetupError(null);
    setSetupSuccess(null);
    setJudgeTemporaryPassword(null);

    if (!selectedSetupEventId) {
      setSetupError('Vyber ročník.');
      return;
    }

    const total = STATION_PASSAGE_CATEGORIES.reduce((sum, category) => sum + Math.max(0, patrolCounts[category] ?? 0), 0);
    if (total <= 0) {
      setSetupError('Zadej počty hlídek alespoň pro jednu kategorii.');
      return;
    }

    setSetupSaving(true);
    try {
      const result = await postSetupAction('create_patrols', {
        event_id: selectedSetupEventId,
        counts: patrolCounts,
        start_numbers: patrolStarts,
      });
      setSetupSuccess(`Vytvořeno hlídek: ${Number(result?.created ?? 0)}.`);
      await loadSetupData();
    } catch (error) {
      console.error('Failed to create patrols', error);
      setSetupError(error instanceof Error ? error.message : 'Vytvoření hlídek selhalo.');
    } finally {
      setSetupSaving(false);
    }
  }, [loadSetupData, patrolCounts, patrolStarts, postSetupAction, selectedSetupEventId]);

  const handleClearEventPoints = useCallback(async () => {
    setSetupError(null);
    setSetupSuccess(null);
    setJudgeTemporaryPassword(null);

    if (!selectedSetupEventId) {
      setSetupError('Vyber ročník.');
      return;
    }

    const confirmed = window.confirm(
      `Opravdu smazat všechny body a průchody pro ročník "${selectedSetupEvent?.name ?? selectedSetupEventId}"?`,
    );
    if (!confirmed) {
      return;
    }

    setSetupSaving(true);
    try {
      await postSetupAction('clear_event_points', { event_id: selectedSetupEventId });
      setSetupSuccess('Body, průchody, čekání a terčové odpovědi byly smazány.');
    } catch (error) {
      console.error('Failed to clear event points', error);
      setSetupError(error instanceof Error ? error.message : 'Smazání bodů selhalo.');
    } finally {
      setSetupSaving(false);
    }
  }, [postSetupAction, selectedSetupEvent, selectedSetupEventId]);

  const handleCleanupIncompletePatrols = useCallback(async () => {
    setSetupError(null);
    setSetupSuccess(null);
    setJudgeTemporaryPassword(null);

    if (!selectedSetupEventId) {
      setSetupError('Vyber ročník.');
      return;
    }

    const confirmed = window.confirm(
      `Opravdu smazat hlídky bez vyplněného jména a příjmení člena v ročníku "${selectedSetupEvent?.name ?? selectedSetupEventId}"?`,
    );
    if (!confirmed) {
      return;
    }

    setSetupSaving(true);
    try {
      const result = await postSetupAction('cleanup_incomplete_patrols', { event_id: selectedSetupEventId });
      const deleted = Number(result?.deleted ?? 0);
      const skipped = Number(result?.skipped ?? 0);
      setSetupSuccess(`Smazáno hlídek: ${deleted}. Přeskočeno (už s body/průchody): ${skipped}.`);
      await loadSetupData();
    } catch (error) {
      console.error('Failed to cleanup incomplete patrols', error);
      setSetupError(error instanceof Error ? error.message : 'Mazání nevyplněných hlídek selhalo.');
    } finally {
      setSetupSaving(false);
    }
  }, [loadSetupData, postSetupAction, selectedSetupEvent, selectedSetupEventId]);

  const handleExportNameCheck = useCallback(async () => {
    if (exportingNames) {
      return;
    }

    setExportingNames(true);
    try {
      type PatrolNameCheckRow = {
        patrol_code: string | null;
        team_name: string | null;
        category: string | null;
        sex: string | null;
        patrol_members: string | null;
        note: string | null;
        active: boolean | null;
      };

      const { data, error } = await supabase
        .from('patrols')
        .select('patrol_code, team_name, category, sex, patrol_members, note, active')
        .eq('event_id', eventId)
        .eq('active', true);

      if (error) {
        throw error;
      }

      const rows = ((data ?? []) as PatrolNameCheckRow[]).filter((row) => row.active !== false);
      rows.sort(comparePatrolOrder);

      const troopNamesByNumber = new Map<number, Set<string>>();
      rows.forEach((row) => {
        splitMixedTroopNames(row.team_name).forEach((troopName) => {
          const troopNumber = parseTroopNumber(troopName);
          if (troopNumber === null) {
            return;
          }
          if (!troopNamesByNumber.has(troopNumber)) {
            troopNamesByNumber.set(troopNumber, new Set<string>());
          }
          troopNamesByNumber.get(troopNumber)!.add(troopName);
        });
      });

      const canonicalTroopNameByNumber = new Map<number, string>();
      troopNamesByNumber.forEach((nameSet, troopNumber) => {
        canonicalTroopNameByNumber.set(troopNumber, pickCanonicalTroopName(troopNumber, Array.from(nameSet)));
      });

      const byTroop = new Map<string, PatrolNameCheckRow[]>();
      rows.forEach((row) => {
        const canonicalTroops = splitMixedTroopNames(row.team_name).map((troopName) => {
          const troopNumber = parseTroopNumber(troopName);
          if (troopNumber === null) {
            return troopName;
          }
          return canonicalTroopNameByNumber.get(troopNumber) ?? `${troopNumber}. PTO`;
        });
        const seenTroops = new Set<string>();
        canonicalTroops.forEach((troopName) => {
          const key = troopName.toLocaleLowerCase('cs');
          if (seenTroops.has(key)) {
            return;
          }
          seenTroops.add(key);
          if (!byTroop.has(troopName)) {
            byTroop.set(troopName, []);
          }
          byTroop.get(troopName)!.push(row);
        });
      });

      const workbook = new ExcelJS.Workbook();
      const usedSheetNames = new Set<string>();
      const sortedTroops = Array.from(byTroop.entries()).sort((a, b) => compareTroopSheetOrder(a[0], b[0]));

      if (sortedTroops.length === 0) {
        const worksheet = workbook.addWorksheet('Kontrola jmen');
        worksheet.addRow(['Žádná hlídka pro export']);
      }

      sortedTroops.forEach(([troopName, patrols]) => {
        const baseSheetName = toWorksheetBaseName(troopName, 'Bez oddílu');
        const sheetName = toUniqueWorksheetName(baseSheetName, usedSheetNames);
        const worksheet = workbook.addWorksheet(sheetName);
        patrols.sort(comparePatrolOrder);
        const memberLists = patrols.map((patrol) => extractPatrolMembers(patrol.patrol_members ?? patrol.note));
        const memberColumnCount = Math.max(
          1,
          memberLists.reduce((max, members) => Math.max(max, members.length), 0),
        );
        const memberHeaders = Array.from({ length: memberColumnCount }, (_, index) => `Člen ${index + 1}`);
        worksheet.addRow(['Číslo hlídky', ...memberHeaders]);
        patrols.forEach((patrol, index) => {
          const code = parsePatrolCodeParts(patrol.patrol_code).normalizedCode || '—';
          const members = memberLists[index];
          const memberCells = Array.from({ length: memberColumnCount }, (_, memberIndex) => members[memberIndex] || '—');
          worksheet.addRow([code, ...memberCells]);
        });
        worksheet.columns = [{ width: 16 }, ...Array.from({ length: memberColumnCount }, () => ({ width: 28 }))];
      });

      await downloadWorkbook(workbook, toExportFileName(eventState.name, 'kontrola-jmen'));
    } catch (error) {
      console.error('Failed to export name check workbook', error);
      window.alert('Export kontroly jmen selhal.');
    } finally {
      setExportingNames(false);
    }
  }, [eventId, eventState.name, exportingNames]);

  const handleExportLeaguePoints = useCallback(async () => {
    if (exportingLeague) {
      return;
    }

    setExportingLeague(true);
    try {
      type LeagueExportRow = {
        patrol_code: string | null;
        team_name: string | null;
        category: string | null;
        sex: string | null;
        disqualified: boolean | null;
        rank_in_bracket: number | string | null;
        total_points: number | string | null;
        points_no_t?: number | string | null;
        points_no_T?: number | string | null;
        pure_seconds?: number | string | null;
      };
      type LeagueExportScoredRow = LeagueExportRow & {
        bracketKey: string;
        rankNumeric: number | null;
        disqualifiedFlag: boolean;
        droppedFlag: boolean;
        zlGroupKey: string;
        zlPointsNoCutoff: number;
        zlPointsWithCutoff: number;
        zlPointsGaussWithCutoff: number;
        zlPointsGaussOpenCutoff: number;
        cutoffDropped: boolean;
        gaussCutoffDropped: boolean;
        gaussOpenCutoffDropped: boolean;
      };

      const { data, error } = await supabase
        .from('results_ranked')
        .select('patrol_code, team_name, category, sex, disqualified, rank_in_bracket, total_points, points_no_t, pure_seconds')
        .eq('event_id', eventId);

      if (error) {
        throw error;
      }

      const rows = (data ?? []) as LeagueExportRow[];
      const scoredRows: LeagueExportScoredRow[] = rows
        .map((row) => {
          const bracketKey = toBracketKey(row.category, row.sex);
          if (!bracketKey) {
            return null;
          }
          const disqualifiedFlag = row.disqualified === true;
          const totalPoints = toNumeric(row.total_points);
          const pointsNoT = toNumeric(row.points_no_t ?? row.points_no_T ?? null);
          return {
            ...row,
            bracketKey,
            rankNumeric: toNumeric(row.rank_in_bracket),
            disqualifiedFlag,
            droppedFlag: !disqualifiedFlag && totalPoints === null && pointsNoT === null,
            zlGroupKey: bracketKey,
            zlPointsNoCutoff: 0,
            zlPointsWithCutoff: 0,
            zlPointsGaussWithCutoff: 0,
            zlPointsGaussOpenCutoff: 0,
            cutoffDropped: false,
            gaussCutoffDropped: false,
            gaussOpenCutoffDropped: false,
          };
        })
        .filter((row): row is LeagueExportScoredRow => Boolean(row));

      const compareLeagueByPerformance = (a: LeagueExportScoredRow, b: LeagueExportScoredRow) => {
        const aTotal = toNumeric(a.total_points) ?? Number.NEGATIVE_INFINITY;
        const bTotal = toNumeric(b.total_points) ?? Number.NEGATIVE_INFINITY;
        if (aTotal !== bTotal) {
          return bTotal - aTotal;
        }
        const aNoTime = toNumeric(a.points_no_t ?? a.points_no_T ?? null) ?? Number.NEGATIVE_INFINITY;
        const bNoTime = toNumeric(b.points_no_t ?? b.points_no_T ?? null) ?? Number.NEGATIVE_INFINITY;
        if (aNoTime !== bNoTime) {
          return bNoTime - aNoTime;
        }
        const aPureSeconds = toNumeric(a.pure_seconds);
        const bPureSeconds = toNumeric(b.pure_seconds);
        if (aPureSeconds !== null && bPureSeconds !== null && aPureSeconds !== bPureSeconds) {
          return aPureSeconds - bPureSeconds;
        }
        if (aPureSeconds === null && bPureSeconds !== null) {
          return 1;
        }
        if (aPureSeconds !== null && bPureSeconds === null) {
          return -1;
        }
        return comparePatrolOrder(a, b);
      };

      const compareLeagueForExport = (a: LeagueExportScoredRow, b: LeagueExportScoredRow) => {
        if (a.disqualifiedFlag && b.disqualifiedFlag) {
          return comparePatrolOrder(a, b);
        }
        if (a.disqualifiedFlag !== b.disqualifiedFlag) {
          return a.disqualifiedFlag ? 1 : -1;
        }
        return compareLeagueByPerformance(a, b);
      };

      const mergeByCategory = new Map<string, boolean>();
      ['N', 'M', 'S', 'R'].forEach((category) => {
        const boysKey = `${category}H`;
        const girlsKey = `${category}D`;
        const boysCount = scoredRows.filter(
          (row) => row.bracketKey === boysKey && !row.disqualifiedFlag && !row.droppedFlag,
        ).length;
        const girlsCount = scoredRows.filter(
          (row) => row.bracketKey === girlsKey && !row.disqualifiedFlag && !row.droppedFlag,
        ).length;
        const totalCount = boysCount + girlsCount;
        const allowAutoMerge = category !== 'S';
        mergeByCategory.set(category, allowAutoMerge && totalCount > 0 && (boysCount < 7 || girlsCount < 7));
      });

      scoredRows.forEach((row) => {
        const category = row.bracketKey.slice(0, 1);
        if (mergeByCategory.get(category)) {
          row.zlGroupKey = `${category}*`;
        }
      });

      const scoringPools = new Map<string, LeagueExportScoredRow[]>();
      scoredRows.forEach((row) => {
        if (row.disqualifiedFlag || row.droppedFlag) {
          return;
        }
        if (!scoringPools.has(row.zlGroupKey)) {
          scoringPools.set(row.zlGroupKey, []);
        }
        scoringPools.get(row.zlGroupKey)!.push(row);
      });

      type AutomaticCutoffCandidate = {
        index: number;
        gap: number;
        weighted: number;
        cutoffIndex: number;
      };

      const collectAutomaticCutoffCandidates = (pool: LeagueExportScoredRow[]) => {
        if (pool.length < 5) {
          return [] as AutomaticCutoffCandidate[];
        }

        const totals = pool.map((row) => toNumeric(row.total_points));
        const baseCandidates: Array<{ index: number; gap: number; weighted: number }> = [];
        const startIndex = Math.floor((pool.length - 1) / 2);
        for (let index = startIndex; index < pool.length - 1; index += 1) {
          const currentTotal = totals[index];
          const nextTotal = totals[index + 1];
          if (currentTotal === null || nextTotal === null) {
            continue;
          }
          const gap = currentTotal - nextTotal;
          if (gap <= 0) {
            continue;
          }
          const tailCount = pool.length - (index + 1);
          const weighted = gap * Math.log(tailCount + 1.5);
          baseCandidates.push({ index, gap, weighted });
        }
        if (!baseCandidates.length) {
          return [] as AutomaticCutoffCandidate[];
        }

        const sortedGaps = baseCandidates.map((candidate) => candidate.gap).sort((a, b) => a - b);
        const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 0;
        const minRequiredGap = Math.max(9, medianGap * 2);

        const selectedCandidates = baseCandidates
          .filter((candidate) => candidate.gap > minRequiredGap)
          .map((candidate) => {
            let cutoffIndex = candidate.index + 1;
            while (cutoffIndex < pool.length) {
              const previousTotal = totals[cutoffIndex - 1];
              const currentTotal = totals[cutoffIndex];
              if (previousTotal === null || currentTotal === null || previousTotal !== currentTotal) {
                break;
              }
              cutoffIndex += 1;
            }
            return {
              ...candidate,
              cutoffIndex,
            };
          })
          .filter((candidate) => candidate.cutoffIndex < pool.length && candidate.cutoffIndex >= 3)
          .sort((a, b) => b.weighted - a.weighted || b.gap - a.gap || a.index - b.index);

        return selectedCandidates;
      };

      const findAutomaticCutoffIndex = (pool: LeagueExportScoredRow[]) => {
        const candidates = collectAutomaticCutoffCandidates(pool);
        return candidates.length ? candidates[0].cutoffIndex : null;
      };

      const collectGaussOpenCutoffCandidates = (pool: LeagueExportScoredRow[]) => {
        if (pool.length < 5) {
          return [] as AutomaticCutoffCandidate[];
        }

        const totals = pool.map((row) => toNumeric(row.total_points));
        const startIndex = Math.floor((pool.length - 1) / 2);
        const selectedCandidates: AutomaticCutoffCandidate[] = [];
        for (let index = startIndex; index < pool.length - 1; index += 1) {
          const currentTotal = totals[index];
          const nextTotal = totals[index + 1];
          if (currentTotal === null || nextTotal === null) {
            continue;
          }
          const gap = currentTotal - nextTotal;
          if (gap <= 0) {
            continue;
          }
          const tailCount = pool.length - (index + 1);
          const weighted = gap * Math.log(tailCount + 1.5);
          let cutoffIndex = index + 1;
          while (cutoffIndex < pool.length) {
            const previousTotal = totals[cutoffIndex - 1];
            const currentAtCutoff = totals[cutoffIndex];
            if (
              previousTotal === null
              || currentAtCutoff === null
              || previousTotal !== currentAtCutoff
            ) {
              break;
            }
            cutoffIndex += 1;
          }
          if (cutoffIndex >= pool.length || cutoffIndex < 3) {
            continue;
          }
          selectedCandidates.push({
            index,
            gap,
            weighted,
            cutoffIndex,
          });
        }
        return selectedCandidates.sort((a, b) => b.weighted - a.weighted || b.gap - a.gap || a.index - b.index);
      };

      const assignBandPoints = (
        pool: LeagueExportScoredRow[],
        applyPoints: (row: LeagueExportScoredRow, points: number) => void,
      ) => {
        const rowsWithTotals = pool.filter((row) => toNumeric(row.total_points) !== null);
        const bestTotal = rowsWithTotals.length ? toNumeric(rowsWithTotals[0].total_points) : null;
        const worstTotal = rowsWithTotals.length
          ? toNumeric(rowsWithTotals[rowsWithTotals.length - 1].total_points)
          : null;
        const step = bestTotal !== null && worstTotal !== null ? (bestTotal - worstTotal) / 7 : null;
        const epsilon = 1e-9;

        pool.forEach((row) => {
          const total = toNumeric(row.total_points);
          let band = 7;
          if (total !== null && bestTotal !== null && step !== null) {
            if (step <= epsilon) {
              band = 1;
            } else {
              const distanceFromBest = bestTotal - total;
              for (let candidateBand = 1; candidateBand <= 6; candidateBand += 1) {
                if (distanceFromBest <= step * candidateBand + epsilon) {
                  band = candidateBand;
                  break;
                }
              }
            }
          }
          const points = ZL_BAND_POINTS[Math.max(0, Math.min(ZL_BAND_POINTS.length - 1, band - 1))];
          applyPoints(row, points);
        });
      };

      const gaussTargetShares = (() => {
        const weights = ZL_BAND_POINTS.map((_, index) => {
          const distance = index - ZL_GAUSS_CENTER_INDEX;
          return Math.exp(-(distance * distance) / (2 * ZL_GAUSS_SIGMA * ZL_GAUSS_SIGMA));
        });
        const weightSum = weights.reduce((sum, value) => sum + value, 0) || 1;
        return weights.map((value) => value / weightSum);
      })();

      const evaluateGaussCutoff = (pool: LeagueExportScoredRow[], cutoffIndex: number | null) => {
        const evaluatedPool = cutoffIndex === null ? pool : pool.slice(0, cutoffIndex);
        if (!evaluatedPool.length) {
          return {
            totalScore: Number.POSITIVE_INFINITY,
            distributionError: Number.POSITIVE_INFINITY,
            ratioPenalty: Number.POSITIVE_INFINITY,
            droppedPenalty: Number.POSITIVE_INFINITY,
          };
        }

        const pointsByRow = new Map<LeagueExportScoredRow, number>();
        assignBandPoints(evaluatedPool, (row, points) => {
          pointsByRow.set(row, points);
        });

        const bandCounts = ZL_BAND_POINTS.map(() => 0);
        evaluatedPool.forEach((row) => {
          const points = pointsByRow.get(row) ?? 1;
          const bandIndex = ZL_BAND_POINTS.findIndex((value) => value === points);
          const safeIndex = bandIndex >= 0 ? bandIndex : ZL_BAND_POINTS.length - 1;
          bandCounts[safeIndex] += 1;
        });

        const distributionError = bandCounts.reduce((sum, count, index) => {
          const actualShare = count / evaluatedPool.length;
          const delta = actualShare - gaussTargetShares[index];
          return sum + delta * delta;
        }, 0);

        const bestTotal = toNumeric(evaluatedPool[0].total_points);
        const worstTotal = toNumeric(evaluatedPool[evaluatedPool.length - 1].total_points);
        const ratioPenalty = bestTotal !== null && worstTotal !== null && bestTotal > 0
          ? Math.max(0, 1 - Math.max(0, Math.min(1, worstTotal / bestTotal)))
          : 0;

        const droppedCount = cutoffIndex === null ? 0 : Math.max(0, pool.length - cutoffIndex);
        const droppedPenalty = pool.length ? droppedCount / pool.length : 0;

        const totalScore = distributionError
          + ratioPenalty * ZL_GAUSS_RATIO_PENALTY_WEIGHT
          + droppedPenalty * ZL_GAUSS_DROPPED_PENALTY_WEIGHT;

        return {
          totalScore,
          distributionError,
          ratioPenalty,
          droppedPenalty,
        };
      };

      const pickBestGaussCutoffIndex = (pool: LeagueExportScoredRow[], candidateCutoffIndices: number[]) => {
        let bestCutoffIndex: number | null = null;
        let bestEvaluation = evaluateGaussCutoff(pool, null);

        candidateCutoffIndices.forEach((candidateCutoffIndex) => {
          const candidateEvaluation = evaluateGaussCutoff(pool, candidateCutoffIndex);
          const hasBetterScore = candidateEvaluation.totalScore < bestEvaluation.totalScore - 1e-9;
          const hasEqualScore = Math.abs(candidateEvaluation.totalScore - bestEvaluation.totalScore) <= 1e-9;
          const winsByTieBreak = hasEqualScore && (
            candidateEvaluation.distributionError < bestEvaluation.distributionError - 1e-9
            || (
              Math.abs(candidateEvaluation.distributionError - bestEvaluation.distributionError) <= 1e-9
              && (
                candidateEvaluation.ratioPenalty < bestEvaluation.ratioPenalty - 1e-9
                || (
                  Math.abs(candidateEvaluation.ratioPenalty - bestEvaluation.ratioPenalty) <= 1e-9
                  && candidateEvaluation.droppedPenalty < bestEvaluation.droppedPenalty - 1e-9
                )
              )
            )
          );

          if (hasBetterScore || winsByTieBreak) {
            bestEvaluation = candidateEvaluation;
            bestCutoffIndex = candidateCutoffIndex;
          }
        });

        return bestCutoffIndex;
      };

      scoringPools.forEach((pool) => {
        pool.sort(compareLeagueByPerformance);
        pool.forEach((row) => {
          row.cutoffDropped = false;
          row.gaussCutoffDropped = false;
          row.gaussOpenCutoffDropped = false;
        });
        assignBandPoints(pool, (row, points) => {
          row.zlPointsNoCutoff = points;
          row.zlPointsWithCutoff = points;
        });

        const cutoffIndex = findAutomaticCutoffIndex(pool);
        if (cutoffIndex !== null) {
          const nonCutoffPool = pool.slice(0, cutoffIndex);
          assignBandPoints(nonCutoffPool, (row, points) => {
            row.zlPointsWithCutoff = points;
            row.cutoffDropped = false;
          });
          for (let index = cutoffIndex; index < pool.length; index += 1) {
            const row = pool[index];
            row.zlPointsWithCutoff = 1;
            row.cutoffDropped = true;
          }
        }

        const gaussCutoffCandidates: number[] = Array.from(
          new Set<number>(collectAutomaticCutoffCandidates(pool).map((candidate) => candidate.cutoffIndex)),
        ).sort((a, b) => a - b);
        const bestGaussCutoffIndex: number | null = pickBestGaussCutoffIndex(pool, gaussCutoffCandidates);

        const gaussScoredPool = bestGaussCutoffIndex === null ? pool : pool.slice(0, bestGaussCutoffIndex);
        assignBandPoints(gaussScoredPool, (row, points) => {
          row.zlPointsGaussWithCutoff = points;
          row.gaussCutoffDropped = false;
        });
        const gaussCutoffStartIndex = bestGaussCutoffIndex ?? pool.length;
        if (gaussCutoffStartIndex < pool.length) {
          for (let index = gaussCutoffStartIndex; index < pool.length; index += 1) {
            const row = pool[index];
            row.zlPointsGaussWithCutoff = 1;
            row.gaussCutoffDropped = true;
          }
        }

        const gaussOpenCutoffCandidates: number[] = Array.from(
          new Set<number>(collectGaussOpenCutoffCandidates(pool).map((candidate) => candidate.cutoffIndex)),
        ).sort((a, b) => a - b);
        const bestGaussOpenCutoffIndex: number | null = pickBestGaussCutoffIndex(pool, gaussOpenCutoffCandidates);

        const gaussOpenScoredPool = bestGaussOpenCutoffIndex === null ? pool : pool.slice(0, bestGaussOpenCutoffIndex);
        assignBandPoints(gaussOpenScoredPool, (row, points) => {
          row.zlPointsGaussOpenCutoff = points;
          row.gaussOpenCutoffDropped = false;
        });
        const gaussOpenCutoffStartIndex = bestGaussOpenCutoffIndex ?? pool.length;
        if (gaussOpenCutoffStartIndex < pool.length) {
          for (let index = gaussOpenCutoffStartIndex; index < pool.length; index += 1) {
            const row = pool[index];
            row.zlPointsGaussOpenCutoff = 1;
            row.gaussOpenCutoffDropped = true;
          }
        }
      });

      scoredRows.forEach((row) => {
        if (row.disqualifiedFlag) {
          row.zlPointsNoCutoff = 0;
          row.zlPointsWithCutoff = 0;
          row.zlPointsGaussWithCutoff = 0;
          row.zlPointsGaussOpenCutoff = 0;
          row.cutoffDropped = false;
          row.gaussCutoffDropped = false;
          row.gaussOpenCutoffDropped = false;
          return;
        }
        if (row.droppedFlag) {
          row.zlPointsNoCutoff = 1;
          row.zlPointsWithCutoff = 1;
          row.zlPointsGaussWithCutoff = 1;
          row.zlPointsGaussOpenCutoff = 1;
          row.cutoffDropped = true;
          row.gaussCutoffDropped = true;
          row.gaussOpenCutoffDropped = true;
          return;
        }
        if (row.zlPointsNoCutoff <= 0) {
          row.zlPointsNoCutoff = 1;
        }
        if (row.zlPointsWithCutoff <= 0) {
          row.zlPointsWithCutoff = row.zlPointsNoCutoff;
        }
        if (row.zlPointsGaussWithCutoff <= 0) {
          row.zlPointsGaussWithCutoff = row.zlPointsWithCutoff;
        }
        if (row.zlPointsGaussOpenCutoff <= 0) {
          row.zlPointsGaussOpenCutoff = row.zlPointsGaussWithCutoff;
        }
        if (row.gaussCutoffDropped !== true) {
          row.gaussCutoffDropped = false;
        }
        if (row.gaussOpenCutoffDropped !== true) {
          row.gaussOpenCutoffDropped = false;
        }
      });

      const groupedByBracket = new Map<string, LeagueExportScoredRow[]>();
      BRACKET_EXPORT_ORDER.forEach((key) => groupedByBracket.set(key, []));
      const groupedByMergedCategory = new Map<string, LeagueExportScoredRow[]>();

      scoredRows.forEach((row) => {
        const category = row.bracketKey.slice(0, 1);
        const mergedCategoryEnabled = mergeByCategory.get(category);
        if (mergedCategoryEnabled) {
          if (!groupedByMergedCategory.has(category)) {
            groupedByMergedCategory.set(category, []);
          }
          groupedByMergedCategory.get(category)!.push(row);
          return;
        }
        groupedByBracket.get(row.bracketKey)?.push(row);
      });

      groupedByBracket.forEach((items) => {
        items.sort(compareLeagueForExport);
      });
      groupedByMergedCategory.forEach((items) => {
        items.sort(compareLeagueForExport);
      });

      const exportSheets: Array<{ name: string; rows: LeagueExportScoredRow[] }> = [];
      (['N', 'M', 'S', 'R'] as const).forEach((category) => {
        const boysKey = `${category}H`;
        const girlsKey = `${category}D`;
        const mergedCategoryEnabled = mergeByCategory.get(category) === true;
        const includeSplitSheets = !mergedCategoryEnabled;

        if (includeSplitSheets) {
          exportSheets.push({ name: boysKey, rows: groupedByBracket.get(boysKey) ?? [] });
          exportSheets.push({ name: girlsKey, rows: groupedByBracket.get(girlsKey) ?? [] });
        }

        if (mergedCategoryEnabled) {
          exportSheets.push({
            name: category,
            rows: groupedByMergedCategory.get(category) ?? [],
          });
        }
      });

      const workbook = new ExcelJS.Workbook();
      exportSheets.forEach(({ name, rows }) => {
        const worksheet = workbook.addWorksheet(name);
        worksheet.addRow([
          'Pořadí',
          'Číslo hlídky',
          'Body celkem',
          'Body ZL bez cut-off',
          'Body ZL s cut-off',
          'Body ZL gauss s cut-off',
          'Body ZL gauss otevřený cut-off',
        ]);
        if (rows.length === 0) {
          worksheet.addRow(['—', '—', '', '', '', '', '']);
        } else {
          rows.forEach((row, index) => {
            const displayRank = name.length === 1
              ? (row.disqualifiedFlag ? 'DSQ' : String(index + 1))
              : (row.disqualifiedFlag ? 'DSQ' : (toNumeric(row.rank_in_bracket) ?? ''));
            const worksheetRow = worksheet.addRow([
              displayRank,
              parsePatrolCodeParts(row.patrol_code).normalizedCode || '—',
              toNumeric(row.total_points) ?? '',
              row.zlPointsNoCutoff,
              row.zlPointsWithCutoff,
              row.zlPointsGaussWithCutoff,
              row.zlPointsGaussOpenCutoff,
            ]);
            if (!row.disqualifiedFlag && !row.droppedFlag) {
              const noCutoffCell = worksheetRow.getCell(4);
              noCutoffCell.font = {
                ...(noCutoffCell.font ?? {}),
                bold: true,
              };
            }
            if (!row.disqualifiedFlag && !row.cutoffDropped) {
              const withCutoffCell = worksheetRow.getCell(5);
              withCutoffCell.font = {
                ...(withCutoffCell.font ?? {}),
                bold: true,
              };
            }
            if (!row.disqualifiedFlag && !row.gaussCutoffDropped) {
              const gaussWithCutoffCell = worksheetRow.getCell(6);
              gaussWithCutoffCell.font = {
                ...(gaussWithCutoffCell.font ?? {}),
                bold: true,
              };
            }
            if (!row.disqualifiedFlag && !row.gaussOpenCutoffDropped) {
              const gaussOpenCutoffCell = worksheetRow.getCell(7);
              gaussOpenCutoffCell.font = {
                ...(gaussOpenCutoffCell.font ?? {}),
                bold: true,
              };
            }
          });
          const cutoffStartIndex = rows.findIndex((row) => row.cutoffDropped && !row.disqualifiedFlag);
          if (cutoffStartIndex > 0) {
            const cutoffRow = worksheet.getRow(cutoffStartIndex + 2);
            [4, 5].forEach((column) => {
              const cell = cutoffRow.getCell(column);
              cell.border = {
                ...cell.border,
                top: { style: 'thick', color: { argb: 'FFE53935' } },
              };
            });
          }
          const gaussCutoffStartIndex = rows.findIndex((row) => row.gaussCutoffDropped && !row.disqualifiedFlag);
          if (gaussCutoffStartIndex > 0) {
            const gaussCutoffRow = worksheet.getRow(gaussCutoffStartIndex + 2);
            const cell = gaussCutoffRow.getCell(6);
            cell.border = {
              ...cell.border,
              top: { style: 'thick', color: { argb: 'FFE53935' } },
            };
          }
          const gaussOpenCutoffStartIndex = rows.findIndex(
            (row) => row.gaussOpenCutoffDropped && !row.disqualifiedFlag,
          );
          if (gaussOpenCutoffStartIndex > 0) {
            const gaussOpenCutoffRow = worksheet.getRow(gaussOpenCutoffStartIndex + 2);
            const cell = gaussOpenCutoffRow.getCell(7);
            cell.border = {
              ...cell.border,
              top: { style: 'thick', color: { argb: 'FFE53935' } },
            };
          }
        }
        worksheet.columns = [
          { width: 10 },
          { width: 16 },
          { width: 14 },
          { width: 18 },
          { width: 16 },
          { width: 22 },
          { width: 27 },
        ];
        // Keep patrol code for reliable import mapping, but hide it in exported sheets.
        worksheet.getColumn(2).hidden = true;
      });

      await downloadWorkbook(workbook, toExportFileName(eventState.name, 'body-zelena-liga'));
    } catch (error) {
      console.error('Failed to export league points workbook', error);
      window.alert('Export bodů pro Zelenou ligu selhal.');
    } finally {
      setExportingLeague(false);
    }
  }, [eventId, eventState.name, exportingLeague]);

  const handleLeagueImportFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const [selectedFile] = Array.from(event.target.files ?? []);
    setLeagueImportFile(selectedFile ?? null);
    setLeagueImportError(null);
    setLeagueImportSuccess(null);
  }, []);

  const handleBuildResultsWithLeaguePoints = useCallback(async () => {
    if (!leagueImportFile || processingLeagueImport) {
      return;
    }

    setProcessingLeagueImport(true);
    setLeagueImportError(null);
    setLeagueImportSuccess(null);

    try {
      type ImportedLeagueSourceRow = {
        patrol_id: string;
        patrol_code: string | null;
        team_name: string | null;
        category: string | null;
        sex: string | null;
        patrol_members: string | null;
        disqualified: boolean | null;
        rank_in_bracket: number | string | null;
        total_points: number | string | null;
        points_no_t?: number | string | null;
        points_no_T?: number | string | null;
        pure_seconds?: number | string | null;
        start_time?: string | null;
        finish_time?: string | null;
        total_seconds?: number | string | null;
        wait_seconds?: number | string | null;
        station_points_breakdown?: Record<string, unknown> | null;
      };

      type ScoredExportRow = {
        patrolId: string;
        patrolCode: string;
        teamName: string;
        category: string;
        sex: string;
        bracketKey: string;
        disqualified: boolean;
        rankInBracket: number | null;
        totalPoints: number | null;
        pointsNoTime: number | null;
        pureSeconds: number | null;
        startTime: string | null;
        finishTime: string | null;
        totalSeconds: number | null;
        waitSeconds: number | null;
        stationPointsBreakdown: Record<string, number>;
        members: string[];
        zlPoints: number;
      };

      type TroopContribution = {
        patrolCode: string;
        points: number;
        sourcePoints: number;
      };

      const importWorkbook = new ExcelJS.Workbook();
      await importWorkbook.xlsx.load(await leagueImportFile.arrayBuffer());

      const importedPointsByPatrol = new Map<string, number>();
      const mergedCategorySheets = new Set<string>();
      const duplicateCodeConflicts: string[] = [];
      const unsupportedSheets: string[] = [];

      importWorkbook.worksheets.forEach((worksheet) => {
        const sheetKey = normalizeSheetNameKey(worksheet.name);
        if (!sheetKey) {
          unsupportedSheets.push(worksheet.name);
          return;
        }

        if (sheetKey.length === 1) {
          mergedCategorySheets.add(sheetKey);
        }

        const headerRow = worksheet.getRow(1);
        const headerByColumn = new Map<number, string>();
        headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
          const rawHeader = excelCellValueToText(cell.value);
          if (!rawHeader) {
            return;
          }
          headerByColumn.set(columnNumber, normalizeHeaderKey(rawHeader));
        });

        let patrolCodeColumn: number | null = null;
        let zlPointsGaussCutoffColumn: number | null = null;
        let zlPointsColumn: number | null = null;
        let zlPointsFallbackColumn: number | null = null;

        headerByColumn.forEach((headerKey, columnNumber) => {
          if (headerKey.includes('cislohlidky') || headerKey === 'hlidka') {
            patrolCodeColumn = columnNumber;
            return;
          }

          if (headerKey === 'bodyzlgaussscutoff' || headerKey === 'bodyzlgausscutoff') {
            zlPointsGaussCutoffColumn = columnNumber;
            return;
          }

          if (headerKey === 'bodyzlscutoff') {
            zlPointsColumn = columnNumber;
            return;
          }

          if (headerKey === 'bodyzlbezcutoff') {
            zlPointsFallbackColumn = columnNumber;
            return;
          }

          if (headerKey.includes('bodyzl') && zlPointsFallbackColumn === null) {
            zlPointsFallbackColumn = columnNumber;
          }
        });

        const pointsColumn = zlPointsGaussCutoffColumn ?? zlPointsColumn ?? zlPointsFallbackColumn;
        if (patrolCodeColumn === null || pointsColumn === null) {
          return;
        }

        for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
          const row = worksheet.getRow(rowNumber);
          const patrolCell = row.getCell(patrolCodeColumn);
          const pointsCell = row.getCell(pointsColumn);
          const patrolCode = normalisePatrolCode(excelCellValueToText(patrolCell.value));
          const points = excelCellValueToNumber(pointsCell.value);

          if (!patrolCode || points === null) {
            continue;
          }

          const previous = importedPointsByPatrol.get(patrolCode);
          if (previous !== undefined && Math.abs(previous - points) > 1e-9) {
            duplicateCodeConflicts.push(patrolCode);
            continue;
          }
          importedPointsByPatrol.set(patrolCode, points);
        }
      });

      if (!importedPointsByPatrol.size) {
        throw new Error('V nahraném XLSX nebyly nalezeny sloupce s hlídkami a body ZL.');
      }

      if (duplicateCodeConflicts.length) {
        throw new Error(
          `Hlídky mají v nahraném XLSX více různých hodnot body ZL: ${duplicateCodeConflicts
            .slice(0, 8)
            .join(', ')}`,
        );
      }

      const [resultsResponse, stationsResponse] = await Promise.all([
        supabase
          .from('results_ranked')
          .select(
            'patrol_id, patrol_code, team_name, category, sex, patrol_members, disqualified, rank_in_bracket, total_points, points_no_t, pure_seconds, start_time, finish_time, total_seconds, wait_seconds, station_points_breakdown',
          )
          .eq('event_id', eventId),
        supabase
          .from('stations')
          .select('code')
          .eq('event_id', eventId)
          .order('code', { ascending: true }),
      ]);

      if (resultsResponse.error) {
        throw resultsResponse.error;
      }
      if (stationsResponse.error) {
        throw stationsResponse.error;
      }

      const rawRows = (resultsResponse.data ?? []) as ImportedLeagueSourceRow[];
      const rows: Omit<ScoredExportRow, 'zlPoints'>[] = [];
      rawRows.forEach((row) => {
        const bracketKey = toBracketKey(row.category, row.sex);
        if (!bracketKey) {
          return;
        }
        const normalizedPatrolCode = normalisePatrolCode(normalizeText(row.patrol_code));
        const stationPointsBreakdown: Record<string, number> = {};
        const rawStationPoints = row.station_points_breakdown;
        if (rawStationPoints && typeof rawStationPoints === 'object' && !Array.isArray(rawStationPoints)) {
          Object.entries(rawStationPoints).forEach(([stationCode, value]) => {
            const normalizedStationCode = normalizeText(stationCode)?.toUpperCase();
            const numericValue = toNumeric(value);
            if (!normalizedStationCode || numericValue === null) {
              return;
            }
            stationPointsBreakdown[normalizedStationCode] = numericValue;
          });
        }
        rows.push({
          patrolId: row.patrol_id,
          patrolCode: normalizedPatrolCode || '',
          teamName: normalizeText(row.team_name),
          category: normalizeText(row.category)?.toUpperCase() ?? '',
          sex: normalizeText(row.sex)?.toUpperCase() ?? '',
          bracketKey,
          disqualified: row.disqualified === true,
          rankInBracket: toNumeric(row.rank_in_bracket),
          totalPoints: toNumeric(row.total_points),
          pointsNoTime: toNumeric(row.points_no_t ?? row.points_no_T ?? null),
          pureSeconds: toNumeric(row.pure_seconds),
          startTime: normalizeText(row.start_time),
          finishTime: normalizeText(row.finish_time),
          totalSeconds: toNumeric(row.total_seconds),
          waitSeconds: toNumeric(row.wait_seconds),
          stationPointsBreakdown,
          members: parsePatrolMembersForExport(row.patrol_members),
        });
      });

      if (!rows.length) {
        throw new Error('Výsledky závodu nejsou k dispozici.');
      }

      const compareRowsForResultsExport = (
        a: Omit<ScoredExportRow, 'zlPoints'>,
        b: Omit<ScoredExportRow, 'zlPoints'>,
      ) => {
        if (a.disqualified && b.disqualified) {
          return comparePatrolOrder(
            { patrol_code: a.patrolCode, category: a.category, sex: a.sex },
            { patrol_code: b.patrolCode, category: b.category, sex: b.sex },
          );
        }
        if (a.disqualified !== b.disqualified) {
          return a.disqualified ? 1 : -1;
        }

        const aHasPoints = a.totalPoints !== null || a.pointsNoTime !== null;
        const bHasPoints = b.totalPoints !== null || b.pointsNoTime !== null;
        if (aHasPoints !== bHasPoints) {
          return aHasPoints ? -1 : 1;
        }

        const aRank = a.rankInBracket ?? Number.POSITIVE_INFINITY;
        const bRank = b.rankInBracket ?? Number.POSITIVE_INFINITY;
        if (aRank !== bRank) {
          return aRank - bRank;
        }

        const aTotalPoints = a.totalPoints ?? Number.NEGATIVE_INFINITY;
        const bTotalPoints = b.totalPoints ?? Number.NEGATIVE_INFINITY;
        if (aTotalPoints !== bTotalPoints) {
          return bTotalPoints - aTotalPoints;
        }

        const aPointsNoTime = a.pointsNoTime ?? Number.NEGATIVE_INFINITY;
        const bPointsNoTime = b.pointsNoTime ?? Number.NEGATIVE_INFINITY;
        if (aPointsNoTime !== bPointsNoTime) {
          return bPointsNoTime - aPointsNoTime;
        }

        const aPureSeconds = a.pureSeconds ?? Number.POSITIVE_INFINITY;
        const bPureSeconds = b.pureSeconds ?? Number.POSITIVE_INFINITY;
        if (aPureSeconds !== bPureSeconds) {
          return aPureSeconds - bPureSeconds;
        }

        return comparePatrolOrder(
          { patrol_code: a.patrolCode, category: a.category, sex: a.sex },
          { patrol_code: b.patrolCode, category: b.category, sex: b.sex },
        );
      };

      const missingInUploaded: string[] = [];
      const usedImportedCodes = new Set<string>();

      const scoredRows: ScoredExportRow[] = rows.map((row) => {
        if (row.disqualified) {
          const candidateCodes = new Set<string>();
          buildPatrolCodeVariants(row.patrolCode).forEach((variant) => candidateCodes.add(variant));
          if (row.patrolCode) {
            candidateCodes.add(row.patrolCode);
          }
          candidateCodes.forEach((candidate) => {
            if (importedPointsByPatrol.has(candidate)) {
              usedImportedCodes.add(candidate);
            }
          });
          return {
            ...row,
            zlPoints: 0,
          };
        }

        const candidateCodes = new Set<string>();
        buildPatrolCodeVariants(row.patrolCode).forEach((variant) => candidateCodes.add(variant));
        if (row.patrolCode) {
          candidateCodes.add(row.patrolCode);
        }

        let matchedCode: string | null = null;
        let points: number | null = null;
        candidateCodes.forEach((candidate) => {
          if (matchedCode !== null) {
            return;
          }
          if (importedPointsByPatrol.has(candidate)) {
            matchedCode = candidate;
            points = importedPointsByPatrol.get(candidate) ?? null;
          }
        });

        if (matchedCode === null || points === null) {
          missingInUploaded.push(row.patrolCode || `${row.bracketKey}-${row.rankInBracket ?? '?'}`);
          return {
            ...row,
            zlPoints: 0,
          };
        }

        usedImportedCodes.add(matchedCode);
        return {
          ...row,
          zlPoints: points,
        };
      });

      if (missingInUploaded.length) {
        throw new Error(
          `V nahraném XLSX chybí body ZL pro hlídky: ${Array.from(new Set(missingInUploaded))
            .slice(0, 10)
            .join(', ')}`,
        );
      }

      const unknownImportedCodes = Array.from(importedPointsByPatrol.keys()).filter((code) => !usedImportedCodes.has(code));
      if (unknownImportedCodes.length) {
        throw new Error(
          `V nahraném XLSX jsou hlídky, které nejsou ve výsledcích závodu: ${unknownImportedCodes
            .slice(0, 10)
            .join(', ')}`,
        );
      }

      const groupedByBracket = new Map<string, ScoredExportRow[]>();
      BRACKET_EXPORT_ORDER.forEach((bracketKey) => groupedByBracket.set(bracketKey, []));
      scoredRows.forEach((row) => {
        groupedByBracket.get(row.bracketKey)?.push(row);
      });
      groupedByBracket.forEach((groupRows) => {
        groupRows.sort(compareRowsForResultsExport);
      });

      const allStationCodes = Array.from(
        new Set(
          ((stationsResponse.data ?? []) as Array<{ code: string | null }>)
            .map((row) => normalizeText(row.code)?.toUpperCase() ?? '')
            .filter(Boolean)
            .concat(
              scoredRows.flatMap((row) => Object.keys(row.stationPointsBreakdown)),
            ),
        ),
      ).sort((a, b) => a.localeCompare(b, 'cs'));

      const maxMemberCount = Math.max(1, scoredRows.reduce((max, row) => Math.max(max, row.members.length), 0));
      const memberHeaders = Array.from({ length: maxMemberCount }, (_, index) => `Člen ${index + 1}`);

      const workbook = new ExcelJS.Workbook();

      const pickStationCodesForSheet = (category: CategoryKey, sheetRows: ScoredExportRow[]) => {
        const allowedFromStations = allStationCodes.filter((code) => {
          const allowedCategories = getStationAllowedBaseCategories(code);
          return allowedCategories.includes(category);
        });
        if (allowedFromStations.length > 0) {
          return allowedFromStations;
        }

        const fallbackSet = new Set<string>();
        sheetRows.forEach((row) => {
          Object.keys(row.stationPointsBreakdown).forEach((code) => {
            const allowedCategories = getStationAllowedBaseCategories(code);
            if (allowedCategories.includes(category)) {
              fallbackSet.add(code);
            }
          });
        });
        if (fallbackSet.size > 0) {
          return Array.from(fallbackSet).sort((a, b) => a.localeCompare(b, 'cs'));
        }
        return allStationCodes;
      };

      const addResultsSheet = (sheetName: string, category: CategoryKey, sheetRows: ScoredExportRow[]) => {
        const worksheet = workbook.addWorksheet(sheetName);
        const stationCodes = pickStationCodesForSheet(category, sheetRows);
        const stationHeaders = stationCodes.map((code) => `Body ${code}`);

        worksheet.addRow([
          '#',
          'Hlídka',
          'Oddíl',
          ...memberHeaders,
          'Čas startu',
          'Čas doběhu',
          'Celkový čas na trati',
          'Čekání',
          'Čas na trati bez čekání',
          ...stationHeaders,
          'Body celkem',
          'Body bez času',
          'Body ZL',
        ]);

        if (!sheetRows.length) {
          worksheet.addRow([
            '—',
            '—',
            'Žádné výsledky v této kategorii.',
            ...Array.from({ length: maxMemberCount }, () => '—'),
            '—',
            '—',
            '—',
            '—',
            '—',
            ...Array.from({ length: stationCodes.length }, () => '—'),
            '',
            '',
            '',
          ]);
        } else {
          sheetRows.forEach((row, index) => {
            const fallbackCode = `${row.bracketKey}-${index + 1}`;
            const memberCells = Array.from({ length: maxMemberCount }, (_, memberIndex) => row.members[memberIndex] || '—');
            const stationCells = stationCodes.map((code) => {
              const value = row.stationPointsBreakdown[code];
              return typeof value === 'number' ? value : '-';
            });

            worksheet.addRow([
              row.disqualified ? 'DSQ' : String(index + 1),
              row.patrolCode || fallbackCode,
              row.teamName || '—',
              ...memberCells,
              formatDateTimeForExport(row.startTime),
              formatDateTimeForExport(row.finishTime),
              formatSecondsForExport(row.totalSeconds),
              formatSecondsForExport(row.waitSeconds),
              formatSecondsForExport(row.pureSeconds),
              ...stationCells,
              row.totalPoints ?? '',
              row.pointsNoTime ?? '',
              row.zlPoints,
            ]);
          });
        }
      };

      BRACKET_EXPORT_ORDER.forEach((bracketKey) => {
        const category = bracketKey.slice(0, 1) as CategoryKey;
        addResultsSheet(bracketKey, category, groupedByBracket.get(bracketKey) ?? []);
      });

      const orderedMergedCategories = BASE_CATEGORY_ORDER.filter((category) => mergedCategorySheets.has(category));
      orderedMergedCategories.forEach((category) => {
        const mergedRows = [
          ...(groupedByBracket.get(`${category}H`) ?? []),
          ...(groupedByBracket.get(`${category}D`) ?? []),
        ];
        mergedRows.sort(compareRowsForResultsExport);
        addResultsSheet(category, category, mergedRows);
      });

      const contributionsByTroop = new Map<string, TroopContribution[]>();
      scoredRows.forEach((row) => {
        if (row.disqualified) {
          return;
        }
        const troopMemberWeights = extractTroopMemberWeights(row.teamName, row.members);
        if (!troopMemberWeights.length) {
          return;
        }

        troopMemberWeights.forEach(({ troopName, memberWeight }) => {
          const share = (row.zlPoints / 3) * memberWeight;
          if (!contributionsByTroop.has(troopName)) {
            contributionsByTroop.set(troopName, []);
          }
          contributionsByTroop.get(troopName)!.push({
            patrolCode: row.patrolCode,
            points: share,
            sourcePoints: row.zlPoints,
          });
        });
      });

      const zlWorksheet = workbook.addWorksheet('ZL');
      const participationPoints = 10;
      const setonCoefficient = 2.0;
      zlWorksheet.addRow([
        'Pořadí',
        'Oddíl',
        'Body ZL (max 4 hlídky)',
        'Body za účast',
        'Koeficient',
        'Body ZL celkem',
        'Započtené hlídky',
      ]);

      if (!contributionsByTroop.size) {
        zlWorksheet.addRow(['—', 'Žádný oddíl PTO', '', '', '', '', '']);
      } else {
        const compareTroopContributionsByPoints = (a: TroopContribution, b: TroopContribution) => {
          if (a.points !== b.points) {
            return b.points - a.points;
          }
          if (a.sourcePoints !== b.sourcePoints) {
            return b.sourcePoints - a.sourcePoints;
          }
          return comparePatrolOrder(
            { patrol_code: a.patrolCode },
            { patrol_code: b.patrolCode },
          );
        };

        const sortedTroopScores = Array.from(contributionsByTroop.entries())
          .map(([troopName, contributions]) => {
            const sortedContributions = [...contributions].sort(compareTroopContributionsByPoints);
            const countedContributions = sortedContributions.slice(0, 4);
            const performancePoints = countedContributions.reduce((sum, item) => sum + item.points, 0);
            const totalPoints = performancePoints * setonCoefficient + participationPoints;
            return {
              troopName,
              performancePoints,
              participationPoints,
              setonCoefficient,
              totalPoints,
              countedContributions,
            };
          })
          .sort((a, b) => {
            if (a.totalPoints !== b.totalPoints) {
              return b.totalPoints - a.totalPoints;
            }
            return compareTroopSheetOrder(a.troopName, b.troopName);
          });

        sortedTroopScores.forEach((row, index) => {
          const formatContribution = (item: TroopContribution) => `${item.patrolCode} (${item.points.toFixed(2)})`;
          zlWorksheet.addRow([
            index + 1,
            row.troopName,
            Number(row.performancePoints.toFixed(2)),
            row.participationPoints,
            row.setonCoefficient,
            Number(row.totalPoints.toFixed(2)),
            row.countedContributions.map(formatContribution).join(', ') || '—',
          ]);
        });
      }

      workbook.worksheets.forEach((worksheet) => {
        if (worksheet.name === 'ZL') {
          worksheet.columns = [
            { width: 10 },
            { width: 28 },
            { width: 21 },
            { width: 14 },
            { width: 12 },
            { width: 16 },
            { width: 64 },
          ];
          return;
        }

        const stationHeaderCount = Math.max(0, worksheet.getRow(1).cellCount - (11 + maxMemberCount));
        worksheet.columns = [
          { width: 8 },
          { width: 14 },
          { width: 28 },
          ...Array.from({ length: maxMemberCount }, () => ({ width: 24 })),
          { width: 18 },
          { width: 18 },
          { width: 20 },
          { width: 14 },
          { width: 22 },
          ...Array.from({ length: stationHeaderCount }, () => ({ width: 10 })),
          { width: 14 },
          { width: 16 },
          { width: 12 },
        ];
      });

      await downloadWorkbook(workbook, toExportFileName(eventState.name, 'vysledky-zl-body'));

      const unsupportedSheetsHint = unsupportedSheets.length
        ? ` Nepodporované listy byly přeskočeny: ${unsupportedSheets.slice(0, 4).join(', ')}.`
        : '';
      setLeagueImportSuccess(`Export byl vytvořen ze souboru ${leagueImportFile.name}.${unsupportedSheetsHint}`);
    } catch (error) {
      console.error('Failed to build results workbook with imported ZL points', error);
      const message = error instanceof Error && error.message
        ? error.message
        : 'Nepodařilo se zpracovat nahraný XLSX soubor.';
      setLeagueImportError(message);
    } finally {
      setProcessingLeagueImport(false);
    }
  }, [eventId, eventState.name, leagueImportFile, processingLeagueImport]);

  const totalMissingAcrossStations = useMemo(
    () => stationRows.reduce((sum, row) => sum + row.totalMissing.length, 0),
    [stationRows],
  );

  const isLivePage = activeAdminPage === 'live';
  const isPatrolsPage = activeAdminPage === 'patrols';
  const isStationsPage = activeAdminPage === 'stations';
  const isResultsPage = activeAdminPage === 'results';
  const isStatisticsPage = activeAdminPage === 'statistics';
  const isSettingsPage = activeAdminPage === 'settings';

  if (!isCalcStation) {
    return (
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-header-inner">
            <div>
              <h1>Administrace závodu</h1>
              <p className="admin-subtitle">Tento účet nemá oprávnění pro kancelář závodu.</p>
            </div>
            <div className="admin-header-actions">
              <button
                type="button"
                className="admin-button admin-button--secondary admin-button--pill"
                onClick={() => logout()}
              >
                Odhlásit se
              </button>
            </div>
          </div>
        </header>
        <main className="admin-content">
          <section className="admin-card">
            <h2>Přístup zamítnut</h2>
            <p>Administrace je dostupná pouze stanovišti T (výpočetka).</p>
          </section>
        </main>
        <AppFooter variant="minimal" />
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-header-inner">
          <div>
            <h1>Administrace závodu</h1>
            <p className="admin-subtitle">
              {eventState.name} · {ADMIN_PAGE_TITLE[activeAdminPage]}
              {eventState.scoringLocked ? ' · Závod ukončen' : ''}
            </p>
          </div>
          <div className="admin-header-actions admin-header-actions--centered-row">
            <a
              className="admin-button admin-button--secondary admin-button--pill"
              href="https://www.zelenaliga.cz/aplikace/setonuv-zavod/vysledky"
              target="_blank"
              rel="noreferrer"
            >
              Otevřít výsledky
            </a>
            <a
              className="admin-button admin-button--secondary admin-button--pill"
              href="https://www.zelenaliga.cz/aplikace/setonuv-zavod/vysledky?autoExport=1"
              target="_blank"
              rel="noreferrer"
            >
              Export výsledky
            </a>
            <button
              type="button"
              className="admin-button admin-button--secondary admin-button--pill"
              onClick={handleRefreshAll}
              disabled={refreshing}
            >
              {refreshing ? 'Obnovuji…' : 'Obnovit data'}
            </button>
            <button
              type="button"
              className="admin-button admin-button--secondary admin-button--pill"
              onClick={handleExportNameCheck}
              disabled={exportingNames}
            >
              {exportingNames ? 'Exportuji…' : 'Export kontrola jmen'}
            </button>
            <button
              type="button"
              className="admin-button admin-button--secondary admin-button--pill"
              onClick={handleExportLeaguePoints}
              disabled={exportingLeague}
            >
              {exportingLeague ? 'Exportuji…' : 'Export body ZL'}
            </button>
            <button
              type="button"
              className="admin-button admin-button--secondary admin-button--pill"
              onClick={() => logout()}
            >
              Odhlásit se
            </button>
          </div>
          <div className="admin-header-event-switch">
            <label className="admin-header-event-switch-label" htmlFor="admin-global-event-switch">
              Ročník
            </label>
            <select
              id="admin-global-event-switch"
              className="admin-header-event-switch-select"
              value={selectedSetupEventId}
              onChange={(event) => setSelectedSetupEventId(event.target.value)}
              disabled={setupLoading || setupSaving || setupEvents.length === 0}
            >
              {setupEvents.length === 0 ? (
                <option value={eventId}>{eventState.name}</option>
              ) : null}
              {setupEvents.map((setupEvent) => (
                <option key={setupEvent.id} value={setupEvent.id}>
                  {setupEvent.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>
      <main className="admin-content">
        <AdminSectionNav
          activePage={activeAdminPage}
          onNavigate={navigateAdminPage}
        />
        {pageTransitioning ? (
          <section className="admin-card admin-card--section admin-card--narrow admin-page-loading">
            <h2>Načítám stránku…</h2>
          </section>
        ) : null}

        {isLivePage ? (
          <AdminLiveOverviewSection
            stationLoading={stationLoading}
            onRefresh={() => {
              void loadStationStats();
            }}
            summary={raceDashboardSummary}
          />
        ) : null}

        {isPatrolsPage ? <AdminPatrolsOverviewSection eventId={eventId} /> : null}
        {isPatrolsPage ? <AdminStartsSection /> : null}

        {isStationsPage ? (
        <section className="admin-card admin-card--with-divider admin-card--section admin-section-block admin-section-block--stations">
          <header className="admin-card-header">
            <div>
              <h2>Správné odpovědi – Terčový úsek</h2>
              <p className="admin-card-subtitle">
                Zadej 12 odpovědí ({targetAnswerInputHint}) pro každou kategorii.
              </p>
            </div>
            <div className="admin-card-actions">
              <button
                type="button"
                className="admin-button admin-button--secondary"
                onClick={loadAnswers}
                disabled={answersLoading}
              >
                {answersLoading ? 'Načítám…' : 'Obnovit'}
              </button>
            </div>
          </header>
          {answersError ? <p className="admin-error">{answersError}</p> : null}
          {answersSuccess ? <p className="admin-success">{answersSuccess}</p> : null}
          <p className="admin-card-subtitle">
            Ročník nastavení: <strong>{selectedSetupEvent?.name || eventState.name}</strong>
          </p>
          <div className="admin-disqualify-form">
            <label className="admin-field" htmlFor="admin-target-answer-option-count">
              <span>Počet možností pro otázku</span>
              <select
                id="admin-target-answer-option-count"
                value={answersTargetOptionCount}
                onChange={(event) => setAnswersTargetOptionCount(toTargetAnswerOptionCount(event.target.value))}
                disabled={setupSaving || setupLoading}
              >
                <option value={4}>4 možnosti (A-D)</option>
                <option value={3}>3 možnosti (A-C)</option>
              </select>
            </label>
          </div>
          <p className="admin-card-subtitle">
            Ve výpočetce rozhodčí zadává <strong>X</strong>, pokud hlídka odpověď nevyplní.
          </p>
          <div className="admin-answers-grid">
            {ANSWER_CATEGORIES.map((category) => {
              const summary = answersSummary[category];
              const hasAnswers = summary.letters.length > 0;
              const formattedLetters = summary.letters.join(' ');
              const updatedAt = summary.updatedAt ? new Date(summary.updatedAt) : null;

              return (
                <div key={category} className="admin-answers-field">
                  <label htmlFor={`answers-${category}`}>
                    <span className="admin-answers-label">{category}</span>
                    <input
                      id={`answers-${category}`}
                      value={answersForm[category]}
                      onChange={(event) =>
                        setAnswersForm((prev) => ({
                          ...prev,
                          [category]: normalizeAnswersInput(event.target.value, {
                            maxOptionCount: answersTargetOptionCount,
                          }),
                        }))
                      }
                      placeholder={`např. ${targetAnswerInputHint}…`}
                      pattern={targetAnswerInputPattern}
                    />
                  </label>
                  <p className="admin-answers-meta">
                    {hasAnswers ? (
                      <>
                        <span className="admin-answers-meta-item admin-answers-meta-count">
                          {`${summary.letters.length} odpovědí`}
                        </span>
                        <span className="admin-answers-meta-item admin-answers-meta-letters">
                          {formattedLetters}
                        </span>
                      </>
                    ) : (
                      <span className="admin-answers-meta-item">Nenastaveno</span>
                    )}
                    {updatedAt ? (
                      <time
                        className="admin-answers-meta-item admin-answers-meta-time"
                        dateTime={updatedAt.toISOString()}
                        suppressHydrationWarning
                      >
                        {updatedAt.toLocaleString('cs-CZ')}
                      </time>
                    ) : null}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="admin-card-actions admin-card-actions--end">
            <button
              type="button"
              className="admin-button admin-button--primary"
              onClick={handleSaveAnswers}
              disabled={answersSaving}
            >
              {answersSaving ? 'Ukládám…' : 'Uložit správné odpovědi'}
            </button>
          </div>
        </section>
        ) : null}

        {isStationsPage ? (
          <section
            id={toAdminSectionId('stations')}
            className="admin-card admin-card--with-divider admin-card--section admin-section-block admin-section-block--stations"
          >
            <header className="admin-card-header">
              <div>
                <h2>Stanoviště a rozhodčí</h2>
                <p className="admin-card-subtitle">
                  Live přehled stanovišť a aktuálně přiřazených rozhodčích.
                </p>
              </div>
              <div className="admin-card-actions">
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={() => void loadSetupData()}
                  disabled={setupLoading || setupSaving}
                >
                  {setupLoading ? 'Načítám…' : 'Obnovit stanoviště'}
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={() => navigateAdminPage('settings')}
                >
                  Otevřít detailní nastavení
                </button>
              </div>
            </header>
            {setupError ? <p className="admin-error">{setupError}</p> : null}
            {setupSuccess ? <p className="admin-success">{setupSuccess}</p> : null}
            <AdminStationHealthPanel
              stationCards={stationHealthCards}
              assignmentRows={selectedSetupAssignments}
            />
            {judgeTemporaryPassword ? (
              <p className="admin-notice">
                Nový účet rozhodčího byl vytvořen. Dočasné heslo: <strong>{judgeTemporaryPassword}</strong>
              </p>
            ) : null}
            <div className="admin-setup-block">
              <h3>Rozhodčí a přiřazení</h3>
              <p className="admin-card-subtitle">
                Pokud už e-mail existuje, účet se jen přiřadí k vybranému ročníku a stanovišti.
              </p>
              <div className="admin-disqualify-form">
                <label className="admin-field" htmlFor="admin-judge-email">
                  <span>E-mail</span>
                  <input
                    id="admin-judge-email"
                    type="email"
                    value={judgeEmailInput}
                    onChange={(event) => setJudgeEmailInput(event.target.value)}
                    placeholder="rozhodci@example.com"
                    autoComplete="email"
                  />
                </label>
                <label className="admin-field" htmlFor="admin-judge-display-name">
                  <span>Jméno (volitelné)</span>
                  <input
                    id="admin-judge-display-name"
                    value={judgeDisplayNameInput}
                    onChange={(event) => setJudgeDisplayNameInput(event.target.value)}
                    placeholder="Jan Novák"
                    autoComplete="off"
                  />
                </label>
                <label className="admin-field" htmlFor="admin-judge-station">
                  <span>Stanoviště</span>
                  <select
                    id="admin-judge-station"
                    value={judgeStationCodeInput}
                    onChange={(event) => setJudgeStationCodeInput(event.target.value)}
                  >
                    {selectedSetupStations.map((station) => (
                      <option key={station.id} value={station.code}>
                        {station.code} – {station.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field" htmlFor="admin-judge-tasks">
                  <span>Oprávnění (allowed tasks)</span>
                  <input
                    id="admin-judge-tasks"
                    value={judgeTasksInput}
                    onChange={(event) => setJudgeTasksInput(event.target.value)}
                    placeholder="score-review, manage-results"
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className="admin-category-toggle-list">
                {(['N', 'M', 'S', 'R'] as const).map((category) => (
                  <label key={category} className="admin-check">
                    <input
                      type="checkbox"
                      checked={judgeCategoryToggle[category]}
                      onChange={(event) =>
                        setJudgeCategoryToggle((prev) => ({
                          ...prev,
                          [category]: event.target.checked,
                        }))
                      }
                    />
                    <span>{category}</span>
                  </label>
                ))}
              </div>
              <div className="admin-card-actions admin-card-actions--end">
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={() => void handleAssignJudgeToEvent()}
                  disabled={setupSaving}
                >
                  {setupSaving ? 'Ukládám…' : 'Vytvořit/Přiřadit rozhodčího'}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {isSettingsPage ? (
        <section
          className="admin-card admin-card--with-divider admin-card--section admin-section-block admin-section-block--stations"
        >
          <header className="admin-card-header">
            <div>
              <h2>Nastavení závodu</h2>
              <p className="admin-card-subtitle">
                Nastavení ročníků, výsledků, času a předzávodních kroků.
              </p>
            </div>
            <div className="admin-card-actions">
              <button
                type="button"
                className="admin-button admin-button--secondary"
                onClick={() => void loadSetupData()}
                disabled={setupLoading || setupSaving}
              >
                {setupLoading ? 'Načítám…' : 'Obnovit nastavení'}
              </button>
              <button
                type="button"
                className="admin-button admin-button--secondary"
                onClick={() => void handleToggleLock(!eventState.scoringLocked)}
                disabled={lockUpdating || eventLoading}
              >
                {lockUpdating
                  ? 'Aktualizuji…'
                  : eventState.scoringLocked
                  ? 'Znovu povolit zapisování'
                  : 'Ukončit závod'}
              </button>
            </div>
          </header>
          {eventError ? <p className="admin-error">{eventError}</p> : null}
          {lockMessage ? <p className="admin-notice">{lockMessage}</p> : null}
          {setupError ? <p className="admin-error">{setupError}</p> : null}
          {setupSuccess ? <p className="admin-success">{setupSuccess}</p> : null}

          <div className="admin-setup-block">
            <h3>Vytvořit nový ročník</h3>
            <div className="admin-disqualify-form">
              <label className="admin-field" htmlFor="admin-create-event-name">
                <span>Název ročníku</span>
                <input
                  id="admin-create-event-name"
                  value={createEventName}
                  onChange={(event) => setCreateEventName(event.target.value)}
                  placeholder="např. Setonův závod 2027"
                  autoComplete="off"
                />
              </label>
              <label className="admin-field" htmlFor="admin-create-event-start">
                <span>Začátek (volitelné)</span>
                <input
                  id="admin-create-event-start"
                  type="datetime-local"
                  value={createEventStartsAt}
                  onChange={(event) => setCreateEventStartsAt(event.target.value)}
                />
              </label>
              <label className="admin-field" htmlFor="admin-create-event-end">
                <span>Konec (volitelné)</span>
                <input
                  id="admin-create-event-end"
                  type="datetime-local"
                  value={createEventEndsAt}
                  onChange={(event) => setCreateEventEndsAt(event.target.value)}
                />
              </label>
              <label className="admin-check" htmlFor="admin-copy-stations">
                <input
                  id="admin-copy-stations"
                  type="checkbox"
                  checked={copyStationsFromCurrentEvent}
                  onChange={(event) => setCopyStationsFromCurrentEvent(event.target.checked)}
                />
                <span>Kopírovat stanoviště z aktuálního ročníku</span>
              </label>
              <button
                type="button"
                className="admin-button admin-button--primary"
                onClick={() => void handleCreateEvent()}
                disabled={setupSaving}
              >
                {setupSaving ? 'Ukládám…' : 'Vytvořit ročník'}
              </button>
            </div>
          </div>

          <div className="admin-setup-block">
            <h3>Nastavení výsledků a času</h3>
            <p className="admin-card-subtitle">
              Kolik míst se zvýrazní ve výsledcích a do jakého času je za kategorii plných 12 bodů.
            </p>
            <h4>Vyhlašovaná místa (po kategoriích)</h4>
            <div className="admin-setup-scoring-grid">
              {STATION_PASSAGE_CATEGORIES.map((category) => (
                <div key={category} className="admin-setup-scoring-row">
                  <strong>{category}</strong>
                  <label className="admin-field" htmlFor={`admin-announced-places-${category}`}>
                    <span>Vyhlašovaná místa</span>
                    <input
                      id={`admin-announced-places-${category}`}
                      type="number"
                      min={1}
                      max={100}
                      value={setupEventScoringConfig.announcedPlaces[category]}
                      onChange={(event) =>
                        setSetupEventScoringConfig((prev) => ({
                          ...prev,
                          announcedPlaces: {
                            ...prev.announcedPlaces,
                            [category]: toPositiveInt(event.target.value, prev.announcedPlaces[category], 100),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
            <h4>Čas pro plných 12 bodů</h4>
            <div className="admin-setup-scoring-grid">
              {BASE_CATEGORY_ORDER.map((category) => (
                <div key={`setup-time-limit-${category}`} className="admin-setup-scoring-row">
                  <strong>{category}</strong>
                  <label className="admin-field" htmlFor={`admin-time-limit-${category}`}>
                    <span>Čas pro 12 bodů (HH:MM)</span>
                    <input
                      id={`admin-time-limit-${category}`}
                      type="time"
                      step={60}
                      value={formatMinutesAsTimeInput(setupEventScoringConfig.timeLimitMinutes[category])}
                      onChange={(event) =>
                        setSetupEventScoringConfig((prev) => {
                          const nextMinutes = parseTimeInputToMinutes(event.target.value);
                          if (nextMinutes === null) {
                            return prev;
                          }
                          return {
                            ...prev,
                            timeLimitMinutes: {
                              ...prev.timeLimitMinutes,
                              [category]: nextMinutes,
                            },
                          };
                        })
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
            <div className="admin-disqualify-form">
              <label className="admin-field" htmlFor="admin-time-step-minutes">
                <span>Penalizace po (min)</span>
                <input
                  id="admin-time-step-minutes"
                  type="number"
                  min={1}
                  max={1440}
                  value={setupEventScoringConfig.timePenaltyStepMinutes}
                  onChange={(event) =>
                    setSetupEventScoringConfig((prev) => ({
                      ...prev,
                      timePenaltyStepMinutes: toPositiveInt(event.target.value, prev.timePenaltyStepMinutes, 24 * 60),
                    }))
                  }
                />
              </label>
            </div>
            <div className="admin-setup-troops">
              <div>
                <h4>Účastnící se oddíly</h4>
                <p className="admin-card-subtitle">
                  Označ oddíly, které se účastní ročníku. Seznam se použije ve výpočetce při úpravě profilu hlídky.
                </p>
                <p className="admin-card-subtitle">
                  {setupEventScoringConfig.participatingTroops.length > 0
                    ? `Vybráno (${setupEventScoringConfig.participatingTroops.length}): ${setupEventScoringConfig.participatingTroops.join(', ')}`
                    : 'Zatím není vybraný žádný oddíl.'}
                </p>
              </div>
              <div className="admin-setup-troop-grid">
                {setupTroopOptions.map((troopName) => (
                  <label key={troopName} className="admin-check">
                    <input
                      type="checkbox"
                      checked={setupEventScoringConfig.participatingTroops.some(
                        (item) => item.toLocaleLowerCase('cs') === troopName.toLocaleLowerCase('cs'),
                      )}
                      onChange={() => handleToggleSetupTroop(troopName)}
                    />
                    <span>{troopName}</span>
                  </label>
                ))}
              </div>
              <div className="admin-disqualify-form">
                <label className="admin-field" htmlFor="admin-add-troop">
                  <span>Přidat další oddíl</span>
                  <div className="admin-setup-troop-inline">
                    <input
                      id="admin-add-troop"
                      value={setupTroopDraft}
                      onChange={(event) => setSetupTroopDraft(event.target.value)}
                      placeholder="Např. 4. PTO Brno"
                      maxLength={120}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="admin-button admin-button--secondary"
                      onClick={handleAddSetupTroop}
                      disabled={!normalizeTroopName(setupTroopDraft)}
                    >
                      Přidat oddíl
                    </button>
                  </div>
                </label>
              </div>
            </div>
            <div className="admin-card-actions admin-card-actions--end">
              <button
                type="button"
                className="admin-button admin-button--secondary"
                onClick={() => void handleSaveEventScoringConfig()}
                disabled={setupSaving}
              >
                {setupSaving ? 'Ukládám…' : 'Uložit nastavení výsledků'}
              </button>
            </div>
          </div>

          <div className="admin-setup-block">
            <h3>Pořadí stanovišť podle kategorie</h3>
            <p className="admin-card-subtitle">
              Pro každou kategorii zadej pořadí kódů stanovišť oddělené čárkou (např. F, U, C…).
            </p>
            <div className="admin-setup-order-grid">
              {STATION_PASSAGE_CATEGORIES.map((category) => (
                <div key={category} className="admin-setup-order-row">
                  <label className="admin-field" htmlFor={`admin-order-${category}`}>
                    <span>{category} – pořadí stanovišť</span>
                    <textarea
                      id={`admin-order-${category}`}
                      value={orderInputs[category]}
                      onChange={(event) =>
                        setOrderInputs((prev) => ({
                          ...prev,
                          [category]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="admin-field" htmlFor={`admin-separator-${category}`}>
                    <span>{category} – oddělovač (volitelné)</span>
                    <input
                      id={`admin-separator-${category}`}
                      value={separatorInputs[category] ?? ''}
                      onChange={(event) =>
                        setSeparatorInputs((prev) => ({
                          ...prev,
                          [category]: event.target.value.trim().toUpperCase(),
                        }))
                      }
                      placeholder="např. R"
                      autoComplete="off"
                    />
                  </label>
                </div>
              ))}
            </div>
            <div className="admin-card-actions admin-card-actions--end">
              <button
                type="button"
                className="admin-button admin-button--secondary"
                onClick={() => void handleSaveStationOrder()}
                disabled={setupSaving}
              >
                {setupSaving ? 'Ukládám…' : 'Uložit pořadí stanovišť'}
              </button>
            </div>
          </div>

          <div className="admin-setup-block">
            <h3>Vytvoření hlídek</h3>
            <p className="admin-card-subtitle">
              Zadej počty hlídek pro jednotlivé kategorie a počáteční čísla kódů.
            </p>
            <div className="admin-setup-patrol-grid">
              {STATION_PASSAGE_CATEGORIES.map((category) => (
                <div key={category} className="admin-setup-patrol-row">
                  <strong>{category}</strong>
                  <label className="admin-field" htmlFor={`admin-patrol-count-${category}`}>
                    <span>Počet</span>
                    <input
                      id={`admin-patrol-count-${category}`}
                      type="number"
                      min={0}
                      value={patrolCounts[category]}
                      onChange={(event) =>
                        setPatrolCounts((prev) => ({
                          ...prev,
                          [category]: Math.max(0, Number.parseInt(event.target.value || '0', 10) || 0),
                        }))
                      }
                    />
                  </label>
                  <label className="admin-field" htmlFor={`admin-patrol-start-${category}`}>
                    <span>Od čísla</span>
                    <input
                      id={`admin-patrol-start-${category}`}
                      type="number"
                      min={1}
                      value={patrolStarts[category]}
                      onChange={(event) =>
                        setPatrolStarts((prev) => ({
                          ...prev,
                          [category]: Math.max(1, Number.parseInt(event.target.value || '1', 10) || 1),
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
            <div className="admin-card-actions admin-card-actions--end">
              <button
                type="button"
                className="admin-button admin-button--secondary"
                onClick={() => void handleCreatePatrols()}
                disabled={setupSaving}
              >
                {setupSaving ? 'Ukládám…' : 'Vytvořit hlídky'}
              </button>
            </div>
          </div>

          <div className="admin-setup-block">
            <h3>Smazat všechny body ročníku</h3>
            <p className="admin-card-subtitle">
              Smaže bodování, průchody, čekání a odpovědi terčového úseku pro vybraný ročník.
            </p>
            <div className="admin-card-actions">
              <button
                type="button"
                className="admin-button admin-button--danger"
                onClick={() => void handleClearEventPoints()}
                disabled={setupSaving}
              >
                {setupSaving ? 'Zpracovávám…' : 'Smazat body ročníku'}
              </button>
              <button
                type="button"
                className="admin-button admin-button--secondary"
                onClick={() => void handleCleanupIncompletePatrols()}
                disabled={setupSaving}
              >
                {setupSaving ? 'Zpracovávám…' : 'Smazat nevyplněné hlídky'}
              </button>
            </div>
          </div>
        </section>
        ) : null}

        {isPatrolsPage ? (
        <section className="admin-card admin-card--with-divider admin-card--section admin-section-block admin-section-block--patrols">
          <header className="admin-card-header">
            <div>
              <h2>Diskvalifikace hlídky</h2>
              <p className="admin-card-subtitle">
                Zadej ručně kód hlídky, načti její detail a potvrď diskvalifikaci.
              </p>
            </div>
          </header>
          <div className="admin-disqualify-form">
            <label className="admin-field" htmlFor="admin-disqualify-code">
              <span>Kód hlídky</span>
              <input
                id="admin-disqualify-code"
                value={disqualifyCode}
                onChange={(event) => {
                  setDisqualifyCode(event.target.value);
                  setDisqualifyTarget(null);
                  setDisqualifyError(null);
                  setDisqualifySuccess(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleLookupPatrol();
                  }
                }}
                placeholder="např. NH-12"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="admin-button admin-button--secondary"
              onClick={handleLookupPatrol}
              disabled={disqualifyLoading}
            >
              {disqualifyLoading ? 'Načítám…' : 'Načíst hlídku'}
            </button>
          </div>
          {disqualifyError ? <p className="admin-error">{disqualifyError}</p> : null}
          {disqualifySuccess ? <p className="admin-success">{disqualifySuccess}</p> : null}
          {disqualifyTarget ? (
            <div className="admin-disqualify-summary">
              <div>
                <strong>{disqualifyTarget.code}</strong>
                <span className="admin-disqualify-team">
                  {disqualifyTarget.teamName || 'Bez názvu'}
                </span>
              </div>
              <div className="admin-disqualify-meta">
                <span>{`${disqualifyTarget.category}${disqualifyTarget.sex}`}</span>
                <span
                  className={
                    disqualifyTarget.disqualified
                      ? 'admin-disqualify-flag admin-disqualify-flag--danger'
                      : 'admin-disqualify-flag'
                  }
                >
                  {disqualifyTarget.disqualified ? 'Diskvalifikována' : 'Aktivní'}
                </span>
              </div>
              <div className="admin-card-actions">
                <button
                  type="button"
                  className="admin-button admin-button--danger"
                  onClick={handleDisqualifyPatrol}
                  disabled={disqualifySaving || disqualifyTarget.disqualified}
                >
                  {disqualifySaving ? 'Ukládám…' : 'Diskvalifikovat hlídku'}
                </button>
              </div>
            </div>
          ) : null}
        </section>
        ) : null}

        {isLivePage ? <AdminQueuesSection /> : null}
        {isLivePage ? (
          <AdminLiveMapSection
            eventId={eventId}
            mapRoute={MAPA_PROCHODU_ROUTE}
          />
        ) : null}
        {isLivePage ? (
        <section
          id="admin-passages-section"
          className="admin-card admin-card--with-divider admin-card--section admin-section-block admin-section-block--live"
        >
          <header className="admin-card-header">
            <div>
              <h2>Průchody stanovišť</h2>
              <p className="admin-card-subtitle">Počet hlídek na jednotlivých stanovištích podle kategorie.</p>
            </div>
            <div className="admin-card-actions">
              <button
                type="button"
                className="admin-button admin-button--secondary"
                onClick={loadStationStats}
                disabled={stationLoading}
              >
                {stationLoading ? 'Načítám…' : 'Obnovit přehled'}
              </button>
            </div>
          </header>
          {stationError ? <p className="admin-error">{stationError}</p> : null}
          {raceDashboardSummary.problematicStations > 0 ? (
            <p className="admin-error">
              Některá stanoviště mohou být offline nebo bez průchodů v průběhu závodu.
            </p>
          ) : null}
          {stationRows.some((row) => row.totalMissing.length > 0) ? (
            <p className="admin-notice">
              U některých stanovišť chybí průchody - zkontroluj chybějící hlídky kliknutím do tabulky.
            </p>
          ) : null}
          {stationRows.length === 0 && !stationLoading ? <p>Žádná data o průchodech stanovišť.</p> : null}
          {stationRows.length > 0 ? (
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Stanoviště</th>
                    {BASE_CATEGORY_ORDER.map((category) => (
                      <th key={category}>{category}</th>
                    ))}
                    <th>CELKEM</th>
                  </tr>
                </thead>
                <tbody>
                  {stationRows.map((row) => (
                    <tr key={row.stationId}>
                      <td>
                        <div className="admin-station-label">
                          <span className="admin-station-code">{row.stationCode}</span>
                          <span>{row.stationName}</span>
                        </div>
                      </td>
                      {BASE_CATEGORY_ORDER.map((category) => {
                        const isAllowed = row.categories.includes(category);

                        if (!isAllowed) {
                          return (
                            <td key={`${row.stationId}-${category}`}>
                              <span className="admin-table-placeholder">–</span>
                            </td>
                          );
                        }

                        const expectedInCategory = row.expectedTotals[category];
                        const passed = row.totals[category];
                        const missingCount = row.missing[category].length;
                        const isDisabled = expectedInCategory === 0 && passed === 0;
                        const ariaLabel =
                          `Stanoviště ${row.stationCode} ${row.stationName}` +
                          ` – kategorie ${category}: ${passed} z ${expectedInCategory}`;
                        const buttonClassNames = [
                          'admin-table-button',
                          missingCount > 0
                            ? 'admin-table-button--missing'
                            : 'admin-table-button--complete',
                        ]
                          .filter(Boolean)
                          .join(' ');

                        return (
                          <td key={`${row.stationId}-${category}`}>
                            <button
                              type="button"
                              className={buttonClassNames}
                              onClick={() => handleOpenStationMissing(row, category)}
                              disabled={isDisabled}
                              aria-label={ariaLabel}
                            >
                              {passed}/{expectedInCategory}
                            </button>
                          </td>
                        );
                      })}
                      <td>
                        <button
                          type="button"
                          className={`admin-table-button ${
                            row.totalMissing.length > 0
                              ? 'admin-table-button--missing'
                              : 'admin-table-button--complete'
                          }`}
                          onClick={() => handleOpenStationMissing(row, 'TOTAL')}
                          disabled={row.totalExpected === 0}
                          aria-label={
                            `Stanoviště ${row.stationCode} ${row.stationName}` +
                            ` – celkem: ${row.totalPassed} z ${row.totalExpected}`
                          }
                        >
                          {row.totalPassed}/{row.totalExpected}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
        ) : null}

        {isResultsPage ? (
        <AdminResultsSection
          totalMissingAcrossStations={totalMissingAcrossStations}
          summary={raceDashboardSummary}
          exportingLeague={exportingLeague}
          onExportLeaguePoints={handleExportLeaguePoints}
        />
        ) : null}

        {isStatisticsPage ? (
        <AdminStatsSection
          showStatsSection
          onToggle={() => setShowStatsSection((prev) => !prev)}
          summary={raceDashboardSummary}
        />
        ) : null}

        {isSettingsPage ? (
        <AdminExportsOverviewSection
          showExportsSection={showExportsSection}
          onToggle={() => setShowExportsSection((prev) => !prev)}
          onExportNameCheck={handleExportNameCheck}
          exportingNames={exportingNames}
          onExportLeaguePoints={handleExportLeaguePoints}
          exportingLeague={exportingLeague}
        />
        ) : null}

        {isSettingsPage && showExportsSection ? (
        <section className="admin-card admin-card--with-divider admin-card--section admin-section-block admin-section-block--exports">
          <header className="admin-card-header">
            <div>
              <h2>Import body ZL do výsledků</h2>
              <p className="admin-card-subtitle">
                Nahraj upravený XLSX export bodů ZL. Vygeneruje se export výsledků s body ZL a souhrn oddílů.
              </p>
            </div>
          </header>
          <div className="admin-import-zl-form">
            <label className="admin-field" htmlFor="admin-zl-import-file">
              <span>Soubor XLSX (Export body ZL)</span>
              <input
                id="admin-zl-import-file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleLeagueImportFileChange}
              />
            </label>
            <button
              type="button"
              className="admin-button admin-button--secondary"
              onClick={handleBuildResultsWithLeaguePoints}
              disabled={!leagueImportFile || processingLeagueImport}
            >
              {processingLeagueImport ? 'Zpracovávám…' : 'Vytvořit výsledky + ZL'}
            </button>
          </div>
          {leagueImportFile ? (
            <p className="admin-notice">
              Vybraný soubor: <strong>{leagueImportFile.name}</strong>
            </p>
          ) : null}
          {leagueImportError ? <p className="admin-error">{leagueImportError}</p> : null}
          {leagueImportSuccess ? <p className="admin-success">{leagueImportSuccess}</p> : null}
        </section>
        ) : null}
        {missingDialog ? (
          <div
            className="admin-modal-backdrop"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                handleCloseMissingDialog();
              }
            }}
          >
            <div
              className="admin-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-missing-title"
            >
              <div className="admin-modal-header">
                <div>
                  <h3 id="admin-missing-title">
                    Stanoviště {missingDialog.stationCode} – {missingDialog.stationName}
                  </h3>
                  <p className="admin-modal-subtitle">
                    {missingDialog.category === 'TOTAL'
                      ? 'Zbývající hlídky celkem'
                      : `Zbývající hlídky (${missingDialog.category})`}
                  </p>
                </div>
                <button
                  type="button"
                  className="admin-modal-close"
                  onClick={handleCloseMissingDialog}
                  aria-label="Zavřít"
                >
                  ×
                </button>
              </div>
              <p className="admin-modal-meta">
                {missingDialog.missing.length} z{' '}
                {missingDialog.expected} hlídek ještě neprošlo.
              </p>
              {missingDialog.missing.length === 0 ? (
                <p className="admin-modal-empty">Všechny hlídky již stanoviště navštívily.</p>
              ) : (
                <ul className="admin-missing-list">
                  {missingDialog.missing.map((patrol) => (
                    <li key={patrol.id}>
                      <span className="admin-missing-code">{patrol.code}</span>
                      {patrol.teamName ? <span className="admin-missing-name">{patrol.teamName}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="admin-modal-actions">
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={handleCloseMissingDialog}
                >
                  Zavřít
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
      <AppFooter variant="minimal" />
    </div>
  );
}

function AdminApp() {
  const { status, refreshManifest, logout } = useAuth();

  if (status.state === 'loading') {
    return (
      <div className="admin-shell admin-shell--center">
        <div className="admin-card admin-card--narrow">
          <h1>Načítám…</h1>
        </div>
        <AppFooter variant="minimal" />
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <div className="admin-shell admin-shell--center">
        <div className="admin-card admin-card--narrow">
          <h1>Nelze načíst aplikaci</h1>
          <p>{status.message || 'Zkontroluj připojení nebo konfiguraci a zkus to znovu.'}</p>
          <button
            type="button"
            className="admin-button admin-button--primary"
            onClick={() => window.location.reload()}
          >
            Zkusit znovu
          </button>
        </div>
        <AppFooter variant="minimal" />
      </div>
    );
  }

  if (status.state === 'unauthenticated') {
    return <AdminLoginScreen />;
  }

  if (status.state === 'password-change-required') {
    return (
      <ChangePasswordScreen
        email={status.email}
        judgeId={status.judgeId}
        pendingPin={status.pendingPin}
      />
    );
  }

  if (status.state === 'locked') {
    return <LoginScreen requirePinOnly />;
  }

  if (status.state === 'authenticated') {
    return <AdminDashboard auth={status} refreshManifest={refreshManifest} logout={logout} />;
  }

  return null;
}

export default AdminApp;
