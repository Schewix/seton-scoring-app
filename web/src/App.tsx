import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// import QRScanner from './components/QRScanner';
import LastScoresList from './components/LastScoresList';
import PatrolCodeInput, {
  normalisePatrolCode,
  PatrolRegistryEntry,
  PatrolValidationState,
} from './components/PatrolCodeInput';
import PointsInput from './components/PointsInput';
import AppFooter from './components/AppFooter';
import { supabase } from './supabaseClient';
import './App.css';
import zelenaLigaLogo from './assets/znak_SPTO_transparent.png';
import { ManifestFetchError } from './auth/api';
import { useAuth } from './auth/context';
import LoginScreen from './auth/LoginScreen';
import ChangePasswordScreen from './auth/ChangePasswordScreen';
import type { AuthStatus } from './auth/types';
import TicketQueue from './components/TicketQueue';
import { createTicket, loadTickets, saveTickets, transitionTicket, Ticket, TicketState } from './auth/tickets';
import { registerPendingSync, setupSyncListener } from './backgroundSync';
import { appendScanRecord, getScanHistory, ScanRecord } from './storage/scanHistory';
import { getManualPatrols, upsertManualPatrol } from './storage/manualPatrols';
import { computePureCourseSeconds, computeTimePoints, isTimeScoringCategory } from './timeScoring';
import { triggerHaptic } from './utils/haptics';
import { ROUTE_PREFIX, SCOREBOARD_ROUTE_PREFIX, getStationPath, isStationAppPath } from './routing';
import {
  createStationCategoryRecord,
  getAllowedStationCategories,
  getStationAllowedBaseCategories,
  StationCategoryKey,
  toStationCategoryKey,
} from './utils/stationCategories';
import { env } from './envVars';
import { CategoryKey, formatAnswersForInput, isCategoryKey, packAnswersForStorage, parseAnswerLetters } from './utils/targetAnswers';
import {
  fetchPatrolRegistryEntries,
  loadPatrolRegistryCache,
  savePatrolRegistryCache,
} from './data/patrolRegistry';
import { ACCESS_DENIED_MESSAGE } from './auth/messages';
import competitionRulesPdf from './assets/pravidla/pravidla-souteze.pdf';
import stationRulesPdf from './assets/pravidla/pravidla-stanovist.pdf';
import {
  OutboxEntry,
  StationScorePayload,
  deleteOutboxEntries,
  enqueueStationScore as enqueueStationScoreHelper,
  flushOutboxBatch,
  releaseNetworkBackoff,
  readOutbox,
  writeOutboxEntries,
  writeOutboxEntry,
} from './outbox';

const SUPABASE_BASE_URL = (env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');

if (!SUPABASE_BASE_URL) {
  throw new Error('Missing VITE_SUPABASE_URL for submit-station-record requests.');
}

const SUBMIT_STATION_RECORD_URL = import.meta.env.PROD
  ? '/api/submit-station-record'
  : `${SUPABASE_BASE_URL}/functions/v1/submit-station-record`;
const SCORE_REVIEW_URL = import.meta.env.PROD ? '/api/station-score-review' : '';
const ACCESS_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const OUTBOX_FLUSH_LOCK_TTL_MS = 30 * 1000;

if (import.meta.env.DEV) {
  console.debug('[outbox] resolved submit endpoint', { submitStationRecordUrl: SUBMIT_STATION_RECORD_URL });
}


interface Patrol {
  id: string;
  team_name: string;
  category: string;
  sex: string;
  patrol_code: string | null;
}

type OutboxState = OutboxEntry['state'];

interface StationScoreRow {
  stationId: string;
  stationCode: string;
  stationName: string;
  points: number | null;
  waitMinutes: number | null;
  judge: string | null;
  note: string | null;
  hasScore: boolean;
  hasWait: boolean;
}

interface StationScoreRowState {
  ok: boolean;
  pointsDraft: string;
  waitDraft: string;
  saving: boolean;
  error: string | null;
}

interface StationSummaryPatrol {
  id: string;
  code: string;
  teamName: string;
  baseCategory: string;
  sex: string;
  visited: boolean;
}

interface StationCategorySummaryItem {
  key: StationCategoryKey;
  expected: number;
  visited: number;
  missing: StationSummaryPatrol[];
  completed: StationSummaryPatrol[];
}

interface StationCategorySummary {
  items: StationCategorySummaryItem[];
  totalExpected: number;
  totalVisited: number;
  totalMissing: StationSummaryPatrol[];
}

type AuthenticatedState = Extract<AuthStatus, { state: 'authenticated' }>;

const WAIT_MINUTES_MAX = 180;
const OUTBOX_BATCH_SIZE = 5;
const SCORE_REVIEW_TASK_KEYS = new Set([
  'score-review',
  'score_review',
  'review-station-scores',
  'calc',
  'calc-score-review',
  'manage-results',
  'manage-wait-times',
]);


function formatWaitMinutes(totalMinutes: number) {
  const clamped = Math.max(0, Math.min(WAIT_MINUTES_MAX, Math.round(totalMinutes)));
  const hours = Math.floor(clamped / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (clamped % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getOutboxFlushLockKey(eventId: string, stationId: string) {
  return `outbox-flush-lock:${eventId}:${stationId}`;
}

function tryAcquireOutboxFlushLock(eventId: string, stationId: string, ownerId: string, now: number) {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    const lockKey = getOutboxFlushLockKey(eventId, stationId);
    const currentRaw = window.localStorage.getItem(lockKey);
    if (currentRaw) {
      const current = JSON.parse(currentRaw) as { ownerId?: string; expiresAt?: number };
      const currentOwner = typeof current.ownerId === 'string' ? current.ownerId : '';
      const currentExpires = typeof current.expiresAt === 'number' ? current.expiresAt : 0;
      if (currentOwner && currentOwner !== ownerId && currentExpires > now) {
        return false;
      }
    }

    const next = { ownerId, expiresAt: now + OUTBOX_FLUSH_LOCK_TTL_MS };
    window.localStorage.setItem(lockKey, JSON.stringify(next));
    const confirmedRaw = window.localStorage.getItem(lockKey);
    if (!confirmedRaw) {
      return false;
    }
    const confirmed = JSON.parse(confirmedRaw) as { ownerId?: string };
    return confirmed.ownerId === ownerId;
  } catch {
    return true;
  }
}

function releaseOutboxFlushLock(eventId: string, stationId: string, ownerId: string) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const lockKey = getOutboxFlushLockKey(eventId, stationId);
    const currentRaw = window.localStorage.getItem(lockKey);
    if (!currentRaw) {
      return;
    }
    const current = JSON.parse(currentRaw) as { ownerId?: string };
    if (current.ownerId === ownerId) {
      window.localStorage.removeItem(lockKey);
    }
  } catch {
    // ignore localStorage lock release errors
  }
}

const WAIT_TIME_ZERO = formatWaitMinutes(0);
const WAIT_TIME_MAX = formatWaitMinutes(WAIT_MINUTES_MAX);

function formatWaitDraft(minutes: number | null | undefined) {
  if (typeof minutes !== 'number' || Number.isNaN(minutes)) {
    return WAIT_TIME_ZERO;
  }
  return formatWaitMinutes(minutes);
}

function parseWaitDraft(value: string) {
  const trimmed = value.trim();
  if (trimmed === '') {
    return NaN;
  }

  const match = trimmed.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) {
    return NaN;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const total = hours * 60 + minutes;
  if (!Number.isInteger(total) || total < 0 || total > WAIT_MINUTES_MAX) {
    return NaN;
  }
  return total;
}

function normalizeWaitInput(value: string, fallback: string) {
  const trimmed = value.trim();
  if (trimmed === '') {
    return WAIT_TIME_ZERO;
  }
  const match = trimmed.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) {
    return fallback;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return fallback;
  }
  return formatWaitMinutes(hours * 60 + minutes);
}

function formatPatrolMetaLabel(patrol: { patrol_code: string | null; category: string; sex: string } | null) {
  if (!patrol) {
    return '';
  }
  const code = patrol.patrol_code?.trim();
  if (code) {
    return code;
  }
  const category = patrol.category?.trim();
  const sex = patrol.sex?.trim();
  if (category && sex) {
    return `${category}/${sex}`;
  }
  return category || sex || '';
}

function formatSummaryPatrolLabel(patrol: StationSummaryPatrol) {
  return patrol.code || `${patrol.baseCategory}/${patrol.sex}`;
}

function createManualPatrolFromCode(code: string): Patrol | null {
  const normalized = code.trim().toUpperCase();
  const match = normalized.match(/^([NMSR])([HD])-(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[3], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  const padded = `${match[1]}${match[2]}-${String(parsed).padStart(2, '0')}`;
  return {
    id: `manual-${padded}`,
    team_name: 'Ruční hlídka',
    category: match[1],
    sex: match[2],
    patrol_code: padded,
  };
}

function getPatrolCodeVariants(raw: string) {
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

function getSummaryPatrolSortKey(patrol: StationSummaryPatrol) {
  const normalized = normalisePatrolCode(patrol.code || '');
  const match = normalized.match(/^([NMSR])([HD])-(\d{1,2})$/);
  const category = match?.[1] ?? patrol.baseCategory;
  const sex = match?.[2] ?? patrol.sex;
  const numberValue = match ? Number(match[3]) : NaN;
  const label = formatSummaryPatrolLabel(patrol).toUpperCase();
  return {
    category,
    sex,
    numberValue,
    label,
  };
}

function compareSummaryPatrols(a: StationSummaryPatrol, b: StationSummaryPatrol) {
  const keyA = getSummaryPatrolSortKey(a);
  const keyB = getSummaryPatrolSortKey(b);
  if (keyA.category !== keyB.category) {
    return keyA.category.localeCompare(keyB.category, 'cs');
  }
  if (keyA.sex !== keyB.sex) {
    return keyA.sex.localeCompare(keyB.sex, 'cs');
  }
  const aHasNumber = Number.isFinite(keyA.numberValue);
  const bHasNumber = Number.isFinite(keyB.numberValue);
  if (aHasNumber && bHasNumber && keyA.numberValue !== keyB.numberValue) {
    return keyA.numberValue - keyB.numberValue;
  }
  if (aHasNumber !== bHasNumber) {
    return aHasNumber ? -1 : 1;
  }
  return keyA.label.localeCompare(keyB.label, 'cs');
}

async function writeOutboxEntriesAndSync(items: OutboxEntry[]) {
  await writeOutboxEntries(items);
  if (typeof window !== 'undefined') {
    void registerPendingSync();
  }
}

async function writeOutboxEntryAndSync(item: OutboxEntry) {
  await writeOutboxEntry(item);
  if (typeof window !== 'undefined') {
    void registerPendingSync();
  }
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTimeLabel(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function formatWaitDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function toLocalTimeInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseTimeInput(value: string) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const [hStr, mStr] = value.split(':');
  const hours = Number(hStr);
  const minutes = Number(mStr);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return { hours, minutes };
}

function combineDateWithTime(baseIso: string | null, value: string) {
  const parsed = parseTimeInput(value);
  if (!parsed) return null;
  const { hours, minutes } = parsed;
  const baseDate = baseIso ? new Date(baseIso) : new Date();
  if (Number.isNaN(baseDate.getTime())) {
    return null;
  }
  const candidate = new Date(baseDate);
  candidate.setHours(hours, minutes, 0, 0);
  if (baseIso) {
    const original = new Date(baseIso);
    if (candidate.getTime() < original.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
  }
  return candidate.toISOString();
}

function formatDurationMs(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hoursPrefix = hours > 0 ? `${hours}:` : ''; // omit leading hours if zero
  const minutesValue = hours > 0 ? minutes.toString().padStart(2, '0') : String(minutes);
  return `${hoursPrefix}${minutesValue}:${seconds.toString().padStart(2, '0')}`;
}

function waitSecondsToMinutes(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  const safeSeconds = Math.floor(seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return Math.max(0, remainder > 30 ? minutes + 1 : minutes);
}

function getStationDisplayName(name: string, code: string | null | undefined): string {
  return code?.trim().toUpperCase() === 'T' ? 'Výpočetka' : name;
}

const STATION_CATEGORY_LABELS: Record<StationCategoryKey, { chip: string; detail: string }> = {
  NH: { chip: 'NH', detail: 'N – hoši' },
  ND: { chip: 'ND', detail: 'N – dívky' },
  MH: { chip: 'MH', detail: 'M – hoši' },
  MD: { chip: 'MD', detail: 'M – dívky' },
  SH: { chip: 'SH', detail: 'S – hoši' },
  SD: { chip: 'SD', detail: 'S – dívky' },
  RH: { chip: 'RH', detail: 'R – hoši' },
  RD: { chip: 'RD', detail: 'R – dívky' },
};

function formatStationCategoryChipLabel(category: StationCategoryKey): string {
  return STATION_CATEGORY_LABELS[category]?.chip ?? category;
}

function formatStationCategoryDetailLabel(category: StationCategoryKey): string {
  return STATION_CATEGORY_LABELS[category]?.detail ?? category;
}

const NO_SESSION_ERROR = 'NO_SESSION';

function requireAccessToken(accessToken: string | null) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { accessToken: null, error: 'OFFLINE', shouldBlock: false };
  }
  if (import.meta.env.DEV) {
    console.debug('[queue] token?', Boolean(accessToken));
  }
  if (accessToken) {
    return { accessToken, shouldBlock: true };
  }
  return { accessToken: null, error: NO_SESSION_ERROR, shouldBlock: true };
}

function StationApp({
  auth,
  refreshManifest,
  logout,
  refreshTokens,
}: {
  auth: AuthenticatedState;
  refreshManifest: () => Promise<void>;
  logout: () => Promise<void>;
  refreshTokens: (options?: { force?: boolean; reason?: string }) => Promise<boolean>;
}) {
  const manifest = auth.manifest;
  const eventId = manifest.event.id;
  const stationId = manifest.station.id;
  const stationCode = manifest.station.code?.trim().toUpperCase() || '';
  const stationDisplayName = getStationDisplayName(manifest.station.name, manifest.station.code);
  const scoringLocked = manifest.event.scoringLocked;
  const isTargetStation = stationCode === 'T';
  const canReviewStationScores =
    isTargetStation || manifest.allowedTasks.some((task) => SCORE_REVIEW_TASK_KEYS.has(task));
  const scoringDisabled = scoringLocked && !isTargetStation;
  const [activePatrol, setActivePatrol] = useState<Patrol | null>(null);
  const [scannerPatrol, setScannerPatrol] = useState<Patrol | null>(null);
  const [scannerSource, setScannerSource] = useState<'manual' | 'scan' | 'summary' | null>(null);
  const [showPatrolChoice, setShowPatrolChoice] = useState(false);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [answersInput, setAnswersInput] = useState('');
  const [answersError, setAnswersError] = useState('');
  const [useTargetScoring, setUseTargetScoring] = useState(false);
  const [categoryAnswers, setCategoryAnswers] = useState<Record<string, string>>({});
  const [outboxItems, setOutboxItems] = useState<OutboxEntry[]>([]);
  const [showPendingDetails, setShowPendingDetails] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const didRecoverOutbox = useRef(false);
  const flushInFlightRef = useRef(false);
  const reconnectRetryTimeoutRef = useRef<number | null>(null);
  const flushLockOwnerIdRef = useRef(
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `flush-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [authNeedsLogin, setAuthNeedsLogin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanRecord[]>([]);
  const [scanHistoryLoading, setScanHistoryLoading] = useState(false);
  const [scanHistoryError, setScanHistoryError] = useState<string | null>(null);
  const [manualCodeDraft, setManualCodeDraft] = useState('');
  const [confirmedManualCode, setConfirmedManualCode] = useState('');
  const [patrolRegistryEntries, setPatrolRegistryEntries] = useState<PatrolRegistryEntry[]>([]);
  const [patrolRegistryLoading, setPatrolRegistryLoading] = useState(true);
  const [patrolRegistryError, setPatrolRegistryError] = useState<string | null>(null);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);
  const [manualPatrols, setManualPatrols] = useState<Patrol[]>([]);
  const [manualValidation, setManualValidation] = useState<PatrolValidationState>({
    code: '',
    valid: false,
    reason: 'loading',
    message: 'Načítám dostupná čísla hlídek…',
  });
  const [scanActive, setScanActive] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tick, setTick] = useState(0);
  const [autoScore, setAutoScore] = useState({ correct: 0, total: 0, given: 0, normalizedGiven: '' });
  const [alerts, setAlerts] = useState<string[]>([]);
  const displayAlerts = useMemo(() => {
    if (scoringDisabled) {
      const baseMessage = 'Závod byl ukončen. Zapisování bodů bylo kanceláří uzamčeno.';
      if (alerts.includes(baseMessage)) {
        return alerts;
      }
      return [baseMessage, ...alerts];
    }
    return alerts;
  }, [alerts, scoringDisabled]);
  const [arrivedAt, setArrivedAt] = useState<string | null>(null);
  const [finishAt, setFinishAt] = useState<string | null>(null);
  const [totalWaitMinutes, setTotalWaitMinutes] = useState<number | null>(null);
  const [waitDraft, setWaitDraft] = useState(WAIT_TIME_ZERO);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const tempCodesRef = useRef<Map<string, string>>(new Map());
  const tempCounterRef = useRef(1);
  const formRef = useRef<HTMLElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const summaryDetailRef = useRef<HTMLDivElement | null>(null);
  const summaryMissingRef = useRef<HTMLDivElement | null>(null);
  const summaryCompletedRef = useRef<HTMLDivElement | null>(null);
  const ticketQueueRef = useRef<HTMLElement | null>(null);
  const pointsInputRef = useRef<HTMLInputElement | null>(null);
  const answersInputRef = useRef<HTMLInputElement | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [finishTimeInput, setFinishTimeInput] = useState('');
  const [scoreReviewRows, setScoreReviewRows] = useState<StationScoreRow[]>([]);
  const [scoreReviewState, setScoreReviewState] = useState<Record<string, StationScoreRowState>>({});
  const [scoreReviewLoading, setScoreReviewLoading] = useState(false);
  const [scoreReviewError, setScoreReviewError] = useState<string | null>(null);
  const [stationPassageIds, setStationPassageIds] = useState<string[]>([]);
  const [stationPassageLoading, setStationPassageLoading] = useState(false);
  const [stationPassageError, setStationPassageError] = useState<string | null>(null);
  const [selectedSummaryCategory, setSelectedSummaryCategory] = useState<StationCategoryKey | null>(null);
  const [showCompletedSummary, setShowCompletedSummary] = useState(false);
  const [showScannerPanel, setShowScannerPanel] = useState(false);
  const lastSummaryScrollRef = useRef<StationCategoryKey | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!eventId) {
        return;
      }
      try {
        const stored = await getManualPatrols(eventId);
        if (!cancelled) {
          setManualPatrols(stored);
        }
      } catch (error) {
        console.error('manual patrols load failed', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const enableTicketQueue = !isTargetStation;
  const scrollToQueue = useCallback(() => {
    if (!enableTicketQueue) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const element = ticketQueueRef.current;
    if (!element) {
      return;
    }
    window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [enableTicketQueue]);
  const scrollToSummary = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const element = summaryRef.current;
    if (!element) {
      return;
    }
    window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);
  const allowedCategorySet = useMemo(() => {
    const manifestCategories = Array.isArray(manifest.allowedCategories)
      ? manifest.allowedCategories
      : [];
    const normalizedManifest = manifestCategories
      .map((category) => (typeof category === 'string' ? category.trim().toUpperCase() : ''))
      .filter((category): category is CategoryKey => category.length > 0 && isCategoryKey(category));
    const fallbackCategories = getStationAllowedBaseCategories(stationCode);
    const effectiveCategories = normalizedManifest.length ? normalizedManifest : fallbackCategories;
    return new Set<CategoryKey>(effectiveCategories);
  }, [manifest.allowedCategories, stationCode]);
  const allowedStationCategories = useMemo(() => {
    if (allowedCategorySet.size === 0) {
      return getAllowedStationCategories(stationCode);
    }
    return getAllowedStationCategories(stationCode, { baseCategories: allowedCategorySet });
  }, [allowedCategorySet, stationCode]);
  const allowedStationCategorySet = useMemo(
    () => new Set<StationCategoryKey>(allowedStationCategories),
    [allowedStationCategories],
  );
  const allowedStationCategoryLabel = useMemo(() => {
    if (!allowedStationCategories.length) {
      return '—';
    }
    return allowedStationCategories.map((category) => formatStationCategoryChipLabel(category)).join(', ');
  }, [allowedStationCategories]);
  const stationRules = useMemo(() => {
    const rules: string[] = [];
    if (isTargetStation) {
      rules.push('Zapiš čas doběhu ve formátu HH:MM.');
      rules.push('12 bodů je za limitní čas dle kategorie, za každých započatých 10 minut navíc se odečte 1 bod.');
      rules.push('Zadej odpovědi v terčovém úseku, body se spočítají automaticky.');
    } else {
      rules.push('Zapisuj body v rozsahu 0–12.');
      rules.push('Čekání zadávej ve formátu HH:MM (bez vteřin).');
      if (enableTicketQueue) {
        rules.push('Hlídku můžeš vrátit do fronty nebo ji obsloužit hned.');
      }
    }
    return rules;
  }, [enableTicketQueue, isTargetStation]);
  useEffect(() => {
    setSelectedSummaryCategory((previous) => {
      if (!previous) {
        return null;
      }
      return allowedStationCategorySet.has(previous) ? previous : null;
    });
  }, [allowedStationCategorySet]);

  useEffect(() => {
    setShowCompletedSummary(false);
  }, [selectedSummaryCategory]);
  const isCategoryAllowed = useCallback(
    (category: string | null | undefined) => {
      if (allowedCategorySet.size === 0) {
        return true;
      }
      const normalized = category?.trim().toUpperCase() ?? '';
      if (!isCategoryKey(normalized)) {
        return false;
      }
      return allowedCategorySet.has(normalized);
    },
    [allowedCategorySet],
  );
  const reportSupabaseError = useCallback(
    (context: string, error: { message?: string } | null, status?: number) => {
      if (import.meta.env.DEV) {
        console.debug('[supabase] request failed', {
          context,
          status,
          message: error?.message ?? null,
        });
      }
      if (status === 403) {
        setAccessDeniedMessage(ACCESS_DENIED_MESSAGE);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const loadRegistry = async () => {
      setPatrolRegistryLoading(true);
      setPatrolRegistryError(null);

      const cachedRegistry = await loadPatrolRegistryCache(eventId);
      if (!cancelled && cachedRegistry?.entries?.length) {
        setPatrolRegistryEntries(cachedRegistry.entries);
      }

      const registryResult = await fetchPatrolRegistryEntries({
        online: navigator.onLine,
        cachedEntries: cachedRegistry?.entries ?? null,
        fetchRows: async () => {
          const { data, error, status } = await supabase
            .from('patrols')
            .select('id, patrol_code, category, sex, active')
            .eq('event_id', eventId)
            .order('category')
            .order('sex')
            .order('patrol_code');
          if (error) {
            reportSupabaseError('patrols.registry', error, status);
          }
          return { data, error };
        },
        isCategoryAllowed,
      });

      if (cancelled) {
        return;
      }

      if (!registryResult.fetched && registryResult.error) {
        console.error('Failed to load patrol registry', registryResult.error);
      }

      if (registryResult.entries) {
        setPatrolRegistryEntries(registryResult.entries);
      }

      if (registryResult.fetched && registryResult.entries) {
        try {
          await savePatrolRegistryCache(eventId, registryResult.entries);
        } catch (storageError) {
          console.warn('Failed to cache patrol registry', storageError);
        }
      }

      if (registryResult.stats) {
        console.info('[patrol-code-input] registry-loaded', registryResult.stats);
      }

      if (registryResult.error) {
        setPatrolRegistryError(registryResult.error);
      } else if (!registryResult.entries?.length && cachedRegistry?.entries?.length) {
        setPatrolRegistryError(null);
      }

      setPatrolRegistryLoading(false);
    };

    void loadRegistry();

    return () => {
      cancelled = true;
    };
  }, [eventId, isCategoryAllowed, reportSupabaseError]);

  const patrolRegistryState = useMemo(
    () => ({
      loading: patrolRegistryLoading,
      entries: patrolRegistryEntries,
      error: patrolRegistryError,
    }),
    [patrolRegistryEntries, patrolRegistryError, patrolRegistryLoading],
  );
  const updateTickets = useCallback(
    (updater: (current: Ticket[]) => Ticket[]) => {
      let nextTickets: Ticket[] = [];
      setTickets((prev) => {
        const next = updater(prev);
        nextTickets = next;
        void saveTickets(stationId, next);
        return next;
      });
      return nextTickets;
    },
    [stationId],
  );

  const updateOutboxState = useCallback((items: OutboxEntry[]) => {
    const sorted = [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    setOutboxItems(sorted);
  }, []);

  const pushAlert = useCallback((message: string) => {
    setAlerts((prev) => [...prev, message]);
    setTimeout(() => {
      setAlerts((prev) => prev.slice(1));
    }, 4500);
  }, []);

  const normalizeOutboxForSession = useCallback(
    async (items: OutboxEntry[]) => {
      const now = Date.now();
      let changed = false;
      const updated = items.map<OutboxEntry>((item) => {
        if (item.state === 'sent') {
          return item;
        }
        const isCurrent = item.event_id === eventId && item.station_id === stationId;
        if (!isCurrent && item.state !== 'blocked_other_session') {
          changed = true;
          return { ...item, state: 'blocked_other_session', next_attempt_at: now };
        }
        if (isCurrent && item.state === 'blocked_other_session') {
          changed = true;
          return { ...item, state: 'queued', next_attempt_at: now };
        }
        return item;
      });
      if (changed) {
        await writeOutboxEntriesAndSync(updated);
      }
      return updated;
    },
    [eventId, stationId],
  );

  const refreshOutbox = useCallback(async () => {
    const items = await readOutbox();
    let nextItems = items;
    if (!didRecoverOutbox.current) {
      didRecoverOutbox.current = true;
      const now = Date.now();
      const recovered = items.map((item) =>
        item.state === 'sending' ? { ...item, state: 'queued', next_attempt_at: now } : item,
      );
      if (recovered.some((item, index) => item !== items[index])) {
        await writeOutboxEntriesAndSync(recovered);
      }
      nextItems = recovered;
    }
    const normalized = await normalizeOutboxForSession(nextItems);
    updateOutboxState(normalized);
  }, [normalizeOutboxForSession, updateOutboxState]);

  useEffect(() => {
    void refreshOutbox();
  }, [refreshOutbox]);

  const currentSessionItems = useMemo(
    () => outboxItems.filter((item) => item.event_id === eventId && item.station_id === stationId),
    [eventId, outboxItems, stationId],
  );
  const queuedPatrolIds = useMemo(() => {
    const ids = new Set<string>();
    if (!enableTicketQueue) {
      return ids;
    }
    tickets.forEach((ticket) => {
      if (ticket.state === 'waiting' || ticket.state === 'serving') {
        ids.add(ticket.patrolId);
      }
    });
    return ids;
  }, [enableTicketQueue, tickets]);
  const hasQueueTickets = useMemo(() => {
    if (!enableTicketQueue) {
      return false;
    }
    return tickets.some((ticket) => ticket.state === 'waiting' || ticket.state === 'serving');
  }, [enableTicketQueue, tickets]);
  const otherSessionItems = useMemo(
    () => outboxItems.filter((item) => item.event_id !== eventId || item.station_id !== stationId),
    [eventId, outboxItems, stationId],
  );
  const pendingCount = useMemo(
    () => currentSessionItems.filter((item) => item.state !== 'sent').length,
    [currentSessionItems],
  );

  useEffect(() => {
    if (outboxItems.length === 0) {
      setShowPendingDetails(false);
    }
  }, [outboxItems.length]);

  const handleClearOtherSessions = useCallback(async () => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Opravdu chcete vyčistit záznamy z jiné relace?');
      if (!confirmed) {
        return;
      }
    }
    const idsToRemove = otherSessionItems.map((item) => item.client_event_id);
    if (!idsToRemove.length) {
      return;
    }
    await deleteOutboxEntries(idsToRemove);
    const filtered = outboxItems.filter((item) => !idsToRemove.includes(item.client_event_id));
    updateOutboxState(filtered);
    pushAlert('Staré záznamy z jiné relace byly odstraněny.');
  }, [otherSessionItems, outboxItems, pushAlert, updateOutboxState]);

  const handleRemoveOutboxEntry = useCallback(
    async (entry: OutboxEntry) => {
      if (typeof window !== 'undefined') {
        const confirmed = window.confirm('Opravdu chcete záznam z fronty odstranit?');
        if (!confirmed) {
          return;
        }
      }
      await deleteOutboxEntries([entry.client_event_id]);
      const filtered = outboxItems.filter((item) => item.client_event_id !== entry.client_event_id);
      updateOutboxState(filtered);
      pushAlert('Záznam byl z fronty odstraněn.');
    },
    [outboxItems, pushAlert, updateOutboxState],
  );

  const lastManifestToastAtRef = useRef<number | null>(null);

  useEffect(() => {
    tempCodesRef.current.clear();
    tempCounterRef.current = 1;
  }, [stationId]);

  const resolvePatrolCode = useCallback(
    (currentPatrol: Patrol | null) => {
      if (!currentPatrol) {
        return '';
      }
      const raw = (currentPatrol.patrol_code ?? '').trim().toUpperCase();
      if (raw) {
        return raw;
      }
      const existing = tempCodesRef.current.get(currentPatrol.id);
      if (existing) {
        return existing;
      }
      const nextValue = `TMP-${String(tempCounterRef.current).padStart(3, '0')}`;
      tempCounterRef.current += 1;
      tempCodesRef.current.set(currentPatrol.id, nextValue);
      return nextValue;
    },
    [],
  );

  const previewPatrolCode = scannerPatrol ? resolvePatrolCode(scannerPatrol) : '';
  const showScannerPreview = Boolean(scannerPatrol && scannerSource === 'scan');

  useEffect(() => {
    let cancelled = false;
    let onlineListener: (() => void) | null = null;
    const toastCooldownMs = 10 * 60 * 1000;

    const scheduleRetryOnOnline = () => {
      if (onlineListener) return;
      onlineListener = () => {
        onlineListener = null;
        if (!cancelled) {
          void refresh();
        }
      };
      window.addEventListener('online', onlineListener, { once: true });
    };

    const refresh = async () => {
      try {
        if (navigator.onLine === false) {
          scheduleRetryOnOnline();
          return;
        }
        await refreshManifest();
      } catch (error) {
        console.error('Manifest refresh failed', error);
        if (navigator.onLine === false) {
          scheduleRetryOnOnline();
          return;
        }
        if (!cancelled) {
          const now = Date.now();
          const lastToastAt = lastManifestToastAtRef.current ?? 0;
          const isThrottled = now - lastToastAt < toastCooldownMs;
          const isDev = import.meta.env.DEV;
          const manifestError = error instanceof ManifestFetchError ? error : null;
          const isNotFoundOrHtml =
            manifestError?.isNotFound || manifestError?.isHtmlResponse || manifestError?.kind === 'content-type';
          const allowToast = isDev || (!isThrottled && !isNotFoundOrHtml);

          if (allowToast) {
            lastManifestToastAtRef.current = now;
            pushAlert('Nepodařilo se obnovit manifest. Zkusím to znovu později.');
          }
        }
      }
    };

    refresh();
    const interval = window.setInterval(refresh, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (onlineListener) {
        window.removeEventListener('online', onlineListener);
      }
    };
  }, [refreshManifest, pushAlert]);

  useEffect(() => {
    setFinishTimeInput(toLocalTimeInput(finishAt));
  }, [finishAt, stationId]);

  const handleAddTicket = useCallback(
    (initialState: Extract<TicketState, 'waiting' | 'serving'> = 'waiting') => {
      if (scoringDisabled) {
        pushAlert('Závod byl ukončen. Zapisování bodů je uzamčeno.');
        return;
      }
      if (!scannerPatrol) {
        pushAlert('Nejprve načti hlídku.');
        return;
      }

      let addedState: TicketState | null = null;
      const patrolCode = resolvePatrolCode(scannerPatrol);

      updateTickets((current) => {
        const exists = current.some((ticket) => ticket.patrolId === scannerPatrol.id && ticket.state !== 'done');
        if (exists) {
          return current;
        }
        const newTicket = createTicket({
          patrolId: scannerPatrol.id,
          patrolCode,
          teamName: scannerPatrol.team_name,
          category: scannerPatrol.category,
          sex: scannerPatrol.sex,
          initialState,
        });
        addedState = newTicket.state;
        return [...current, newTicket];
      });

      if (addedState) {
        if (initialState === 'serving') {
          pushAlert(`Hlídka ${scannerPatrol.team_name} je připravena k obsluze.`);
        } else {
          pushAlert(`Do fronty přidána hlídka ${scannerPatrol.team_name}.`);
        }
        setShowPatrolChoice(false);
      } else {
        setShowPatrolChoice(false);
      }
    },
    [scannerPatrol, pushAlert, resolvePatrolCode, scoringDisabled, updateTickets],
  );

  const clearWait = useCallback(() => {
    setWaitDraft(WAIT_TIME_ZERO);
  }, []);

  const patrolById = useMemo(() => {
    const map = new Map<string, Patrol>();
    auth.patrols.forEach((summary) => {
      if (!isCategoryAllowed(summary.category)) {
        return;
      }
      map.set(summary.id, {
        id: summary.id,
        team_name: summary.team_name,
        category: summary.category,
        sex: summary.sex,
        patrol_code: summary.patrol_code,
      });
    });
    return map;
  }, [auth.patrols, isCategoryAllowed]);

  const registerManualPatrol = useCallback(
    async (patrol: Patrol) => {
      if (!eventId) {
        return;
      }
      if (!patrol.id.startsWith('manual-') || !patrol.patrol_code) {
        return;
      }
      try {
        const next = await upsertManualPatrol(eventId, {
          id: patrol.id,
          team_name: patrol.team_name,
          category: patrol.category,
          sex: patrol.sex,
          patrol_code: patrol.patrol_code,
        });
        setManualPatrols(next);
      } catch (error) {
        console.error('manual patrols persist failed', error);
      }
    },
    [eventId],
  );

  const stationPassageVisitedSet = useMemo(() => {
    const visited = new Set<string>();
    stationPassageIds.forEach((id) => {
      if (typeof id === 'string' && id.length > 0) {
        visited.add(id);
      }
    });

    currentSessionItems.forEach((item) => {
      if (item.type !== 'station_score') {
        return;
      }
      const payload = item.payload;
      if (!payload || payload.event_id !== eventId || payload.station_id !== stationId) {
        return;
      }
      if (payload.patrol_id) {
        visited.add(payload.patrol_id);
      }
    });

    queuedPatrolIds.forEach((id) => {
      visited.add(id);
    });

    return visited;
  }, [currentSessionItems, eventId, queuedPatrolIds, stationId, stationPassageIds]);


  const loadTimingData = useCallback(
    async (patrolId: string) => {
      if (stationCode !== 'T') {
        setStartTime(null);
        setFinishAt(null);
        setTotalWaitMinutes(null);
        return;
      }

      const [
        { data: timingRows, error: timingError, status: timingStatus },
        { data: passageRows, error: waitError, status: waitStatus },
      ] =
        await Promise.all([
          supabase
            .from('timings')
            .select('start_time, finish_time')
            .eq('event_id', eventId)
            .eq('patrol_id', patrolId),
          supabase
            .from('station_passages')
            .select('wait_minutes')
            .eq('event_id', eventId)
            .eq('patrol_id', patrolId),
        ]);

      if (timingError) {
        reportSupabaseError('timings.load', timingError, timingStatus);
        console.error('Failed to load finish time', timingError);
        setStartTime(null);
        setFinishAt(null);
        setTotalWaitMinutes(null);
        return;
      }

      const row = Array.isArray(timingRows) && timingRows.length > 0 ? timingRows[0] : null;
      const timing = row as { start_time?: string | null; finish_time?: string | null } | null;
      setStartTime(timing?.start_time ?? null);
      setFinishAt(timing?.finish_time ?? null);

      if (waitError) {
        reportSupabaseError('station_passages.wait', waitError, waitStatus);
        console.error('Failed to load wait data', waitError);
        setTotalWaitMinutes(null);
      } else {
        const rows = (passageRows as { wait_minutes?: number | null }[] | null) ?? [];
        const total = rows.reduce((acc, current) => {
          const value = Number(current?.wait_minutes ?? 0);
          return Number.isFinite(value) ? acc + value : acc;
        }, 0);
        setTotalWaitMinutes(total);
      }
    },
    [eventId, reportSupabaseError, stationCode],
  );

  const loadScoreReview = useCallback(
    async (
      patrolId: string,
      patrolCode?: string | null,
      patrolCategory?: string | null,
      patrolSex?: string | null,
    ) => {
      if (!canReviewStationScores) {
        setScoreReviewRows([]);
        setScoreReviewState({});
        setScoreReviewError(null);
        setScoreReviewLoading(false);
        return;
      }

      setScoreReviewLoading(true);
      setScoreReviewError(null);

      try {
        let stationsData: { id: string; code: string; name: string }[] = [];
        let scoresData: { station_id: string; points: number | null; judge: string | null; note: string | null }[] = [];
        let waitsData: { station_id: string; wait_minutes: number | null }[] = [];

        if (SCORE_REVIEW_URL) {
          const response = await fetch(SCORE_REVIEW_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_id: eventId,
              patrol_id: patrolId,
              patrol_code: patrolCode ?? '',
            }),
          });

          setScoreReviewLoading(false);

          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            console.error('Failed to load station scores for review', {
              status: response.status,
              detail,
            });
            setScoreReviewRows([]);
            setScoreReviewState({});
            setScoreReviewError('Nepodařilo se načíst body ostatních stanovišť.');
            return;
          }

          const payload = (await response.json().catch(() => null)) as
            | {
                stations?: { id: string; code: string; name: string }[];
                scores?: { station_id: string; points: number | null; judge: string | null; note: string | null }[];
                waits?: { station_id: string; wait_minutes: number | null }[];
              }
            | null;

          stationsData = payload?.stations ?? [];
          scoresData = payload?.scores ?? [];
          waitsData = payload?.waits ?? [];
        } else {
          const [stationsRes, scoresRes, waitsRes] = await Promise.all([
            supabase
              .from('stations')
              .select('id, code, name')
              .eq('event_id', eventId),
            supabase
              .from('station_scores')
              .select('station_id, points, judge, note')
              .eq('event_id', eventId)
              .eq('patrol_id', patrolId),
            supabase
              .from('station_passages')
              .select('station_id, wait_minutes')
              .eq('event_id', eventId)
              .eq('patrol_id', patrolId),
          ]);

          setScoreReviewLoading(false);

          if (stationsRes.error || scoresRes.error || waitsRes.error) {
            reportSupabaseError('stations.review', stationsRes.error, stationsRes.status);
            reportSupabaseError('station_scores.review', scoresRes.error, scoresRes.status);
            reportSupabaseError('station_passages.review', waitsRes.error, waitsRes.status);
            console.error(
              'Failed to load station scores for review',
              stationsRes.error,
              scoresRes.error,
              waitsRes.error,
            );
            setScoreReviewRows([]);
            setScoreReviewState({});
            setScoreReviewError('Nepodařilo se načíst body ostatních stanovišť.');
            return;
          }

          stationsData = (stationsRes.data ?? []) as { id: string; code: string; name: string }[];
          scoresData = (scoresRes.data ?? []) as {
            station_id: string;
            points: number | null;
            judge: string | null;
            note: string | null;
          }[];
          waitsData = (waitsRes.data ?? []) as { station_id: string; wait_minutes: number | null }[];
        }

        const patrolStationCategory = toStationCategoryKey(patrolCategory, patrolSex);
        const stations = stationsData
          .map((station) => ({
          id: station.id,
          code: (station.code || '').trim().toUpperCase(),
          name: station.name,
        }))
          .filter((station) => {
            if (station.code === 'T' || station.code === 'R') {
              return false;
            }
            if (!patrolStationCategory) {
              return true;
            }
            return getAllowedStationCategories(station.code).includes(patrolStationCategory);
          });

        const scoreMap = new Map<
          string,
          { points: number | null; judge: string | null; note: string | null }
        >();
        scoresData.forEach((row) => {
          scoreMap.set(row.station_id, {
            points: typeof row.points === 'number' ? row.points : row.points ?? null,
            judge: row.judge ?? null,
            note: row.note ?? null,
          });
        });

        const waitValues = new Map<string, number>();
        const waitPresent = new Set<string>();
        waitsData.forEach((row) => {
          const station = row.station_id;
          if (typeof station !== 'string' || station.length === 0) {
            return;
          }
          const wait = Number(row.wait_minutes ?? 0);
          if (!Number.isFinite(wait) || wait < 0) {
            waitValues.set(station, 0);
          } else {
            waitValues.set(station, wait);
          }
          waitPresent.add(station);
        });

        const rows = stations
          .map<StationScoreRow>((station) => {
            const existing = scoreMap.get(station.id);
            const waitValue = waitValues.get(station.id);
            return {
              stationId: station.id,
              stationCode: station.code,
              stationName: station.name,
              points: existing?.points ?? null,
              waitMinutes: waitValue ?? null,
              judge: existing?.judge ?? null,
              note: existing?.note ?? null,
              hasScore: typeof existing?.points === 'number',
              hasWait: waitPresent.has(station.id),
            };
          })
          .sort((a, b) => a.stationCode.localeCompare(b.stationCode, 'cs'));

        setScoreReviewRows(rows);
        setScoreReviewState((prev) => {
          const next: Record<string, StationScoreRowState> = {};
          rows.forEach((row) => {
            const previous = prev[row.stationId];
            const defaultPointsDraft = row.points !== null ? String(row.points) : '';
            const defaultWaitDraft = formatWaitDraft(row.waitMinutes);
            next[row.stationId] = {
              ok: previous?.ok ?? true,
              pointsDraft: previous
                ? previous.ok
                  ? defaultPointsDraft
                  : previous.pointsDraft
                : defaultPointsDraft,
              waitDraft: previous
                ? previous.ok
                  ? defaultWaitDraft
                  : previous.waitDraft
                : defaultWaitDraft,
              saving: false,
              error: null,
            };
          });
          return next;
        });
      } catch (error) {
        setScoreReviewLoading(false);
        setScoreReviewRows([]);
        setScoreReviewState({});
        setScoreReviewError('Nepodařilo se načíst body ostatních stanovišť.');
        console.error('Failed to load station score review', error);
      }
    },
    [eventId, canReviewStationScores, reportSupabaseError],
  );

  const initializeFormForPatrol = useCallback(
    (data: Patrol, options?: { arrivedAt?: string | null; waitSeconds?: number | null }) => {
      setActivePatrol({ ...data });
      setScannerPatrol({ ...data });
      setPoints('');
      setNote('');
      setAnswersInput('');
      setAnswersError('');
      setScanActive(false);
      setManualCodeDraft('');
      setConfirmedManualCode('');
      setUseTargetScoring(isTargetStation);

      const arrival = options?.arrivedAt ?? new Date().toISOString();
      setArrivedAt(arrival);

      clearWait();

      const waitMinutes = !isTargetStation && typeof options?.waitSeconds === 'number'
        ? waitSecondsToMinutes(options.waitSeconds)
        : 0;
      setWaitDraft(formatWaitMinutes(waitMinutes));

      const stored = categoryAnswers[data.category] || '';
      const total = parseAnswerLetters(stored).length;
      setAutoScore({ correct: 0, total, given: 0, normalizedGiven: '' });

      void loadTimingData(data.id);
      if (canReviewStationScores) {
        void loadScoreReview(data.id, data.patrol_code, data.category, data.sex);
      }

      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (isTargetStation) {
            answersInputRef.current?.focus();
          } else {
            pointsInputRef.current?.focus();
          }
        });
      }
    },
    [
      categoryAnswers,
      clearWait,
      isTargetStation,
      loadTimingData,
      loadScoreReview,
      canReviewStationScores,
    ],
  );

  const handleServePatrol = useCallback(() => {
    if (enableTicketQueue) {
      handleAddTicket('serving');
      return;
    }
    if (!scannerPatrol) {
      pushAlert('Nejprve načti hlídku.');
      return;
    }
    initializeFormForPatrol(scannerPatrol);
    if (stationCode === 'T' && scannerSource === 'summary') {
      setSelectedSummaryCategory(null);
    }
    pushAlert(`Hlídka ${scannerPatrol.team_name} je připravena k obsluze.`);
    setShowPatrolChoice(false);
  }, [
    enableTicketQueue,
    handleAddTicket,
    initializeFormForPatrol,
    pushAlert,
    scannerPatrol,
    scannerSource,
    setSelectedSummaryCategory,
    stationCode,
  ]);

  const handleScoreOkToggle = useCallback(
    (stationId: string, ok: boolean) => {
      setScoreReviewState((prev) => {
        const next = { ...prev };
        const base = scoreReviewRows.find((row) => row.stationId === stationId);
        const defaultPointsDraft = base && base.points !== null ? String(base.points) : '';
        const defaultWaitDraft = formatWaitDraft(base?.waitMinutes);
        const current = prev[stationId];
        next[stationId] = {
          ok,
          pointsDraft: ok ? defaultPointsDraft : current?.pointsDraft ?? defaultPointsDraft,
          waitDraft: ok ? defaultWaitDraft : current?.waitDraft ?? defaultWaitDraft,
          saving: false,
          error: null,
        };
        return next;
      });
    },
    [scoreReviewRows],
  );

  const handleScoreDraftChange = useCallback((stationId: string, value: string) => {
    setScoreReviewState((prev) => {
      const current =
        prev[stationId] ?? { ok: false, pointsDraft: '', waitDraft: WAIT_TIME_ZERO, saving: false, error: null };
      return {
        ...prev,
        [stationId]: {
          ...current,
          pointsDraft: value,
          error: null,
        },
      };
    });
  }, []);

  const handleWaitDraftChange = useCallback((stationId: string, value: string) => {
    setScoreReviewState((prev) => {
      const current =
        prev[stationId] ?? { ok: false, pointsDraft: '', waitDraft: WAIT_TIME_ZERO, saving: false, error: null };
      const nextWaitDraft = normalizeWaitInput(value, current.waitDraft);
      return {
        ...prev,
        [stationId]: {
          ...current,
          waitDraft: nextWaitDraft,
          error: null,
        },
      };
    });
  }, []);

  const handleRefreshScoreReview = useCallback(() => {
    if (activePatrol) {
      void loadScoreReview(
        activePatrol.id,
        activePatrol.patrol_code,
        activePatrol.category,
        activePatrol.sex,
      );
    }
  }, [loadScoreReview, activePatrol]);

  const handleTicketStateChange = useCallback(
    (id: string, nextState: Ticket['state']) => {
      const existingTicket = tickets.find((ticket) => ticket.id === id);
      if (!existingTicket) {
        return;
      }

      const nextTicket = transitionTicket(existingTicket, nextState);

      updateTickets((current) =>
        current.map((ticket) => (ticket.id === id ? nextTicket : ticket)),
      );

      if (nextState !== 'done') {
        return;
      }

      const summary = patrolById.get(nextTicket.patrolId);
      const ticketPatrol: Patrol = summary
        ? {
          id: summary.id,
          team_name: summary.team_name,
          category: summary.category,
          sex: summary.sex,
          patrol_code: summary.patrol_code || nextTicket.patrolCode || null,
        }
        : {
          id: nextTicket.patrolId,
          team_name: nextTicket.teamName,
          category: nextTicket.category,
          sex: nextTicket.sex,
          patrol_code: nextTicket.patrolCode || null,
        };

      if (!ticketPatrol.team_name) {
        pushAlert('Hlídku se nepodařilo otevřít, není v manifestu.');
        return;
      }

      const waitSeconds = Math.max(0, Math.round(nextTicket.waitAccumMs / 1000));
      initializeFormForPatrol(ticketPatrol, {
        arrivedAt: nextTicket.createdAt,
        waitSeconds,
      });
    },
    [initializeFormForPatrol, patrolById, pushAlert, tickets, updateTickets],
  );

  const handleRemoveTicket = useCallback(
    (id: string) => {
      updateTickets((current) => current.filter((ticket) => ticket.id !== id));
    },
    [updateTickets],
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const desiredPath = getStationPath(stationDisplayName);
      if (window.location.pathname !== desiredPath) {
        window.history.replaceState({}, '', desiredPath + window.location.search + window.location.hash);
      }
    }
  }, [stationDisplayName]);

  useEffect(() => {
    loadTickets(stationId).then((loaded) => {
      setTickets(loaded);
    });
  }, [stationId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setUseTargetScoring(isTargetStation);
  }, [isTargetStation]);

  const loadCategoryAnswers = useCallback(async () => {
    if (!stationId) {
      return;
    }
    const { data, error, status } = await supabase
      .from('station_category_answers')
      .select('category, correct_answers')
      .eq('event_id', eventId)
      .eq('station_id', stationId);

    if (error) {
      reportSupabaseError('station_category_answers.load', error, status);
      console.error(error);
      pushAlert('Nepodařilo se načíst správné odpovědi.');
      return;
    }

    const map: Record<string, string> = {};
    (data || []).forEach((row) => {
      map[row.category] = row.correct_answers;
    });
    setCategoryAnswers(map);
  }, [eventId, stationId, pushAlert, reportSupabaseError]);

  const loadStationPassages = useCallback(async () => {
    setStationPassageLoading(true);
    setStationPassageError(null);

    try {
      const judgeId = manifest.judge.id;
      const [passagesRes, scoresRes] = await Promise.all([
        supabase
          .from('station_passages')
          .select('patrol_id')
          .eq('event_id', eventId)
          .eq('station_id', stationId)
          .eq('submitted_by', judgeId),
        supabase
          .from('station_scores')
          .select('patrol_id')
          .eq('event_id', eventId)
          .eq('station_id', stationId)
          .eq('submitted_by', judgeId),
      ]);

      if (passagesRes.error || scoresRes.error) {
        reportSupabaseError('station_passages.summary', passagesRes.error, passagesRes.status);
        reportSupabaseError('station_scores.summary', scoresRes.error, scoresRes.status);
        throw passagesRes.error || scoresRes.error;
      }

      const rows = (passagesRes.data ?? []) as { patrol_id: string | null }[];
      const scoreRows = (scoresRes.data ?? []) as { patrol_id: string | null }[];
      const ids = new Set<string>();
      rows.forEach((row) => {
        if (typeof row.patrol_id === 'string' && row.patrol_id.length > 0) {
          ids.add(row.patrol_id);
        }
      });
      scoreRows.forEach((row) => {
        if (typeof row.patrol_id === 'string' && row.patrol_id.length > 0) {
          ids.add(row.patrol_id);
        }
      });
      setStationPassageIds(Array.from(ids));
    } catch (error) {
      console.error('Failed to load station passages summary', error);
      setStationPassageError('Nepodařilo se načíst průchody hlídek.');
    } finally {
      setStationPassageLoading(false);
    }
  }, [eventId, manifest.judge.id, reportSupabaseError, stationId]);

  const stationCategorySummary = useMemo<StationCategorySummary>(() => {
    const record = createStationCategoryRecord(() => ({
      expected: 0,
      visited: 0,
      missing: [] as StationSummaryPatrol[],
      completed: [] as StationSummaryPatrol[],
    }));
    let totalExpected = 0;
    let totalVisited = 0;
    const seen = new Set<string>();

    auth.patrols.forEach((patrolSummary) => {
      if (!isCategoryAllowed(patrolSummary.category)) {
        return;
      }
      const stationCategory = toStationCategoryKey(patrolSummary.category, patrolSummary.sex);
      if (!stationCategory || !allowedStationCategorySet.has(stationCategory)) {
        return;
      }
      const normalizedCode = normalisePatrolCode(patrolSummary.patrol_code ?? '');
      seen.add(patrolSummary.id);
      if (normalizedCode) {
        seen.add(`code:${normalizedCode}`);
      }
      const teamName = (patrolSummary.team_name || '').trim();
      const detail: StationSummaryPatrol = {
        id: patrolSummary.id,
        code: normalizedCode,
        teamName,
        baseCategory: patrolSummary.category,
        sex: patrolSummary.sex,
        visited: stationPassageVisitedSet.has(patrolSummary.id),
      };

      record[stationCategory].expected += 1;
      totalExpected += 1;

      if (detail.visited) {
        record[stationCategory].visited += 1;
        totalVisited += 1;
        record[stationCategory].completed.push(detail);
      } else {
        record[stationCategory].missing.push(detail);
      }
    });

    manualPatrols.forEach((manual) => {
      if (!isCategoryAllowed(manual.category)) {
        return;
      }
      const stationCategory = toStationCategoryKey(manual.category, manual.sex);
      if (!stationCategory || !allowedStationCategorySet.has(stationCategory)) {
        return;
      }
      const normalizedCode = normalisePatrolCode(manual.patrol_code ?? '');
      if (seen.has(manual.id) || (normalizedCode && seen.has(`code:${normalizedCode}`))) {
        return;
      }
      const visited = stationPassageVisitedSet.has(manual.id) || manual.id.startsWith('manual-');
      const detail: StationSummaryPatrol = {
        id: manual.id,
        code: normalizedCode || manual.patrol_code || manual.id,
        teamName: (manual.team_name || 'Ruční hlídka').trim(),
        baseCategory: manual.category,
        sex: manual.sex,
        visited,
      };
      record[stationCategory].expected += 1;
      totalExpected += 1;
      if (detail.visited) {
        record[stationCategory].visited += 1;
        totalVisited += 1;
        record[stationCategory].completed.push(detail);
      } else {
        record[stationCategory].missing.push(detail);
      }
    });

    const items = allowedStationCategories.map<StationCategorySummaryItem>((category) => {
      const entry = record[category];
      const missing = [...entry.missing].sort(compareSummaryPatrols);
      const completed = [...entry.completed].sort(compareSummaryPatrols);
      return {
        key: category,
        expected: entry.expected,
        visited: entry.visited,
        missing,
        completed,
      };
    });

    const totalMissing = items.flatMap((item) => item.missing);

    return {
      items,
      totalExpected,
      totalVisited,
      totalMissing,
    };
  }, [
    allowedStationCategories,
    allowedStationCategorySet,
    auth.patrols,
    isCategoryAllowed,
    manualPatrols,
    stationPassageVisitedSet,
  ]);

  const selectedSummaryDetail = useMemo(() => {
    if (!selectedSummaryCategory) {
      return null;
    }
    return (
      stationCategorySummary.items.find((item) => item.key === selectedSummaryCategory) ?? null
    );
  }, [selectedSummaryCategory, stationCategorySummary]);

  useEffect(() => {
    if (!selectedSummaryCategory) {
      lastSummaryScrollRef.current = null;
      return;
    }
    if (lastSummaryScrollRef.current === selectedSummaryCategory) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const target = summaryDetailRef.current;
    if (!target) {
      return;
    }
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    lastSummaryScrollRef.current = selectedSummaryCategory;
  }, [selectedSummaryCategory]);

  const handleSelectSummaryCategory = useCallback((category: StationCategoryKey) => {
    setSelectedSummaryCategory((previous) => (previous === category ? null : category));
  }, []);

  const handleSelectSummaryPatrol = useCallback(
    (patrol: StationSummaryPatrol) => {
      if (scannerPatrol && scannerPatrol.id === patrol.id) {
        pushAlert('Hlídka už je načtená.');
        return;
      }
      if (activePatrol && activePatrol.id === patrol.id) {
        pushAlert('Hlídka už je právě obsluhovaná.');
        return;
      }
      if (patrol.visited && stationCode !== 'T') {
        pushAlert('Hlídka už na stanovišti byla.');
        return;
      }
      const data = auth.patrols.find((candidate) => candidate.id === patrol.id);
      if (!data) {
        pushAlert('Hlídka nenalezena.');
        return;
      }
      setScannerPatrol({ ...data });
      setScannerSource('summary');
      setShowPatrolChoice(true);
      setScanActive(false);
      setManualCodeDraft('');
      setConfirmedManualCode(patrol.code ? patrol.code.toUpperCase() : '');
    },
    [
      activePatrol,
      auth.patrols,
      pushAlert,
      scannerPatrol,
      setConfirmedManualCode,
      setManualCodeDraft,
      setScanActive,
      setScannerPatrol,
      setScannerSource,
      setShowPatrolChoice,
      stationCode,
    ],
  );

  const handleRefreshStationPassages = useCallback(() => {
    void loadStationPassages();
  }, [loadStationPassages]);

  const stationSummaryRemaining = useMemo(
    () => Math.max(0, stationCategorySummary.totalExpected - stationCategorySummary.totalVisited),
    [stationCategorySummary.totalExpected, stationCategorySummary.totalVisited],
  );

  const shouldRefreshAccessToken = useCallback(() => {
    const expiresAt = auth.tokens.accessTokenExpiresAt;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
      return true;
    }
    return Date.now() >= expiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS;
  }, [auth.tokens.accessTokenExpiresAt]);

  const refreshAccessToken = useCallback(
    async (options?: { force?: boolean; reason?: string }) => {
      if (!isOnline) {
        return false;
      }
      return refreshTokens(options);
    },
    [isOnline, refreshTokens],
  );

  useEffect(() => {
    if (!isTargetStation) {
      setCategoryAnswers({});
      return;
    }
    loadCategoryAnswers();
  }, [isTargetStation, loadCategoryAnswers]);

  useEffect(() => {
    loadStationPassages();
  }, [loadStationPassages]);

  const flushOutbox = useCallback(async (options?: { force?: boolean }) => {
    if (flushInFlightRef.current) {
      return;
    }
    flushInFlightRef.current = true;
    const lockOwnerId = flushLockOwnerIdRef.current;
    let hasCrossTabLock = false;

    try {
      const now = Date.now();
      hasCrossTabLock = tryAcquireOutboxFlushLock(eventId, stationId, lockOwnerId, now);
      if (!hasCrossTabLock) {
        return;
      }

      let items = await readOutbox();
      items = await normalizeOutboxForSession(items);
      updateOutboxState(items);

      const released = releaseNetworkBackoff(items, { eventId, stationId, now });
      if (released.changed) {
        items = released.updated;
        await writeOutboxEntriesAndSync(items);
        updateOutboxState(items);
      }

      if (options?.force) {
        const forced = items.map((item) => {
          if (
            item.event_id === eventId &&
            item.station_id === stationId &&
            (item.state === 'queued' || item.state === 'failed') &&
            item.next_attempt_at > now
          ) {
            return { ...item, next_attempt_at: now };
          }
          return item;
        });
        if (forced.some((item, index) => item !== items[index])) {
          await writeOutboxEntriesAndSync(forced);
          items = forced;
          updateOutboxState(items);
        }
      }
      const ready = items.filter(
        (item) =>
          item.event_id === eventId &&
          item.station_id === stationId &&
          (item.state === 'queued' || item.state === 'failed') &&
          item.next_attempt_at <= now,
      );
      if (!ready.length) {
        return;
      }

      if (shouldRefreshAccessToken()) {
        const refreshed = await refreshAccessToken({ reason: 'outbox-preflight' });
        if (refreshed) {
          setAuthNeedsLogin(false);
          return;
        }
      } else if (!auth.tokens.accessToken) {
        const refreshed = await refreshAccessToken({ force: true, reason: 'missing-access' });
        if (refreshed) {
          setAuthNeedsLogin(false);
          return;
        }
      }

      const sessionResult = requireAccessToken(auth.tokens.accessToken);
      if (!sessionResult.accessToken) {
        if (sessionResult.shouldBlock) {
          const updated = items.map<OutboxEntry>((item) => {
            if (
              item.event_id !== eventId ||
              item.station_id !== stationId ||
              item.state === 'sent' ||
              item.state === 'blocked_other_session'
            ) {
              return item;
            }
            if (item.state === 'needs_auth') {
              return item;
            }
            return {
              ...item,
              state: 'needs_auth',
              last_error: sessionResult.error ?? NO_SESSION_ERROR,
              next_attempt_at: now,
            };
          });
          await writeOutboxEntriesAndSync(updated);
          updateOutboxState(updated);
          setAuthNeedsLogin(true);
          if (import.meta.env.DEV) {
            console.debug('[outbox] auth block', { error: sessionResult.error ?? NO_SESSION_ERROR });
          }
        }
        return;
      }

      const cleared = items.map<OutboxEntry>((item) => {
        if (item.event_id === eventId && item.station_id === stationId && item.state === 'needs_auth') {
          return { ...item, state: 'queued', last_error: undefined, next_attempt_at: now };
        }
        return item;
      });
      if (cleared.some((item, index) => item !== items[index])) {
        await writeOutboxEntriesAndSync(cleared);
        items = cleared;
        updateOutboxState(items);
        setAuthNeedsLogin(false);
      }

      const batchIds = new Set(ready.slice(0, OUTBOX_BATCH_SIZE).map((item) => item.client_event_id));
      const sendingItems = items.map<OutboxEntry>((item) =>
        batchIds.has(item.client_event_id) ? { ...item, state: 'sending' } : item,
      );
      await writeOutboxEntriesAndSync(sendingItems);
      updateOutboxState(sendingItems);
      setSyncing(true);

      try {
        const accessToken = sessionResult.accessToken;
        const endpoint = SUBMIT_STATION_RECORD_URL;

        if (import.meta.env.DEV) {
          console.debug('[outbox] submit batch', { endpoint, hasAccessToken: Boolean(accessToken) });
        }

        const { updated, sentIds } = await flushOutboxBatch({
          items,
          eventId,
          stationId,
          accessToken,
          endpoint,
          fetchFn: fetch,
          now,
          batchSize: OUTBOX_BATCH_SIZE,
        });

        const needsAuth = updated.some((item) => item.state === 'needs_auth');
        let nextItems = updated;
        if (needsAuth) {
          setAuthNeedsLogin(true);
          if (isOnline) {
            const refreshed = await refreshAccessToken({ force: true, reason: 'outbox-401' });
            if (refreshed) {
              nextItems = updated.map((item) =>
                item.state === 'needs_auth'
                  ? { ...item, state: 'queued', last_error: undefined, next_attempt_at: now }
                  : item,
              );
              setAuthNeedsLogin(false);
            }
          }
        }

        const retained = nextItems.filter((item) => item.state !== 'sent');
        if (sentIds.length > 0) {
          await deleteOutboxEntries(sentIds);
        }
        await writeOutboxEntriesAndSync(retained);
        updateOutboxState(retained);

        if (sentIds.length > 0) {
          void loadStationPassages();
        }
      } finally {
        setSyncing(false);
      }
    } finally {
      if (hasCrossTabLock) {
        releaseOutboxFlushLock(eventId, stationId, lockOwnerId);
      }
      flushInFlightRef.current = false;
    }
  }, [
    auth.tokens.accessToken,
    eventId,
    loadStationPassages,
    normalizeOutboxForSession,
    pushAlert,
    refreshAccessToken,
    setAuthNeedsLogin,
    stationId,
    shouldRefreshAccessToken,
    updateOutboxState,
  ]);

  useEffect(() => {
    void flushOutbox();
    const onOnline = () => {
      const jitterMs = Math.floor(Math.random() * 301);
      if (reconnectRetryTimeoutRef.current !== null) {
        window.clearTimeout(reconnectRetryTimeoutRef.current);
      }
      reconnectRetryTimeoutRef.current = window.setTimeout(() => {
        reconnectRetryTimeoutRef.current = null;
        void flushOutbox();
      }, jitterMs);
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      if (reconnectRetryTimeoutRef.current !== null) {
        window.clearTimeout(reconnectRetryTimeoutRef.current);
        reconnectRetryTimeoutRef.current = null;
      }
    };
  }, [flushOutbox]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void flushOutbox();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [flushOutbox]);

  useEffect(() => setupSyncListener(flushOutbox), [flushOutbox]);

  useEffect(() => {
    void flushOutbox();
  }, [flushOutbox, tick]);

  const resetForm = useCallback(() => {
    setActivePatrol(null);
      setScannerPatrol(null);
      setScannerSource(null);
    setShowPatrolChoice(false);
    setPoints('');
    setNote('');
    setAnswersInput('');
    setAnswersError('');
    setAutoScore({ correct: 0, total: 0, given: 0, normalizedGiven: '' });
    setUseTargetScoring(isTargetStation);
    setScanActive(false);
    setManualCodeDraft('');
    setConfirmedManualCode('');
    setArrivedAt(null);
    setFinishAt(null);
    setFinishTimeInput('');
    setStartTime(null);
    setTotalWaitMinutes(null);
    setScoreReviewRows([]);
    setScoreReviewState({});
    setScoreReviewError(null);
    setScoreReviewLoading(false);
    clearWait();
    lastScanRef.current = null;
  }, [clearWait, isTargetStation]);

  const handleReturnToQueue = useCallback(() => {
    if (!activePatrol) {
      resetForm();
      scrollToQueue();
      return;
    }

    if (!enableTicketQueue) {
      resetForm();
      return;
    }

    const targetTicket = tickets.find((ticket) => ticket.patrolId === activePatrol.id);
    if (!targetTicket) {
      pushAlert('Hlídku se nepodařilo vrátit do obsluhy.');
      resetForm();
      scrollToQueue();
      return;
    }

    if (targetTicket.state === 'serving') {
      pushAlert('Hlídka už je v obsluze.');
      resetForm();
      scrollToQueue();
      return;
    }

    updateTickets((current) =>
      current.map((ticket) =>
        ticket.id === targetTicket.id ? transitionTicket(ticket, 'serving') : ticket,
      ),
    );
    pushAlert(`Hlídka ${activePatrol.team_name} byla vrácena do obsluhovaných.`);
    resetForm();
    scrollToQueue();
  }, [
    activePatrol,
    enableTicketQueue,
    pushAlert,
    resetForm,
    scrollToQueue,
    tickets,
    updateTickets,
  ]);

  const needsAuthCount = useMemo(
    () => currentSessionItems.filter((item) => item.state === 'needs_auth').length,
    [currentSessionItems],
  );
  const shouldShowAuthBanner = authNeedsLogin || needsAuthCount > 0;
  const authBannerMessage = useMemo(() => {
    if (!isOnline) {
      return 'Jste offline – přihlášení ověříme po návratu online.';
    }
    if (needsAuthCount > 0) {
      return `Pro odeslání fronty se přihlas (${needsAuthCount} čeká na přihlášení).`;
    }
    return 'Přihlášení vypršelo, obnov ho prosím pro synchronizaci.';
  }, [isOnline, needsAuthCount]);

  const handleLoginPrompt = useCallback(() => {
    if (!isOnline) {
      pushAlert('Jste offline, přihlášení ověříme po obnovení připojení.');
      return;
    }
    void (async () => {
      const refreshed = await refreshAccessToken({ force: true, reason: 'manual' });
      if (refreshed) {
        setAuthNeedsLogin(false);
        return;
      }
      pushAlert('Nepodařilo se obnovit přihlášení. Zkus to prosím znovu.');
    })();
  }, [isOnline, pushAlert, refreshAccessToken]);

  useEffect(() => {
    resetForm();
    setShowPendingDetails(false);
  }, [resetForm, stationId]);

  const handleFinishTimeChange = useCallback(
    (value: string) => {
      setFinishTimeInput(value);
      const combined = combineDateWithTime(startTime, value);
      if (combined) {
        setFinishAt(combined);
      } else if (!value) {
        setFinishAt(null);
      }
    },
    [startTime],
  );

  const cachedPatrolMap = useMemo(() => {
    const map = new Map<string, Patrol>();
    auth.patrols.forEach((activePatrol) => {
      if (activePatrol.patrol_code) {
        if (!isCategoryAllowed(activePatrol.category)) {
          return;
        }
        const variants = getPatrolCodeVariants(activePatrol.patrol_code);
        variants.forEach((variant) => {
          map.set(variant.trim().toUpperCase(), {
            id: activePatrol.id,
            team_name: activePatrol.team_name,
            category: activePatrol.category,
            sex: activePatrol.sex,
            patrol_code: activePatrol.patrol_code,
          });
        });
      }
    });
    return map;
  }, [auth.patrols, isCategoryAllowed]);

  const fetchPatrol = useCallback(
    async (patrolCode: string, options?: { allowFallback?: boolean }) => {
      const normalized = normalisePatrolCode(patrolCode);
      if (!normalized) {
        pushAlert('Neplatný kód hlídky.');
        return false;
      }
      let data = cachedPatrolMap.get(normalized) || null;
      let usedFallback = false;

      if (!data) {
        if (isOnline) {
          const variants = getPatrolCodeVariants(normalized);
          const { data: fetched, error, status } = await supabase
            .from('patrols')
            .select('id, team_name, category, sex, patrol_code')
            .eq('event_id', eventId)
            .in('patrol_code', variants.length ? variants : [normalized])
            .maybeSingle();

          if (error || !fetched) {
            if (error) {
              reportSupabaseError('patrols.fetch', error, status);
            }
            if (options?.allowFallback) {
              const fallback = createManualPatrolFromCode(normalized);
              if (fallback) {
                data = fallback;
                usedFallback = true;
              }
            } else {
              pushAlert('Hlídka nenalezena.');
              void appendScanRecord(eventId, stationId, {
                code: normalized,
                scannedAt: new Date().toISOString(),
                status: 'failed',
                reason: error ? 'fetch-error' : 'not-found',
              }).catch((err) => console.debug('scan history store failed', err));
              return false;
            }
          } else {
            data = fetched as Patrol;
          }
        } else if (options?.allowFallback) {
          const fallback = createManualPatrolFromCode(normalized);
          if (fallback) {
            data = fallback;
            usedFallback = true;
          }
        } else {
          pushAlert('Offline režim: hlídku nelze načíst.');
          return false;
        }
      }

      if (!data) {
        pushAlert('Hlídka nenalezena.');
        return false;
      }

      if (!isCategoryAllowed(data.category)) {
        pushAlert('Hlídka této kategorie na stanoviště nepatří.');
        void appendScanRecord(eventId, stationId, {
          code: normalized,
          scannedAt: new Date().toISOString(),
          status: 'failed',
          reason: 'category-not-allowed',
          patrolId: data.id,
          teamName: data.team_name,
        }).catch((err) => console.debug('scan history store failed', err));
        return false;
      }

      if (scannerPatrol && scannerPatrol.id === data.id) {
        pushAlert('Hlídka už je načtená.');
        return false;
      }

      if (activePatrol && activePatrol.id === data.id) {
        pushAlert('Hlídka už je právě obsluhovaná.');
        return false;
      }

      if (stationCode !== 'T' && stationPassageVisitedSet.has(data.id)) {
        pushAlert('Hlídka už na stanovišti byla.');
        void appendScanRecord(eventId, stationId, {
          code: normalized,
          scannedAt: new Date().toISOString(),
          status: 'failed',
          reason: 'already-visited',
          patrolId: data.id,
          teamName: data.team_name,
        }).catch((err) => console.debug('scan history store failed', err));
        return false;
      }

      setScannerPatrol({ ...data });
      setShowPatrolChoice(true);
      setScanActive(false);
      setManualCodeDraft('');
      setConfirmedManualCode(normalized);

      if (usedFallback) {
        pushAlert('Hlídka není v cache. Pokračuji s ručním záznamem.');
      }

      void appendScanRecord(eventId, stationId, {
        code: normalized,
        scannedAt: new Date().toISOString(),
        status: 'success',
        patrolId: data.id,
        teamName: data.team_name,
      }).catch((err) => console.debug('scan history store failed', err));

      return true;
    },
    [
      activePatrol,
      cachedPatrolMap,
      eventId,
      isCategoryAllowed,
      isOnline,
      pushAlert,
      reportSupabaseError,
      scannerPatrol,
      stationCode,
      stationId,
      stationPassageVisitedSet,
      setConfirmedManualCode,
      setManualCodeDraft,
      setShowPatrolChoice,
    ]
  );

  const handleManualConfirm = useCallback(async () => {
    if (!manualValidation.valid) {
      return;
    }
    const trimmed = manualValidation.code.trim();
    if (!trimmed) {
      return;
    }
    const normalized = trimmed.toUpperCase();
    console.info('[patrol-code-input] confirm', {
      code: normalized,
      patrolId: manualValidation.patrolId,
    });
    const hapticType = normalized === confirmedManualCode ? 'light' : 'heavy';
    triggerHaptic(hapticType);
    setScannerSource('manual');
    void fetchPatrol(normalized, { allowFallback: true });
  }, [confirmedManualCode, fetchPatrol, manualValidation, setScannerSource]);

  const handleScanResult = useCallback(
    async (text: string) => {
      const match = text.match(/zelenaliga:\/\/p\/(.+)$/);
      if (!match) {
        pushAlert('Neplatný QR kód. Očekávám zelenaliga://p/<code>');
        void appendScanRecord(eventId, stationId, {
          code: text,
          scannedAt: new Date().toISOString(),
          status: 'failed',
          reason: 'invalid-schema',
        }).catch((err) => console.debug('scan history store failed', err));
        return;
      }
      const scannedCode = match[1].trim();
      const now = Date.now();
      const recent = lastScanRef.current;
      if (recent && recent.code === scannedCode && now - recent.at < 3_000) {
        return;
      }
      lastScanRef.current = { code: scannedCode, at: now };
      setScannerSource('scan');
      await fetchPatrol(scannedCode);
    },
    [eventId, fetchPatrol, pushAlert, setScannerSource, stationId]
  );

  useEffect(() => {
    if (!activePatrol) {
      return;
    }

    const stored = categoryAnswers[activePatrol.category] || '';
    const total = parseAnswerLetters(stored).length;
    setAutoScore((prev) => ({ ...prev, total }));
  }, [categoryAnswers, activePatrol]);

  useEffect(() => {
    if (!activePatrol || !useTargetScoring) {
      setAnswersError('');
      setAutoScore((prev) => ({ ...prev, correct: 0, given: 0, normalizedGiven: '' }));
      return;
    }

    const correctLetters = parseAnswerLetters(categoryAnswers[activePatrol.category] || '');
    const givenLetters = parseAnswerLetters(answersInput);
    const correct = correctLetters.reduce((acc, letter, index) => (letter === givenLetters[index] ? acc + 1 : acc), 0);
    const normalizedGiven = packAnswersForStorage(answersInput);
    const total = correctLetters.length;

    setAutoScore({ correct, total, given: givenLetters.length, normalizedGiven });

    if (!total) {
      setAnswersError('Pro tuto kategorii nejsou nastavené správné odpovědi.');
    } else if (givenLetters.length !== total) {
      setAnswersError(`Zadaných odpovědí: ${givenLetters.length} / ${total}.`);
    } else {
      setAnswersError('');
    }

    if (total > 0) {
      setPoints(String(correct));
    }
  }, [answersInput, useTargetScoring, activePatrol, categoryAnswers]);

  const handleLogout = useCallback(() => {
    void logout();
  }, [logout]);

  const enqueueStationScore = useCallback(
    async (payload: Omit<StationScorePayload, 'client_event_id' | 'client_created_at'>) => {
      return enqueueStationScoreHelper(
        payload,
        {
          write: writeOutboxEntryAndSync,
          refresh: refreshOutbox,
          flush: () => void flushOutbox(),
          pushAlert,
          isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
        },
      );
    },
    [flushOutbox, pushAlert, refreshOutbox],
  );

  const handleSaveStationScore = useCallback(
    async (stationId: string) => {
      if (!activePatrol) {
        return;
      }

      const baseRow = scoreReviewRows.find((row) => row.stationId === stationId);
      const state = scoreReviewState[stationId];

      if (!baseRow || !state) {
        return;
      }

      const trimmedPoints = state.pointsDraft.trim();
      const pointsValue = trimmedPoints === '' ? NaN : Number(trimmedPoints);
      const waitValue = parseWaitDraft(state.waitDraft);

      if (!Number.isInteger(pointsValue) || pointsValue < 0 || pointsValue > 12) {
        setScoreReviewState((prev) => {
          const previous = prev[stationId] ?? state;
          return {
            ...prev,
            [stationId]: {
              ...previous,
              ok: false,
              saving: false,
              error: 'Body musí být číslo 0–12.',
            },
          };
        });
        return;
      }

      if (!Number.isInteger(waitValue) || waitValue < 0 || waitValue > WAIT_MINUTES_MAX) {
        setScoreReviewState((prev) => {
          const previous = prev[stationId] ?? state;
          return {
            ...prev,
            [stationId]: {
              ...previous,
              ok: false,
              saving: false,
              error: `Čekání musí být čas v rozsahu 00:00–${WAIT_TIME_MAX}.`,
            },
          };
        });
        return;
      }

      setScoreReviewState((prev) => {
        const previous = prev[stationId] ?? state;
        return {
          ...prev,
          [stationId]: { ...previous, saving: true, error: null },
        };
      });

      try {
        const queued = await enqueueStationScore({
          event_id: eventId,
          station_id: stationId,
          patrol_id: activePatrol.id,
          category: activePatrol.category,
          arrived_at: new Date().toISOString(),
          wait_minutes: waitValue,
          points: pointsValue,
          note: baseRow.note ?? '',
          use_target_scoring: false,
          normalized_answers: null,
          finish_time: null,
          patrol_code: resolvePatrolCode(activePatrol),
          team_name: activePatrol.team_name,
          sex: activePatrol.sex,
        });
        if (!queued) {
          throw new Error('queue-failed');
        }

        pushAlert(`Záznam pro stanoviště ${baseRow.stationCode || stationId} aktualizován.`);
        await loadScoreReview(
          activePatrol.id,
          activePatrol.patrol_code,
          activePatrol.category,
          activePatrol.sex,
        );
        setScoreReviewState((prev) => {
          const current = prev[stationId];
          if (!current) {
            return prev;
          }
          return {
            ...prev,
            [stationId]: {
              ...current,
              ok: true,
              saving: false,
              error: null,
              pointsDraft: String(pointsValue),
              waitDraft: formatWaitDraft(waitValue),
            },
          };
        });
      } catch (error) {
        console.error('Failed to save station score', error);
        setScoreReviewState((prev) => {
          const previous = prev[stationId] ?? state;
          return {
            ...prev,
            [stationId]: {
              ...previous,
              saving: false,
              error: 'Uložení se nezdařilo. Zkus to znovu.',
            },
          };
        });
        pushAlert('Nepodařilo se uložit záznam pro vybrané stanoviště.');
      }
    },
    [
      activePatrol,
      enqueueStationScore,
      eventId,
      loadScoreReview,
      pushAlert,
      resolvePatrolCode,
      scoreReviewRows,
      scoreReviewState,
    ],
  );

  const handleSave = useCallback(async () => {
    if (scoringDisabled) {
      pushAlert('Závod byl ukončen. Zapisování bodů je uzamčeno.');
      return;
    }
    if (!activePatrol) return;
    if (!stationId) {
      pushAlert('Vyber stanoviště před uložením záznamu.');
      return;
    }

    if (stationCode === 'T' && (!finishTimeInput || !finishAt)) {
      pushAlert('Nejdřív vyplň čas doběhu.');
      return;
    }

    let scorePoints = 0;
    let normalizedAnswers: string | null = null;

    if (useTargetScoring) {
      if (!autoScore.total) {
        pushAlert('Pro tuto kategorii nejsou nastavené správné odpovědi.');
        return;
      }
      if (autoScore.given !== autoScore.total) {
        pushAlert(`Je potřeba zadat všech ${autoScore.total} odpovědí.`);
        return;
      }
      scorePoints = autoScore.correct;
      normalizedAnswers = autoScore.normalizedGiven;
    } else {
      const normalizedPoints = points.trim();
      const parsed = Number(normalizedPoints);
      if (
        !normalizedPoints ||
        Number.isNaN(parsed) ||
        !Number.isInteger(parsed) ||
        parsed < 0 ||
        parsed > 12
      ) {
        pushAlert('Body musí být celé číslo v rozsahu 0 až 12.');
        return;
      }
      scorePoints = parsed;
    }

    const waitMinutes = parseWaitDraft(waitDraft);
    if (!Number.isInteger(waitMinutes) || waitMinutes < 0 || waitMinutes > WAIT_MINUTES_MAX) {
      pushAlert(`Čekání musí být čas v rozsahu 00:00–${WAIT_TIME_MAX}.`);
      return;
    }

    const now = new Date().toISOString();
    const arrivalIso = arrivedAt || now;
    const effectivePatrolCode = resolvePatrolCode(activePatrol);

    const submissionData = {
      event_id: eventId,
      station_id: stationId,
      patrol_id: activePatrol.id,
      category: activePatrol.category,
      arrived_at: arrivalIso,
      wait_minutes: waitMinutes,
      points: scorePoints,
      note,
      use_target_scoring: useTargetScoring,
      normalized_answers: normalizedAnswers,
      finish_time: finishAt,
      patrol_code: effectivePatrolCode,
      team_name: activePatrol.team_name,
      sex: activePatrol.sex,
    };
    const queued = await enqueueStationScore(submissionData);
    if (!queued) {
      return;
    }
    void registerManualPatrol(activePatrol);
    if (enableTicketQueue) {
      updateTickets((current) =>
        current.map((ticket) =>
          ticket.patrolId === activePatrol.id ? { ...ticket, points: scorePoints } : ticket,
        ),
      );
    }
    setShowPendingDetails(false);
    resetForm();
    if (hasQueueTickets) {
      scrollToQueue();
    } else {
      scrollToSummary();
    }
  }, [
    autoScore,
    note,
    activePatrol,
    points,
    useTargetScoring,
    pushAlert,
    enqueueStationScore,
    resetForm,
    updateTickets,
    waitDraft,
    arrivedAt,
    stationId,
    finishAt,
    registerManualPatrol,
    resolvePatrolCode,
    scoringDisabled,
    scrollToQueue,
    scrollToSummary,
    enableTicketQueue,
    hasQueueTickets,
  ]);

  const totalAnswers = useMemo(
    () => (activePatrol ? parseAnswerLetters(categoryAnswers[activePatrol.category] || '').length : 0),
    [activePatrol, categoryAnswers]
  );
  const heroBadges = useMemo(() => {
    const badges = [`Event: ${manifest.event.name}`];
    if (enableTicketQueue) {
      const queueLabel = pendingCount ? `Offline fronta: ${pendingCount}` : 'Offline fronta prázdná';
      badges.push(queueLabel);
    }
    return badges;
  }, [enableTicketQueue, manifest.event.name, pendingCount]);

  const failedCount = useMemo(
    () => currentSessionItems.filter((item) => item.state === 'failed').length,
    [currentSessionItems],
  );
  const nextAttemptAtIso = useMemo(() => {
    const future = currentSessionItems
      .filter(
        (item) =>
          (item.state === 'queued' || item.state === 'failed') &&
          item.next_attempt_at > Date.now(),
      )
      .map((item) => item.next_attempt_at);
    if (!future.length) {
      return null;
    }
    const earliest = Math.min(...future);
    return new Date(earliest).toISOString();
  }, [currentSessionItems]);
  const nextAttemptAtLabel = useMemo(() => {
    if (!nextAttemptAtIso) {
      return null;
    }
    return formatTime(nextAttemptAtIso);
  }, [nextAttemptAtIso]);
  const offlineQueueSummaryLabel =
    pendingCount === 0 ? 'Offline fronta prázdná' : `Čeká na odeslání: ${pendingCount}`;
  const offlineSyncLabel = useMemo(() => {
    if (syncing) {
      return 'Odesílám…';
    }
    if (pendingCount === 0) {
      return 'Zatím žádné odesílání';
    }
    if (nextAttemptAtLabel) {
      return `Další pokus v ${nextAttemptAtLabel}`;
    }
    return 'Čeká na odeslání';
  }, [nextAttemptAtLabel, pendingCount, syncing]);
  const scanHistoryItems = useMemo(() => scanHistory.slice().reverse(), [scanHistory]);
  const loadScanHistory = useCallback(async () => {
    if (!eventId || !stationId) {
      return;
    }
    setScanHistoryLoading(true);
    setScanHistoryError(null);
    try {
      const records = await getScanHistory(eventId, stationId);
      setScanHistory(records);
    } catch (error) {
      console.error('scan history load failed', error);
      setScanHistoryError('Historii skenů se nepodařilo načíst.');
    } finally {
      setScanHistoryLoading(false);
    }
  }, [eventId, stationId]);
  const handleOpenRules = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  useEffect(() => {
    if (menuOpen) {
      void loadScanHistory();
    }
  }, [loadScanHistory, menuOpen]);

  useEffect(() => {
    if (!nextAttemptAtIso) {
      return undefined;
    }

    const targetTime = new Date(nextAttemptAtIso).getTime();
    if (!Number.isFinite(targetTime)) {
      return undefined;
    }

    const delay = Math.max(0, targetTime - Date.now());
    const timeout = window.setTimeout(() => {
      void flushOutbox();
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [nextAttemptAtIso, flushOutbox]);

  const timeOnCourse = useMemo(() => {
    if (!startTime || !finishAt) {
      return null;
    }
    const start = new Date(startTime);
    const finish = new Date(finishAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime())) {
      return null;
    }
    let ms = finish.getTime() - start.getTime();
    if (ms < 0) {
      ms += 24 * 60 * 60 * 1000;
    }
    return formatDurationMs(ms);
  }, [startTime, finishAt]);

  const pureCourseSeconds = useMemo(() => {
    if (!startTime || !finishAt) {
      return null;
    }
    const start = new Date(startTime);
    const finish = new Date(finishAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime())) {
      return null;
    }
    const waitMinutes = Number(totalWaitMinutes ?? 0);
    return computePureCourseSeconds({ start, finish, waitMinutes });
  }, [finishAt, startTime, totalWaitMinutes]);

  const pureCourseLabel = useMemo(() => {
    if (pureCourseSeconds === null) {
      return '—';
    }
    return formatDurationMs(pureCourseSeconds * 1000);
  }, [pureCourseSeconds]);

  const timePoints = useMemo(() => {
    if (!activePatrol) {
      return null;
    }
    const category = activePatrol.category?.trim().toUpperCase();
    if (!isTimeScoringCategory(category)) {
      return null;
    }
    return computeTimePoints(category, pureCourseSeconds);
  }, [activePatrol, pureCourseSeconds]);

  const controlChecks = useMemo(() => {
    const checks: { label: string; ok: boolean }[] = [];
    if (stationCode === 'T') {
      checks.push({ label: 'Čas doběhu vyplněn', ok: Boolean(finishAt && finishTimeInput) });
      checks.push({ label: 'Čas startu dostupný', ok: Boolean(startTime) });
      checks.push({ label: 'Čistý čas vypočítán', ok: pureCourseSeconds !== null });
      const answersReady = autoScore.total > 0 ? autoScore.given === autoScore.total : false;
      checks.push({ label: 'Odpovědi zadány', ok: answersReady });
    }
    return checks;
  }, [stationCode, finishAt, finishTimeInput, startTime, autoScore, pureCourseSeconds]);

  const isPatrolInQueue = useMemo(() => {
    if (!scannerPatrol) {
      return false;
    }
    return tickets.some((ticket) => ticket.patrolId === scannerPatrol.id && ticket.state !== 'done');
  }, [scannerPatrol, tickets]);


  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-inner">
          <div className="hero-brand">
            <a
              className="hero-logo"
              href="https://zelenaliga.cz"
              target="_blank"
              rel="noreferrer"
              aria-label="Zelená liga"
            >
              <img src={zelenaLigaLogo} alt="Logo Setonův závod - aplikace" />
            </a>
            <div>
              <h1>Setonův závod - aplikace</h1>
              <p>
                Tady spravuješ průběh závodu na svém stanovišti. Zapisuj výsledky hlídek, kontroluj průchody a nech aplikaci,
                aby se o zbytek postarala. Když není signál, vše se uloží a po připojení se automaticky odešle.
              </p>
            </div>
          </div>
          <div className="hero-meta">
            <div className="hero-menu-actions">
              <button
                type="button"
                className="hero-menu-button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-expanded={menuOpen}
                aria-controls="station-menu"
              >
                <span className="hero-menu-icon" aria-hidden="true" />
                {menuOpen ? 'Zavřít menu' : 'Otevřít menu'}
              </button>
              {isTargetStation ? (
                <a
                  className="hero-menu-link"
                  href={SCOREBOARD_ROUTE_PREFIX}
                  target="_blank"
                  rel="noreferrer"
                >
                  Otevřít výsledky
                </a>
              ) : null}
            </div>
          </div>
          {displayAlerts.length ? (
            <div className="hero-alerts">
              {displayAlerts.map((msg, idx) => (
                <div key={idx} className="hero-alert">
                  {msg}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </header>
      {menuOpen ? (
        <div
          className="station-menu-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setMenuOpen(false);
            }
          }}
        >
          <aside className="station-menu" id="station-menu">
            <header className="station-menu-header">
              <h2>Menu</h2>
              <button type="button" className="ghost station-menu-close" onClick={() => setMenuOpen(false)}>
                Zavřít
              </button>
            </header>
            <section className="card station-menu-card">
              <header className="card-header">
                <h3>Účet</h3>
              </header>
              <p className="card-hint">Odhlásíš se z aktuální relace.</p>
              <button type="button" className="logout-button" onClick={handleLogout}>
                Odhlásit se
              </button>
            </section>
            <section className="card station-menu-card">
              <header className="card-header">
                <h3>Stav závodu</h3>
              </header>
              <ul className="station-menu-list">
                <li>
                  <span className="card-hint">Event</span>
                  <strong className="station-menu-value">{manifest.event.name}</strong>
                </li>
                <li>
                  <span className="card-hint">Offline fronta</span>
                  <strong className="station-menu-value">{offlineQueueSummaryLabel}</strong>
                </li>
                {failedCount > 0 ? (
                  <li>
                    <span className="card-hint">Chyby</span>
                    <strong className="station-menu-value">{failedCount}</strong>
                  </li>
                ) : null}
              </ul>
            </section>
            <section className="card station-menu-card">
              <header className="card-header">
                <h3>Stanoviště</h3>
              </header>
              <ul className="station-menu-list">
                <li>
                  <span className="card-hint">Název</span>
                  <strong className="station-menu-value station-menu-value--emphasis">{stationDisplayName}</strong>
                </li>
                <li>
                  <span className="card-hint">Kód</span>
                  <span className="station-menu-code">{stationCode || '—'}</span>
                </li>
                <li>
                  <span className="card-hint">Událost</span>
                  <strong className="station-menu-value">{manifest.event.name}</strong>
                </li>
                <li>
                  <span className="card-hint">Kategorie</span>
                  <strong className="station-menu-value">{allowedStationCategoryLabel}</strong>
                </li>
              </ul>
            </section>
            <section className="card station-menu-card">
              <header className="card-header">
                <h3>Rozhodčí</h3>
              </header>
              <ul className="station-menu-list">
                <li>
                  <span className="card-hint">Jméno</span>
                  <strong className="station-menu-value station-menu-value--emphasis">{manifest.judge.displayName}</strong>
                </li>
                <li>
                  <span className="card-hint">Email</span>
                  <strong className="station-menu-value station-menu-value--muted">{manifest.judge.email}</strong>
                </li>
              </ul>
            </section>
            <section className="card station-menu-card">
              <header className="card-header">
                <h3>Offline fronta</h3>
              </header>
              <ul className="station-menu-list">
                <li>
                  <span className="card-hint">Síť</span>
                  <strong className="station-menu-value">{isOnline ? 'Online' : 'Offline'}</strong>
                </li>
                <li>
                  <span className="card-hint">Synchronizace</span>
                  <strong className="station-menu-value">{offlineSyncLabel}</strong>
                </li>
                <li>
                  <span className="card-hint">Fronta</span>
                  <strong className="station-menu-value">
                    {pendingCount === 0 ? 'prázdná' : `${pendingCount} položek`}
                  </strong>
                </li>
              </ul>
            </section>
            <section className="card station-menu-card">
              <header className="card-header">
                <h3>Historie skenů</h3>
              </header>
              <p className="card-hint">Posledních 100 skenů uložených v tomto zařízení.</p>
              <div className="station-menu-history-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void loadScanHistory();
                  }}
                  disabled={scanHistoryLoading}
                >
                  {scanHistoryLoading ? 'Načítám…' : 'Obnovit'}
                </button>
              </div>
              {scanHistoryError ? <p className="error-text">{scanHistoryError}</p> : null}
              {scanHistoryItems.length ? (
                <ul className="scan-history-list">
                  {scanHistoryItems.map((record, index) => (
                    <li key={`${record.code}-${record.scannedAt}-${index}`} className="scan-history-item">
                      <div className="scan-history-meta">
                        <span className="scan-history-time">{formatTime(record.scannedAt)}</span>
                        <span className="scan-history-code">{record.code}</span>
                      </div>
                      <div className="scan-history-detail">
                        <span
                          className={`scan-history-status ${
                            record.status === 'success' ? 'scan-history-status--success' : 'scan-history-status--failed'
                          }`}
                        >
                          {record.status === 'success' ? 'OK' : 'Chyba'}
                        </span>
                        <span className="scan-history-team">{record.teamName ?? '—'}</span>
                      </div>
                      {record.reason ? <span className="scan-history-reason">{record.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : scanHistoryLoading ? null : (
                <p className="card-hint">Zatím tu nejsou žádné skeny.</p>
              )}
            </section>
            <section className="card station-menu-card">
              <header className="card-header">
                <h3>Pravidla</h3>
              </header>
              <div className="station-menu-rules-actions">
                <button type="button" className="primary" onClick={() => handleOpenRules(competitionRulesPdf)}>
                  Pravidla soutěže
                </button>
                <button type="button" className="ghost" onClick={() => handleOpenRules(stationRulesPdf)}>
                  Pravidla stanovišť
                </button>
              </div>
              <ul className="station-menu-rules">
                {stationRules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </section>
            <section className="card station-menu-card">
              <header className="card-header">
                <h3>Další aplikace</h3>
              </header>
              <p className="card-hint">Přepni se na samostatné bodování turnaje Deskové hry.</p>
              <div className="station-menu-rules-actions">
                <a className="primary" href="/aplikace/deskovky">
                  Otevřít Deskovky
                </a>
              </div>
            </section>
          </aside>
        </div>
      ) : null}
      {showPatrolChoice && scannerPatrol ? (
        <div className="patrol-choice-backdrop" role="dialog" aria-modal="true">
          <div className="patrol-choice-modal">
            <div className="patrol-choice-header">
              <h2>Hlídka načtena</h2>
              <button
                type="button"
                className="ghost patrol-choice-close"
                onClick={() => setShowPatrolChoice(false)}
                aria-label="Zavřít dialog"
              >
                ✕
              </button>
            </div>
            <p className="patrol-choice-subtitle">Vyber další krok, aby hlídka nezapadla ve frontě.</p>
            <div className="patrol-choice-details">
              <strong>{scannerPatrol.team_name}</strong>
              {previewPatrolCode ? <span>Kód: {previewPatrolCode}</span> : null}
              <span>{formatPatrolMetaLabel(scannerPatrol)}</span>
            </div>
            <div className="patrol-choice-actions">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  handleServePatrol();
                  setShowPatrolChoice(false);
                }}
              >
                Obsluhovat
              </button>
              {enableTicketQueue ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    handleAddTicket('waiting');
                    setShowPatrolChoice(false);
                  }}
                >
                  Čekat
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <main className="content">
        <>
          {accessDeniedMessage ? <p className="error-text">{accessDeniedMessage}</p> : null}
          <section ref={summaryRef} className="card station-summary-card">
            <header className="card-header">
              <div>
                <h2>Přehled průchodů</h2>
                <p className="card-subtitle">
                  Sleduj, kolik hlídek už stanoviště navštívilo podle kategorií. Hlídky lze
                  načítat také přes tlačítko „Zobrazit ruční načítání kódů“.
                </p>
              </div>
              <div className="card-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowScannerPanel((prev) => !prev)}
                  aria-expanded={showScannerPanel}
                  aria-controls="scanner-panel"
                >
                  {showScannerPanel ? 'Skrýt ruční načítání' : 'Zobrazit ruční načítání kódů'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={handleRefreshStationPassages}
                  disabled={stationPassageLoading}
                >
                  {stationPassageLoading ? 'Načítám…' : 'Obnovit'}
                </button>
              </div>
            </header>
            {showScannerPanel ? (
              <section className="card scanner-card">
                <header className="card-header">
                  <div>
                    <h2>Načtení hlídek</h2>
                    <p className="card-subtitle">
                      {enableTicketQueue
                        ? 'Zadej kód hlídky ručně. Hlídku pak přidej do fronty nebo rovnou obsluhuj.'
                        : 'Zadej kód hlídky ručně a obsluhuj ji.'}
                    </p>
                  </div>
                </header>
                <div className="scanner-wrapper" id="scanner-panel">
                  {/*
                  <div className="scanner-controls">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setScanActive((prev) => !prev)}
                    >
                      {scanActive ? 'Vypnout skener' : 'Zapnout skener'}
                    </button>
                    <span className={`scanner-status ${scanActive ? 'active' : 'inactive'}`}>
                      {scanActive ? 'Skener je zapnutý' : 'Skener je vypnutý'}
                    </span>
                  </div>
                  <QRScanner active={scanActive} onResult={handleScanResult} onError={(err) => console.error(err)} />
                  */}
                <div className="manual-entry">
                  <PatrolCodeInput
                    value={manualCodeDraft}
                    onChange={setManualCodeDraft}
                    label="Ruční kód"
                    registry={patrolRegistryState}
                    onValidationChange={setManualValidation}
                    excludePatrolIds={stationPassageVisitedSet}
                    allowedCategories={allowedCategorySet}
                    validationMode="station-only"
                    action={(
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          void handleManualConfirm();
                        }}
                        disabled={!manualValidation.valid}
                      >
                        Načíst hlídku
                      </button>
                    )}
                  />
                </div>
                  {showScannerPreview ? (
                    <div className="scanner-preview">
                      <>
                        <strong>{scannerPatrol.team_name}</strong>
                        {previewPatrolCode ? (
                          <span
                            className="scanner-code"
                            aria-label={`Kód hlídky ${previewPatrolCode}`}
                            data-code={previewPatrolCode}
                          >
                            <span className="scanner-code__label" aria-hidden="true">
                              Kód
                            </span>
                          </span>
                        ) : null}
                        <span>{formatPatrolMetaLabel(scannerPatrol)}</span>
                      </>
                      <div className="scanner-actions">
                        <button
                          type="button"
                          className="primary"
                          onClick={handleServePatrol}
                          disabled={enableTicketQueue && isPatrolInQueue}
                        >
                          Obsluhovat
                        </button>
                        {enableTicketQueue ? (
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleAddTicket('waiting')}
                            disabled={isPatrolInQueue}
                          >
                            Čekat
                          </button>
                        ) : null}
                      </div>
                      {enableTicketQueue && isPatrolInQueue ? (
                        <span className="scanner-note" aria-hidden="true" />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}
            {stationPassageError ? <p className="error-text">{stationPassageError}</p> : null}
            {stationCategorySummary.items.length ? (
              <>
                <div className="station-summary-grid">
                  {stationCategorySummary.items.map((item) => {
                    const missingCount = Math.max(0, item.expected - item.visited);
                    let statusLabel = 'Žádné hlídky';
                    if (item.expected > 0) {
                      statusLabel = missingCount === 0 ? 'Splněno' : `Chybí ${missingCount}`;
                    }
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className="station-summary-chip"
                        data-missing={missingCount > 0 ? '1' : '0'}
                        data-empty={item.expected === 0 ? '1' : '0'}
                        data-active={selectedSummaryCategory === item.key ? '1' : '0'}
                        onClick={() => handleSelectSummaryCategory(item.key)}
                      >
                        <span className="station-summary-chip-label">
                          {formatStationCategoryChipLabel(item.key)}
                        </span>
                        <span className="station-summary-chip-value">
                          {item.visited}/{item.expected}
                        </span>
                        <span className="station-summary-chip-status">{statusLabel}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="card-hint">
                  Celkem: {stationCategorySummary.totalVisited}/{stationCategorySummary.totalExpected} hlídek
                  {stationCategorySummary.totalExpected === 0
                    ? '.'
                    : stationSummaryRemaining > 0
                      ? `, chybí ${stationSummaryRemaining}.`
                      : ', vše splněno.'}
                </p>
              </>
            ) : (
              <p className="card-hint">Pro toto stanoviště nejsou žádné hlídky k zobrazení.</p>
            )}
            {selectedSummaryDetail ? (
              <div
                ref={summaryDetailRef}
                className="station-summary-detail"
                role="region"
                aria-live="polite"
              >
                <div className="station-summary-detail-header">
                  <h3>{formatStationCategoryDetailLabel(selectedSummaryDetail.key)}</h3>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setSelectedSummaryCategory(null)}
                  >
                    Zavřít
                  </button>
                </div>
                <p className="card-hint">
                  {selectedSummaryDetail.expected === 0
                    ? 'Tato kategorie nemá žádné hlídky.'
                    : `Absolvováno ${selectedSummaryDetail.visited} z ${selectedSummaryDetail.expected} hlídek.`}
                  {selectedSummaryDetail.expected > 0 && selectedSummaryDetail.missing.length > 0
                    ? ` Chybí ${selectedSummaryDetail.missing.length}.`
                    : selectedSummaryDetail.expected > 0
                      ? ' Všechny hlídky již stanoviště navštívily.'
                      : null}
                </p>
                <div className="station-summary-sections">
                  {selectedSummaryDetail.missing.length ? (
                    <div ref={summaryMissingRef} className="station-summary-section">
                      <div className="station-summary-section-header">
                        <h4>Chybějící hlídky ({selectedSummaryDetail.missing.length})</h4>
                        <span className="card-hint">Kliknutím vybereš hlídku k obsluze.</span>
                      </div>
                      <ul className="station-summary-list">
                        {selectedSummaryDetail.missing.map((patrol) => {
                          const codeLabel = formatSummaryPatrolLabel(patrol);
                          const isSelectable = !patrol.visited || stationCode === 'T';
                          return (
                            <li key={patrol.id}>
                              <button
                                type="button"
                                className="station-summary-item"
                                data-visited={patrol.visited ? '1' : '0'}
                                onClick={() => handleSelectSummaryPatrol(patrol)}
                                disabled={!isSelectable}
                                aria-label={`Vybrat hlídku ${codeLabel}`}
                              >
                                <div className="station-summary-item-header">
                                  <strong>{codeLabel}</strong>
                                  <span className="station-summary-item-status">Chybí</span>
                                </div>
                                {patrol.teamName ? <span>{patrol.teamName}</span> : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                  <div ref={summaryCompletedRef} className="station-summary-section">
                    <div className="station-summary-section-header">
                      <h4>Splněné hlídky ({selectedSummaryDetail.completed.length})</h4>
                      {selectedSummaryDetail.completed.length ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setShowCompletedSummary((prev) => !prev)}
                          aria-expanded={showCompletedSummary}
                        >
                          {showCompletedSummary ? 'Skrýt hotové' : 'Ukázat hotové'}
                        </button>
                      ) : null}
                    </div>
                    {selectedSummaryDetail.completed.length ? (
                      showCompletedSummary ? (
                        <ul className="station-summary-list">
                          {selectedSummaryDetail.completed.map((patrol) => {
                            const codeLabel = formatSummaryPatrolLabel(patrol);
                            return (
                              <li key={patrol.id}>
                                <button
                                  type="button"
                                  className="station-summary-item"
                                  data-visited="1"
                                  onClick={() => handleSelectSummaryPatrol(patrol)}
                                  disabled={stationCode !== 'T'}
                                  aria-label={`Vybrat hlídku ${codeLabel}`}
                                >
                                  <div className="station-summary-item-header">
                                    <strong>{codeLabel}</strong>
                                    <span className="station-summary-item-status">Hotovo</span>
                                  </div>
                                  {patrol.teamName ? <span>{patrol.teamName}</span> : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="card-hint">Hotové hlídky jsou skryté.</p>
                      )
                    ) : (
                      <p className="card-hint">Zatím tu nejsou hotové hlídky.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
          {enableTicketQueue ? (
            <TicketQueue
              ref={ticketQueueRef}
              tickets={tickets}
              heartbeat={tick}
              onChangeState={handleTicketStateChange}
              onRemove={handleRemoveTicket}
              onBackToSummary={scrollToSummary}
            />
          ) : null}

          <section ref={formRef} className="card form-card">
            <header className="card-header">
              <div>
                <h2>Stanovištní formulář</h2>
                <p className="card-subtitle">
                  {stationCode === 'T'
                    ? 'Zapiš čas doběhu, zkontroluj terčové odpovědi a potvrď uložení.'
                    : useTargetScoring
                      ? 'Zadej odpovědi a potvrď uložení.'
                      : 'Vyplň body a potvrď uložení.'}
                </p>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={enableTicketQueue ? handleReturnToQueue : resetForm}
              >
                {enableTicketQueue ? 'Vrátit hlídku do fronty' : 'Vymazat'}
              </button>
            </header>
            {activePatrol ? (
              <div className="form-grid">
                <div className="patrol-meta">
                  <strong>{activePatrol.team_name}</strong>
                  <span>{formatPatrolMetaLabel(activePatrol)}</span>
                </div>
                <div className="judge-display">
                  <span>Rozhodčí</span>
                  <strong>{manifest.judge.displayName}</strong>
                  <small>{manifest.judge.email}</small>
                </div>
                <div className="wait-field">
                  <span className="wait-label">Čekání</span>
                  <div className="wait-display">
                    <input
                      type="time"
                      step={60}
                      min={WAIT_TIME_ZERO}
                      max={WAIT_TIME_MAX}
                      value={waitDraft}
                      onChange={(event) =>
                        setWaitDraft((current) => normalizeWaitInput(event.target.value, current))
                      }
                      placeholder="hh:mm"
                      required
                    />
                  </div>
                  <p className="wait-hint">Zadej čekání ručně ve formátu HH:MM (bez vteřin).</p>
                </div>
                {stationCode === 'T' ? (
                  <div className="calc-grid">
                    <div className="calc-time-card">
                      <div className="calc-time-header">
                        <h3>Čas doběhu</h3>
                        <p className="card-hint">Zapiš čas doběhu na stanovišti. Přepočet vychází ze startovního času.</p>
                        <p className="card-hint">
                          12 bodů je za limitní čas dle kategorie, za každých započatých 10 minut navíc se odečte 1 bod.
                        </p>
                      </div>
                      <div className="calc-time-input">
                        <label htmlFor="finish-time-input">Doběh (HH:MM)</label>
                        <input
                          id="finish-time-input"
                          type="time"
                          value={finishTimeInput}
                          onChange={(event) => handleFinishTimeChange(event.target.value)}
                          step={60}
                          placeholder="hh:mm"
                        />
                      </div>
                      <div className="calc-time-meta">
                        <div>
                          <span className="calc-meta-label">Start:</span>
                          <strong>{formatDateTimeLabel(startTime)}</strong>
                        </div>
                        <div>
                          <span className="calc-meta-label">Čas na trati:</span>
                          <strong>{timeOnCourse ?? '—'}</strong>
                        </div>
                        <div>
                          <span className="calc-meta-label">Čekání:</span>
                          <strong>
                            {totalWaitMinutes !== null
                              ? formatWaitDuration(totalWaitMinutes * 60)
                              : '—'}
                          </strong>
                        </div>
                        <div>
                          <span className="calc-meta-label">Čistý čas:</span>
                          <strong>{pureCourseLabel}</strong>
                        </div>
                        <div>
                          <span className="calc-meta-label">Body za čas:</span>
                          <strong>{timePoints ?? '—'}</strong>
                        </div>
                      </div>
                    </div>
                    {controlChecks.length ? (
                      <div className="calc-checklist">
                        <h3>Kontrola vyplnění</h3>
                        <ul>
                          {controlChecks.map((item) => (
                            <li key={item.label} className={item.ok ? 'ok' : 'warn'}>
                              <span className="status-dot" aria-hidden />
                              {item.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {canReviewStationScores ? (
                  <div className="score-review">
                    <div className="score-review-header">
                      <div>
                        <h3>Kontrola bodů stanovišť</h3>
                        <p className="card-hint">Zkontroluj body ze všech stanovišť a případně je uprav.</p>
                      </div>
                      <button
                        type="button"
                        className="ghost score-review-refresh"
                        onClick={handleRefreshScoreReview}
                        disabled={scoreReviewLoading}
                      >
                        {scoreReviewLoading ? 'Načítám…' : 'Obnovit'}
                      </button>
                    </div>
                    {scoreReviewError ? <p className="error-text">{scoreReviewError}</p> : null}
                    {!scoreReviewRows.length && !scoreReviewLoading ? (
                      <p className="card-hint">Pro tuto hlídku zatím nejsou žádné body k zobrazení.</p>
                    ) : null}
                    {scoreReviewRows.length ? (
                      <div className="score-review-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Body</th>
                              <th>Čekání (HH:MM)</th>
                              <th>Stanoviště</th>
                              <th>OK</th>
                              <th>Akce</th>
                            </tr>
                          </thead>
                          <tbody>
                            {scoreReviewRows.map((row) => {
                              const state =
                                scoreReviewState[row.stationId] ??
                                ({
                                  ok: true,
                                  pointsDraft: row.points !== null ? String(row.points) : '',
                                  waitDraft: formatWaitDraft(row.waitMinutes),
                                  saving: false,
                                  error: null,
                                } satisfies StationScoreRowState);
                              const pointsDraft = state.pointsDraft;
                              const rawWaitDraft = state.waitDraft;
                              const pointsTrimmed = pointsDraft.trim();
                              const pointsNumber = pointsTrimmed === '' ? NaN : Number(pointsTrimmed);
                              const waitNumber = parseWaitDraft(rawWaitDraft);
                              const waitDraft = Number.isNaN(waitNumber)
                                ? rawWaitDraft || WAIT_TIME_ZERO
                                : formatWaitDraft(waitNumber);
                              const pointsValid =
                                Number.isInteger(pointsNumber) && pointsNumber >= 0 && pointsNumber <= 12;
                              const waitValid =
                                Number.isInteger(waitNumber) && waitNumber >= 0 && waitNumber <= WAIT_MINUTES_MAX;
                              const dirtyPoints = Number.isNaN(pointsNumber)
                                ? row.points !== null
                                : row.points === null
                                  ? true
                                  : pointsNumber !== row.points;
                              const baseWait = row.waitMinutes ?? 0;
                              const dirtyWait = Number.isNaN(waitNumber)
                                ? row.waitMinutes !== null
                                : waitNumber !== baseWait;
                              const isValid = pointsValid && waitValid;
                              const dirty = !state.ok && (dirtyPoints || dirtyWait);
                              return (
                                <tr key={row.stationId} className={state.ok ? '' : 'score-review-editing'}>
                                  <td>
                                    <input
                                      type="number"
                                      min={0}
                                      max={12}
                                      inputMode="numeric"
                                      value={pointsDraft}
                                      onChange={(event) => handleScoreDraftChange(row.stationId, event.target.value)}
                                      disabled={state.ok || state.saving}
                                      placeholder="—"
                                      className="score-review-input"
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="time"
                                      step={60}
                                      min={WAIT_TIME_ZERO}
                                      max={WAIT_TIME_MAX}
                                      value={waitDraft}
                                      onChange={(event) => handleWaitDraftChange(row.stationId, event.target.value)}
                                      disabled={state.ok || state.saving}
                                      placeholder="hh:mm"
                                      className="score-review-input score-review-input--wait"
                                    />
                                  </td>
                                  <td>
                                    <div className="score-review-station">
                                      <span className="score-review-code">{row.stationCode || '—'}</span>
                                      <span className="score-review-name">{row.stationName}</span>
                                    </div>
                                  </td>
                                  <td>
                                    <label className="score-review-check">
                                      <input
                                        type="checkbox"
                                        checked={state.ok}
                                        onChange={(event) => handleScoreOkToggle(row.stationId, event.target.checked)}
                                        disabled={state.saving}
                                      />
                                      <span>OK</span>
                                    </label>
                                  </td>
                                  <td>
                                    {state.ok ? (
                                      <span className="score-review-status">
                                        {row.hasScore ? 'Potvrzeno' : 'Bez bodů'}
                                      </span>
                                    ) : (
                                      <div className="score-review-actions">
                                        <button
                                          type="button"
                                          className="ghost score-review-save"
                                          onClick={() => handleSaveStationScore(row.stationId)}
                                          disabled={state.saving || !isValid || !dirty}
                                        >
                                          {state.saving ? 'Ukládám…' : 'Uložit'}
                                        </button>
                                        {state.error ? (
                                          <span className="error-text score-review-row-error">{state.error}</span>
                                        ) : null}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {useTargetScoring ? (
                  <div className={`auto-section${stationCode === 'T' ? ' calc-auto' : ''}`}>
                    {stationCode === 'T' ? <h3>Odpovědi v terčovém úseku</h3> : null}
                    <p className="card-hint">Terčový úsek se hodnotí automaticky podle zadaných odpovědí.</p>
                    <label>
                      Odpovědi hlídky ({totalAnswers || '–'})
                      <input
                        ref={answersInputRef}
                        value={answersInput}
                        onChange={(event) => setAnswersInput(event.target.value.toUpperCase())}
                        placeholder="např. A B C D …"
                      />
                    </label>
                    <p className="auto-score">Správně: {autoScore.correct} / {autoScore.total}</p>
                    {answersError ? <p className="error-text">{answersError}</p> : null}
                  </div>
                ) : (
                  <PointsInput
                    ref={pointsInputRef}
                    value={points}
                    onChange={setPoints}
                    label="Body (0 až 12)"
                    helperText="Zadej počet bodů, které hlídka získala."
                  />
                )}
                <button type="button" className="primary" onClick={handleSave} disabled={scoringDisabled}>
                  Uložit záznam
                </button>
                {scoringDisabled ? (
                  <p className="error-text">
                    Závod byl ukončen. Zapisování bodů je možné pouze na stanovišti T.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="form-placeholder">Nejprve načti hlídku a otevři formulář.</p>
            )}
            {shouldShowAuthBanner ? (
              <div className="pending-auth-banner" role="status">
                <div className="pending-auth-text">{authBannerMessage}</div>
                {isOnline ? (
                  <button type="button" className="ghost" onClick={handleLoginPrompt}>
                    Přihlásit
                  </button>
                ) : null}
              </div>
            ) : null}
            {outboxItems.length > 0 ? (
              <div className="pending-banner">
                <div className="pending-banner-main">
                  <div>
                    Čeká na odeslání: {pendingCount} {syncing ? '(synchronizuji…)' : ''}
                  </div>
                  {otherSessionItems.length > 0 ? (
                    <div className="pending-banner-note">
                      Jiná relace: {otherSessionItems.length}
                    </div>
                  ) : null}
                  <div className="pending-banner-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setShowPendingDetails((prev) => !prev)}
                    >
                      {showPendingDetails ? 'Skrýt frontu' : 'Zobrazit frontu'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void flushOutbox({ force: true })}
                      disabled={syncing || pendingCount === 0}
                    >
                      {syncing ? 'Pracuji…' : 'Odeslat nyní'}
                    </button>
                  </div>
                </div>
                {showPendingDetails ? (
                  <div className="pending-preview">
                    {outboxItems.length === 0 ? (
                      <p>Fronta je prázdná.</p>
                    ) : (
                      <>
                        {currentSessionItems.length > 0 ? (
                          <div className="table-scroll">
                            <table className="pending-table">
                              <thead>
                                <tr>
                                  <th>Hlídka</th>
                                  <th>Body / Terč</th>
                                  <th>Rozhodčí</th>
                                  <th>Poznámka</th>
                                  <th>Stav</th>
                                  <th>Akce</th>
                                </tr>
                              </thead>
                              <tbody>
                                {currentSessionItems.map((item, index) => {
                                  const payload = item.payload;
                                  const answers = payload.use_target_scoring
                                    ? formatAnswersForInput(payload.normalized_answers || '')
                                    : '';
                                  const blockedLabel =
                                    item.state === 'blocked_other_session'
                                      ? 'Záznam patří k jiné relaci.'
                                      : null;
                                  const patrolLabel = payload.team_name || 'Neznámá hlídka';
                                  const codeLabel = payload.patrol_code ? ` (${payload.patrol_code})` : '';
                                  const categoryLabel = payload.sex ? `${payload.category}/${payload.sex}` : payload.category;
                                  const statusLabel = (() => {
                                    switch (item.state) {
                                      case 'sending':
                                        return 'Odesílám…';
                                      case 'needs_auth':
                                        return 'Čeká na přihlášení';
                                      case 'blocked_other_session':
                                        return 'Nelze odeslat';
                                      case 'failed':
                                        return `Další pokus v ${formatTime(new Date(item.next_attempt_at).toISOString())}`;
                                      case 'sent':
                                        return 'Odesláno';
                                      default:
                                        return 'Čeká na odeslání';
                                    }
                                  })();
                                  return (
                                    <tr key={`${item.client_event_id}-${index}`}>
                                      <td>
                                        <div className="pending-patrol">
                                          <strong>
                                            {patrolLabel}
                                            {codeLabel}
                                          </strong>
                                          <span className="pending-subline">{categoryLabel}</span>
                                          <span className="pending-subline">Čekání: {payload.wait_minutes} min</span>
                                        </div>
                                      </td>
                                      <td>
                                        <div className="pending-score">
                                          <span className="pending-score-points">{payload.points} b</span>
                                          <span className="pending-subline">
                                            {payload.use_target_scoring ? 'Terčový úsek' : 'Manuální body'}
                                          </span>
                                          {payload.use_target_scoring ? (
                                            <span className="pending-answers">{answers || '—'}</span>
                                          ) : null}
                                        </div>
                                      </td>
                                      <td>{manifest.judge.displayName || '—'}</td>
                                      <td>{payload.note ? payload.note : '—'}</td>
                                      <td>
                                        <div className="pending-status">
                                          <span>{statusLabel}</span>
                                          {blockedLabel ? (
                                            <span className="pending-subline">{blockedLabel}</span>
                                          ) : null}
                                          {item.last_error ? (
                                            <span className="pending-subline">Chyba: {item.last_error}</span>
                                          ) : null}
                                        </div>
                                      </td>
                                      <td>
                                        <button
                                          type="button"
                                          className="ghost pending-remove"
                                          onClick={() => void handleRemoveOutboxEntry(item)}
                                          disabled={item.state === 'sending'}
                                        >
                                          Smazat
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p>Aktuální relace je prázdná.</p>
                        )}
                        {otherSessionItems.length > 0 ? (
                          <div className="pending-section">
                            <div className="pending-section-header">
                              <h4>Jiná relace</h4>
                              <button type="button" className="ghost" onClick={handleClearOtherSessions}>
                                Vyčistit staré záznamy
                              </button>
                            </div>
                            <p className="pending-section-note">
                              Záznamy patří k jiné relaci, proto je teď neodesíláme.
                            </p>
                            <div className="table-scroll">
                              <table className="pending-table">
                                <thead>
                                  <tr>
                                    <th>Hlídka</th>
                                    <th>Body / Terč</th>
                                    <th>Relace</th>
                                    <th>Stav</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {otherSessionItems.map((item, index) => {
                                    const payload = item.payload;
                                    const answers = payload.use_target_scoring
                                      ? formatAnswersForInput(payload.normalized_answers || '')
                                      : '';
                                    const patrolLabel = payload.team_name || 'Neznámá hlídka';
                                    const codeLabel = payload.patrol_code ? ` (${payload.patrol_code})` : '';
                                    const categoryLabel = payload.sex
                                      ? `${payload.category}/${payload.sex}`
                                      : payload.category;
                                    const sessionLabel = `Závod: ${item.event_id ?? '—'}, Stanoviště: ${item.station_id ?? '—'}`;
                                    return (
                                      <tr key={`${item.client_event_id}-other-${index}`}>
                                        <td>
                                          <div className="pending-patrol">
                                            <strong>
                                              {patrolLabel}
                                              {codeLabel}
                                            </strong>
                                            <span className="pending-subline">{categoryLabel}</span>
                                            <span className="pending-subline">Čekání: {payload.wait_minutes} min</span>
                                          </div>
                                        </td>
                                        <td>
                                          <div className="pending-score">
                                            <span className="pending-score-points">{payload.points} b</span>
                                            <span className="pending-subline">
                                              {payload.use_target_scoring ? 'Terčový úsek' : 'Manuální body'}
                                            </span>
                                            {payload.use_target_scoring ? (
                                              <span className="pending-answers">{answers || '—'}</span>
                                            ) : null}
                                          </div>
                                        </td>
                                        <td>{sessionLabel}</td>
                                        <td>
                                          <div className="pending-status">
                                            <span>Neodesíláme</span>
                                            <span className="pending-subline">
                                              Záznam patří k jiné relaci, proto ho teď neodesíláme.
                                            </span>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <LastScoresList
            eventId={eventId}
            stationId={stationId}
            isTargetStation={isTargetStation}
            onQueueScoreUpdate={enqueueStationScore}
          />

        </>
      </main>
      <AppFooter />
    </div>
  );
}

export function useStationRouting(status: AuthStatus) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const pathname = window.location.pathname;
    const search = window.location.search ?? '';
    const hash = window.location.hash ?? '';

    if (status.state === 'authenticated') {
      const station = status.manifest.station;
      const stationDisplayName = getStationDisplayName(station.name, station.code);
      if (!stationDisplayName) {
        return;
      }

      const canonicalPath = getStationPath(stationDisplayName);

      if (pathname !== canonicalPath) {
        window.history.replaceState(window.history.state, '', `${canonicalPath}${search}${hash}`);
      }
      return;
    }

    if (
      status.state === 'unauthenticated' ||
      status.state === 'locked' ||
      status.state === 'password-change-required' ||
      status.state === 'error'
    ) {
      if (isStationAppPath(pathname)) {
        window.history.replaceState(window.history.state, '', ROUTE_PREFIX);
      }
    }
  }, [status]);
}

function App() {
  const { status, refreshManifest, logout, refreshTokens } = useAuth();

  useStationRouting(status);

  if (status.state === 'loading') {
    return (
      <div className="auth-shell auth-overlay">
        <div className="auth-shell-content">
          <div className="auth-card">
            <h1>Načítám…</h1>
          </div>
        </div>
        <AppFooter variant="dark" />
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <div className="auth-shell auth-overlay">
        <div className="auth-shell-content">
          <div className="auth-card">
            <h1>Nelze načíst aplikaci</h1>
            <p className="auth-description">{status.message || 'Zkontroluj připojení nebo konfiguraci a zkus to znovu.'}</p>
            <button type="button" className="auth-primary" onClick={() => window.location.reload()}>
              Zkusit znovu
            </button>
          </div>
        </div>
        <AppFooter variant="dark" />
      </div>
    );
  }

  if (status.state === 'unauthenticated') {
    return <LoginScreen />;
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
    return (
      <StationApp
        auth={status}
        refreshManifest={refreshManifest}
        logout={logout}
        refreshTokens={refreshTokens}
      />
    );
  }

  return null;
}

export default App;
