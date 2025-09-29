import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import localforage from 'localforage';
import QRScanner from './components/QRScanner';
import LastScoresList from './components/LastScoresList';
import TargetAnswersReport from './components/TargetAnswersReport';
import PatrolCodeInput from './components/PatrolCodeInput';
import { supabase } from './supabaseClient';
import './App.css';
import setonLogo from './assets/seton-logo.png';
import { useAuth } from './auth/context';
import LoginScreen from './auth/LoginScreen';
import type { AuthStatus } from './auth/types';
import { env } from './envVars';
import { signPayload } from './auth/crypto';
import TicketQueue from './components/TicketQueue';
import { createTicket, loadTickets, saveTickets, transitionTicket, Ticket } from './auth/tickets';


interface Patrol {
  id: string;
  team_name: string;
  category: string;
  sex: string;
  patrol_code: string;
}

interface PendingSubmissionPayload {
  event_id: string;
  station_id: string;
  patrol_id: string;
  category: string;
  arrived_at: string;
  wait_minutes: number;
  points: number;
  judge: string;
  note: string;
  useTargetScoring: boolean;
  normalizedAnswers: string | null;
  shouldDeleteQuiz: boolean;
  patrol_code: string;
  team_name?: string;
  sex?: string;
  finish_time?: string | null;
  judge_id: string;
  session_id: string;
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
}

type LegacyPendingSubmission = PendingSubmissionPayload & {
  signature: string;
  signature_payload: string;
};

type AuthenticatedState = Extract<AuthStatus, { state: 'authenticated' }>;

const ANSWER_CATEGORIES = ['N', 'M', 'S', 'R'] as const;
type CategoryKey = (typeof ANSWER_CATEGORIES)[number];
const QUEUE_KEY_PREFIX = 'web_pending_ops_v1';
const LEGACY_QUEUE_KEY_PREFIX = 'web_pending_station_submissions_v1';

import { env } from './envVars';

const isAdminMode =
  typeof env.VITE_ADMIN_MODE === 'string' && ['1', 'true', 'yes', 'on'].includes(env.VITE_ADMIN_MODE.toLowerCase());

localforage.config({
  name: 'seton-web',
});

function parseAnswerLetters(value = '') {
  return (value.match(/[A-D]/gi) || []).map((l) => l.toUpperCase());
}

function formatAnswersForInput(stored = '') {
  return parseAnswerLetters(stored).join(' ');
}

function packAnswersForStorage(value = '') {
  return parseAnswerLetters(value).join('');
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
      return item as PendingOperation;
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
        judge: legacy.judge,
        note: legacy.note,
        useTargetScoring: legacy.useTargetScoring,
        normalizedAnswers: legacy.normalizedAnswers,
        shouldDeleteQuiz: legacy.shouldDeleteQuiz,
        patrol_code: legacy.patrol_code,
        team_name: legacy.team_name,
        sex: legacy.sex,
        finish_time: legacy.finish_time,
        judge_id: legacy.judge_id,
        session_id: legacy.session_id,
        manifest_version: legacy.manifest_version,
      },
      signature: legacy.signature,
      signature_payload: legacy.signature_payload,
      created_at: new Date().toISOString(),
      inProgress: false,
      retryCount: 0,
      nextAttemptAt: Date.now(),
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

function formatWaitDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function waitSecondsToMinutes(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(seconds / 60));
}

function toLocalDateTimeInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num: number) => num.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromLocalDateTimeInput(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function StationApp({ auth, refreshManifest }: { auth: AuthenticatedState; refreshManifest: () => Promise<void> }) {
  const manifest = auth.manifest;
  const eventId = manifest.event.id;
  const stationId = manifest.station.id;
  const stationCode = manifest.station.code?.trim().toUpperCase() || '';
  const stationName = manifest.station.name;
  const [patrol, setPatrol] = useState<Patrol | null>(null);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [answersInput, setAnswersInput] = useState('');
  const [answersError, setAnswersError] = useState('');
  const [useTargetScoring, setUseTargetScoring] = useState(false);
  const [categoryAnswers, setCategoryAnswers] = useState<Record<string, string>>({});
  const [answersForm, setAnswersForm] = useState<Record<CategoryKey, string>>({
    N: '',
    M: '',
    S: '',
    R: '',
  });
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingItems, setPendingItems] = useState<PendingOperation[]>([]);
  const [showPendingDetails, setShowPendingDetails] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scanActive, setScanActive] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tick, setTick] = useState(0);
  const [loadingAnswers, setLoadingAnswers] = useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [autoScore, setAutoScore] = useState({ correct: 0, total: 0, given: 0, normalizedGiven: '' });
  const [alerts, setAlerts] = useState<string[]>([]);
  const [showAnswersEditor, setShowAnswersEditor] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [arrivedAt, setArrivedAt] = useState<string | null>(null);
  const [finishAt, setFinishAt] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [waitDurationSeconds, setWaitDurationSeconds] = useState(0);
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitStartRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);

  const queueKey = useMemo(() => `${QUEUE_KEY_PREFIX}_${stationId}`, [stationId]);

  const isTargetStation = stationCode === 'T';
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
  const canEditAnswers = isAdminMode;

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

  const handleAddTicket = useCallback(() => {
    if (!patrol) {
      pushAlert('Nejprve naskenuj hlídku.');
      return;
    }

    let added = false;
    const patrolCode = patrol.patrol_code.trim().toUpperCase();

    updateTickets((current) => {
      const exists = current.some((ticket) => ticket.patrolId === patrol.id && ticket.state !== 'done');
      if (exists) {
        return current;
      }
      added = true;
      const newTicket = createTicket({
        patrolId: patrol.id,
        patrolCode,
        teamName: patrol.team_name,
        category: patrol.category,
      });
      return [...current, newTicket];
    });

    if (added) {
      pushAlert(`Do fronty přidána hlídka ${patrol.team_name}.`);
    } else {
      pushAlert('Hlídka už je ve frontě.');
    }
  }, [patrol, pushAlert, updateTickets]);

  const handleTicketStateChange = useCallback(
    (id: string, nextState: Ticket['state']) => {
      updateTickets((current) =>
        current.map((ticket) => (ticket.id === id ? transitionTicket(ticket, nextState) : ticket)),
      );
    },
    [updateTickets],
  );

  const handleResetTickets = useCallback(() => {
    let hadTickets = false;
    updateTickets((current) => {
      hadTickets = current.length > 0;
      return [];
    });
    if (hadTickets) {
      pushAlert('Fronta byla vymazána.');
    }
  }, [pushAlert, updateTickets]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const desiredPath = `/stations/${encodeURIComponent(stationId)}`;
      if (window.location.pathname !== desiredPath) {
        window.history.replaceState({}, '', desiredPath + window.location.search + window.location.hash);
      }
    }
  }, [stationId]);

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

  useEffect(() => {
    if (!canEditAnswers) {
      setShowAnswersEditor(false);
    }
  }, [canEditAnswers]);

  const clearWait = useCallback(() => {
    if (waitTimerRef.current) {
      clearInterval(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    waitStartRef.current = null;
    setIsWaiting(false);
    setWaitDurationSeconds(0);
  }, []);

  const startWait = useCallback(() => {
    const start = Date.now();
    if (waitTimerRef.current) {
      clearInterval(waitTimerRef.current);
    }
    waitStartRef.current = start;
    setIsWaiting(true);
    setWaitDurationSeconds(0);
    waitTimerRef.current = setInterval(() => {
      if (waitStartRef.current === null) {
        return;
      }
      const elapsed = Math.floor((Date.now() - waitStartRef.current) / 1000);
      setWaitDurationSeconds(elapsed);
    }, 500);
  }, []);

  const stopWait = useCallback(() => {
    if (waitTimerRef.current) {
      clearInterval(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    if (waitStartRef.current !== null) {
      const elapsed = Math.floor((Date.now() - waitStartRef.current) / 1000);
      setWaitDurationSeconds(elapsed);
    }
    waitStartRef.current = null;
    setIsWaiting(false);
  }, []);

  useEffect(() => {
    return () => {
      if (waitTimerRef.current) {
        clearInterval(waitTimerRef.current);
      }
    };
  }, []);

  const loadCategoryAnswers = useCallback(async () => {
    if (!stationId) {
      return;
    }
    setLoadingAnswers(true);
    const { data, error } = await supabase
      .from('station_category_answers')
      .select('category, correct_answers')
      .eq('event_id', eventId)
      .eq('station_id', stationId);

    setLoadingAnswers(false);

    if (error) {
      console.error(error);
      pushAlert('Nepodařilo se načíst správné odpovědi.');
      return;
    }

    const map: Record<string, string> = {};
    const form: Record<CategoryKey, string> = { N: '', M: '', S: '', R: '' };
    (data || []).forEach((row) => {
      map[row.category] = row.correct_answers;
      if (ANSWER_CATEGORIES.includes(row.category as CategoryKey)) {
        form[row.category as CategoryKey] = formatAnswersForInput(row.correct_answers);
      }
    });
    setCategoryAnswers(map);
    setAnswersForm(form);
  }, [eventId, stationId, pushAlert]);

  useEffect(() => {
    if (!isTargetStation) {
      setCategoryAnswers({});
      setAnswersForm({ N: '', M: '', S: '', R: '' });
      return;
    }
    loadCategoryAnswers();
  }, [isTargetStation, loadCategoryAnswers]);

  const syncQueue = useCallback(async () => {
    const queue = await readQueue(queueKey);
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
    const accessToken = auth.tokens.accessToken;

    if (!accessToken) {
      const rollbackQueue = queueWithLocks.map((op) => {
        if (!readyIds.has(op.id)) return op;
        const retryCount = op.retryCount + 1;
        return {
          ...op,
          inProgress: false,
          retryCount,
          nextAttemptAt: Date.now() + computeBackoffMs(retryCount),
          lastError: 'missing-access-token',
        };
      });
      await writeQueue(queueKey, rollbackQueue);
      updateQueueState(rollbackQueue);
      setSyncing(false);
      return;
    }

    try {
      const response = await fetch(`${baseUrl}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ operations: operationsPayload }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
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
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown-error';
      const rollbackQueue = queueWithLocks.map((op) => {
        if (!readyIds.has(op.id)) return op;
        const retryCount = op.retryCount + 1;
        return {
          ...op,
          inProgress: false,
          retryCount,
          nextAttemptAt: Date.now() + computeBackoffMs(retryCount),
          lastError: message,
        };
      });
      await writeQueue(queueKey, rollbackQueue);
      updateQueueState(rollbackQueue);
      pushAlert('Synchronizace selhala, zkusím to znovu později.');
    } finally {
      setSyncing(false);
    }
  }, [auth.tokens.accessToken, queueKey, syncing, updateQueueState, pushAlert]);

  useEffect(() => {
    syncQueue();
    const onOnline = () => syncQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncQueue]);

  useEffect(() => {
    syncQueue();
  }, [syncQueue, tick]);

  const resetForm = useCallback(() => {
    setPatrol(null);
    setPoints('');
    setNote('');
    setAnswersInput('');
    setAnswersError('');
    setAutoScore({ correct: 0, total: 0, given: 0, normalizedGiven: '' });
    setUseTargetScoring(isTargetStation);
    setScanActive(true);
    setManualCode('');
    setArrivedAt(null);
    setFinishAt(null);
    clearWait();
    lastScanRef.current = null;
  }, [clearWait, isTargetStation]);

  useEffect(() => {
    resetForm();
    setLastSavedAt(null);
    setShowPendingDetails(false);
  }, [resetForm, stationId]);

  const cachedPatrolMap = useMemo(() => {
    const map = new Map<string, Patrol>();
    auth.patrols.forEach((patrol) => {
      if (patrol.patrol_code) {
        map.set(patrol.patrol_code.trim().toUpperCase(), {
          id: patrol.id,
          team_name: patrol.team_name,
          category: patrol.category,
          sex: patrol.sex,
          patrol_code: patrol.patrol_code,
        });
      }
    });
    return map;
  }, [auth.patrols]);

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
          return;
        }
        data = fetched as Patrol;
      }

      setPatrol({ ...data });
      setPoints('');
      setNote('');
      setAnswersInput('');
      setAnswersError('');
      setScanActive(false);
      setManualCode('');
      setArrivedAt(new Date().toISOString());
      clearWait();

      const stored = categoryAnswers[data.category] || '';
      const total = parseAnswerLetters(stored).length;
      setAutoScore({ correct: 0, total, given: 0, normalizedGiven: '' });
      setUseTargetScoring(isTargetStation);

      if (stationCode === 'T') {
        const { data: timingRows, error: timingError } = await supabase
          .from('timings')
          .select('finish_time')
          .eq('event_id', eventId)
          .eq('patrol_id', data.id);

        if (timingError) {
          console.error('Failed to load finish time', timingError);
          setFinishAt(null);
        } else {
          const row = Array.isArray(timingRows) && timingRows.length > 0 ? timingRows[0] : null;
          setFinishAt((row as { finish_time?: string | null } | null)?.finish_time ?? null);
        }
      } else {
        setFinishAt(null);
      }
    },
    [auth.patrols, cachedPatrolMap, categoryAnswers, clearWait, eventId, isTargetStation, pushAlert, stationCode]
  );

  const handleScanResult = useCallback(
    async (text: string) => {
      const match = text.match(/seton:\/\/p\/(.+)$/);
      if (!match) {
        pushAlert('Neplatný QR kód. Očekávám seton://p/<code>');
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
    [fetchPatrol, pushAlert]
  );

  useEffect(() => {
    if (!patrol) {
      return;
    }

    const stored = categoryAnswers[patrol.category] || '';
    const total = parseAnswerLetters(stored).length;
    setAutoScore((prev) => ({ ...prev, total }));
  }, [categoryAnswers, patrol]);

  useEffect(() => {
    if (!patrol || !useTargetScoring) {
      setAnswersError('');
      setAutoScore((prev) => ({ ...prev, correct: 0, given: 0, normalizedGiven: '' }));
      return;
    }

    const correctLetters = parseAnswerLetters(categoryAnswers[patrol.category] || '');
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
  }, [answersInput, useTargetScoring, patrol, categoryAnswers]);

  const saveCategoryAnswers = useCallback(async () => {
    if (!stationId) {
      pushAlert('Vyber prosím stanoviště před uložením odpovědí.');
      return;
    }

    setSavingAnswers(true);
    const updates: { event_id: string; station_id: string; category: string; correct_answers: string }[] = [];
    const deletions: string[] = [];

    for (const cat of ANSWER_CATEGORIES) {
      const packed = packAnswersForStorage(answersForm[cat]);
      if (!packed) {
        if (categoryAnswers[cat]) deletions.push(cat);
        continue;
      }
      if (packed.length !== 12) {
        pushAlert(`Kategorie ${cat} musí mít 12 odpovědí.`);
        setSavingAnswers(false);
        return;
      }
      updates.push({ event_id: eventId, station_id: stationId, category: cat, correct_answers: packed });
    }

    if (updates.length) {
      const { error } = await supabase
        .from('station_category_answers')
        .upsert(updates, { onConflict: 'event_id,station_id,category' });
      if (error) {
        console.error(error);
        pushAlert('Uložení správných odpovědí selhalo.');
        setSavingAnswers(false);
        return;
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
        console.error(error);
        pushAlert('Některé kategorie se nepodařilo odstranit.');
        setSavingAnswers(false);
        return;
      }
    }

    setSavingAnswers(false);
    pushAlert('Správné odpovědi uloženy.');
    loadCategoryAnswers();
  }, [answersForm, categoryAnswers, eventId, loadCategoryAnswers, pushAlert, stationId]);

  const handleSave = useCallback(async () => {
    if (!patrol) return;
    if (!stationId || !queueKey) {
      pushAlert('Vyber stanoviště před uložením záznamu.');
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
      const parsed = parseInt(points, 10);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 12) {
        pushAlert('Body musí být číslo v rozsahu 0 až 12.');
        return;
      }
      scorePoints = parsed;
    }

    let effectiveWaitSeconds = waitDurationSeconds;
    if (!useTargetScoring) {
      if (waitStartRef.current !== null) {
        effectiveWaitSeconds = Math.floor((Date.now() - waitStartRef.current) / 1000);
      }
      stopWait();
    }

    const waitMinutes = useTargetScoring ? 0 : waitSecondsToMinutes(effectiveWaitSeconds);

    const now = new Date().toISOString();
    const arrivalIso = arrivedAt || now;
    const submissionData = {
      event_id: eventId,
      station_id: stationId,
      patrol_id: patrol.id,
      category: patrol.category,
      arrived_at: arrivalIso,
      wait_minutes: waitMinutes,
      points: scorePoints,
      note,
      use_target_scoring: useTargetScoring,
      normalized_answers: normalizedAnswers,
      finish_time: finishAt,
      patrol_code: patrol.patrol_code,
      team_name: patrol.team_name,
      sex: patrol.sex,
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
      judge: manifest.judge.displayName,
      note: submissionData.note,
      useTargetScoring,
      normalizedAnswers,
      shouldDeleteQuiz: !useTargetScoring,
      patrol_code: submissionData.patrol_code,
      team_name: submissionData.team_name,
      sex: submissionData.sex,
      finish_time: submissionData.finish_time,
      judge_id: manifest.judge.id,
      session_id: auth.tokens.sessionId,
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
    };

    const queueBefore = await readQueue(queueKey);
    const queueWithOperation = [...queueBefore, operation];
    await writeQueue(queueKey, queueWithOperation);
    updateQueueState(queueWithOperation);
    setShowPendingDetails(true);
    pushAlert(`Záznam uložen do fronty (${queuePayload.team_name ?? queuePayload.patrol_code}).`);
    setLastSavedAt(now);
    resetForm();
    void syncQueue();
  }, [
    autoScore,
    note,
    patrol,
    points,
    useTargetScoring,
    pushAlert,
    resetForm,
    updateQueueState,
    waitDurationSeconds,
    stopWait,
    arrivedAt,
    stationId,
    queueKey,
    finishAt,
    manifest.judge.displayName,
    manifest.judge.id,
    manifest.manifestVersion,
    auth.tokens.sessionId,
    auth.deviceKey,
    syncQueue,
  ]);

  const totalAnswers = useMemo(
    () => (patrol ? parseAnswerLetters(categoryAnswers[patrol.category] || '').length : 0),
    [patrol, categoryAnswers]
  );
  const heroBadges = useMemo(() => {
    const queueLabel = pendingCount ? `Offline fronta: ${pendingCount}` : 'Offline fronta prázdná';
    return [`Event: ${manifest.event.name}`, queueLabel];
  }, [manifest.event.name, pendingCount]);

  const isPatrolInQueue = useMemo(() => {
    if (!patrol) {
      return false;
    }
    return tickets.some((ticket) => ticket.patrolId === patrol.id && ticket.state !== 'done');
  }, [patrol, tickets]);

  const answersSummary = useMemo(
    () =>
      ANSWER_CATEGORIES.reduce(
        (acc, cat) => {
          const letters = parseAnswerLetters(categoryAnswers[cat] || '');
          acc[cat] = { letters, count: letters.length };
          return acc;
        },
        {} as Record<CategoryKey, { letters: string[]; count: number }>
      ),
    [categoryAnswers]
  );

  const hasAnyAnswers = useMemo(
    () => ANSWER_CATEGORIES.some((cat) => answersSummary[cat].count > 0),
    [answersSummary]
  );

  const waitSecondsDisplay = useTargetScoring ? 0 : waitDurationSeconds;
  const waitMinutesDisplay = useTargetScoring ? 0 : waitSecondsToMinutes(waitDurationSeconds);
  const hasWaitValue = useTargetScoring ? false : waitDurationSeconds > 0 || isWaiting;

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-brand">
          <div className="hero-logo">
            <img src={setonLogo} alt="Logo Setonův závod" />
          </div>
          <div>
            <h1>Setonův závod - stanoviště</h1>
            <p>Webová podpora rozhodčích s QR skenerem, automatickým hodnocením a offline frontou.</p>
          </div>
        </div>
        <div className="hero-meta">
          <div className="station-summary">
            <span className="station-summary-label">Stanoviště</span>
            <strong>{stationCode || '—'}</strong>
            {stationName ? <span className="station-summary-sub">{stationName}</span> : null}
          </div>
          <div className="station-summary">
            <span className="station-summary-label">Rozhodčí</span>
            <strong>{manifest.judge.displayName}</strong>
            <span className="station-summary-sub">{manifest.judge.email}</span>
          </div>
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
      </header>

      <main className="content">
        {alerts.length ? (
          <div className="alerts">
            {alerts.map((msg, idx) => (
              <div key={idx} className="alert">
                {msg}
              </div>
            ))}
          </div>
        ) : null}

        <>
          {isTargetStation ? (
              <section className="card answers-card">
                <header className="card-header">
                  <div>
                    <h2>Správné odpovědi</h2>
                    <p className="card-subtitle">Každá kategorie musí mít 12 odpovědí (A–D).</p>
                  </div>
                  <div className="card-actions">
                    {canEditAnswers ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setShowAnswersEditor((prev) => !prev)}
                      >
                        {showAnswersEditor ? 'Zobrazit přehled' : 'Upravit odpovědi'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ghost"
                      onClick={loadCategoryAnswers}
                      disabled={loadingAnswers}
                    >
                      {loadingAnswers ? 'Načítám…' : 'Obnovit'}
                    </button>
                  </div>
                </header>
                {canEditAnswers && showAnswersEditor ? (
                  <div className="answers-editor">
                    <p className="card-hint">Zadej 12 odpovědí (A/B/C/D) pro každou kategorii.</p>
                    <div className="answers-grid">
                      {ANSWER_CATEGORIES.map((cat) => (
                        <label key={cat} className="answers-field">
                          <span>{cat}</span>
                          <input
                            value={answersForm[cat]}
                            onChange={(event) =>
                              setAnswersForm((prev) => ({ ...prev, [cat]: event.target.value.toUpperCase() }))
                            }
                            placeholder="např. A B C D …"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="answers-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={saveCategoryAnswers}
                        disabled={savingAnswers}
                      >
                        {savingAnswers ? 'Ukládám…' : 'Uložit správné odpovědi'}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={loadCategoryAnswers}
                        disabled={loadingAnswers}
                      >
                        Znovu načíst
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="answers-summary">
                    {ANSWER_CATEGORIES.map((cat) => {
                      const summary = answersSummary[cat];
                      return (
                        <div key={cat} className="answers-summary-row">
                          <span className="answers-tag">{cat}</span>
                          <span className="answers-value">
                            {summary.count ? `${summary.count} • ${summary.letters.join(' ')}` : 'Nenastaveno'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {!canEditAnswers ? (
                  <p className="card-hint">Správné odpovědi může upravit pouze administrátor.</p>
                ) : null}
                {!(canEditAnswers && showAnswersEditor) && !hasAnyAnswers && !loadingAnswers ? (
                  <p className="card-hint">Správné odpovědi zatím nejsou nastavené.</p>
                ) : null}
                {!(canEditAnswers && showAnswersEditor) && loadingAnswers ? (
                  <p className="card-hint">Načítám…</p>
                ) : null}
              </section>
            ) : null}

          <TicketQueue
            tickets={tickets}
            heartbeat={tick}
            onChangeState={handleTicketStateChange}
            onReset={handleResetTickets}
          />

          <section className="card scanner-card">
              <div className="scanner-icon" aria-hidden>
                <span>📷</span>
              </div>
              <div className="scanner-copy">
                <h2>Skener hlídek</h2>
                <p>Naskenuj QR kód nebo zadej kód ručně. Po načtení se formulář otevře automaticky.</p>
              </div>
              <div className="scanner-wrapper">
                <QRScanner active={scanActive} onResult={handleScanResult} onError={(err) => console.error(err)} />
                <div className="manual-entry">
                  <PatrolCodeInput
                    value={manualCode}
                    onChange={setManualCode}
                    label="Ruční kód"
                  />
                  <button
                    type="button"
                    className="primary"
                    onClick={() => manualCode.trim() && fetchPatrol(manualCode.trim())}
                    disabled={!manualCode}
                  >
                    Načíst hlídku
                  </button>
                </div>
                {patrol ? (
                  <div className="scanner-preview">
                    <strong>{patrol.team_name}</strong>
                    <span>
                      {patrol.category}/{patrol.sex}
                    </span>
                    <button
                      type="button"
                      className="ghost"
                      onClick={handleAddTicket}
                      disabled={isPatrolInQueue}
                    >
                      {isPatrolInQueue ? 'Ve frontě' : 'Přidat do fronty'}
                    </button>
                    {isPatrolInQueue ? <span className="scanner-note">Hlídka už čeká ve frontě.</span> : null}
                  </div>
                ) : (
                  <p className="scanner-placeholder">Nejprve naskenuj QR kód hlídky.</p>
                )}
              </div>
            </section>

          <section className="card form-card">
              <header className="card-header">
                <div>
                  <h2>Stanovištní formulář</h2>
                  <p className="card-subtitle">
                    {useTargetScoring
                      ? 'Zadej odpovědi, přidej poznámku a potvrď uložení.'
                      : 'Vyplň body, čekání, poznámku a potvrď uložení.'}
                  </p>
                </div>
                <button type="button" className="ghost" onClick={resetForm}>
                  Vymazat
                </button>
              </header>
              {patrol ? (
                <div className="form-grid">
                  <div className="patrol-meta">
                    <strong>{patrol.team_name}</strong>
                    <span>
                      {patrol.category}/{patrol.sex}
                    </span>
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
                        <strong>{formatWaitDuration(waitSecondsDisplay)}</strong>
                        <span className="pending-subline">≈ {waitMinutesDisplay} min</span>
                      </div>
                      <div className="wait-actions">
                        <button type="button" onClick={startWait} disabled={isWaiting}>
                          {isWaiting ? 'Měřím…' : 'Začít čekání'}
                        </button>
                        <button type="button" onClick={stopWait} disabled={!isWaiting}>
                          Ukončit čekání
                        </button>
                        <button type="button" className="ghost" onClick={clearWait} disabled={!hasWaitValue}>
                          Vynulovat
                        </button>
                      </div>
                    </div>
                ) : null}
                {stationCode === 'T' ? (
                  <div className="finish-time-section">
                    <label>
                      Čas v cíli
                      <input
                        type="datetime-local"
                        value={toLocalDateTimeInput(finishAt)}
                        onChange={(event) => setFinishAt(fromLocalDateTimeInput(event.target.value))}
                      />
                    </label>
                    <div className="finish-time-actions">
                      <button type="button" onClick={() => setFinishAt(new Date().toISOString())}>
                        Nastavit na aktuální čas
                      </button>
                      {finishAt ? (
                        <button type="button" className="ghost" onClick={() => setFinishAt(null)}>
                          Vymazat
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <label>
                  Poznámka
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
                </label>
                  {useTargetScoring ? (
                    <div className="auto-section">
                      <p className="card-hint">Terčový úsek se hodnotí automaticky podle zadaných odpovědí.</p>
                      <label>
                        Odpovědi hlídky ({totalAnswers || '–'})
                        <input
                          value={answersInput}
                          onChange={(event) => setAnswersInput(event.target.value.toUpperCase())}
                          placeholder="např. A B C D …"
                        />
                      </label>
                      <p className="auto-score">Správně: {autoScore.correct} / {autoScore.total}</p>
                      {answersError ? <p className="error-text">{answersError}</p> : null}
                    </div>
                  ) : (
                    <label>
                      Body (0 až 12)
                      <input
                        value={points}
                        onChange={(event) => setPoints(event.target.value)}
                        type="number"
                        min={0}
                        max={12}
                      />
                    </label>
                  )}
                  <button type="button" className="primary" onClick={handleSave}>
                    Uložit záznam
                  </button>
                </div>
              ) : (
                <p className="form-placeholder">Nejprve naskenuj hlídku a otevři formulář.</p>
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
                                    <td>{payload.judge || '—'}</td>
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
          {isTargetStation ? <TargetAnswersReport eventId={eventId} stationId={stationId} /> : null}
        </>
      </main>
    </div>
  );
}

function App() {
  const { status, refreshManifest } = useAuth();

  if (status.state === 'loading') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Načítám…</h1>
        </div>
      </div>
    );
  }

  if (status.state === 'unauthenticated') {
    return <LoginScreen />;
  }

  if (status.state === 'locked') {
    return <LoginScreen requirePinOnly />;
  }

  if (status.state === 'authenticated') {
    return <StationApp auth={status} refreshManifest={refreshManifest} />;
  }

  return null;
}

export default App;
