import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import localforage from 'localforage';
// import QRScanner from './components/QRScanner';
import LastScoresList from './components/LastScoresList';
import PatrolCodeInput, {
  normalisePatrolCode,
  PatrolRegistryEntry,
  PatrolValidationState,
} from './components/PatrolCodeInput';
import PointsInput from './components/PointsInput';
import OfflineHealth from './components/OfflineHealth';
import AppFooter from './components/AppFooter';
import { supabase } from './supabaseClient';
import './App.css';
import zelenaLigaLogo from './assets/znak_SPTO_transparent.png';
import { useAuth } from './auth/context';
import LoginScreen from './auth/LoginScreen';
import ChangePasswordScreen from './auth/ChangePasswordScreen';
import type { AuthStatus } from './auth/types';
import { signPayload } from './auth/crypto';
import TicketQueue from './components/TicketQueue';
import { createTicket, loadTickets, saveTickets, transitionTicket, Ticket, TicketState } from './auth/tickets';
import { registerPendingSync, setupSyncListener } from './backgroundSync';
import { appendScanRecord } from './storage/scanHistory';
import { computePureCourseSeconds, computeTimePoints, isTimeScoringCategory } from './timeScoring';
import { triggerHaptic } from './utils/haptics';
import { ROUTE_PREFIX, SCOREBOARD_ROUTE_PREFIX, getStationPath, isStationAppPath } from './routing';
import competitionRulesPdf from './assets/pravidla-souteze.pdf';
import stationRulesPdf from './assets/pravidla-stanovist.pdf';
import {
  createStationCategoryRecord,
  getAllowedStationCategories,
  getStationAllowedBaseCategories,
  StationCategoryKey,
  toStationCategoryKey,
} from './utils/stationCategories';
import { env } from './envVars';
import { CategoryKey, formatAnswersForInput, isCategoryKey, packAnswersForStorage, parseAnswerLetters } from './utils/targetAnswers';


interface Patrol {
  id: string;
  team_name: string;
  category: string;
  sex: string;
  patrol_code: string | null;
}

interface PendingSubmissionPayload {
  event_id: string;
  station_id: string;
  patrol_id: string;
  category: string;
  arrived_at: string;
  wait_minutes: number;
  points: number;
  note: string;
  useTargetScoring: boolean;
  normalizedAnswers: string | null;
  shouldDeleteQuiz: boolean;
  patrol_code: string;
  team_name?: string;
  sex?: string;
  finish_time?: string | null;
  manifest_version: number;
}

interface PendingOperation {
  id: string;
  type: 'submission';
  payload: PendingSubmissionPayload;
  signature: string;
  signature_payload: string;
  created_at: string;
  inProgress: boolean;
  retryCount: number;
  nextAttemptAt: number;
  lastError?: string;
  sessionId?: string;
}

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
}

interface StationCategorySummaryItem {
  key: StationCategoryKey;
  expected: number;
  visited: number;
  missing: StationSummaryPatrol[];
}

interface StationCategorySummary {
  items: StationCategorySummaryItem[];
  totalExpected: number;
  totalVisited: number;
  totalMissing: StationSummaryPatrol[];
}

type LegacyPendingSubmission = PendingSubmissionPayload & {
  judge?: string;
  judge_id?: string;
  session_id?: string;
  signature: string;
  signature_payload: string;
};

type AuthenticatedState = Extract<AuthStatus, { state: 'authenticated' }>;

const QUEUE_KEY_PREFIX = 'web_pending_ops_v1';
const LEGACY_QUEUE_KEY_PREFIX = 'web_pending_station_submissions_v1';
const WAIT_MINUTES_MAX = 600;

localforage.config({
  name: 'seton-web',
});

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

async function readQueue(key: string): Promise<PendingOperation[]> {
  let raw = await localforage.getItem<(PendingOperation | LegacyPendingSubmission)[]>(key);
  let migratedFromLegacy = false;

  if ((!raw || !Array.isArray(raw) || raw.length === 0) && key.startsWith(QUEUE_KEY_PREFIX)) {
    const legacyKey = key.replace(QUEUE_KEY_PREFIX, LEGACY_QUEUE_KEY_PREFIX);
    const legacyRaw = await localforage.getItem<(LegacyPendingSubmission | PendingOperation)[]>(legacyKey);
    if (legacyRaw && Array.isArray(legacyRaw) && legacyRaw.length) {
      raw = legacyRaw;
      migratedFromLegacy = true;
      await localforage.removeItem(legacyKey);
    }
  }

  if (!raw || !Array.isArray(raw)) {
    return [];
  }

  let mutated = false;
  const mapped = raw.map((item) => {
    if (item && typeof item === 'object' && 'type' in item && 'payload' in item) {
      const operation = item as PendingOperation & {
        payload: PendingSubmissionPayload & { judge?: string; judge_id?: string; session_id?: string };
      };
      const { judge: _legacyJudge, judge_id: _legacyJudgeId, session_id: _legacySessionId, ...rest } =
        operation.payload as PendingSubmissionPayload & {
          judge?: string;
          judge_id?: string;
          session_id?: string;
        };
      const legacySessionId =
        typeof _legacySessionId === 'string' && _legacySessionId.length ? _legacySessionId : undefined;
      const hasLegacyIdentity =
        typeof _legacyJudge !== 'undefined' || typeof _legacyJudgeId !== 'undefined' || legacySessionId;
      if (hasLegacyIdentity || typeof operation.sessionId === 'undefined') {
        mutated = true;
      }
      return {
        ...operation,
        sessionId: typeof operation.sessionId === 'string' && operation.sessionId.length
          ? operation.sessionId
          : legacySessionId,
        payload: {
          ...rest,
          manifest_version: typeof rest.manifest_version === 'number' ? rest.manifest_version : 0,
        },
      } satisfies PendingOperation;
    }

    mutated = true;
    const legacy = item as LegacyPendingSubmission;
    return {
      id: generateOperationId(),
      type: 'submission' as const,
      payload: {
        event_id: legacy.event_id,
        station_id: legacy.station_id,
        patrol_id: legacy.patrol_id,
        category: legacy.category,
        arrived_at: legacy.arrived_at,
        wait_minutes: legacy.wait_minutes,
        points: legacy.points,
        note: legacy.note,
        useTargetScoring: legacy.useTargetScoring,
        normalizedAnswers: legacy.normalizedAnswers,
        shouldDeleteQuiz: legacy.shouldDeleteQuiz,
        patrol_code: legacy.patrol_code,
        team_name: legacy.team_name,
        sex: legacy.sex,
        finish_time: legacy.finish_time,
        manifest_version: legacy.manifest_version,
      },
      signature: legacy.signature,
      signature_payload: legacy.signature_payload,
      created_at: new Date().toISOString(),
      inProgress: false,
      retryCount: 0,
      nextAttemptAt: Date.now(),
      sessionId:
        legacy.session_id && typeof legacy.session_id === 'string' && legacy.session_id.length
          ? legacy.session_id
          : undefined,
    } satisfies PendingOperation;
  });

  if (mutated || migratedFromLegacy) {
    await writeQueue(key, mapped);
  }

  return mapped;
}

async function writeQueue(key: string, items: PendingOperation[]) {
  if (!items.length) {
    await localforage.removeItem(key);
  } else {
    await localforage.setItem(key, items);
    if (typeof window !== 'undefined') {
      void registerPendingSync();
    }
  }
}

function generateOperationId() {
  const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function computeBackoffMs(retryCount: number) {
  const base = 5000;
  const max = 5 * 60 * 1000;
  const delay = base * 2 ** Math.max(0, retryCount - 1);
  return Math.min(max, delay);
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
  return Math.max(0, Math.round(seconds / 60));
}

function getStationDisplayName(name: string, code: string | null | undefined): string {
  return code?.trim().toUpperCase() === 'T' ? 'Výpočetka' : name;
}

const STATION_CATEGORY_LABELS: Record<StationCategoryKey, { chip: string; detail: string }> = {
  NH: { chip: 'N/H', detail: 'N – hoši' },
  ND: { chip: 'N/D', detail: 'N – dívky' },
  MH: { chip: 'M/H', detail: 'M – hoši' },
  MD: { chip: 'M/D', detail: 'M – dívky' },
  SH: { chip: 'S/H', detail: 'S – hoši' },
  SD: { chip: 'S/D', detail: 'S – dívky' },
  RH: { chip: 'R/H', detail: 'R – hoši' },
  RD: { chip: 'R/D', detail: 'R – dívky' },
};

function formatStationCategoryChipLabel(category: StationCategoryKey): string {
  return STATION_CATEGORY_LABELS[category]?.chip ?? category;
}

function formatStationCategoryDetailLabel(category: StationCategoryKey): string {
  return STATION_CATEGORY_LABELS[category]?.detail ?? category;
}

function StationApp({
  auth,
  refreshManifest,
  logout,
}: {
  auth: AuthenticatedState;
  refreshManifest: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  const manifest = auth.manifest;
  const eventId = manifest.event.id;
  const stationId = manifest.station.id;
  const stationCode = manifest.station.code?.trim().toUpperCase() || '';
  const stationDisplayName = getStationDisplayName(manifest.station.name, manifest.station.code);
  const showScoreboardLink = stationCode === 'T';
  const scoringLocked = manifest.event.scoringLocked;
  const isTargetStation = stationCode === 'T';
  const scoringDisabled = scoringLocked && !isTargetStation;
  const [activePatrol, setActivePatrol] = useState<Patrol | null>(null);
  const [scannerPatrol, setScannerPatrol] = useState<Patrol | null>(null);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [answersInput, setAnswersInput] = useState('');
  const [answersError, setAnswersError] = useState('');
  const [useTargetScoring, setUseTargetScoring] = useState(false);
  const [categoryAnswers, setCategoryAnswers] = useState<Record<string, string>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingItems, setPendingItems] = useState<PendingOperation[]>([]);
  const [showPendingDetails, setShowPendingDetails] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [manualCodeDraft, setManualCodeDraft] = useState('');
  const [confirmedManualCode, setConfirmedManualCode] = useState('');
  const [patrolRegistryEntries, setPatrolRegistryEntries] = useState<PatrolRegistryEntry[]>([]);
  const [patrolRegistryLoading, setPatrolRegistryLoading] = useState(true);
  const [patrolRegistryError, setPatrolRegistryError] = useState<string | null>(null);
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
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [arrivedAt, setArrivedAt] = useState<string | null>(null);
  const [finishAt, setFinishAt] = useState<string | null>(null);
  const [totalWaitMinutes, setTotalWaitMinutes] = useState<number | null>(null);
  const [waitDurationSeconds, setWaitDurationSeconds] = useState<number | null>(null);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const tempCodesRef = useRef<Map<string, string>>(new Map());
  const tempCounterRef = useRef(1);
  const formRef = useRef<HTMLElement | null>(null);
  const ticketQueueRef = useRef<HTMLElement | null>(null);
  const pointsInputRef = useRef<HTMLButtonElement | null>(null);
  const answersInputRef = useRef<HTMLInputElement | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
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

  const queueKey = useMemo(() => `${QUEUE_KEY_PREFIX}_${stationId}`, [stationId]);
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
  useEffect(() => {
    setSelectedSummaryCategory((previous) => {
      if (!previous) {
        return null;
      }
      return allowedStationCategorySet.has(previous) ? previous : null;
    });
  }, [allowedStationCategorySet]);
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

  useEffect(() => {
    let cancelled = false;

    type RawRegistryRow = {
      id: string;
      patrol_code: string | null;
      category: string | null;
      sex: string | null;
      active: boolean | null;
    };

    const loadRegistry = async () => {
      setPatrolRegistryLoading(true);
      setPatrolRegistryError(null);

      const { data, error } = await supabase
        .from('patrols')
        .select('id, patrol_code, category, sex, active')
        .eq('event_id', eventId)
        .order('category')
        .order('sex')
        .order('patrol_code');

      if (cancelled) {
        return;
      }

      if (error) {
        console.error('Failed to load patrol registry', error);
        setPatrolRegistryEntries([]);
        setPatrolRegistryError('Nepodařilo se načíst dostupná čísla hlídek.');
        setPatrolRegistryLoading(false);
        return;
      }

      const rows = (data ?? []) as RawRegistryRow[];
      const entries: PatrolRegistryEntry[] = [];
      const availabilityStats = new Map<string, { total: number; inactive: number }>();
      let totalInactive = 0;
      rows.forEach((row) => {
        const normalized = normalisePatrolCode(row.patrol_code ?? '');
        const match = normalized.match(/^([NMSR])([HD])-(\d{1,2})$/);
        if (!match) {
          return;
        }
        const [, category, gender, digits] = match;
        if (!isCategoryAllowed(category)) {
          return;
        }
        const numeric = Number.parseInt(digits, 10);
        if (!Number.isFinite(numeric)) {
          return;
        }
        const statsKey = `${category}-${gender}`;
        const stats = availabilityStats.get(statsKey) ?? { total: 0, inactive: 0 };
        stats.total += 1;
        const isActive = row.active !== false;
        if (!isActive) {
          stats.inactive += 1;
          totalInactive += 1;
        }
        availabilityStats.set(statsKey, stats);
        entries.push({
          id: row.id,
          code: normalized,
          category,
          gender,
          number: String(numeric),
          active: isActive,
        });
      });

      setPatrolRegistryEntries(entries);
      const ratio = entries.length > 0 ? totalInactive / entries.length : 0;
      const breakdown = Array.from(availabilityStats.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([group, stats]) => {
          const [category, gender] = group.split('-');
          const groupRatio = stats.total > 0 ? stats.inactive / stats.total : 0;
          return {
            category,
            gender,
            total: stats.total,
            inactive: stats.inactive,
            inactiveRatio: Number(groupRatio.toFixed(3)),
          };
        });
      console.info('[patrol-code-input] registry-loaded', {
        total: entries.length,
        inactive: totalInactive,
        inactiveRatio: Number(ratio.toFixed(3)),
        breakdown,
      });
      setPatrolRegistryLoading(false);
    };

    void loadRegistry();

    return () => {
      cancelled = true;
    };
  }, [eventId, isCategoryAllowed]);

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

  const updateQueueState = useCallback((items: PendingOperation[]) => {
    setPendingCount(items.length);
    const sorted = [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    setPendingItems(sorted);
    if (items.length === 0) {
      setShowPendingDetails(false);
    }
  }, []);

  const pushAlert = useCallback((message: string) => {
    setAlerts((prev) => [...prev, message]);
    setTimeout(() => {
      setAlerts((prev) => prev.slice(1));
    }, 4500);
  }, []);

  useEffect(() => {
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

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        await refreshManifest();
      } catch (error) {
        console.error('Manifest refresh failed', error);
        if (!cancelled) {
          pushAlert('Nepodařilo se obnovit manifest. Zkusím to znovu později.');
        }
      }
    };

    refresh();
    const interval = window.setInterval(refresh, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
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
      } else {
        pushAlert('Hlídka už je ve frontě.');
      }
    },
    [scannerPatrol, pushAlert, resolvePatrolCode, scoringDisabled, updateTickets],
  );

  const clearWait = useCallback(() => {
    setWaitDurationSeconds(null);
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

  const stationPassageVisitedSet = useMemo(() => {
    const visited = new Set<string>();
    stationPassageIds.forEach((id) => {
      if (typeof id === 'string' && id.length > 0) {
        visited.add(id);
      }
    });

    pendingItems.forEach((item) => {
      if (item.type !== 'submission') {
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

    return visited;
  }, [eventId, pendingItems, stationId, stationPassageIds]);


  const loadTimingData = useCallback(
    async (patrolId: string) => {
      if (stationCode !== 'T') {
        setStartTime(null);
        setFinishAt(null);
        setTotalWaitMinutes(null);
        return;
      }

      const [{ data: timingRows, error: timingError }, { data: passageRows, error: waitError }] =
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
    [eventId, stationCode],
  );

  const loadScoreReview = useCallback(
    async (patrolId: string) => {
      if (!isTargetStation) {
        setScoreReviewRows([]);
        setScoreReviewState({});
        setScoreReviewError(null);
        setScoreReviewLoading(false);
        return;
      }

      setScoreReviewLoading(true);
      setScoreReviewError(null);

      try {
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

        const stations = ((stationsRes.data ?? []) as { id: string; code: string; name: string }[]).map((station) => ({
          id: station.id,
          code: (station.code || '').trim().toUpperCase(),
          name: station.name,
        }));

        const scoreMap = new Map<
          string,
          { points: number | null; judge: string | null; note: string | null }
        >();
        ((scoresRes.data ?? []) as { station_id: string; points: number | null; judge: string | null; note: string | null }[]).forEach(
          (row) => {
            scoreMap.set(row.station_id, {
              points: typeof row.points === 'number' ? row.points : row.points ?? null,
              judge: row.judge ?? null,
              note: row.note ?? null,
            });
          },
        );

        const waitValues = new Map<string, number>();
        const waitPresent = new Set<string>();
        ((waitsRes.data ?? []) as { station_id: string; wait_minutes: number | null }[]).forEach((row) => {
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
            const defaultWaitDraft = row.waitMinutes !== null ? String(row.waitMinutes) : '0';
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
    [eventId, isTargetStation],
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

      if (typeof options?.waitSeconds === 'number' && !isTargetStation) {
        setWaitDurationSeconds(options.waitSeconds);
      }

      const stored = categoryAnswers[data.category] || '';
      const total = parseAnswerLetters(stored).length;
      setAutoScore({ correct: 0, total, given: 0, normalizedGiven: '' });

      void loadTimingData(data.id);
      void loadScoreReview(data.id);

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
    [categoryAnswers, clearWait, isTargetStation, loadTimingData, loadScoreReview],
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
    pushAlert(`Hlídka ${scannerPatrol.team_name} je připravena k obsluze.`);
  }, [enableTicketQueue, handleAddTicket, initializeFormForPatrol, pushAlert, scannerPatrol]);

  const handleScoreOkToggle = useCallback(
    (stationId: string, ok: boolean) => {
      setScoreReviewState((prev) => {
        const next = { ...prev };
        const base = scoreReviewRows.find((row) => row.stationId === stationId);
        const defaultPointsDraft = base && base.points !== null ? String(base.points) : '';
        const defaultWaitDraft = base && base.waitMinutes !== null ? String(base.waitMinutes) : '0';
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
        prev[stationId] ?? { ok: false, pointsDraft: '', waitDraft: '0', saving: false, error: null };
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
        prev[stationId] ?? { ok: false, pointsDraft: '', waitDraft: '0', saving: false, error: null };
      return {
        ...prev,
        [stationId]: {
          ...current,
          waitDraft: value,
          error: null,
        },
      };
    });
  }, []);

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
      const trimmedWait = state.waitDraft.trim();
      const waitValue = trimmedWait === '' ? NaN : Number(trimmedWait);

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
              error: `Čekání musí být číslo 0–${WAIT_MINUTES_MAX}.`,
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
        if (baseRow.hasScore) {
          const { error } = await supabase
            .from('station_scores')
            .update({ points: pointsValue })
            .eq('event_id', eventId)
            .eq('station_id', stationId)
            .eq('patrol_id', activePatrol.id);
          if (error) {
            throw error;
          }
        } else {
          const { error } = await supabase.from('station_scores').insert({
            event_id: eventId,
            station_id: stationId,
            patrol_id: activePatrol.id,
            points: pointsValue,
            judge: manifest.judge.displayName,
          });
          if (error) {
            throw error;
          }
        }

        const waitBase = baseRow.waitMinutes ?? 0;

        if (baseRow.hasWait) {
          if (waitValue !== waitBase) {
            const { error } = await supabase
              .from('station_passages')
              .update({ wait_minutes: waitValue })
              .eq('event_id', eventId)
              .eq('station_id', stationId)
              .eq('patrol_id', activePatrol.id);
            if (error) {
              throw error;
            }
          }
        } else if (waitValue !== 0) {
          const { error } = await supabase.from('station_passages').insert({
            event_id: eventId,
            station_id: stationId,
            patrol_id: activePatrol.id,
            wait_minutes: waitValue,
          });
          if (error) {
            throw error;
          }
        }

        pushAlert(`Záznam pro stanoviště ${baseRow.stationCode || stationId} aktualizován.`);
        await loadScoreReview(activePatrol.id);
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
              waitDraft: String(waitValue),
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
    [eventId, loadScoreReview, manifest.judge.displayName, activePatrol, pushAlert, scoreReviewRows, scoreReviewState],
  );

  const handleRefreshScoreReview = useCallback(() => {
    if (activePatrol) {
      void loadScoreReview(activePatrol.id);
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
    const { data, error } = await supabase
      .from('station_category_answers')
      .select('category, correct_answers')
      .eq('event_id', eventId)
      .eq('station_id', stationId);

    if (error) {
      console.error(error);
      pushAlert('Nepodařilo se načíst správné odpovědi.');
      return;
    }

    const map: Record<string, string> = {};
    (data || []).forEach((row) => {
      map[row.category] = row.correct_answers;
    });
    setCategoryAnswers(map);
  }, [eventId, stationId, pushAlert]);

  const loadStationPassages = useCallback(async () => {
    setStationPassageLoading(true);
    setStationPassageError(null);

    try {
      const { data, error } = await supabase
        .from('station_passages')
        .select('patrol_id')
        .eq('event_id', eventId)
        .eq('station_id', stationId);

      if (error) {
        throw error;
      }

      const rows = (data ?? []) as { patrol_id: string | null }[];
      const ids = rows
        .map((row) => row.patrol_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      setStationPassageIds(ids);
    } catch (error) {
      console.error('Failed to load station passages summary', error);
      setStationPassageError('Nepodařilo se načíst průchody hlídek.');
    } finally {
      setStationPassageLoading(false);
    }
  }, [eventId, stationId]);

  const stationCategorySummary = useMemo<StationCategorySummary>(() => {
    const record = createStationCategoryRecord(() => ({
      expected: 0,
      visited: 0,
      missing: [] as StationSummaryPatrol[],
    }));
    let totalExpected = 0;
    let totalVisited = 0;

    auth.patrols.forEach((patrolSummary) => {
      if (!isCategoryAllowed(patrolSummary.category)) {
        return;
      }
      const stationCategory = toStationCategoryKey(patrolSummary.category, patrolSummary.sex);
      if (!stationCategory || !allowedStationCategorySet.has(stationCategory)) {
        return;
      }
      const normalizedCode = normalisePatrolCode(patrolSummary.patrol_code ?? '');
      const teamName = (patrolSummary.team_name || '').trim();
      const detail: StationSummaryPatrol = {
        id: patrolSummary.id,
        code: normalizedCode,
        teamName,
        baseCategory: patrolSummary.category,
        sex: patrolSummary.sex,
      };

      record[stationCategory].expected += 1;
      totalExpected += 1;

      if (stationPassageVisitedSet.has(patrolSummary.id)) {
        record[stationCategory].visited += 1;
        totalVisited += 1;
      } else {
        record[stationCategory].missing.push(detail);
      }
    });

    const items = allowedStationCategories.map<StationCategorySummaryItem>((category) => {
      const entry = record[category];
      const missing = [...entry.missing].sort((a, b) => {
        const labelA = (a.code || `${a.baseCategory}/${a.sex}`).toUpperCase();
        const labelB = (b.code || `${b.baseCategory}/${b.sex}`).toUpperCase();
        return labelA.localeCompare(labelB, 'cs');
      });
      return {
        key: category,
        expected: entry.expected,
        visited: entry.visited,
        missing,
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

  const handleSelectSummaryCategory = useCallback((category: StationCategoryKey) => {
    setSelectedSummaryCategory((previous) => (previous === category ? null : category));
  }, []);

  const handleRefreshStationPassages = useCallback(() => {
    void loadStationPassages();
  }, [loadStationPassages]);

  const stationSummaryRemaining = useMemo(
    () => Math.max(0, stationCategorySummary.totalExpected - stationCategorySummary.totalVisited),
    [stationCategorySummary.totalExpected, stationCategorySummary.totalVisited],
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

  const syncQueue = useCallback(async () => {
    let queue = await readQueue(queueKey);

    const staleIds = new Set<string>();
    for (const op of queue) {
      const payload = op.payload;
      let signatureMetadata: {
        station_id?: string;
        event_id?: string;
        session_id?: string;
        manifest_version?: number;
      } = {};

      if (typeof op.signature_payload === 'string' && op.signature_payload.length) {
        try {
          const parsed = JSON.parse(op.signature_payload) as Record<string, unknown> | null;
          if (parsed && typeof parsed === 'object') {
            const manifestVersion = parsed.manifest_version;
            if (typeof manifestVersion === 'number') {
              signatureMetadata.manifest_version = manifestVersion;
            }
            const sessionId = parsed.session_id;
            if (typeof sessionId === 'string') {
              signatureMetadata.session_id = sessionId;
            }
            const stationFromSignature = parsed.station_id;
            if (typeof stationFromSignature === 'string') {
              signatureMetadata.station_id = stationFromSignature;
            }
            const eventFromSignature = parsed.event_id;
            if (typeof eventFromSignature === 'string') {
              signatureMetadata.event_id = eventFromSignature;
            }
          }
        } catch (error) {
          console.error('Failed to parse signature payload metadata', error);
        }
      }

      const effectiveStationId = payload?.station_id ?? signatureMetadata.station_id;
      if (effectiveStationId && effectiveStationId !== stationId) {
        staleIds.add(op.id);
        continue;
      }

      const effectiveEventId = payload?.event_id ?? signatureMetadata.event_id;
      if (effectiveEventId && effectiveEventId !== eventId) {
        staleIds.add(op.id);
        continue;
      }

      const effectiveSessionId = op.sessionId ?? signatureMetadata.session_id;
      if (effectiveSessionId && effectiveSessionId !== auth.tokens.sessionId) {
        staleIds.add(op.id);
        continue;
      }

      const manifestVersionFromPayload =
        typeof payload?.manifest_version === 'number' ? payload.manifest_version : undefined;
      const effectiveManifestVersion =
        manifestVersionFromPayload ?? signatureMetadata.manifest_version;
      if (
        typeof effectiveManifestVersion === 'number' &&
        effectiveManifestVersion !== manifest.manifestVersion
      ) {
        staleIds.add(op.id);
      }
    }

    if (staleIds.size) {
      const filtered = queue.filter((op) => !staleIds.has(op.id));
      queue = filtered;
      await writeQueue(queueKey, filtered);
      pushAlert(
        staleIds.size === 1
          ? 'Odebrán 1 záznam z dřívější relace – nelze jej odeslat.'
          : `Odebráno ${staleIds.size} záznamů z dřívější relace – nelze je odeslat.`,
      );
    }

    updateQueueState(queue);
    if (syncing) return;

    const now = Date.now();
    const ready = queue.filter((op) => !op.inProgress && op.nextAttemptAt <= now);
    if (!ready.length) {
      return;
    }

    setSyncing(true);

    const readyIds = new Set(ready.map((op) => op.id));
    const queueWithLocks = queue.map((op) => (readyIds.has(op.id) ? { ...op, inProgress: true } : op));
    await writeQueue(queueKey, queueWithLocks);
    updateQueueState(queueWithLocks);

    const operationsPayload = ready.map((op) => ({
      id: op.id,
      type: op.type,
      signature: op.signature,
      signature_payload: op.signature_payload,
    }));

    const baseUrl = env.VITE_AUTH_API_URL?.replace(/\/$/, '') ?? '';

    const releaseLocks = async (updater: (op: PendingOperation) => PendingOperation) => {
      const rollbackQueue = queueWithLocks.map((op) => (readyIds.has(op.id) ? updater(op) : op));
      await writeQueue(queueKey, rollbackQueue);
      updateQueueState(rollbackQueue);
      setSyncing(false);
    };

    const hasSession = Boolean(auth.tokens.sessionId);
    const expiresAt = auth.tokens.accessTokenExpiresAt;
    if (!hasSession || (typeof expiresAt === 'number' && expiresAt <= Date.now())) {
      await releaseLocks((op) => ({
        ...op,
        inProgress: false,
        lastError: 'missing-session',
      }));
      pushAlert('Přihlášení vypršelo, po obnovení připojení se znovu přihlas pro odeslání fronty.');
      return;
    }

    try {
      const response = await fetch(`${baseUrl}/auth/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ operations: operationsPayload }),
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        const shouldForceLogout = response.status === 401 || response.status === 403;
        try {
          const errorBody = await response.json();
          const errorMessage = typeof errorBody?.error === 'string' ? errorBody.error.trim() : '';
          if (errorMessage) {
            message = errorMessage;
          }
        } catch (parseError) {
          console.debug('Failed to parse sync error response', parseError);
        }

        const syncError = new Error(message) as Error & { shouldLogout?: boolean };
        if (shouldForceLogout) {
          syncError.shouldLogout = true;
        }
        throw syncError;
      }

      const resultBody: { results?: { id: string; status: 'done' | 'failed'; error?: string }[] } = await response.json();
      const resultMap = new Map<string, { status: 'done' | 'failed'; error?: string }>();
      for (const result of resultBody.results ?? []) {
        resultMap.set(result.id, { status: result.status, error: result.error });
      }

      const updatedQueue: PendingOperation[] = [];
      let flushed = 0;

      for (const op of queueWithLocks) {
        if (!readyIds.has(op.id)) {
          updatedQueue.push(op);
          continue;
        }

        const result = resultMap.get(op.id);
        if (result && result.status === 'done') {
          flushed += 1;
          continue;
        }

        const retryCount = op.retryCount + 1;
        const lastError = result?.error || 'sync-failed';
        updatedQueue.push({
          ...op,
          inProgress: false,
          retryCount,
          nextAttemptAt: Date.now() + computeBackoffMs(retryCount),
          lastError,
        });
      }

      await writeQueue(queueKey, updatedQueue);
      updateQueueState(updatedQueue);

      if (flushed) {
        pushAlert(`Synchronizováno ${flushed} záznamů.`);
        setLastSavedAt(new Date().toISOString());
        void loadStationPassages();
      }
    } catch (error) {
      const syncError = error as Error & { shouldLogout?: boolean };
      const message = syncError instanceof Error ? syncError.message : 'unknown-error';
      const shouldForceLogout = Boolean(syncError?.shouldLogout);
      await releaseLocks((op) => {
        const retryCount = op.retryCount + 1;
        return {
          ...op,
          inProgress: false,
          retryCount,
          nextAttemptAt: Date.now() + computeBackoffMs(retryCount),
          lastError: message,
        };
      });
      pushAlert('Synchronizace selhala, zkusím to znovu později.');
      if (shouldForceLogout) {
        pushAlert('Přihlášení vypršelo, přihlas se prosím znovu.');
        void logout();
      }
    } finally {
      setSyncing(false);
    }
  }, [
    auth.tokens.sessionId,
    eventId,
    manifest.manifestVersion,
    loadStationPassages,
    queueKey,
    stationId,
    syncing,
    updateQueueState,
    pushAlert,
  ]);

  useEffect(() => {
    syncQueue();
    const onOnline = () => syncQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncQueue]);

  useEffect(() => setupSyncListener(syncQueue), [syncQueue]);

  useEffect(() => {
    syncQueue();
  }, [syncQueue, tick]);

  const resetForm = useCallback(() => {
    setActivePatrol(null);
    setScannerPatrol(null);
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

  useEffect(() => {
    resetForm();
    setLastSavedAt(null);
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
        map.set(activePatrol.patrol_code.trim().toUpperCase(), {
          id: activePatrol.id,
          team_name: activePatrol.team_name,
          category: activePatrol.category,
          sex: activePatrol.sex,
          patrol_code: activePatrol.patrol_code,
        });
      }
    });
    return map;
  }, [auth.patrols, isCategoryAllowed]);

  const fetchPatrol = useCallback(
    async (patrolCode: string) => {
      const normalized = patrolCode.trim().toUpperCase();
      let data = cachedPatrolMap.get(normalized) || null;

      if (!data) {
        const { data: fetched, error } = await supabase
          .from('patrols')
          .select('id, team_name, category, sex, patrol_code')
          .eq('event_id', eventId)
          .eq('patrol_code', normalized)
          .maybeSingle();

        if (error || !fetched) {
          pushAlert('Hlídka nenalezena.');
          void appendScanRecord(eventId, stationId, {
            code: normalized,
            scannedAt: new Date().toISOString(),
            status: 'failed',
            reason: error ? 'fetch-error' : 'not-found',
          }).catch((err) => console.debug('scan history store failed', err));
          return false;
        }
        data = fetched as Patrol;
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
      setScanActive(false);
      setManualCodeDraft('');
      setConfirmedManualCode(normalized);

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
      cachedPatrolMap,
      eventId,
      isCategoryAllowed,
      pushAlert,
      stationCode,
      stationId,
      stationPassageVisitedSet,
      setConfirmedManualCode,
      setManualCodeDraft,
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
    void fetchPatrol(normalized);
  }, [confirmedManualCode, fetchPatrol, manualValidation]);

  const handleScanResult = useCallback(
    async (text: string) => {
      const match = text.match(/seton:\/\/p\/(.+)$/);
      if (!match) {
        pushAlert('Neplatný QR kód. Očekávám seton://p/<code>');
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
      await fetchPatrol(scannedCode);
    },
    [eventId, fetchPatrol, pushAlert, stationId]
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

  const handleSave = useCallback(async () => {
    if (scoringDisabled) {
      pushAlert('Závod byl ukončen. Zapisování bodů je uzamčeno.');
      return;
    }
    if (!activePatrol) return;
    if (!stationId || !queueKey) {
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

    const effectiveWaitSeconds = useTargetScoring ? 0 : Math.max(0, waitDurationSeconds ?? 0);
    const waitMinutes = useTargetScoring ? 0 : waitSecondsToMinutes(effectiveWaitSeconds);

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

    const signaturePayload = {
      version: 1,
      manifest_version: manifest.manifestVersion,
      session_id: auth.tokens.sessionId,
      judge_id: manifest.judge.id,
      station_id: stationId,
      event_id: eventId,
      signed_at: now,
      data: submissionData,
    };

    const signatureResult = await signPayload(auth.deviceKey, signaturePayload);

    const queuePayload: PendingSubmissionPayload = {
      event_id: submissionData.event_id,
      station_id: submissionData.station_id,
      patrol_id: submissionData.patrol_id,
      category: submissionData.category,
      arrived_at: submissionData.arrived_at,
      wait_minutes: submissionData.wait_minutes,
      points: submissionData.points,
      note: submissionData.note,
      useTargetScoring,
      normalizedAnswers,
      shouldDeleteQuiz: !useTargetScoring,
      patrol_code: effectivePatrolCode,
      team_name: submissionData.team_name,
      sex: submissionData.sex,
      finish_time: submissionData.finish_time,
      manifest_version: manifest.manifestVersion,
    };

    const operation: PendingOperation = {
      id: generateOperationId(),
      type: 'submission',
      payload: queuePayload,
      signature: signatureResult.signature,
      signature_payload: signatureResult.canonical,
      created_at: now,
      inProgress: false,
      retryCount: 0,
      nextAttemptAt: Date.now(),
      sessionId: auth.tokens.sessionId || undefined,
    };

    const queueBefore = await readQueue(queueKey);
    const queueWithOperation = [...queueBefore, operation];
    await writeQueue(queueKey, queueWithOperation);
    updateQueueState(queueWithOperation);
    setShowPendingDetails(false);
    pushAlert(`Záznam uložen do fronty (${queuePayload.team_name ?? queuePayload.patrol_code}).`);
    setLastSavedAt(now);
    resetForm();
    scrollToQueue();
    void syncQueue();
  }, [
    autoScore,
    note,
    activePatrol,
    points,
    useTargetScoring,
    pushAlert,
    resetForm,
    updateQueueState,
    waitDurationSeconds,
    arrivedAt,
    stationId,
    queueKey,
    finishAt,
    manifest.judge.displayName,
    manifest.judge.id,
    manifest.manifestVersion,
    auth.deviceKey,
    resolvePatrolCode,
    scoringDisabled,
    scrollToQueue,
    syncQueue,
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

  const failedCount = useMemo(() => pendingItems.filter((item) => Boolean(item.lastError)).length, [pendingItems]);

  const nextAttemptAtIso = useMemo(() => {
    const future = pendingItems
      .filter((item) => !item.inProgress && item.nextAttemptAt > Date.now())
      .map((item) => item.nextAttemptAt);
    if (!future.length) {
      return null;
    }
    const earliest = Math.min(...future);
    return new Date(earliest).toISOString();
  }, [pendingItems]);

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
      void syncQueue();
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [nextAttemptAtIso, syncQueue]);

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

  const waitSecondsDisplay = useTargetScoring ? null : waitDurationSeconds;

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
              <img src={zelenaLigaLogo} alt="Logo Setonův závod" />
            </a>
            <div>
              <h1>Setonův závod – stanoviště</h1>
              <p>
                Tady spravuješ průběh závodu na svém stanovišti. Zapisuj výsledky hlídek, kontroluj průchody a nech aplikaci,
                aby se o zbytek postarala. Když není signál, vše se uloží a po připojení se automaticky odešle.
              </p>
            </div>
          </div>
          <div className="hero-meta">
            <div className="hero-panel hero-panel--station">
              <span className="hero-panel-label">Stanoviště</span>
              <strong className="hero-panel-value">{stationCode || '—'}</strong>
              {stationDisplayName ? <span className="hero-panel-sub">{stationDisplayName}</span> : null}
            </div>
            <div className="hero-panel hero-panel--judge">
              <span className="hero-panel-label">Rozhodčí</span>
              <strong className="hero-panel-value">{manifest.judge.displayName}</strong>
              <span className="hero-panel-sub">{manifest.judge.email}</span>
            </div>
            <div className="hero-panel hero-panel--status">
              <span className="hero-panel-label">Stav závodu</span>
              <div className="hero-badges">
                {heroBadges.map((badge) => (
                  <span key={badge} className="meta-pill">
                    {badge}
                  </span>
                ))}
                {lastSavedAt ? (
                  <span className="meta-pill subtle">Poslední záznam: {formatTime(lastSavedAt)}</span>
                ) : null}
                {syncing ? <span className="meta-pill subtle">Synchronizuji frontu…</span> : null}
              </div>
            </div>
            <div className="hero-panel hero-panel--health">
              <span className="hero-panel-label">Offline fronta</span>
              <OfflineHealth
                isOnline={isOnline}
                pendingCount={pendingCount}
                failedCount={failedCount}
                syncing={syncing}
                nextAttemptAt={nextAttemptAtIso}
                lastSyncedAt={lastSavedAt}
              />
            </div>
            <div className="hero-panel hero-panel--links">
              <span className="hero-panel-label">{stationCode === 'T' ? 'Odkazy' : 'Pravidla'}</span>
              {showScoreboardLink ? (
                <a
                  className="hero-panel-link"
                  href={SCOREBOARD_ROUTE_PREFIX}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Otevřít výsledky
                </a>
              ) : null}
              <div className="hero-panel-links">
                <a
                  className="hero-panel-link"
                  href={competitionRulesPdf}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Pravidla soutěže
                </a>
                <a
                  className="hero-panel-link"
                  href={stationRulesPdf}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Pravidla stanovišť
                </a>
              </div>
            </div>
            <div className="hero-panel hero-panel--actions">
              <span className="hero-panel-label">Účet</span>
              <button type="button" className="logout-button" onClick={handleLogout}>
                Odhlásit se
              </button>
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

      <main className="content">
        <>
          <section className="card station-summary-card">
            <header className="card-header">
              <div>
                <h2>Přehled průchodů</h2>
                <p className="card-subtitle">
                  Sleduj, kolik hlídek už stanoviště navštívilo podle kategorií.
                </p>
              </div>
              <div className="card-actions">
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
              <div className="station-summary-detail" role="region" aria-live="polite">
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
                    : selectedSummaryDetail.missing.length === 0
                      ? 'Všechny hlídky již stanoviště navštívily.'
                      : `Chybí ${selectedSummaryDetail.missing.length} z ${selectedSummaryDetail.expected} hlídek.`}
                </p>
                {selectedSummaryDetail.missing.length ? (
                  <ul className="station-summary-list">
                    {selectedSummaryDetail.missing.map((patrol) => {
                      const codeLabel = patrol.code || `${patrol.baseCategory}/${patrol.sex}`;
                      return (
                        <li key={patrol.id}>
                          <strong>{codeLabel}</strong>
                          {patrol.teamName ? <span>{patrol.teamName}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

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
            <div className="scanner-wrapper">
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
                />
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    void handleManualConfirm();
                  }}
                  disabled={!manualValidation.valid || patrolRegistryLoading}
                >
                  Načíst hlídku
                </button>
              </div>
              {scannerPatrol ? (
                <div className="scanner-preview">
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
                    <span className="scanner-note">Hlídka už čeká ve frontě.</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          {enableTicketQueue ? (
            <TicketQueue
              ref={ticketQueueRef}
              tickets={tickets}
              heartbeat={tick}
              onChangeState={handleTicketStateChange}
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
                {!useTargetScoring ? (
                  <div className="wait-field">
                    <span className="wait-label">Čekání</span>
                    <div className="wait-display">
                      <strong>
                        {typeof waitSecondsDisplay === 'number'
                          ? formatWaitDuration(waitSecondsDisplay)
                          : '—'}
                      </strong>
                    </div>
                    <p className="wait-hint">Čas čekání se načítá automaticky z fronty hlídek.</p>
                  </div>
                ) : null}
                {stationCode === 'T' ? (
                  <>
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
                                <th>Čekání (min)</th>
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
                                    waitDraft: row.waitMinutes !== null ? String(row.waitMinutes) : '0',
                                    saving: false,
                                    error: null,
                                  } satisfies StationScoreRowState);
                                const pointsDraft = state.pointsDraft;
                                const waitDraft = state.waitDraft;
                                const pointsTrimmed = pointsDraft.trim();
                                const waitTrimmed = waitDraft.trim();
                                const pointsNumber = pointsTrimmed === '' ? NaN : Number(pointsTrimmed);
                                const waitNumber = waitTrimmed === '' ? NaN : Number(waitTrimmed);
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
                                        type="number"
                                        min={0}
                                        max={WAIT_MINUTES_MAX}
                                        inputMode="numeric"
                                        value={waitDraft}
                                        onChange={(event) => handleWaitDraftChange(row.stationId, event.target.value)}
                                        disabled={state.ok || state.saving}
                                        placeholder="—"
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
                  </>
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
                    helperText="Vyber počet bodů, které hlídka získala."
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
            {pendingCount > 0 ? (
              <div className="pending-banner">
                <div className="pending-banner-main">
                  <div>
                    Čeká na odeslání: {pendingCount} {syncing ? '(synchronizuji…)' : ''}
                  </div>
                  <div className="pending-banner-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setShowPendingDetails((prev) => !prev)}
                    >
                      {showPendingDetails ? 'Skrýt frontu' : 'Zobrazit frontu'}
                    </button>
                    <button type="button" onClick={syncQueue} disabled={syncing}>
                      {syncing ? 'Pracuji…' : 'Odeslat nyní'}
                    </button>
                  </div>
                </div>
                {showPendingDetails ? (
                  <div className="pending-preview">
                    {pendingItems.length === 0 ? (
                      <p>Fronta je prázdná.</p>
                    ) : (
                      <div className="table-scroll">
                        <table className="pending-table">
                          <thead>
                            <tr>
                              <th>Hlídka</th>
                              <th>Body / Terč</th>
                              <th>Rozhodčí</th>
                              <th>Poznámka</th>
                              <th>Stav</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pendingItems.map((item, index) => {
                              const payload = item.payload;
                              const answers = payload.useTargetScoring
                                ? formatAnswersForInput(payload.normalizedAnswers || '')
                                : '';
                              const patrolLabel = payload.team_name || 'Neznámá hlídka';
                              const codeLabel = payload.patrol_code ? ` (${payload.patrol_code})` : '';
                              const categoryLabel = payload.sex ? `${payload.category}/${payload.sex}` : payload.category;
                              const statusLabel = item.inProgress
                                ? 'Odesílám…'
                                : item.retryCount > 0
                                  ? `Další pokus v ${formatTime(new Date(item.nextAttemptAt).toISOString())}`
                                  : 'Čeká na odeslání';
                              return (
                                <tr key={`${item.id}-${index}`}>
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
                                        {payload.useTargetScoring ? 'Terčový úsek' : 'Manuální body'}
                                      </span>
                                      {payload.useTargetScoring ? (
                                        <span className="pending-answers">{answers || '—'}</span>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td>{manifest.judge.displayName || '—'}</td>
                                  <td>{payload.note ? payload.note : '—'}</td>
                                  <td>
                                    <div className="pending-status">
                                      <span>{statusLabel}</span>
                                      {item.lastError ? (
                                        <span className="pending-subline">Chyba: {item.lastError}</span>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <LastScoresList eventId={eventId} stationId={stationId} isTargetStation={isTargetStation} />
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
  const { status, refreshManifest, logout } = useAuth();

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
    return <StationApp auth={status} refreshManifest={refreshManifest} logout={logout} />;
  }

  return null;
}

export default App;
