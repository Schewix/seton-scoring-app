import { useCallback, useEffect, useState } from 'react';
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
  return firstLine
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
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

      const byTroop = new Map<string, PatrolNameCheckRow[]>();
      rows.forEach((row) => {
        const troopName = normalizeText(row.team_name) || 'Bez oddílu';
        if (!byTroop.has(troopName)) {
          byTroop.set(troopName, []);
        }
        byTroop.get(troopName)!.push(row);
      });

      const workbook = new ExcelJS.Workbook();
      const usedSheetNames = new Set<string>();
      const sortedTroops = Array.from(byTroop.entries()).sort((a, b) => a[0].localeCompare(b[0], 'cs'));

      if (sortedTroops.length === 0) {
        const worksheet = workbook.addWorksheet('Kontrola jmen');
        worksheet.addRow(['Žádná hlídka pro export']);
      }

      sortedTroops.forEach(([troopName, patrols]) => {
        const baseSheetName = toWorksheetBaseName(troopName, 'Bez oddílu');
        const sheetName = toUniqueWorksheetName(baseSheetName, usedSheetNames);
        const worksheet = workbook.addWorksheet(sheetName);
        worksheet.addRow(['Číslo hlídky', 'Členové']);
        patrols.forEach((patrol) => {
          const code = parsePatrolCodeParts(patrol.patrol_code).normalizedCode || '—';
          const members = extractPatrolMembers(patrol.note).join(', ') || '—';
          worksheet.addRow([code, members]);
        });
        worksheet.columns = [{ width: 16 }, { width: 52 }];
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
        points_no_T: number | string | null;
      };

      const { data, error } = await supabase
        .from('results_ranked')
        .select('patrol_code, category, sex, disqualified, rank_in_bracket, total_points, points_no_T')
        .eq('event_id', eventId);

      if (error) {
        throw error;
      }

      const rows = (data ?? []) as LeagueExportRow[];
      const grouped = new Map<string, LeagueExportRow[]>();
      BRACKET_EXPORT_ORDER.forEach((key) => grouped.set(key, []));

      rows.forEach((row) => {
        const bracketKey = toBracketKey(row.category, row.sex);
        if (!bracketKey) {
          return;
        }
        grouped.get(bracketKey)?.push(row);
      });

      grouped.forEach((items) => {
        items.sort((a, b) => {
          const rankA = toNumeric(a.rank_in_bracket) ?? Number.MAX_SAFE_INTEGER;
          const rankB = toNumeric(b.rank_in_bracket) ?? Number.MAX_SAFE_INTEGER;
          if (rankA !== rankB) {
            return rankA - rankB;
          }
          return comparePatrolOrder(a, b);
        });
      });

      const workbook = new ExcelJS.Workbook();
      BRACKET_EXPORT_ORDER.forEach((bracketKey) => {
        const worksheet = workbook.addWorksheet(bracketKey);
        worksheet.addRow(['Pořadí', 'Číslo hlídky', 'Body celkem', 'Body bez času']);
        const bracketRows = grouped.get(bracketKey) ?? [];
        if (bracketRows.length === 0) {
          worksheet.addRow(['—', '—', '', '']);
        } else {
          bracketRows.forEach((row) => {
            worksheet.addRow([
              row.disqualified ? 'DSQ' : (toNumeric(row.rank_in_bracket) ?? ''),
              parsePatrolCodeParts(row.patrol_code).normalizedCode || '—',
              toNumeric(row.total_points) ?? '',
              toNumeric(row.points_no_T) ?? '',
            ]);
          });
        }
        worksheet.columns = [{ width: 10 }, { width: 16 }, { width: 14 }, { width: 16 }];
      });

      await downloadWorkbook(workbook, toExportFileName(eventState.name, 'body-zelena-liga'));
    } catch (error) {
      console.error('Failed to export league points workbook', error);
      window.alert('Export bodů pro Zelenou ligu selhal.');
    } finally {
      setExportingLeague(false);
    }
  }, [eventId, eventState.name, exportingLeague]);

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
          <div className="admin-header-actions">
            <a
              className="admin-button admin-button--secondary admin-button--pill"
              href="https://www.zelenaliga.cz/aplikace/setonuv-zavod/vysledky"
              target="_blank"
              rel="noreferrer"
            >
              Otevřít výsledky
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
