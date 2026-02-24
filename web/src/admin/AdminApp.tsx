import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
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
  packAnswersForStorage,
  parseAnswerLetters,
} from '../utils/targetAnswers';
import { env } from '../envVars';
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

const API_BASE_URL = env.VITE_AUTH_API_URL?.replace(/\/$/, '') ?? '';
const BRACKET_EXPORT_ORDER = ['NH', 'ND', 'MH', 'MD', 'SH', 'SD', 'RH', 'RD'] as const;
const BRACKET_EXPORT_ORDER_INDEX = new Map(BRACKET_EXPORT_ORDER.map((value, index) => [value, index] as const));
const BASE_CATEGORY_ORDER = ['N', 'M', 'S', 'R'] as const;
const ZL_BAND_POINTS = [16, 12, 9, 6, 4, 2, 1] as const;
const ZL_GAUSS_CENTER_INDEX = 2;
const ZL_GAUSS_SIGMA = 1.35;
const ZL_GAUSS_RATIO_PENALTY_WEIGHT = 0.35;
const ZL_GAUSS_DROPPED_PENALTY_WEIGHT = 0.08;

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
    numbers: [24, 25, 26, 27],
    aliases: [
      'ZS PCV',
      'ZSPCV',
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
  category: StationCategoryKey;
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
  categories: StationCategoryKey[];
  totals: Record<StationCategoryKey, number>;
  expectedTotals: Record<StationCategoryKey, number>;
  totalPassed: number;
  totalExpected: number;
  missing: Record<StationCategoryKey, PatrolSummary[]>;
  totalMissing: PatrolSummary[];
};

type EventState = {
  name: string;
  scoringLocked: boolean;
};

type MissingDialogState = {
  stationCode: string;
  stationName: string;
  category: StationCategoryKey | 'TOTAL';
  missing: PatrolSummary[];
  expected: number;
};

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

function extractPatrolMembers(rawNote: string | null | undefined): string[] {
  const normalizedNote = normalizeText(rawNote);
  if (!normalizedNote) {
    return [];
  }
  const firstLine = normalizedNote
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return [];
  }
  const semicolonParts = firstLine
    .split(/;|\|/g)
    .map((value) => value.trim())
    .filter(Boolean);
  if (semicolonParts.length > 1) {
    return semicolonParts;
  }
  const commaParts = firstLine
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (commaParts.length > 1) {
    return commaParts;
  }
  return [firstLine];
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
    .map((value) => value.trim())
    .filter(Boolean);

  if (semicolonParts.length > 1) {
    return semicolonParts;
  }

  const commaParts = normalized
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (commaParts.length > 1) {
    return commaParts;
  }

  return [normalized];
}

function formatSecondsForExport(seconds: number | null): string {
  if (seconds === null) {
    return '—';
  }
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
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
  return parsed.toLocaleString('cs-CZ');
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

  useEffect(() => {
    setEventState({ name: manifest.event.name, scoringLocked: manifest.event.scoringLocked });
  }, [manifest.event.name, manifest.event.scoringLocked]);

  const loadAnswers = useCallback(async () => {
    if (!stationId) {
      return;
    }
    setAnswersLoading(true);
    setAnswersError(null);
    const { data, error } = await supabase
      .from('station_category_answers')
      .select('category, correct_answers, updated_at')
      .eq('event_id', eventId)
      .eq('station_id', stationId);
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
      form[category] = formatAnswersForInput(packed);
      summary[category] = {
        letters: parseAnswerLetters(packed),
        updatedAt: row.updated_at ?? null,
      };
    });

    setAnswersForm(form);
    setAnswersSummary(summary);
    setAnswersSuccess(null);
  }, [eventId, stationId]);

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
        .select('station_id, patrol_id, patrols(category, sex)')
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

    const categoryPatrols = createStationCategoryRecord<PatrolSummary[]>(() => []);
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
        category: stationCategory,
      };
      categoryPatrols[stationCategory].push(summary);
      allPatrols.push(summary);
    });

    STATION_PASSAGE_CATEGORIES.forEach((category) => {
      categoryPatrols[category].sort((a, b) => a.code.localeCompare(b.code, 'cs'));
    });

    type StationAccumulator = {
      stationId: string;
      stationCode: string;
      stationName: string;
      totals: Record<StationCategoryKey, number>;
      passed: Record<StationCategoryKey, Set<string>>;
    };

    const totals = new Map<string, StationAccumulator>();
    stations.forEach((station, id) => {
      totals.set(id, {
        stationId: id,
        stationCode: station.code,
        stationName: station.name,
        totals: createStationCategoryRecord<number>(() => 0),
        passed: createStationCategoryRecord<Set<string>>(() => new Set<string>()),
      });
    });

    type PassageRow = {
      station_id: string;
      patrol_id: string;
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
      station.totals[stationCategory] += 1;
      station.passed[stationCategory].add(row.patrol_id);
    });

    const sorted = Array.from(totals.values()).sort((a, b) =>
      a.stationCode.localeCompare(b.stationCode, 'cs'),
    );

    const rows: StationPassageRow[] = sorted.map((station) => {
      const categories = getAllowedStationCategories(station.stationCode);
      const allowedCategorySet = new Set(categories);
      const missing = createStationCategoryRecord<PatrolSummary[]>(() => []);
      const expectedTotals = createStationCategoryRecord<number>(() => 0);
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
  }, [eventId]);

  const handleOpenStationMissing = useCallback(
    (row: StationPassageRow, category: StationCategoryKey | 'TOTAL') => {
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
    loadAnswers();
    loadStationStats();
    loadEventState();
  }, [isCalcStation, loadAnswers, loadStationStats, loadEventState]);

  const handleSaveAnswers = useCallback(async () => {
    setAnswersError(null);
    setAnswersSuccess(null);

    const updates: { event_id: string; station_id: string; category: string; correct_answers: string }[] = [];
    const deletions: string[] = [];

    for (const category of ANSWER_CATEGORIES) {
      const packed = packAnswersForStorage(answersForm[category]);
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
        event_id: eventId,
        station_id: stationId,
        category,
        correct_answers: packed,
      });
    }

    setAnswersSaving(true);

    try {
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
          .eq('event_id', eventId)
          .eq('station_id', stationId);
        if (error) {
          throw error;
        }
      }

      setAnswersSuccess('Správné odpovědi byly uloženy.');
      await loadAnswers();
    } catch (error) {
      console.error('Failed to save category answers', error);
      setAnswersError('Uložení správných odpovědí selhalo.');
    } finally {
      setAnswersSaving(false);
    }
  }, [answersForm, answersSummary, eventId, loadAnswers, stationId]);

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
    await Promise.all([loadAnswers(), loadStationStats(), loadEventState(), refreshManifest()]).catch((error) => {
      console.error('Admin refresh failed', error);
    });
    setRefreshing(false);
  }, [loadAnswers, loadStationStats, loadEventState, refreshManifest]);

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
        note: string | null;
        active: boolean | null;
      };

      const { data, error } = await supabase
        .from('patrols')
        .select('patrol_code, team_name, category, sex, note, active')
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
        const memberLists = patrols.map((patrol) => extractPatrolMembers(patrol.note));
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
        .select('patrol_code, category, sex, disqualified, rank_in_bracket, total_points, points_no_t, pure_seconds')
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
        mergeByCategory.set(category, totalCount > 0 && (boysCount < 7 || girlsCount < 7));
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

        const gaussCutoffCandidates = Array.from(
          new Set(collectAutomaticCutoffCandidates(pool).map((candidate) => candidate.cutoffIndex)),
        ).sort((a, b) => a - b);
        const bestGaussCutoffIndex = pickBestGaussCutoffIndex(pool, gaussCutoffCandidates);

        const gaussScoredPool = bestGaussCutoffIndex === null ? pool : pool.slice(0, bestGaussCutoffIndex);
        assignBandPoints(gaussScoredPool, (row, points) => {
          row.zlPointsGaussWithCutoff = points;
          row.gaussCutoffDropped = false;
        });
        if (bestGaussCutoffIndex !== null) {
          for (let index = bestGaussCutoffIndex; index < pool.length; index += 1) {
            const row = pool[index];
            row.zlPointsGaussWithCutoff = 1;
            row.gaussCutoffDropped = true;
          }
        }

        const gaussOpenCutoffCandidates = Array.from(
          new Set(collectGaussOpenCutoffCandidates(pool).map((candidate) => candidate.cutoffIndex)),
        ).sort((a, b) => a - b);
        const bestGaussOpenCutoffIndex = pickBestGaussCutoffIndex(pool, gaussOpenCutoffCandidates);

        const gaussOpenScoredPool = bestGaussOpenCutoffIndex === null ? pool : pool.slice(0, bestGaussOpenCutoffIndex);
        assignBandPoints(gaussOpenScoredPool, (row, points) => {
          row.zlPointsGaussOpenCutoff = points;
          row.gaussOpenCutoffDropped = false;
        });
        if (bestGaussOpenCutoffIndex !== null) {
          for (let index = bestGaussOpenCutoffIndex; index < pool.length; index += 1) {
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
        if (mergeByCategory.get(category)) {
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
        if (mergeByCategory.get(category)) {
          exportSheets.push({
            name: category,
            rows: groupedByMergedCategory.get(category) ?? [],
          });
          return;
        }
        const boysKey = `${category}H`;
        const girlsKey = `${category}D`;
        exportSheets.push({ name: boysKey, rows: groupedByBracket.get(boysKey) ?? [] });
        exportSheets.push({ name: girlsKey, rows: groupedByBracket.get(girlsKey) ?? [] });
      });

      const workbook = new ExcelJS.Workbook();
      exportSheets.forEach(({ name, rows }) => {
        const worksheet = workbook.addWorksheet(name);
        worksheet.addRow([
          'Pořadí',
          'Číslo hlídky',
          'Body celkem',
          'Body bez času',
          'Body ZL bez cut-off',
          'Body ZL s cut-off',
          'Body ZL gauss s cut-off',
          'Body ZL gauss otevřený cut-off',
        ]);
        if (rows.length === 0) {
          worksheet.addRow(['—', '—', '', '', '', '', '', '']);
        } else {
          rows.forEach((row, index) => {
            const displayRank = name.length === 1
              ? (row.disqualified ? 'DSQ' : String(index + 1))
              : (row.disqualified ? 'DSQ' : (toNumeric(row.rank_in_bracket) ?? ''));
            const worksheetRow = worksheet.addRow([
              displayRank,
              parsePatrolCodeParts(row.patrol_code).normalizedCode || '—',
              toNumeric(row.total_points) ?? '',
              toNumeric(row.points_no_t ?? row.points_no_T ?? null) ?? '',
              row.zlPointsNoCutoff,
              row.zlPointsWithCutoff,
              row.zlPointsGaussWithCutoff,
              row.zlPointsGaussOpenCutoff,
            ]);
            if (!row.disqualifiedFlag && !row.droppedFlag) {
              const noCutoffCell = worksheetRow.getCell(5);
              noCutoffCell.font = {
                ...(noCutoffCell.font ?? {}),
                bold: true,
              };
            }
            if (!row.disqualifiedFlag && !row.cutoffDropped) {
              const withCutoffCell = worksheetRow.getCell(6);
              withCutoffCell.font = {
                ...(withCutoffCell.font ?? {}),
                bold: true,
              };
            }
            if (!row.disqualifiedFlag && !row.gaussCutoffDropped) {
              const gaussWithCutoffCell = worksheetRow.getCell(7);
              gaussWithCutoffCell.font = {
                ...(gaussWithCutoffCell.font ?? {}),
                bold: true,
              };
            }
            if (!row.disqualifiedFlag && !row.gaussOpenCutoffDropped) {
              const gaussOpenCutoffCell = worksheetRow.getCell(8);
              gaussOpenCutoffCell.font = {
                ...(gaussOpenCutoffCell.font ?? {}),
                bold: true,
              };
            }
          });
          const cutoffStartIndex = rows.findIndex((row) => row.cutoffDropped && !row.disqualifiedFlag);
          if (cutoffStartIndex > 0) {
            const cutoffRow = worksheet.getRow(cutoffStartIndex + 2);
            [5, 6].forEach((column) => {
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
            const cell = gaussCutoffRow.getCell(7);
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
            const cell = gaussOpenCutoffRow.getCell(8);
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
          { width: 16 },
          { width: 18 },
          { width: 16 },
          { width: 22 },
          { width: 27 },
        ];
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
        let zlPointsColumn: number | null = null;
        let zlPointsFallbackColumn: number | null = null;

        headerByColumn.forEach((headerKey, columnNumber) => {
          if (headerKey.includes('cislohlidky') || headerKey === 'hlidka') {
            patrolCodeColumn = columnNumber;
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

        const pointsColumn = zlPointsColumn ?? zlPointsFallbackColumn;
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
        const uniqueTroops = extractPtoTroopsFromPatrol(row.teamName, row.members);

        if (!uniqueTroops.length) {
          return;
        }

        const share = row.zlPoints / uniqueTroops.length;
        uniqueTroops.forEach((troopName) => {
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
        const sortedTroopScores = Array.from(contributionsByTroop.entries())
          .map(([troopName, contributions]) => {
            const sortedContributions = [...contributions].sort((a, b) => {
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
            });
            const countedContributions = sortedContributions.slice(0, 4);
            const performancePoints = countedContributions.reduce((sum, item) => sum + item.points, 0);
            const totalPoints = (performancePoints + participationPoints) * setonCoefficient;
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
              {eventState.name}
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
        </div>
      </header>
      <main className="admin-content">
        <section className="admin-card">
          <header className="admin-card-header">
            <div>
              <h2>Stav závodu</h2>
              <p className="admin-card-subtitle">
                {eventLoading
                  ? 'Načítám stav závodu…'
                  : eventState.scoringLocked
                  ? 'Závod je ukončen. Zapisování bodů je uzamčeno pro všechna stanoviště kromě T.'
                  : 'Závod probíhá. Všechna stanoviště mohou zapisovat body.'}
              </p>
            </div>
            <div className="admin-card-actions">
              <button
                type="button"
                className="admin-button admin-button--primary"
                onClick={() => handleToggleLock(!eventState.scoringLocked)}
                disabled={lockUpdating}
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
        </section>

        <section className="admin-card admin-card--with-divider">
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

        <section className="admin-card admin-card--with-divider">
          <header className="admin-card-header">
            <div>
              <h2>Správné odpovědi – Terčový úsek</h2>
              <p className="admin-card-subtitle">Zadej 12 odpovědí (A–D) pro každou kategorii.</p>
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
                        setAnswersForm((prev) => ({ ...prev, [category]: event.target.value.toUpperCase() }))
                      }
                      placeholder="např. A B C D …"
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

        <section className="admin-card admin-card--with-divider">
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
          {stationRows.length === 0 && !stationLoading ? <p>Žádná data o průchodech stanovišť.</p> : null}
          {stationRows.length > 0 ? (
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Stanoviště</th>
                    {STATION_PASSAGE_CATEGORIES.map((category) => (
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
                      {STATION_PASSAGE_CATEGORIES.map((category) => {
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

        <section className="admin-card admin-card--with-divider">
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
