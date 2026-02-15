import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LoginScreen from '../../auth/LoginScreen';
import ChangePasswordScreen from '../../auth/ChangePasswordScreen';
import { useAuth } from '../../auth/context';
import type { AuthStatus } from '../../auth/types';
import AppFooter from '../../components/AppFooter';
import QRScanner from '../../components/QRScanner';
import { supabase } from '../../supabaseClient';
import {
  DESKOVKY_ADMIN_ROUTE,
  DESKOVKY_MATCH_NEW_ROUTE,
  DESKOVKY_ROUTE_PREFIX,
  DESKOVKY_RULES_ROUTE,
  DESKOVKY_STANDINGS_ROUTE,
  LEGACY_DESKOVKY_ROUTE_PREFIX,
} from '../../routing';
import { buildBoardQrPayload, parseBoardQrPayload } from './qr';
import type {
  BoardAdminJudge,
  BoardBlock,
  BoardCategory,
  BoardEvent,
  BoardGame,
  BoardGameStanding,
  BoardJudgeAssignment,
  BoardJudgeContext,
  BoardMatch,
  BoardOverallStanding,
  BoardPlayer,
  BoardPointsOrder,
  BoardScoringType,
} from './types';
import '../../admin/AdminApp.css';
import './DeskovkyApp.css';

type AuthenticatedState = Extract<AuthStatus, { state: 'authenticated' }>;
type DeskovkyPage = 'home' | 'new-match' | 'standings' | 'rules' | 'admin';

type MatchEntry = {
  seat: number;
  player: BoardPlayer | null;
  points: string;
  placement: string;
};

type EventSetup = {
  categories: BoardCategory[];
  games: BoardGame[];
  blocks: BoardBlock[];
};

type CsvRow = {
  short_code: string;
  team_name: string;
  display_name: string;
  category: string;
};

type AdminSectionKey =
  | 'overview'
  | 'event'
  | 'categories'
  | 'games'
  | 'blocks'
  | 'players'
  | 'judges'
  | 'import-export';

type AdminSectionHeaderConfig = {
  description: string;
  action?: {
    label: string;
    kind: 'primary' | 'secondary';
    disabled?: boolean;
    onClick: () => void;
  };
};

const ADMIN_SECTION_ITEMS: ReadonlyArray<{ key: AdminSectionKey; hash: string; label: string }> = [
  { key: 'overview', hash: 'prehled', label: 'Přehled' },
  { key: 'event', hash: 'event', label: 'Event' },
  { key: 'categories', hash: 'kategorie', label: 'Kategorie' },
  { key: 'games', hash: 'hry', label: 'Hry' },
  { key: 'blocks', hash: 'bloky', label: 'Bloky' },
  { key: 'players', hash: 'hraci', label: 'Hráči' },
  { key: 'judges', hash: 'rozhodci', label: 'Rozhodčí' },
  { key: 'import-export', hash: 'import-export', label: 'Import / export' },
] as const;

function resolveAdminSectionFromHash(hash: string): AdminSectionKey {
  const normalized = hash.replace(/^#/, '').trim().toLowerCase();
  const found = ADMIN_SECTION_ITEMS.find((item) => item.hash === normalized);
  return found?.key ?? 'overview';
}

function adminSectionHash(section: AdminSectionKey): string {
  return ADMIN_SECTION_ITEMS.find((item) => item.key === section)?.hash ?? 'prehled';
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeCsv(value: string | null | undefined): string {
  const text = (value ?? '').replace(/"/g, '""');
  return `"${text}"`;
}

function buildCanonicalPath(page: DeskovkyPage): string {
  switch (page) {
    case 'new-match':
      return DESKOVKY_MATCH_NEW_ROUTE;
    case 'standings':
      return DESKOVKY_STANDINGS_ROUTE;
    case 'rules':
      return DESKOVKY_RULES_ROUTE;
    case 'admin':
      return DESKOVKY_ADMIN_ROUTE;
    default:
      return DESKOVKY_ROUTE_PREFIX;
  }
}

function resolvePage(pathname: string): DeskovkyPage {
  const path = normalizePath(pathname);

  if (
    path === DESKOVKY_ADMIN_ROUTE ||
    path === `${LEGACY_DESKOVKY_ROUTE_PREFIX}/admin` ||
    path.endsWith('/deskovky/admin')
  ) {
    return 'admin';
  }
  if (
    path === DESKOVKY_MATCH_NEW_ROUTE ||
    path === `${LEGACY_DESKOVKY_ROUTE_PREFIX}/match/new` ||
    path.endsWith('/deskovky/match/new')
  ) {
    return 'new-match';
  }
  if (
    path === DESKOVKY_STANDINGS_ROUTE ||
    path === `${LEGACY_DESKOVKY_ROUTE_PREFIX}/standings` ||
    path.endsWith('/deskovky/standings')
  ) {
    return 'standings';
  }
  if (
    path === DESKOVKY_RULES_ROUTE ||
    path === `${LEGACY_DESKOVKY_ROUTE_PREFIX}/pravidla` ||
    path.endsWith('/deskovky/pravidla')
  ) {
    return 'rules';
  }
  return 'home';
}

function getTodayStartIso(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function useIsMobileBreakpoint(maxWidth = 640): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
    setIsMobile(media.matches);
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [maxWidth]);

  return isMobile;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function buildInitialMatchEntries(): MatchEntry[] {
  return [1, 2, 3, 4].map((seat) => ({
    seat,
    player: null,
    points: '',
    placement: '',
  }));
}

function parseNumeric(value: string): number | null {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (ch === ',' || ch === ';')) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => slugify(header));
  const shortCodeIndex = headers.findIndex((header) => header === 'short-code' || header === 'short_code');
  const teamNameIndex = headers.findIndex((header) => header === 'team-name' || header === 'team_name');
  const displayNameIndex = headers.findIndex(
    (header) => header === 'display-name' || header === 'display_name' || header === 'name',
  );
  const categoryIndex = headers.findIndex((header) => header === 'category' || header === 'kategorie');

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return {
      short_code: shortCodeIndex >= 0 ? (values[shortCodeIndex] ?? '').trim().toUpperCase() : '',
      team_name: teamNameIndex >= 0 ? (values[teamNameIndex] ?? '').trim() : '',
      display_name: displayNameIndex >= 0 ? (values[displayNameIndex] ?? '').trim() : '',
      category: categoryIndex >= 0 ? (values[categoryIndex] ?? '').trim() : '',
    };
  });
}

function randomShortCode(existing: Set<string>): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!existing.has(code)) {
      existing.add(code);
      return code;
    }
  }
  return `PL${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

type RuleAsset = {
  filename: string;
  key: string;
  url: string;
};

const RULE_ASSETS: RuleAsset[] = Object.entries(
  import.meta.glob('../../assets/pravidla/*.pdf', { eager: true, import: 'default' }),
).map(([path, url]) => {
  const filename = path.split('/').pop() ?? '';
  return {
    filename,
    key: slugify(filename.replace(/\.pdf$/i, '')),
    url: url as string,
  };
});

const BOARD_RULES_TOURNAMENT =
  RULE_ASSETS.find((asset) => asset.key.includes('deskove-hry-2023-pravidla-turnaje'))?.url ?? null;
const BOARD_RULES_SCORING =
  RULE_ASSETS.find((asset) => asset.key.includes('deskove-hry-2023-hodnoceni-turnaje'))?.url ?? null;

async function loadJudgeContext(judgeId: string): Promise<BoardJudgeContext> {
  const { data: assignmentsData, error: assignmentsError } = await supabase
    .from('board_judge_assignment')
    .select('id, event_id, user_id, game_id, category_id, created_at')
    .eq('user_id', judgeId)
    .order('created_at', { ascending: false });

  if (assignmentsError) {
    throw assignmentsError;
  }

  const assignments = ((assignmentsData ?? []) as BoardJudgeAssignment[]).map((assignment) => ({
    ...assignment,
    category_id: assignment.category_id ?? null,
  }));

  const eventIds = unique(assignments.map((assignment) => assignment.event_id));
  const gameIds = unique(assignments.map((assignment) => assignment.game_id));
  const categoryIds = unique(
    assignments
      .map((assignment) => assignment.category_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );

  const [eventsRes, gamesRes, categoriesRes] = await Promise.all([
    eventIds.length
      ? supabase
          .from('board_event')
          .select('id, slug, name, start_date, end_date, created_at')
          .in('id', eventIds)
          .order('start_date', { ascending: false, nullsFirst: false })
      : Promise.resolve({ data: [], error: null }),
    gameIds.length
      ? supabase
          .from('board_game')
          .select('id, event_id, name, scoring_type, points_order, three_player_adjustment, notes, created_at')
          .in('id', gameIds)
          .order('name', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    categoryIds.length
      ? supabase
          .from('board_category')
          .select('id, event_id, name, primary_game_id, created_at')
          .in('id', categoryIds)
          .order('name', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (eventsRes.error) {
    throw eventsRes.error;
  }
  if (gamesRes.error) {
    throw gamesRes.error;
  }
  if (categoriesRes.error) {
    throw categoriesRes.error;
  }

  return {
    assignments,
    events: (eventsRes.data ?? []) as BoardEvent[],
    games: (gamesRes.data ?? []) as BoardGame[],
    categories: (categoriesRes.data ?? []) as BoardCategory[],
  };
}

async function loadEventSetup(eventId: string): Promise<EventSetup> {
  const [categoriesRes, gamesRes, blocksRes] = await Promise.all([
    supabase
      .from('board_category')
      .select('id, event_id, name, primary_game_id, created_at')
      .eq('event_id', eventId)
      .order('name', { ascending: true }),
    supabase
      .from('board_game')
      .select('id, event_id, name, scoring_type, points_order, three_player_adjustment, notes, created_at')
      .eq('event_id', eventId)
      .order('name', { ascending: true }),
    supabase
      .from('board_block')
      .select('id, event_id, category_id, block_number, game_id, created_at')
      .eq('event_id', eventId)
      .order('block_number', { ascending: true }),
  ]);

  if (categoriesRes.error) throw categoriesRes.error;
  if (gamesRes.error) throw gamesRes.error;
  if (blocksRes.error) throw blocksRes.error;

  return {
    categories: (categoriesRes.data ?? []) as BoardCategory[],
    games: (gamesRes.data ?? []) as BoardGame[],
    blocks: (blocksRes.data ?? []) as BoardBlock[],
  };
}

function getScoringInputs(scoringType: BoardScoringType) {
  return {
    showPoints: scoringType === 'points' || scoringType === 'both',
    showPlacement: scoringType === 'placement' || scoringType === 'both',
  };
}

function LoadingState() {
  return (
    <div className="admin-shell admin-shell--center">
      <div className="admin-card admin-card--narrow">
        <h1>Načítám…</h1>
      </div>
      <AppFooter variant="minimal" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="admin-shell admin-shell--center">
      <div className="admin-card admin-card--narrow">
        <h1>Nelze načíst aplikaci</h1>
        <p>{message || 'Zkontroluj připojení a zkus to znovu.'}</p>
      </div>
      <AppFooter variant="minimal" />
    </div>
  );
}

function JudgeHomePage({
  judgeId,
  context,
  selectedEventId,
  onSelectEventId,
  onNavigate,
}: {
  judgeId: string;
  context: BoardJudgeContext;
  selectedEventId: string | null;
  onSelectEventId: (eventId: string) => void;
  onNavigate: (page: DeskovkyPage) => void;
}) {
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const event = useMemo(
    () => context.events.find((item) => item.id === selectedEventId) ?? null,
    [context.events, selectedEventId],
  );

  const eventAssignments = useMemo(
    () => context.assignments.filter((assignment) => assignment.event_id === selectedEventId),
    [context.assignments, selectedEventId],
  );

  const gameMap = useMemo(
    () => new Map(context.games.map((game) => [game.id, game])),
    [context.games],
  );

  const categoryMap = useMemo(
    () => new Map(context.categories.map((category) => [category.id, category])),
    [context.categories],
  );

  useEffect(() => {
    if (!selectedEventId) {
      setTodayCount(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      const { count, error } = await supabase
        .from('board_match')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', selectedEventId)
        .eq('created_by', judgeId)
        .gte('created_at', getTodayStartIso());

      if (cancelled) {
        return;
      }

      setLoading(false);
      if (error) {
        console.error('Failed to load board matches count', error);
        setTodayCount(null);
        return;
      }

      setTodayCount(count ?? 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [judgeId, selectedEventId]);

  if (!context.events.length) {
    return (
      <section className="admin-card">
        <h2>Deskové hry</h2>
        <p className="admin-card-subtitle">
          K tomuto účtu zatím není přiřazená žádná hra. Požádej administrátora o přiřazení.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="admin-card deskovky-toolbar deskovky-home-toolbar">
        <div className="deskovky-toolbar-left">
          <h2>Rozhodčí panel</h2>
          <p className="admin-card-subtitle">Správa výsledků turnaje Deskové hry.</p>
        </div>
        <div className="deskovky-toolbar-actions">
          <label className="admin-field deskovky-event-select">
            <span>Event</span>
            <select
              value={selectedEventId ?? ''}
              onChange={(eventTarget) => onSelectEventId(eventTarget.target.value)}
            >
              {context.events.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="admin-button admin-button--primary deskovky-home-primary-action"
            onClick={() => onNavigate('new-match')}
          >
            Nový zápas
          </button>
        </div>
      </section>

      <section className="admin-card">
        <header className="admin-card-header">
          <div>
            <h2>Moje přiřazení</h2>
            <p className="admin-card-subtitle">
              {event ? `Event: ${event.name}` : 'Není vybraný event.'}
            </p>
          </div>
          <div className="deskovky-kpi">
            <span>Odevzdané zápasy dnes</span>
            <strong>{loading ? '…' : todayCount ?? '—'}</strong>
          </div>
        </header>

        {eventAssignments.length ? (
          <div className="deskovky-assignment-grid">
            {eventAssignments.map((assignment) => {
              const game = gameMap.get(assignment.game_id);
              const category = assignment.category_id ? categoryMap.get(assignment.category_id) : null;
              return (
                <article key={assignment.id} className="deskovky-assignment-card">
                  <h3>{game?.name ?? assignment.game_id}</h3>
                  <p>
                    Kategorie:{' '}
                    <strong>{category?.name ?? 'Všechny v rámci přiřazené hry'}</strong>
                  </p>
                  <p className="admin-card-subtitle">
                    Typ bodování: {game?.scoring_type ?? '—'}
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="admin-card-subtitle">Pro vybraný event nemáš žádná přiřazení.</p>
        )}
      </section>
    </>
  );
}

function NewMatchPage({
  judgeId,
  context,
  selectedEventId,
  onSelectEventId,
  isMobile,
}: {
  judgeId: string;
  context: BoardJudgeContext;
  selectedEventId: string | null;
  onSelectEventId: (eventId: string) => void;
  isMobile: boolean;
}) {
  const AUTO_CLOSE_SCANNER_AFTER_SCAN = true;
  const [setup, setSetup] = useState<EventSetup | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedBlockId, setSelectedBlockId] = useState<string>('');
  const [roundNumber, setRoundNumber] = useState('');

  const [entries, setEntries] = useState<MatchEntry[]>(() => buildInitialMatchEntries());
  const [manualCode, setManualCode] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [activeSeat, setActiveSeat] = useState(1);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const scanLockRef = useRef(false);
  const slotRefs = useRef<Record<number, HTMLElement | null>>({});
  const slotInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const event = useMemo(
    () => context.events.find((item) => item.id === selectedEventId) ?? null,
    [context.events, selectedEventId],
  );

  const eventAssignments = useMemo(
    () => context.assignments.filter((assignment) => assignment.event_id === selectedEventId),
    [context.assignments, selectedEventId],
  );

  useEffect(() => {
    if (!selectedEventId) {
      setSetup(null);
      setSetupError(null);
      return;
    }

    let cancelled = false;
    setSetupLoading(true);
    setSetupError(null);

    void (async () => {
      try {
        const loaded = await loadEventSetup(selectedEventId);
        if (cancelled) return;
        setSetup(loaded);
      } catch (loadError) {
        console.error('Failed to load board setup', loadError);
        if (cancelled) return;
        setSetup(null);
        setSetupError('Nepodařilo se načíst konfiguraci eventu.');
      } finally {
        if (!cancelled) {
          setSetupLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedEventId]);

  const categories = setup?.categories ?? [];
  const games = setup?.games ?? [];
  const blocks = setup?.blocks ?? [];

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const gameMap = useMemo(
    () => new Map(games.map((game) => [game.id, game])),
    [games],
  );

  const allowedBlocks = useMemo(() => {
    if (!blocks.length) {
      return [];
    }

    return blocks.filter((block) =>
      eventAssignments.some(
        (assignment) =>
          assignment.game_id === block.game_id &&
          (assignment.category_id === null || assignment.category_id === block.category_id),
      ),
    );
  }, [blocks, eventAssignments]);

  const allowedCategoryIds = useMemo(
    () => unique(allowedBlocks.map((block) => block.category_id)),
    [allowedBlocks],
  );

  const visibleBlocks = useMemo(() => {
    if (!selectedCategoryId) {
      return allowedBlocks;
    }
    return allowedBlocks.filter((block) => block.category_id === selectedCategoryId);
  }, [allowedBlocks, selectedCategoryId]);

  const selectedBlock = useMemo(
    () => visibleBlocks.find((block) => block.id === selectedBlockId) ?? null,
    [visibleBlocks, selectedBlockId],
  );

  const selectedGame = useMemo(
    () => (selectedBlock ? gameMap.get(selectedBlock.game_id) ?? null : null),
    [selectedBlock, gameMap],
  );

  const scoringType: BoardScoringType = selectedGame?.scoring_type ?? 'both';
  const scoringInputs = getScoringInputs(scoringType);
  const seatValidation = useMemo(
    () =>
      entries.map((entry) => {
        const errors: string[] = [];
        let pointsMissing = false;
        let placementMissing = false;

        if (!entry.player) {
          return {
            seat: entry.seat,
            missingPlayer: true,
            pointsMissing: false,
            placementMissing: false,
            errors: ['Načti hráče.'],
          };
        }

        const parsedPoints = parseNumeric(entry.points);
        const parsedPlacement = parseNumeric(entry.placement);

        if (scoringType === 'points' && parsedPoints === null) {
          pointsMissing = true;
          errors.push('Doplň body.');
        }

        if (scoringType === 'placement' && parsedPlacement === null) {
          placementMissing = true;
          errors.push('Doplň umístění.');
        }

        if (scoringType === 'both' && parsedPoints === null && parsedPlacement === null) {
          pointsMissing = true;
          placementMissing = true;
          errors.push('Zadej body nebo umístění.');
        }

        return {
          seat: entry.seat,
          missingPlayer: false,
          pointsMissing,
          placementMissing,
          errors,
        };
      }),
    [entries, scoringType],
  );
  const seatValidationMap = useMemo(() => new Map(seatValidation.map((item) => [item.seat, item])), [seatValidation]);
  const allSlotsFilled = useMemo(() => entries.every((entry) => entry.player !== null), [entries]);
  const hasDuplicatePlayers = useMemo(() => {
    const ids = entries
      .map((entry) => entry.player?.id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return new Set(ids).size !== ids.length;
  }, [entries]);

  const roundError = useMemo(() => {
    if (!roundNumber.trim()) {
      return null;
    }
    const parsed = Number(roundNumber.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return 'Kolo musí být kladné celé číslo.';
    }
    return null;
  }, [roundNumber]);

  const submitDisabledReason = useMemo(() => {
    if (!selectedEventId) {
      return 'Vyber event.';
    }
    if (!selectedCategoryId) {
      return 'Vyber kategorii.';
    }
    if (!selectedBlockId) {
      return 'Vyber blok.';
    }
    if (hasDuplicatePlayers) {
      return 'Hráč je v zápase zadaný vícekrát.';
    }
    if (!allSlotsFilled) {
      return 'Načti 4 hráče do všech slotů.';
    }
    const invalidSeat = seatValidation.find((item) => item.errors.length > 0);
    if (invalidSeat) {
      return `Slot ${invalidSeat.seat}: ${invalidSeat.errors[0]}`;
    }
    if (roundError) {
      return roundError;
    }
    return null;
  }, [
    allSlotsFilled,
    hasDuplicatePlayers,
    roundError,
    seatValidation,
    selectedBlockId,
    selectedCategoryId,
    selectedEventId,
  ]);

  const canSubmit = submitDisabledReason === null && !saving;
  const mobileSubmitHelperText = useMemo(() => {
    if (saving) {
      return 'Ukládám zápas…';
    }
    if (!canSubmit) {
      return submitAttempted ? submitDisabledReason : 'Doplň 4 hráče a výsledky pro odeslání.';
    }
    return 'Vše připraveno k odeslání.';
  }, [canSubmit, saving, submitAttempted, submitDisabledReason]);

  useEffect(() => {
    if (!allowedCategoryIds.length) {
      setSelectedCategoryId('');
      return;
    }
    if (!selectedCategoryId || !allowedCategoryIds.includes(selectedCategoryId)) {
      setSelectedCategoryId(allowedCategoryIds[0]);
    }
  }, [allowedCategoryIds, selectedCategoryId]);

  useEffect(() => {
    if (!visibleBlocks.length) {
      setSelectedBlockId('');
      return;
    }
    if (!selectedBlockId || !visibleBlocks.some((block) => block.id === selectedBlockId)) {
      setSelectedBlockId(visibleBlocks[0].id);
    }
  }, [visibleBlocks, selectedBlockId]);

  useEffect(() => {
    if (!isMobile) {
      return;
    }
    const currentSeat = entries.find((entry) => entry.seat === activeSeat);
    if (currentSeat && !currentSeat.player) {
      return;
    }
    const nextEmpty = entries.find((entry) => !entry.player)?.seat;
    if (nextEmpty) {
      setActiveSeat(nextEmpty);
    }
  }, [activeSeat, entries, isMobile]);

  useEffect(() => {
    if (typeof document === 'undefined' || !scannerOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [scannerOpen]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1600);
  }, []);

  const scrollToSeat = useCallback(
    (seat: number) => {
      if (!isMobile) {
        return;
      }
      const slot = slotRefs.current[seat];
      if (!slot) {
        return;
      }
      slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    [isMobile],
  );

  const focusSeatInput = useCallback(
    (seat: number) => {
      if (!isMobile) {
        return;
      }
      const input = slotInputRefs.current[seat];
      if (!input) {
        return;
      }
      input.focus({ preventScroll: true });
    },
    [isMobile],
  );

  const resetEntries = useCallback(() => {
    setEntries(buildInitialMatchEntries());
    setManualCode('');
    setScannerOpen(false);
    setScannerError(null);
    setActiveSeat(1);
    setSubmitAttempted(false);
    setError(null);
    setMessage(null);
  }, []);

  const loadPlayer = useCallback(
    async (rawCode: string, source: 'manual' | 'scan' = 'manual') => {
      if (!selectedEventId) {
        setError('Nejdřív vyber event.');
        return false;
      }

      const shortCode = rawCode.trim().toUpperCase();
      if (!shortCode) {
        setError('Zadej kód hráče.');
        return false;
      }

      const { data, error: playerError } = await supabase
        .from('board_player')
        .select('id, event_id, short_code, team_name, display_name, category_id, created_at')
        .eq('event_id', selectedEventId)
        .eq('short_code', shortCode)
        .maybeSingle();

      if (playerError) {
        console.error('Failed to load board player', playerError);
        setError('Nepodařilo se načíst hráče.');
        return false;
      }

      if (!data) {
        setError(`Hráč s kódem ${shortCode} nebyl nalezen.`);
        return false;
      }

      const player = data as BoardPlayer;
      if (selectedCategoryId && player.category_id !== selectedCategoryId) {
        const categoryName = categoryMap.get(selectedCategoryId)?.name ?? 'vybrané kategorie';
        setError(`Hráč ${shortCode} nepatří do ${categoryName}.`);
        return false;
      }

      let duplicate = false;
      let full = false;
      let addedSeat: number | null = null;
      let nextSeat: number | null = null;

      setEntries((current) => {
        if (current.some((entry) => entry.player?.id === player.id)) {
          duplicate = true;
          return current;
        }

        const firstEmptyIndex = current.findIndex((entry) => entry.player === null);
        if (firstEmptyIndex < 0) {
          full = true;
          return current;
        }

        const next = [...current];
        next[firstEmptyIndex] = {
          ...next[firstEmptyIndex],
          player,
        };
        addedSeat = next[firstEmptyIndex].seat;
        nextSeat = next.find((entry) => entry.player === null)?.seat ?? null;
        return next;
      });

      if (duplicate) {
        setError(`Hráč ${shortCode} už je v zápase přidaný.`);
        showToast('Hráč už je v zápase');
        return false;
      }

      if (full || addedSeat === null) {
        setError('Všechny 4 sloty jsou obsazené.');
        return false;
      }

      const targetSeat = nextSeat ?? addedSeat;
      setActiveSeat(targetSeat);
      scrollToSeat(targetSeat);
      window.setTimeout(() => focusSeatInput(targetSeat), 180);
      setSubmitAttempted(false);
      setManualCode('');
      setError(null);
      setMessage(null);
      if (source === 'scan') {
        showToast('Hráč načten');
      }
      return true;
    },
    [categoryMap, focusSeatInput, scrollToSeat, selectedCategoryId, selectedEventId, showToast],
  );

  const handleManualAdd = useCallback(async () => {
    await loadPlayer(manualCode, 'manual');
  }, [loadPlayer, manualCode]);

  const handleQrResult = useCallback(
    (raw: string) => {
      if (scanLockRef.current) {
        return;
      }
      scanLockRef.current = true;

      void (async () => {
        try {
          const parsed = parseBoardQrPayload(raw);
          if (!parsed) {
            setError('QR kód není ve formátu Deskovek.');
            return;
          }

          if (parsed.eventSlug && event && slugify(event.slug) !== slugify(parsed.eventSlug)) {
            setMessage(`QR je z eventu ${parsed.eventSlug}, ale aktuálně je vybraný ${event.slug}.`);
          }

          setScannerError(null);
          const added = await loadPlayer(parsed.shortCode, 'scan');
          if (added && AUTO_CLOSE_SCANNER_AFTER_SCAN) {
            setScannerOpen(false);
          }
        } finally {
          window.setTimeout(() => {
            scanLockRef.current = false;
          }, 180);
        }
      })();
    },
    [event, loadPlayer],
  );

  const handleScannerError = useCallback(
    (scanError: Error) => {
      const raw = (scanError.message || '').toLowerCase();
      const permissionDenied =
        raw.includes('notallowederror') ||
        raw.includes('permission') ||
        raw.includes('denied') ||
        raw.includes('insecure context');
      const reason = permissionDenied
        ? 'Přístup ke kameře byl zamítnut. Povol kameru v prohlížeči.'
        : 'Skener nelze spustit. Zkontroluj kameru a oprávnění.';
      setScannerError(reason);
      showToast(reason);
    },
    [showToast],
  );

  const handleEntryChange = useCallback((seat: number, field: 'points' | 'placement', value: string) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.seat === seat
          ? {
              ...entry,
              [field]: value,
            }
          : entry,
      ),
    );
  }, []);

  const handleRemovePlayer = useCallback((seat: number) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.seat === seat
          ? {
              seat: entry.seat,
              player: null,
              points: '',
              placement: '',
            }
          : entry,
      ),
    );
    setActiveSeat(seat);
    setSubmitAttempted(false);
    scrollToSeat(seat);
  }, [scrollToSeat]);

  const handleSubmit = useCallback(async () => {
    setSubmitAttempted(true);
    setError(null);
    setMessage(null);

    if (submitDisabledReason) {
      setError(submitDisabledReason);
      return;
    }
    if (!selectedEventId || !selectedCategoryId || !selectedBlockId) {
      setError('Vyber event, kategorii a blok.');
      return;
    }

    const parsedRound = roundNumber.trim() ? Number(roundNumber.trim()) : null;
    setSaving(true);

    const { data: insertedMatch, error: insertMatchError } = await supabase
      .from('board_match')
      .insert({
        event_id: selectedEventId,
        category_id: selectedCategoryId,
        block_id: selectedBlockId,
        round_number: parsedRound,
        created_by: judgeId,
      })
      .select('id, event_id, category_id, block_id, round_number, created_by, created_at, status')
      .single();

    if (insertMatchError || !insertedMatch) {
      console.error('Failed to insert board match', insertMatchError);
      setSaving(false);
      setError('Uložení zápasu selhalo (hlavička).');
      return;
    }

    const match = insertedMatch as BoardMatch;

    const playerRows = entries.map((entry) => {
      const points = parseNumeric(entry.points);
      const placement = parseNumeric(entry.placement);
      return {
        match_id: match.id,
        player_id: entry.player!.id,
        seat: entry.seat,
        points,
        placement,
      };
    });

    const { error: insertPlayersError } = await supabase.from('board_match_player').insert(playerRows);

    if (insertPlayersError) {
      console.error('Failed to insert board match players', insertPlayersError);
      void supabase.from('board_match').update({ status: 'void' }).eq('id', match.id);
      setSaving(false);
      setError('Uložení zápasu selhalo (hráči).');
      return;
    }

    setSaving(false);
    setMessage('Zápas byl úspěšně uložen.');
    showToast('Zápas odeslán');
    setEntries(buildInitialMatchEntries());
    setSubmitAttempted(false);
    setActiveSeat(1);
    setScannerOpen(false);
    setError(null);

    if (parsedRound !== null) {
      setRoundNumber(String(parsedRound + 1));
    }
  }, [
    entries,
    judgeId,
    roundNumber,
    selectedBlockId,
    selectedCategoryId,
    selectedEventId,
    showToast,
    submitDisabledReason,
  ]);

  if (!selectedEventId) {
    return (
      <section className="admin-card">
        <h2>Nový zápas</h2>
        <p className="admin-card-subtitle">Nejdřív vyber event na úvodní stránce.</p>
      </section>
    );
  }

  return (
    <>
      <section className="admin-card deskovky-new-match-card">
        <header className="admin-card-header">
          <div>
            <h2>Nový zápas</h2>
            <p className="admin-card-subtitle">
              {event?.name ?? 'Event'} · načti 4 hráče a zapiš výsledek.
            </p>
          </div>
          <div className="admin-card-actions">
            {context.events.length > 1 ? (
              <label className="admin-field deskovky-event-select">
                <span>Event</span>
                <select
                  value={selectedEventId ?? ''}
                  onChange={(eventTarget) => onSelectEventId(eventTarget.target.value)}
                >
                  {context.events.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button type="button" className="admin-button admin-button--secondary" onClick={resetEntries}>
              Vyčistit formulář
            </button>
          </div>
        </header>

        {setupError ? <p className="admin-error">{setupError}</p> : null}
        {setupLoading ? <p className="admin-card-subtitle">Načítám konfiguraci…</p> : null}

        <div className="deskovky-new-match-grid">
          <label className="admin-field">
            <span>Kategorie</span>
            <select
              value={selectedCategoryId}
              onChange={(eventTarget) => setSelectedCategoryId(eventTarget.target.value)}
              disabled={!allowedCategoryIds.length}
            >
              {allowedCategoryIds.map((categoryId) => (
                <option key={categoryId} value={categoryId}>
                  {categoryMap.get(categoryId)?.name ?? categoryId}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-field">
            <span>Blok</span>
            <select
              value={selectedBlockId}
              onChange={(eventTarget) => setSelectedBlockId(eventTarget.target.value)}
              disabled={!visibleBlocks.length}
            >
              {visibleBlocks.map((block) => (
                <option key={block.id} value={block.id}>
                  Blok {block.block_number} · {gameMap.get(block.game_id)?.name ?? block.game_id}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-field">
            <span>Kolo / stůl (volitelné)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={roundNumber}
              onChange={(eventTarget) => setRoundNumber(eventTarget.target.value)}
              placeholder="např. 3"
            />
          </label>
        </div>

        <div className="deskovky-scoring-hint">
          <strong>Typ bodování:</strong> {selectedGame?.name ?? '—'} ({scoringType})
        </div>

        <div className="deskovky-scanner-panel">
          <div className="deskovky-scanner-controls">
            <button
              type="button"
              className="admin-button admin-button--secondary"
              onClick={() => {
                setScannerError(null);
                setScannerOpen(true);
              }}
              aria-label="Spustit QR skener"
            >
              Spustit skener
            </button>
            <div className="deskovky-manual-input">
              <input
                type="text"
                value={manualCode}
                onChange={(eventTarget) => setManualCode(eventTarget.target.value.toUpperCase())}
                placeholder="Short code hráče"
                aria-label="Kód hráče pro ruční přidání"
              />
              <button
                type="button"
                className="admin-button admin-button--primary"
                onClick={() => void handleManualAdd()}
                aria-label="Přidat hráče podle kódu"
              >
                Přidat
              </button>
            </div>
          </div>
          {error ? <p className="admin-error deskovky-inline-error">{error}</p> : null}
        </div>

        {/* Scanner je modal: fullscreen na mobile, kompaktnější dialog na desktopu. */}
        {scannerOpen ? (
          <div className={`deskovky-scanner-modal ${isMobile ? 'deskovky-scanner-modal--mobile' : ''}`}>
            <button
              type="button"
              className="deskovky-scanner-backdrop"
              onClick={() => setScannerOpen(false)}
              aria-label="Zavřít QR skener"
            />
            <section className="deskovky-scanner-dialog" role="dialog" aria-modal="true" aria-label="QR skener">
              <header className="deskovky-scanner-dialog-header">
                <h3>QR skener hráčů</h3>
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={() => setScannerOpen(false)}
                  aria-label="Zavřít QR skener"
                >
                  Zavřít
                </button>
              </header>
              {scannerError ? <p className="admin-error deskovky-inline-error">{scannerError}</p> : null}
              <QRScanner active={scannerOpen} onResult={handleQrResult} onError={handleScannerError} />
            </section>
          </div>
        ) : null}

        <div className={`deskovky-slots-grid ${isMobile ? 'deskovky-slots-grid--mobile' : ''}`}>
          {entries.map((entry) => {
            const code = entry.player?.short_code ?? 'Prázdný slot';
            const title = entry.player?.display_name || entry.player?.team_name || 'Nenačteno';
            const statusLabel = entry.player ? 'Načteno' : 'Chybí';
            const validation = seatValidationMap.get(entry.seat);
            const expanded = !isMobile || activeSeat === entry.seat;
            const invalid = submitAttempted && Boolean(validation?.errors.length);
            return (
              <article
                key={entry.seat}
                className={`deskovky-slot-card ${invalid ? 'deskovky-slot-card--invalid' : ''}`}
                ref={(node) => {
                  slotRefs.current[entry.seat] = node;
                }}
              >
                {/* Mobile: akordeon po slotech; desktop: všechny sloty otevřené ve 4 sloupcích. */}
                {isMobile ? (
                  <button
                    type="button"
                    className="deskovky-slot-toggle"
                    onClick={() => setActiveSeat(entry.seat)}
                    aria-expanded={expanded}
                    aria-controls={`deskovky-slot-content-${entry.seat}`}
                    aria-label={`Slot ${entry.seat} ${statusLabel}`}
                  >
                    <span className="deskovky-slot-toggle-meta">
                      <span>Slot {entry.seat}</span>
                      <span
                        className={`deskovky-slot-status ${
                          entry.player ? 'deskovky-slot-status--loaded' : 'deskovky-slot-status--missing'
                        }`}
                      >
                        {statusLabel}
                      </span>
                    </span>
                    <strong>{title}</strong>
                    <span className="deskovky-slot-summary">{entry.player ? code : 'Nenačteno'}</span>
                  </button>
                ) : (
                  <header>
                    <span>Slot {entry.seat}</span>
                    {entry.player ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleRemovePlayer(entry.seat)}
                        aria-label={`Odebrat hráče ze slotu ${entry.seat}`}
                      >
                        Odebrat
                      </button>
                    ) : null}
                  </header>
                )}

                <div id={`deskovky-slot-content-${entry.seat}`} hidden={!expanded}>
                  {isMobile ? (
                    <div className="deskovky-slot-mobile-head">
                      <strong>{code}</strong>
                      {entry.player ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleRemovePlayer(entry.seat)}
                          aria-label={`Odebrat hráče ze slotu ${entry.seat}`}
                        >
                          Odebrat
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <strong>{code}</strong>
                  )}
                  <p className="admin-card-subtitle">{title}</p>

                  {scoringInputs.showPoints ? (
                    <label className="admin-field">
                      <span>Body</span>
                      <input
                        ref={(node) => {
                          slotInputRefs.current[entry.seat] = node;
                        }}
                        type="number"
                        step="0.5"
                        value={entry.points}
                        className={submitAttempted && validation?.pointsMissing ? 'deskovky-field-invalid' : ''}
                        onChange={(eventTarget) => handleEntryChange(entry.seat, 'points', eventTarget.target.value)}
                      />
                    </label>
                  ) : null}

                  {scoringInputs.showPlacement ? (
                    <label className="admin-field">
                      <span>Umístění</span>
                      <input
                        ref={
                          !scoringInputs.showPoints
                            ? (node) => {
                                slotInputRefs.current[entry.seat] = node;
                              }
                            : undefined
                        }
                        type="number"
                        step="0.5"
                        min="1"
                        value={entry.placement}
                        className={submitAttempted && validation?.placementMissing ? 'deskovky-field-invalid' : ''}
                        onChange={(eventTarget) => handleEntryChange(entry.seat, 'placement', eventTarget.target.value)}
                      />
                    </label>
                  ) : null}

                  {submitAttempted && validation?.errors.length ? (
                    <p className="admin-error deskovky-slot-error">{validation.errors[0]}</p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        {!isMobile ? (
          <div className="admin-card-actions admin-card-actions--end deskovky-submit-row">
            <button
              type="button"
              className="admin-button admin-button--primary"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {saving ? 'Ukládám…' : 'Odeslat zápas'}
            </button>
          </div>
        ) : null}

        {message ? <p className="admin-success">{message}</p> : null}
        {error ? <p className="admin-error deskovky-form-error">{error}</p> : null}

        {isMobile ? (
          <div className="deskovky-mobile-submitbar" role="region" aria-label="Odeslání zápasu">
            <p className="deskovky-mobile-submit-note" title={mobileSubmitHelperText}>
              {mobileSubmitHelperText}
            </p>
            <button
              type="button"
              className="admin-button admin-button--primary"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {saving ? 'Ukládám…' : 'Odeslat zápas'}
            </button>
          </div>
        ) : null}
      </section>

      {toast ? (
        <div className="deskovky-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </>
  );
}

function StandingsPage({
  context,
  selectedEventId,
  onSelectEventId,
  isMobile,
}: {
  context: BoardJudgeContext;
  selectedEventId: string | null;
  onSelectEventId: (eventId: string) => void;
  isMobile: boolean;
}) {
  const [setup, setSetup] = useState<EventSetup | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [gameStandings, setGameStandings] = useState<BoardGameStanding[]>([]);
  const [overallStandings, setOverallStandings] = useState<BoardOverallStanding[]>([]);
  const [players, setPlayers] = useState<BoardPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const event = useMemo(
    () => context.events.find((item) => item.id === selectedEventId) ?? null,
    [context.events, selectedEventId],
  );

  useEffect(() => {
    if (!selectedEventId) {
      setSetup(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadEventSetup(selectedEventId);
        if (!cancelled) {
          setSetup(loaded);
        }
      } catch (loadError) {
        console.error('Failed to load standings setup', loadError);
        if (!cancelled) {
          setSetup(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedEventId]);

  const categories = setup?.categories ?? [];
  const games = setup?.games ?? [];

  const gameMap = useMemo(
    () => new Map(games.map((game) => [game.id, game])),
    [games],
  );
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );
  const primaryGameLabel = useMemo(() => {
    if (!selectedCategory?.primary_game_id) {
      return null;
    }
    return gameMap.get(selectedCategory.primary_game_id)?.name ?? selectedCategory.primary_game_id;
  }, [gameMap, selectedCategory]);

  const playerMap = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );

  useEffect(() => {
    if (!categories.length) {
      setSelectedCategoryId('');
      return;
    }
    if (!selectedCategoryId || !categories.some((category) => category.id === selectedCategoryId)) {
      setSelectedCategoryId(categories[0].id);
    }
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (!selectedEventId || !selectedCategoryId) {
      setGameStandings([]);
      setOverallStandings([]);
      setPlayers([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      const [gameRes, overallRes, playerRes] = await Promise.all([
        supabase
          .from('board_game_standings')
          .select('event_id, category_id, game_id, player_id, matches_played, total_points, avg_placement, best_placement, game_rank')
          .eq('event_id', selectedEventId)
          .eq('category_id', selectedCategoryId)
          .order('game_rank', { ascending: true }),
        supabase
          .from('board_overall_standings')
          .select('event_id, category_id, player_id, primary_game_id, games_counted, overall_score, game_breakdown, overall_rank')
          .eq('event_id', selectedEventId)
          .eq('category_id', selectedCategoryId)
          .order('overall_rank', { ascending: true }),
        supabase
          .from('board_player')
          .select('id, event_id, short_code, team_name, display_name, category_id, created_at')
          .eq('event_id', selectedEventId)
          .eq('category_id', selectedCategoryId)
          .order('short_code', { ascending: true }),
      ]);

      if (cancelled) {
        return;
      }

      setLoading(false);

      if (gameRes.error || overallRes.error || playerRes.error) {
        console.error('Failed to load standings', gameRes.error, overallRes.error, playerRes.error);
        setError('Nepodařilo se načíst průběžné pořadí.');
        return;
      }

      setGameStandings((gameRes.data ?? []) as BoardGameStanding[]);
      setOverallStandings((overallRes.data ?? []) as BoardOverallStanding[]);
      setPlayers((playerRes.data ?? []) as BoardPlayer[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCategoryId, selectedEventId]);

  const perGame = useMemo(() => {
    const grouped = new Map<string, BoardGameStanding[]>();
    gameStandings.forEach((standing) => {
      const current = grouped.get(standing.game_id) ?? [];
      current.push(standing);
      grouped.set(standing.game_id, current);
    });
    return grouped;
  }, [gameStandings]);

  if (!context.events.length) {
    return (
      <section className="admin-card">
        <h2>Průběžné pořadí</h2>
        <p className="admin-card-subtitle">Nejsou dostupné žádné eventy.</p>
      </section>
    );
  }

  return (
    <>
      <section className="admin-card deskovky-toolbar deskovky-toolbar--sticky-mobile">
        <div className="deskovky-toolbar-left">
          <h2>Průběžné pořadí</h2>
          <p className="admin-card-subtitle">Přehled po hrách a celkové pořadí kategorie.</p>
        </div>
        <div className="deskovky-toolbar-actions">
          <label className="admin-field deskovky-event-select">
            <span>Event</span>
            <select
              value={selectedEventId ?? ''}
              onChange={(eventTarget) => onSelectEventId(eventTarget.target.value)}
            >
              {context.events.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field deskovky-event-select">
            <span>Kategorie</span>
            <select
              value={selectedCategoryId}
              onChange={(eventTarget) => setSelectedCategoryId(eventTarget.target.value)}
              disabled={!categories.length}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="admin-card">
        <h2>Celkové pořadí</h2>
        <p className="admin-card-subtitle">
          {event?.name ?? 'Event'} · součet pořadí všech her v kategorii (nižší součet je lepší)
          {primaryGameLabel ? ` · hlavní hra: ${primaryGameLabel}` : ''}.
        </p>

        {loading ? <p className="admin-card-subtitle">Načítám pořadí…</p> : null}
        {error ? <p className="admin-error">{error}</p> : null}

        {overallStandings.length ? (
          // Mobile používá karty místo široké tabulky kvůli čitelnosti bez horizontálního scrollu.
          isMobile ? (
            <div className="deskovky-standings-cards">
              {overallStandings.map((row) => {
                const player = playerMap.get(row.player_id);
                const label = player?.display_name || player?.team_name || row.player_id;
                const breakdown = (row.game_breakdown ?? [])
                  .map((item) => {
                    const gameName = item.game_name || gameMap.get(item.game_id)?.name || item.game_id;
                    return `${item.is_primary ? '★ ' : ''}${gameName}: ${item.game_rank}`;
                  })
                  .join(' · ');
                const totalGames = perGame.size || row.games_counted;
                return (
                  <article key={`overall-${row.player_id}`} className="deskovky-standings-card">
                    <h3>
                      {row.overall_rank}. {label}
                    </h3>
                    <p>
                      <strong>Součet pořadí:</strong> {row.overall_score}
                    </p>
                    <p>
                      <strong>Odehráno:</strong> {row.games_counted}/{totalGames}
                    </p>
                    <p>
                      <strong>Kód:</strong> {player?.short_code ?? '—'}
                    </p>
                    <p>
                      <strong>Hry:</strong> {breakdown || '—'}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="deskovky-table-wrap">
              <table className="deskovky-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Hráč</th>
                    <th>Kód</th>
                    <th>Součet umístění</th>
                    <th>Hry</th>
                  </tr>
                </thead>
                <tbody>
                  {overallStandings.map((row) => {
                    const player = playerMap.get(row.player_id);
                    const label = player?.display_name || player?.team_name || row.player_id;
                    const breakdown = (row.game_breakdown ?? [])
                      .map((item) => {
                        const gameName = item.game_name || gameMap.get(item.game_id)?.name || item.game_id;
                        return `${item.is_primary ? '★ ' : ''}${gameName}: ${item.game_rank}`;
                      })
                      .join(' · ');
                    return (
                      <tr key={`overall-${row.player_id}`}>
                        <td>{row.overall_rank}</td>
                        <td>{label}</td>
                        <td>{player?.short_code ?? '—'}</td>
                        <td>{row.overall_score}</td>
                        <td>{breakdown || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <p className="admin-card-subtitle">Zatím nejsou k dispozici žádná data.</p>
        )}
      </section>

      {[...perGame.entries()].map(([gameId, standings]) => {
        const game = gameMap.get(gameId);
        return (
          <section key={gameId} className="admin-card">
            <h2>{game?.name ?? gameId}</h2>
            <p className="admin-card-subtitle">Typ bodování: {game?.scoring_type ?? '—'}</p>
            // Stejná data, jiný layout: karty na mobile, tabulka na desktopu.
            {isMobile ? (
              <div className="deskovky-standings-cards">
                {standings.map((row) => {
                  const player = playerMap.get(row.player_id);
                  const label = player?.display_name || player?.team_name || row.player_id;
                  return (
                    <article key={`${gameId}-${row.player_id}`} className="deskovky-standings-card">
                      <h3>
                        {row.game_rank}. {label}
                      </h3>
                      <p>
                        <strong>Součet pořadí:</strong> {row.avg_placement ?? '—'}
                      </p>
                      <p>
                        <strong>Odehráno:</strong> {row.matches_played}
                      </p>
                      <p>
                        <strong>Body:</strong> {row.total_points ?? '—'}
                      </p>
                      <p>
                        <strong>Kód:</strong> {player?.short_code ?? '—'}
                      </p>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="deskovky-table-wrap">
                <table className="deskovky-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Hráč</th>
                      <th>Kód</th>
                      <th>Body</th>
                      <th>Průměr umístění</th>
                      <th>Počet partií</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((row) => {
                      const player = playerMap.get(row.player_id);
                      const label = player?.display_name || player?.team_name || row.player_id;
                      return (
                        <tr key={`${gameId}-${row.player_id}`}>
                          <td>{row.game_rank}</td>
                          <td>{label}</td>
                          <td>{player?.short_code ?? '—'}</td>
                          <td>{row.total_points ?? '—'}</td>
                          <td>{row.avg_placement ?? '—'}</td>
                          <td>{row.matches_played}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function RulesPage() {
  return (
    <section className="admin-card">
      <h2>Pravidla Deskových her</h2>
      <p className="admin-card-subtitle">Dokumenty se otevřou v nové kartě.</p>
      <div className="deskovky-rules-links">
        {BOARD_RULES_TOURNAMENT ? (
          <a href={BOARD_RULES_TOURNAMENT} target="_blank" rel="noreferrer" className="admin-button admin-button--primary">
            Pravidla turnaje
          </a>
        ) : (
          <span className="admin-error">Soubor „Pravidla turnaje“ nebyl nalezen.</span>
        )}

        {BOARD_RULES_SCORING ? (
          <a href={BOARD_RULES_SCORING} target="_blank" rel="noreferrer" className="admin-button admin-button--secondary">
            Hodnocení turnaje
          </a>
        ) : (
          <span className="admin-error">Soubor „Hodnocení turnaje“ nebyl nalezen.</span>
        )}
      </div>
    </section>
  );
}

function AdminPage({
  selectedEventId,
  onSelectEventId,
  isMobile,
}: {
  selectedEventId: string | null;
  onSelectEventId: (eventId: string) => void;
  isMobile: boolean;
}) {
  const isTabletOrMobile = useIsMobileBreakpoint(1024);
  const isCompactAdminNav = isMobile || isTabletOrMobile;
  const [activeSection, setActiveSection] = useState<AdminSectionKey>(() => {
    if (typeof window === 'undefined') {
      return 'overview';
    }
    return resolveAdminSectionFromHash(window.location.hash);
  });

  const [events, setEvents] = useState<BoardEvent[]>([]);
  const [categories, setCategories] = useState<BoardCategory[]>([]);
  const [games, setGames] = useState<BoardGame[]>([]);
  const [blocks, setBlocks] = useState<BoardBlock[]>([]);
  const [players, setPlayers] = useState<BoardPlayer[]>([]);
  const [assignments, setAssignments] = useState<BoardJudgeAssignment[]>([]);
  const [judges, setJudges] = useState<BoardAdminJudge[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [eventName, setEventName] = useState('');
  const [eventSlug, setEventSlug] = useState('');
  const [eventStartDate, setEventStartDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');

  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryPrimaryGameId, setNewCategoryPrimaryGameId] = useState('');
  const [newGameName, setNewGameName] = useState('');
  const [newGameScoringType, setNewGameScoringType] = useState<BoardScoringType>('points');
  const [newGamePointsOrder, setNewGamePointsOrder] = useState<BoardPointsOrder>('desc');
  const [newGameThreePlayerAdjustment, setNewGameThreePlayerAdjustment] = useState(false);
  const [newGameNotes, setNewGameNotes] = useState('');

  const [newBlockCategoryId, setNewBlockCategoryId] = useState('');
  const [newBlockGameId, setNewBlockGameId] = useState('');
  const [newBlockNumber, setNewBlockNumber] = useState('1');

  const [csvInput, setCsvInput] = useState('');
  const [autoGenerateCodes, setAutoGenerateCodes] = useState(true);

  const [newAssignmentUserId, setNewAssignmentUserId] = useState('');
  const [newAssignmentGameId, setNewAssignmentGameId] = useState('');
  const [newAssignmentCategoryId, setNewAssignmentCategoryId] = useState('');

  const [playerSearch, setPlayerSearch] = useState('');
  const [playerCategoryFilter, setPlayerCategoryFilter] = useState('');
  const [playerPage, setPlayerPage] = useState(1);
  const [playerPageSize, setPlayerPageSize] = useState(50);
  const [gameSearch, setGameSearch] = useState('');
  const [gameScoringFilter, setGameScoringFilter] = useState<'all' | BoardScoringType>('all');
  const [assignmentJudgeFilter, setAssignmentJudgeFilter] = useState('');
  const [assignmentGameFilter, setAssignmentGameFilter] = useState('');

  const activeSectionLabel = useMemo(
    () => ADMIN_SECTION_ITEMS.find((item) => item.key === activeSection)?.label ?? 'Přehled',
    [activeSection],
  );

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const gameMap = useMemo(
    () => new Map(games.map((game) => [game.id, game])),
    [games],
  );

  const judgesMap = useMemo(
    () => new Map(judges.map((judge) => [judge.id, judge])),
    [judges],
  );

  const loadEvents = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('board_event')
      .select('id, slug, name, start_date, end_date, created_at')
      .order('start_date', { ascending: false, nullsFirst: false });

    if (loadError) {
      throw loadError;
    }

    const list = (data ?? []) as BoardEvent[];
    setEvents(list);

    if (!selectedEventId && list.length > 0) {
      onSelectEventId(list[0].id);
    }
  }, [onSelectEventId, selectedEventId]);

  const loadEventDetail = useCallback(async () => {
    if (!selectedEventId) {
      setCategories([]);
      setGames([]);
      setBlocks([]);
      setPlayers([]);
      setAssignments([]);
      return;
    }

    const [categoryRes, gameRes, blockRes, playerRes, assignmentRes, judgesRes] = await Promise.all([
      supabase
        .from('board_category')
        .select('id, event_id, name, primary_game_id, created_at')
        .eq('event_id', selectedEventId)
        .order('name', { ascending: true }),
      supabase
        .from('board_game')
        .select('id, event_id, name, scoring_type, points_order, three_player_adjustment, notes, created_at')
        .eq('event_id', selectedEventId)
        .order('name', { ascending: true }),
      supabase
        .from('board_block')
        .select('id, event_id, category_id, block_number, game_id, created_at')
        .eq('event_id', selectedEventId)
        .order('block_number', { ascending: true }),
      supabase
        .from('board_player')
        .select('id, event_id, short_code, team_name, display_name, category_id, created_at')
        .eq('event_id', selectedEventId)
        .order('short_code', { ascending: true }),
      supabase
        .from('board_judge_assignment')
        .select('id, event_id, user_id, game_id, category_id, created_at')
        .eq('event_id', selectedEventId)
        .order('created_at', { ascending: false }),
      supabase
        .from('judges')
        .select('id, email, display_name')
        .order('display_name', { ascending: true }),
    ]);

    if (categoryRes.error || gameRes.error || blockRes.error || playerRes.error || assignmentRes.error) {
      console.error(
        'Failed to load board admin data',
        categoryRes.error,
        gameRes.error,
        blockRes.error,
        playerRes.error,
        assignmentRes.error,
      );
      throw new Error('Nepodařilo se načíst data administrace.');
    }

    if (judgesRes.error) {
      console.warn('Failed to load judges list, switching to manual user id input', judgesRes.error);
      setJudges([]);
    } else {
      setJudges((judgesRes.data ?? []) as BoardAdminJudge[]);
    }

    setCategories((categoryRes.data ?? []) as BoardCategory[]);
    setGames((gameRes.data ?? []) as BoardGame[]);
    setBlocks((blockRes.data ?? []) as BoardBlock[]);
    setPlayers((playerRes.data ?? []) as BoardPlayer[]);
    setAssignments((assignmentRes.data ?? []) as BoardJudgeAssignment[]);
  }, [selectedEventId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        await loadEvents();
      } catch (loadError) {
        console.error('Failed to load board events', loadError);
        if (!cancelled) {
          setError('Nepodařilo se načíst eventy.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadEvents]);

  useEffect(() => {
    if (!selectedEventId) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        await loadEventDetail();
      } catch (loadError) {
        console.error('Failed to load board event detail', loadError);
        if (!cancelled) {
          setError('Nepodařilo se načíst detail eventu.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadEventDetail, selectedEventId]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  useEffect(() => {
    const handleHashChange = () => {
      setActiveSection(resolveAdminSectionFromHash(window.location.hash));
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const navigateAdminSection = useCallback((nextSection: AdminSectionKey) => {
    setActiveSection(nextSection);
    const hash = adminSectionHash(nextSection);
    const nextUrl = `${window.location.pathname}${window.location.search}#${hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, []);

  useEffect(() => {
    if (!selectedEvent) {
      setEventName('');
      setEventSlug('');
      setEventStartDate('');
      setEventEndDate('');
      return;
    }

    setEventName(selectedEvent.name);
    setEventSlug(selectedEvent.slug);
    setEventStartDate(selectedEvent.start_date ?? '');
    setEventEndDate(selectedEvent.end_date ?? '');
  }, [selectedEvent]);

  useEffect(() => {
    if (!categories.length) {
      setNewBlockCategoryId('');
      return;
    }
    if (!newBlockCategoryId || !categories.some((category) => category.id === newBlockCategoryId)) {
      setNewBlockCategoryId(categories[0].id);
    }
  }, [categories, newBlockCategoryId]);

  useEffect(() => {
    if (!games.length) {
      setNewCategoryPrimaryGameId('');
      return;
    }
    if (newCategoryPrimaryGameId && !games.some((game) => game.id === newCategoryPrimaryGameId)) {
      setNewCategoryPrimaryGameId('');
    }
  }, [games, newCategoryPrimaryGameId]);

  useEffect(() => {
    if (!games.length) {
      setNewBlockGameId('');
      return;
    }
    if (!newBlockGameId || !games.some((game) => game.id === newBlockGameId)) {
      setNewBlockGameId(games[0].id);
    }
  }, [games, newBlockGameId]);

  useEffect(() => {
    if (newGameScoringType === 'placement') {
      setNewGamePointsOrder('asc');
    }
  }, [newGameScoringType]);

  const handleCreateEvent = useCallback(async () => {
    const name = eventName.trim();
    const slug = slugify(eventSlug || name);

    if (!name || !slug) {
      setError('Vyplň název i slug eventu.');
      return;
    }

    setError(null);
    setMessage(null);

    const { data, error: createError } = await supabase
      .from('board_event')
      .insert({
        name,
        slug,
        start_date: eventStartDate || null,
        end_date: eventEndDate || null,
      })
      .select('id, slug, name, start_date, end_date, created_at')
      .single();

    if (createError || !data) {
      console.error('Failed to create board event', createError);
      setError('Vytvoření eventu selhalo.');
      return;
    }

    const next = data as BoardEvent;
    setEvents((current) => [next, ...current]);
    onSelectEventId(next.id);
    setMessage('Event byl vytvořen.');
  }, [eventEndDate, eventName, eventSlug, eventStartDate, onSelectEventId]);

  const handleUpdateEvent = useCallback(async () => {
    if (!selectedEventId) {
      setError('Vyber event.');
      return;
    }

    const name = eventName.trim();
    const slug = slugify(eventSlug || name);

    if (!name || !slug) {
      setError('Vyplň název i slug eventu.');
      return;
    }

    const { error: updateError } = await supabase
      .from('board_event')
      .update({
        name,
        slug,
        start_date: eventStartDate || null,
        end_date: eventEndDate || null,
      })
      .eq('id', selectedEventId);

    if (updateError) {
      console.error('Failed to update board event', updateError);
      setError('Uložení eventu selhalo.');
      return;
    }

    setEvents((current) =>
      current.map((event) =>
        event.id === selectedEventId
          ? {
              ...event,
              name,
              slug,
              start_date: eventStartDate || null,
              end_date: eventEndDate || null,
            }
          : event,
      ),
    );
    setMessage('Event byl uložen.');
  }, [eventEndDate, eventName, eventSlug, eventStartDate, selectedEventId]);

  const handleCreateCategory = useCallback(async () => {
    if (!selectedEventId) {
      setError('Vyber event.');
      return;
    }

    const name = newCategoryName.trim();
    if (!name) {
      setError('Vyplň název kategorie.');
      return;
    }

    const { data, error: createError } = await supabase
      .from('board_category')
      .insert({ event_id: selectedEventId, name, primary_game_id: newCategoryPrimaryGameId || null })
      .select('id, event_id, name, primary_game_id, created_at')
      .single();

    if (createError || !data) {
      console.error('Failed to create board category', createError);
      setError('Vytvoření kategorie selhalo.');
      return;
    }

    setCategories((current) => [...current, data as BoardCategory].sort((a, b) => a.name.localeCompare(b.name, 'cs')));
    setNewCategoryName('');
    setMessage('Kategorie byla vytvořena.');
  }, [newCategoryName, newCategoryPrimaryGameId, selectedEventId]);

  const handleDeleteCategory = useCallback(async (categoryId: string) => {
    const confirmed = window.confirm('Smazat kategorii?');
    if (!confirmed) {
      return;
    }

    const { error: deleteError } = await supabase.from('board_category').delete().eq('id', categoryId);
    if (deleteError) {
      console.error('Failed to delete board category', deleteError);
      setError('Smazání kategorie selhalo.');
      return;
    }

    setCategories((current) => current.filter((category) => category.id !== categoryId));
    setMessage('Kategorie byla smazána.');
  }, []);

  const handleSetCategoryPrimaryGame = useCallback(async (categoryId: string, primaryGameId: string) => {
    const { error: updateError } = await supabase
      .from('board_category')
      .update({ primary_game_id: primaryGameId || null })
      .eq('id', categoryId);

    if (updateError) {
      console.error('Failed to update category primary game', updateError);
      setError('Uložení hlavní hry kategorie selhalo.');
      return;
    }

    setCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              primary_game_id: primaryGameId || null,
            }
          : category,
      ),
    );
    setMessage('Hlavní hra kategorie byla uložena.');
  }, []);

  const handleCreateGame = useCallback(async () => {
    if (!selectedEventId) {
      setError('Vyber event.');
      return;
    }

    const name = newGameName.trim();
    if (!name) {
      setError('Vyplň název hry.');
      return;
    }

    const { data, error: createError } = await supabase
      .from('board_game')
      .insert({
        event_id: selectedEventId,
        name,
        scoring_type: newGameScoringType,
        points_order: newGamePointsOrder,
        three_player_adjustment: newGameThreePlayerAdjustment,
        notes: newGameNotes.trim() || null,
      })
      .select('id, event_id, name, scoring_type, points_order, three_player_adjustment, notes, created_at')
      .single();

    if (createError || !data) {
      console.error('Failed to create board game', createError);
      setError('Vytvoření hry selhalo.');
      return;
    }

    setGames((current) => [...current, data as BoardGame].sort((a, b) => a.name.localeCompare(b.name, 'cs')));
    setNewGameName('');
    setNewGameNotes('');
    setNewGameScoringType('points');
    setNewGamePointsOrder('desc');
    setNewGameThreePlayerAdjustment(false);
    setMessage('Hra byla vytvořena.');
  }, [
    newGameName,
    newGameNotes,
    newGamePointsOrder,
    newGameScoringType,
    newGameThreePlayerAdjustment,
    selectedEventId,
  ]);

  const handleDeleteGame = useCallback(async (gameId: string) => {
    const confirmed = window.confirm('Smazat hru?');
    if (!confirmed) {
      return;
    }

    const { error: deleteError } = await supabase.from('board_game').delete().eq('id', gameId);
    if (deleteError) {
      console.error('Failed to delete board game', deleteError);
      setError('Smazání hry selhalo.');
      return;
    }

    setGames((current) => current.filter((game) => game.id !== gameId));
    setMessage('Hra byla smazána.');
  }, []);

  const handleCreateBlock = useCallback(async () => {
    if (!selectedEventId) {
      setError('Vyber event.');
      return;
    }

    const blockNumber = Number(newBlockNumber);
    if (!Number.isInteger(blockNumber) || blockNumber <= 0) {
      setError('Číslo bloku musí být kladné celé číslo.');
      return;
    }
    if (!newBlockCategoryId || !newBlockGameId) {
      setError('Vyber kategorii i hru.');
      return;
    }

    const { data, error: createError } = await supabase
      .from('board_block')
      .insert({
        event_id: selectedEventId,
        category_id: newBlockCategoryId,
        game_id: newBlockGameId,
        block_number: blockNumber,
      })
      .select('id, event_id, category_id, block_number, game_id, created_at')
      .single();

    if (createError || !data) {
      console.error('Failed to create board block', createError);
      setError('Vytvoření bloku selhalo.');
      return;
    }

    setBlocks((current) =>
      [...current, data as BoardBlock].sort((a, b) =>
        a.block_number === b.block_number
          ? (categoryMap.get(a.category_id)?.name ?? '').localeCompare(categoryMap.get(b.category_id)?.name ?? '', 'cs')
          : a.block_number - b.block_number,
      ),
    );
    setMessage('Blok byl vytvořen.');
  }, [categoryMap, newBlockCategoryId, newBlockGameId, newBlockNumber, selectedEventId]);

  const handleDeleteBlock = useCallback(async (blockId: string) => {
    const confirmed = window.confirm('Smazat blok?');
    if (!confirmed) {
      return;
    }

    const { error: deleteError } = await supabase.from('board_block').delete().eq('id', blockId);
    if (deleteError) {
      console.error('Failed to delete board block', deleteError);
      setError('Smazání bloku selhalo.');
      return;
    }

    setBlocks((current) => current.filter((block) => block.id !== blockId));
    setMessage('Blok byl smazán.');
  }, []);

  const handleImportPlayers = useCallback(async () => {
    if (!selectedEventId) {
      setError('Vyber event.');
      return;
    }

    const rows = parseCsv(csvInput);
    if (!rows.length) {
      setError('CSV je prázdné nebo má neplatnou hlavičku.');
      return;
    }

    const existingCodes = new Set(players.map((player) => player.short_code.toUpperCase()));
    const categoryByName = new Map(categories.map((category) => [slugify(category.name), category.id]));

    const payload: Array<{
      event_id: string;
      short_code: string;
      team_name: string | null;
      display_name: string | null;
      category_id: string;
    }> = [];

    const skipped: string[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const categoryKey = slugify(row.category);
      const categoryId = categoryByName.get(categoryKey);
      if (!categoryId) {
        skipped.push(`řádek ${rowNumber}: neznámá kategorie "${row.category}"`);
        return;
      }

      let shortCode = row.short_code;
      if (!shortCode) {
        if (!autoGenerateCodes) {
          skipped.push(`řádek ${rowNumber}: chybí short_code`);
          return;
        }
        shortCode = randomShortCode(existingCodes);
      }

      shortCode = shortCode.toUpperCase();
      existingCodes.add(shortCode);

      payload.push({
        event_id: selectedEventId,
        short_code: shortCode,
        team_name: row.team_name || null,
        display_name: row.display_name || null,
        category_id: categoryId,
      });
    });

    if (!payload.length) {
      setError(`Import nic nevložil (${skipped.join('; ') || 'bez validních řádků'}).`);
      return;
    }

    const { error: upsertError } = await supabase
      .from('board_player')
      .upsert(payload, { onConflict: 'event_id,short_code' });

    if (upsertError) {
      console.error('Failed to import players', upsertError);
      setError('Import hráčů selhal.');
      return;
    }

    setCsvInput('');
    setMessage(
      skipped.length
        ? `Import hotov: ${payload.length} řádků, přeskočeno ${skipped.length} (${skipped.join('; ')}).`
        : `Import hotov: ${payload.length} řádků.`,
    );

    await loadEventDetail();
  }, [autoGenerateCodes, categories, csvInput, loadEventDetail, players, selectedEventId]);

  const handleExportBadges = useCallback(async () => {
    if (!selectedEventId) {
      setError('Vyber event.');
      return;
    }

    const badgeRows = players.map((player) => ({
      event_id: selectedEventId,
      player_id: player.id,
      qr_payload: buildBoardQrPayload(player.short_code),
    }));

    if (badgeRows.length) {
      const { error: badgeError } = await supabase
        .from('board_badge')
        .upsert(badgeRows, { onConflict: 'event_id,player_id' });
      if (badgeError) {
        console.error('Failed to sync board badges', badgeError);
      }
    }

    const lines = [
      'short_code,team_name,display_name,category,qr_payload',
      ...players.map((player) => {
        const category = categoryMap.get(player.category_id)?.name ?? '';
        return [
          escapeCsv(player.short_code),
          escapeCsv(player.team_name),
          escapeCsv(player.display_name),
          escapeCsv(category),
          escapeCsv(buildBoardQrPayload(player.short_code)),
        ].join(',');
      }),
    ];

    const csv = `${lines.join('\n')}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    const fileSlug = selectedEvent ? slugify(selectedEvent.slug || selectedEvent.name) : 'deskovky';
    link.href = URL.createObjectURL(blob);
    link.download = `${fileSlug}-badges.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    setMessage('CSV s visačkami bylo exportováno.');
  }, [categoryMap, players, selectedEvent, selectedEventId]);

  const handleCreateAssignment = useCallback(async () => {
    if (!selectedEventId) {
      setError('Vyber event.');
      return;
    }

    const userId = newAssignmentUserId.trim();
    if (!userId || !newAssignmentGameId) {
      setError('Vyber uživatele a hru.');
      return;
    }

    const { data, error: createError } = await supabase
      .from('board_judge_assignment')
      .insert({
        event_id: selectedEventId,
        user_id: userId,
        game_id: newAssignmentGameId,
        category_id: newAssignmentCategoryId || null,
      })
      .select('id, event_id, user_id, game_id, category_id, created_at')
      .single();

    if (createError || !data) {
      console.error('Failed to create assignment', createError);
      setError('Vytvoření přiřazení selhalo.');
      return;
    }

    setAssignments((current) => [data as BoardJudgeAssignment, ...current]);
    setMessage('Přiřazení bylo vytvořeno.');
  }, [newAssignmentCategoryId, newAssignmentGameId, newAssignmentUserId, selectedEventId]);

  const handleDeleteAssignment = useCallback(async (assignmentId: string) => {
    const confirmed = window.confirm('Smazat přiřazení?');
    if (!confirmed) {
      return;
    }

    const { error: deleteError } = await supabase
      .from('board_judge_assignment')
      .delete()
      .eq('id', assignmentId);

    if (deleteError) {
      console.error('Failed to delete assignment', deleteError);
      setError('Smazání přiřazení selhalo.');
      return;
    }

    setAssignments((current) => current.filter((assignment) => assignment.id !== assignmentId));
    setMessage('Přiřazení bylo smazáno.');
  }, []);

  const selectedEventLabel = selectedEvent?.name ?? 'Nevybraný event';
  const sectionStats = useMemo(
    () => [
      { label: 'Kategorie', value: categories.length },
      { label: 'Hry', value: games.length },
      { label: 'Bloky', value: blocks.length },
      { label: 'Hráči', value: players.length },
      { label: 'Přiřazení', value: assignments.length },
    ],
    [assignments.length, blocks.length, categories.length, games.length, players.length],
  );

  const filteredGames = useMemo(() => {
    const term = gameSearch.trim().toLowerCase();
    return games.filter((game) => {
      if (gameScoringFilter !== 'all' && game.scoring_type !== gameScoringFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [game.name, game.notes ?? ''].join(' ').toLowerCase().includes(term);
    });
  }, [gameScoringFilter, gameSearch, games]);

  const filteredPlayers = useMemo(() => {
    const term = playerSearch.trim().toLowerCase();
    return players.filter((player) => {
      if (playerCategoryFilter && player.category_id !== playerCategoryFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [player.short_code, player.display_name ?? '', player.team_name ?? ''].join(' ').toLowerCase().includes(term);
    });
  }, [playerCategoryFilter, playerSearch, players]);

  useEffect(() => {
    setPlayerPage(1);
  }, [playerCategoryFilter, playerPageSize, playerSearch, selectedEventId]);

  const playerTotalPages = Math.max(1, Math.ceil(filteredPlayers.length / playerPageSize));
  const safePlayerPage = Math.min(playerPage, playerTotalPages);

  useEffect(() => {
    if (playerPage !== safePlayerPage) {
      setPlayerPage(safePlayerPage);
    }
  }, [playerPage, safePlayerPage]);

  const pagedPlayers = useMemo(() => {
    const start = (safePlayerPage - 1) * playerPageSize;
    return filteredPlayers.slice(start, start + playerPageSize);
  }, [filteredPlayers, playerPageSize, safePlayerPage]);

  const assignmentJudgeOptions = useMemo(() => {
    const values = new Set(assignments.map((assignment) => assignment.user_id));
    return Array.from(values)
      .map((userId) => {
        const judge = judgesMap.get(userId);
        return {
          value: userId,
          label: judge ? `${judge.display_name} (${judge.email})` : userId,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'cs'));
  }, [assignments, judgesMap]);

  const filteredAssignments = useMemo(
    () =>
      assignments.filter((assignment) => {
        if (assignmentJudgeFilter && assignment.user_id !== assignmentJudgeFilter) {
          return false;
        }
        if (assignmentGameFilter && assignment.game_id !== assignmentGameFilter) {
          return false;
        }
        return true;
      }),
    [assignmentGameFilter, assignmentJudgeFilter, assignments],
  );

  const sectionHeaderConfig = useMemo<AdminSectionHeaderConfig>(() => {
    switch (activeSection) {
      case 'event':
        return {
          description: 'Nastavení názvu, slugu a termínu eventu.',
          action: {
            label: 'Uložit event',
            kind: 'primary',
            disabled: !selectedEventId,
            onClick: () => {
              void handleUpdateEvent();
            },
          },
        };
      case 'categories':
        return {
          description: 'Správa kategorií a hlavních her pro tie-break.',
          action: {
            label: 'Přidat kategorii',
            kind: 'primary',
            disabled: !selectedEventId,
            onClick: () => {
              void handleCreateCategory();
            },
          },
        };
      case 'games':
        return {
          description: 'Konfigurace her a jejich bodování.',
          action: {
            label: 'Přidat hru',
            kind: 'primary',
            disabled: !selectedEventId,
            onClick: () => {
              void handleCreateGame();
            },
          },
        };
      case 'blocks':
        return {
          description: 'Mapování kategorií na bloky a hry.',
          action: {
            label: 'Přidat blok',
            kind: 'primary',
            disabled: !selectedEventId,
            onClick: () => {
              void handleCreateBlock();
            },
          },
        };
      case 'players':
        return {
          description: 'Hráči aktivního eventu a jejich rozřazení do kategorií.',
          action: {
            label: 'Import / export',
            kind: 'secondary',
            onClick: () => {
              navigateAdminSection('import-export');
            },
          },
        };
      case 'judges':
        return {
          description: 'Přiřazení rozhodčích na hry a kategorie.',
          action: {
            label: 'Přidat přiřazení',
            kind: 'primary',
            disabled: !selectedEventId,
            onClick: () => {
              void handleCreateAssignment();
            },
          },
        };
      case 'import-export':
        return {
          description: 'Import a export hráčů a visaček.',
          action: {
            label: 'Importovat CSV',
            kind: 'primary',
            disabled: !selectedEventId,
            onClick: () => {
              void handleImportPlayers();
            },
          },
        };
      default:
        return {
          description: `Rychlý přehled administrace pro event ${selectedEventLabel}.`,
        };
    }
  }, [
    activeSection,
    handleCreateAssignment,
    handleCreateBlock,
    handleCreateCategory,
    handleCreateGame,
    handleImportPlayers,
    handleUpdateEvent,
    navigateAdminSection,
    selectedEventId,
    selectedEventLabel,
  ]);

  return (
    <>
      <section className="admin-card">
        <header className="admin-card-header">
          <div>
            <h2>Administrace Deskovek</h2>
            <p className="admin-card-subtitle">Konfigurace eventu, hráčů, bloků a přiřazení rozhodčích.</p>
          </div>
          <div className="deskovky-toolbar-actions">
            <span className="deskovky-admin-current-section">Sekce: {activeSectionLabel}</span>
          </div>
        </header>

        {loading ? <p className="admin-card-subtitle">Načítám data administrace…</p> : null}
        {error ? <p className="admin-error">{error}</p> : null}
        {message ? <p className="admin-success">{message}</p> : null}
      </section>

      <div className="deskovky-admin-sections-layout">
        {isCompactAdminNav ? (
          <section className="admin-card deskovky-admin-mobile-nav">
            <label className="admin-field deskovky-event-select">
              <span>Vyber sekci</span>
              <select
                value={activeSection}
                onChange={(eventTarget) => navigateAdminSection(eventTarget.target.value as AdminSectionKey)}
                aria-label="Výběr sekce administrace"
              >
                {ADMIN_SECTION_ITEMS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </section>
        ) : (
          <aside className="admin-card deskovky-admin-sidebar" aria-label="Sekce administrace">
            <h3>Sekce</h3>
            <nav className="deskovky-admin-sidebar-nav" role="navigation">
              {ADMIN_SECTION_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`admin-button ${
                    activeSection === item.key ? 'admin-button--primary' : 'admin-button--secondary'
                  }`}
                  onClick={() => navigateAdminSection(item.key)}
                  aria-current={activeSection === item.key ? 'page' : undefined}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>
        )}

        <div className="deskovky-admin-section-panel">
          <section className="admin-card deskovky-admin-section-sticky">
            <header className="deskovky-admin-section-sticky-head">
              <div>
                <h3>{activeSectionLabel}</h3>
                <p className="admin-card-subtitle">{sectionHeaderConfig.description}</p>
              </div>
              {sectionHeaderConfig.action ? (
                <button
                  type="button"
                  className={`admin-button ${
                    sectionHeaderConfig.action.kind === 'primary' ? 'admin-button--primary' : 'admin-button--secondary'
                  }`}
                  onClick={sectionHeaderConfig.action.onClick}
                  disabled={sectionHeaderConfig.action.disabled}
                >
                  {sectionHeaderConfig.action.label}
                </button>
              ) : null}
            </header>

            {activeSection === 'games' ? (
              <div className="deskovky-admin-filters deskovky-admin-filters--sticky">
                <label className="admin-field">
                  <span>Hledat hru</span>
                  <input
                    value={gameSearch}
                    onChange={(eventTarget) => setGameSearch(eventTarget.target.value)}
                    placeholder="Název nebo poznámka…"
                    aria-label="Hledat hru podle názvu nebo poznámky"
                  />
                </label>
                <label className="admin-field">
                  <span>Typ bodování</span>
                  <select
                    value={gameScoringFilter}
                    onChange={(eventTarget) => setGameScoringFilter(eventTarget.target.value as 'all' | BoardScoringType)}
                    aria-label="Filtrovat hry podle typu bodování"
                  >
                    <option value="all">Všechny</option>
                    <option value="points">points</option>
                    <option value="placement">placement</option>
                    <option value="both">both</option>
                  </select>
                </label>
              </div>
            ) : null}

            {activeSection === 'players' ? (
              <div className="deskovky-admin-filters deskovky-admin-filters--sticky">
                <label className="admin-field">
                  <span>Hledat hráče</span>
                  <input
                    value={playerSearch}
                    onChange={(eventTarget) => setPlayerSearch(eventTarget.target.value)}
                    placeholder="Kód, jméno nebo tým…"
                    aria-label="Hledat hráče podle kódu, jména nebo týmu"
                  />
                </label>
                <label className="admin-field">
                  <span>Kategorie</span>
                  <select
                    value={playerCategoryFilter}
                    onChange={(eventTarget) => setPlayerCategoryFilter(eventTarget.target.value)}
                    aria-label="Filtrovat hráče podle kategorie"
                  >
                    <option value="">Všechny</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Počet na stránku</span>
                  <select
                    value={String(playerPageSize)}
                    onChange={(eventTarget) => setPlayerPageSize(Number(eventTarget.target.value))}
                    aria-label="Počet hráčů na jednu stránku"
                  >
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </label>
              </div>
            ) : null}

            {activeSection === 'judges' ? (
              <div className="deskovky-admin-filters deskovky-admin-filters--sticky">
                <label className="admin-field">
                  <span>Rozhodčí</span>
                  <select
                    value={assignmentJudgeFilter}
                    onChange={(eventTarget) => setAssignmentJudgeFilter(eventTarget.target.value)}
                    aria-label="Filtrovat přiřazení podle rozhodčího"
                  >
                    <option value="">Všichni</option>
                    {assignmentJudgeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Hra</span>
                  <select 
                    value={assignmentGameFilter} 
                    onChange={(eventTarget) => setAssignmentGameFilter(eventTarget.target.value)}
                    aria-label="Filtrovat přiřazení podle hry"
                  >
                    <option value="">Všechny</option>
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {game.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </section>

          {activeSection === 'overview' ? (
            <section className="admin-card">
              <h2>Přehled administrace</h2>
              <p className="admin-card-subtitle">Aktivní event: {selectedEventLabel}</p>
              <label className="admin-field deskovky-event-select">
                <span>Aktivní event</span>
                <select
                  value={selectedEventId ?? ''}
                  onChange={(eventTarget) => onSelectEventId(eventTarget.target.value)}
                  aria-label="Aktivní event Deskovek"
                >
                  {!events.length ? <option value="">Bez dostupného eventu</option> : null}
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="deskovky-admin-overview-stats">
                {sectionStats.map((item) => (
                  <article key={item.label} className="deskovky-admin-overview-stat">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </article>
                ))}
              </div>

              <div className="admin-card-actions">
                <button 
                  type="button" 
                  className="admin-button admin-button--primary" 
                  onClick={() => navigateAdminSection('games')}
                  aria-label="Přejít na sekci Přidat hru"
                >
                  Přidat hru
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={() => navigateAdminSection('import-export')}
                  aria-label="Přejít na sekci Import hráčů"
                >
                  Import hráčů
                </button>
                <button 
                  type="button" 
                  className="admin-button admin-button--secondary" 
                  onClick={() => navigateAdminSection('judges')}
                  aria-label="Přejít na sekci Přiřadit rozhodčí"
                >
                  Přiřadit rozhodčí
                </button>
              </div>
            </section>
          ) : null}

          {activeSection === 'event' ? (
            <section className="admin-card">
              <h2>Event</h2>
              <div className="deskovky-admin-grid">
                <label className="admin-field">
                  <span>Název</span>
                  <input value={eventName} onChange={(eventTarget) => setEventName(eventTarget.target.value)} />
                </label>
                <label className="admin-field">
                  <span>Slug</span>
                  <input value={eventSlug} onChange={(eventTarget) => setEventSlug(eventTarget.target.value)} />
                </label>
                <label className="admin-field">
                  <span>Začátek</span>
                  <input
                    type="date"
                    value={eventStartDate}
                    onChange={(eventTarget) => setEventStartDate(eventTarget.target.value)}
                  />
                </label>
                <label className="admin-field">
                  <span>Konec</span>
                  <input
                    type="date"
                    value={eventEndDate}
                    onChange={(eventTarget) => setEventEndDate(eventTarget.target.value)}
                  />
                </label>
              </div>
              <div className="admin-card-actions">
                <button type="button" className="admin-button admin-button--secondary" onClick={() => void handleCreateEvent()}>
                  Vytvořit event
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--primary"
                  onClick={() => void handleUpdateEvent()}
                  disabled={!selectedEventId}
                >
                  Uložit event
                </button>
              </div>
            </section>
          ) : null}

          {activeSection === 'categories' ? (
            <section className="admin-card">
              <h2>Kategorie</h2>
              <div className="deskovky-admin-grid">
                <label className="admin-field">
                  <span>Název kategorie</span>
                  <input
                    value={newCategoryName}
                    onChange={(eventTarget) => setNewCategoryName(eventTarget.target.value)}
                    placeholder="Např. Kategorie I + II"
                  />
                </label>
                <label className="admin-field">
                  <span>Hlavní hra (tie-break)</span>
                  <select
                    value={newCategoryPrimaryGameId}
                    onChange={(eventTarget) => setNewCategoryPrimaryGameId(eventTarget.target.value)}
                    disabled={!games.length}
                  >
                    <option value="">Bez nastavení</option>
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {game.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="admin-card-actions">
                <button type="button" className="admin-button admin-button--primary" onClick={() => void handleCreateCategory()}>
                  Přidat kategorii
                </button>
              </div>
              <div className="deskovky-table-wrap">
                <table className="deskovky-table">
                  <thead>
                    <tr>
                      <th>Kategorie</th>
                      <th>Hlavní hra</th>
                      <th>Akce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((category) => (
                      <tr key={category.id}>
                        <td>{category.name}</td>
                        <td>
                          <select
                            value={category.primary_game_id ?? ''}
                            onChange={(eventTarget) =>
                              void handleSetCategoryPrimaryGame(category.id, eventTarget.target.value)
                            }
                          >
                            <option value="">Bez nastavení</option>
                            {games.map((game) => (
                              <option key={game.id} value={game.id}>
                                {game.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <button type="button" className="ghost" onClick={() => void handleDeleteCategory(category.id)}>
                            Smazat
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {activeSection === 'games' ? (
            <section className="admin-card">
              <h2>Hry</h2>
              <div className="deskovky-admin-grid">
                <label className="admin-field">
                  <span>Název hry</span>
                  <input value={newGameName} onChange={(eventTarget) => setNewGameName(eventTarget.target.value)} />
                </label>
                <label className="admin-field">
                  <span>Typ bodování</span>
                  <select
                    value={newGameScoringType}
                    onChange={(eventTarget) => setNewGameScoringType(eventTarget.target.value as BoardScoringType)}
                  >
                    <option value="points">points</option>
                    <option value="placement">placement</option>
                    <option value="both">both</option>
                  </select>
                </label>
                <label className="admin-field">
                  <span>Směr bodů</span>
                  <select
                    value={newGamePointsOrder}
                    onChange={(eventTarget) => setNewGamePointsOrder(eventTarget.target.value as BoardPointsOrder)}
                    disabled={newGameScoringType === 'placement'}
                  >
                    <option value="desc">Vyšší body = lepší</option>
                    <option value="asc">Nižší body = lepší</option>
                  </select>
                </label>
                <label className="deskovky-checkbox">
                  <input
                    type="checkbox"
                    checked={newGameThreePlayerAdjustment}
                    onChange={(eventTarget) => setNewGameThreePlayerAdjustment(eventTarget.target.checked)}
                  />
                  <span>Zapnout 3‑hráčovou úpravu (0.75 bodů + 1/2.5/4 pořadí)</span>
                </label>
                <label className="admin-field deskovky-field-full">
                  <span>Poznámka</span>
                  <input value={newGameNotes} onChange={(eventTarget) => setNewGameNotes(eventTarget.target.value)} />
                </label>
              </div>
              <p className="admin-card-subtitle">
                Zobrazeno {filteredGames.length} z {games.length} her.
              </p>
              {isMobile ? (
                <div className="deskovky-admin-mobile-list">
                  {filteredGames.map((game) => (
                    <article key={game.id} className="deskovky-admin-mobile-card">
                      <h3>{game.name}</h3>
                      <p className="deskovky-admin-mobile-meta">
                        {game.scoring_type} · {game.points_order === 'asc' ? 'nižší body lepší' : 'vyšší body lepší'}
                      </p>
                      <p className="deskovky-admin-mobile-meta">
                        3P úprava: <strong>{game.three_player_adjustment ? 'Zapnuto' : 'Vypnuto'}</strong>
                      </p>
                      {game.notes ? <p className="deskovky-admin-mobile-note">{game.notes}</p> : null}
                      <div className="deskovky-admin-mobile-card-actions">
                        <button type="button" className="ghost" onClick={() => void handleDeleteGame(game.id)}>
                          Smazat
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="deskovky-table-wrap">
                  <table className="deskovky-table">
                    <thead>
                      <tr>
                        <th>Hra</th>
                        <th>Typ bodování</th>
                        <th>Směr bodů</th>
                        <th>3P úprava</th>
                        <th>Poznámka</th>
                        <th>Akce</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGames.map((game) => (
                        <tr key={game.id}>
                          <td>{game.name}</td>
                          <td>{game.scoring_type}</td>
                          <td>{game.points_order === 'asc' ? 'nižší body lepší' : 'vyšší body lepší'}</td>
                          <td>{game.three_player_adjustment ? 'Ano' : 'Ne'}</td>
                          <td>{game.notes || '—'}</td>
                          <td>
                            <button type="button" className="ghost" onClick={() => void handleDeleteGame(game.id)}>
                              Smazat
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {activeSection === 'blocks' ? (
            <section className="admin-card">
              <h2>Bloky</h2>
              <div className="deskovky-admin-grid">
                <label className="admin-field">
                  <span>Kategorie</span>
                  <select value={newBlockCategoryId} onChange={(eventTarget) => setNewBlockCategoryId(eventTarget.target.value)}>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Hra</span>
                  <select value={newBlockGameId} onChange={(eventTarget) => setNewBlockGameId(eventTarget.target.value)}>
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {game.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Číslo bloku</span>
                  <input
                    type="number"
                    min={1}
                    value={newBlockNumber}
                    onChange={(eventTarget) => setNewBlockNumber(eventTarget.target.value)}
                  />
                </label>
              </div>
              <div className="admin-card-actions">
                <button type="button" className="admin-button admin-button--primary" onClick={() => void handleCreateBlock()}>
                  Přidat blok
                </button>
              </div>

              {isMobile ? (
                <div className="deskovky-admin-mobile-list">
                  {blocks.map((block) => (
                    <article key={block.id} className="deskovky-admin-mobile-card">
                      <h3>Blok {block.block_number}</h3>
                      <p className="deskovky-admin-mobile-meta">
                        Kategorie: <strong>{categoryMap.get(block.category_id)?.name ?? block.category_id}</strong>
                      </p>
                      <p className="deskovky-admin-mobile-meta">
                        Hra: <strong>{gameMap.get(block.game_id)?.name ?? block.game_id}</strong>
                      </p>
                      <div className="deskovky-admin-mobile-card-actions">
                        <button type="button" className="ghost" onClick={() => void handleDeleteBlock(block.id)}>
                          Smazat
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="deskovky-table-wrap">
                  <table className="deskovky-table">
                    <thead>
                      <tr>
                        <th>Blok</th>
                        <th>Kategorie</th>
                        <th>Hra</th>
                        <th>Akce</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blocks.map((block) => (
                        <tr key={block.id}>
                          <td>{block.block_number}</td>
                          <td>{categoryMap.get(block.category_id)?.name ?? block.category_id}</td>
                          <td>{gameMap.get(block.game_id)?.name ?? block.game_id}</td>
                          <td>
                            <button type="button" className="ghost" onClick={() => void handleDeleteBlock(block.id)}>
                              Smazat
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {activeSection === 'players' ? (
            <section className="admin-card">
              <h2>Hráči</h2>
              <p className="admin-card-subtitle">Správa hráčů načtených v aktivním eventu.</p>
              {isMobile ? (
                <div className="deskovky-admin-mobile-list">
                  {pagedPlayers.map((player) => (
                    <article key={player.id} className="deskovky-admin-mobile-card">
                      <h3>{player.display_name || player.team_name || player.short_code}</h3>
                      <p className="deskovky-admin-mobile-meta">
                        Kód: <strong>{player.short_code}</strong>
                      </p>
                      <p className="deskovky-admin-mobile-meta">
                        Kategorie: <strong>{categoryMap.get(player.category_id)?.name ?? player.category_id}</strong>
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="deskovky-table-wrap">
                  <table className="deskovky-table">
                    <thead>
                      <tr>
                        <th>Kód</th>
                        <th>Jméno / tým</th>
                        <th>Kategorie</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedPlayers.map((player) => (
                        <tr key={player.id}>
                          <td>{player.short_code}</td>
                          <td>{player.display_name || player.team_name || '—'}</td>
                          <td>{categoryMap.get(player.category_id)?.name ?? player.category_id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="deskovky-admin-pagination">
                <p className="deskovky-admin-pagination-status">
                  Zobrazeno {pagedPlayers.length} z {filteredPlayers.length} hráčů (strana {safePlayerPage}/{playerTotalPages}).
                </p>
                <div className="admin-card-actions">
                  <button
                    type="button"
                    className="admin-button admin-button--secondary"
                    onClick={() => setPlayerPage((current) => Math.max(1, current - 1))}
                    disabled={safePlayerPage <= 1}
                    aria-label={`Předchozí strana hráčů (strana ${Math.max(1, safePlayerPage - 1)})`}
                  >
                    Předchozí
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button--secondary"
                    onClick={() => setPlayerPage((current) => Math.min(playerTotalPages, current + 1))}
                    disabled={safePlayerPage >= playerTotalPages}
                    aria-label={`Další strana hráčů (strana ${Math.min(playerTotalPages, safePlayerPage + 1)})`}
                  >
                    Další
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {activeSection === 'judges' ? (
            <section className="admin-card">
              <h2>Přiřazení rozhodčích</h2>
              <div className="deskovky-admin-grid">
                {judges.length ? (
                  <label className="admin-field">
                    <span>Rozhodčí</span>
                    <select
                      value={newAssignmentUserId}
                      onChange={(eventTarget) => setNewAssignmentUserId(eventTarget.target.value)}
                    >
                      <option value="">Vyber rozhodčího</option>
                      {judges.map((judge) => (
                        <option key={judge.id} value={judge.id}>
                          {judge.display_name} ({judge.email})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="admin-field">
                    <span>User ID rozhodčího (UUID)</span>
                    <input
                      value={newAssignmentUserId}
                      onChange={(eventTarget) => setNewAssignmentUserId(eventTarget.target.value)}
                      placeholder="uuid"
                    />
                  </label>
                )}

                <label className="admin-field">
                  <span>Hra</span>
                  <select value={newAssignmentGameId} onChange={(eventTarget) => setNewAssignmentGameId(eventTarget.target.value)}>
                    <option value="">Vyber hru</option>
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {game.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-field">
                  <span>Kategorie (volitelné)</span>
                  <select
                    value={newAssignmentCategoryId}
                    onChange={(eventTarget) => setNewAssignmentCategoryId(eventTarget.target.value)}
                  >
                    <option value="">Všechny</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p className="admin-card-subtitle">
                Zobrazeno {filteredAssignments.length} z {assignments.length} přiřazení.
              </p>

              {isMobile ? (
                <div className="deskovky-admin-mobile-list">
                  {filteredAssignments.map((assignment) => {
                    const judge = judgesMap.get(assignment.user_id);
                    return (
                      <article key={assignment.id} className="deskovky-admin-mobile-card">
                        <h3>{judge ? judge.display_name : assignment.user_id}</h3>
                        <p className="deskovky-admin-mobile-meta">{judge ? judge.email : 'Bez e-mailu v seznamu'}</p>
                        <p className="deskovky-admin-mobile-meta">
                          Hra: <strong>{gameMap.get(assignment.game_id)?.name ?? assignment.game_id}</strong>
                        </p>
                        <p className="deskovky-admin-mobile-meta">
                          Kategorie:{' '}
                          <strong>
                            {assignment.category_id
                              ? categoryMap.get(assignment.category_id)?.name ?? assignment.category_id
                              : 'Všechny'}
                          </strong>
                        </p>
                        <div className="deskovky-admin-mobile-card-actions">
                          <button type="button" className="ghost" onClick={() => void handleDeleteAssignment(assignment.id)}>
                            Smazat
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="deskovky-table-wrap">
                  <table className="deskovky-table">
                    <thead>
                      <tr>
                        <th>Rozhodčí</th>
                        <th>Hra</th>
                        <th>Kategorie</th>
                        <th>Akce</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAssignments.map((assignment) => {
                        const judge = judgesMap.get(assignment.user_id);
                        return (
                          <tr key={assignment.id}>
                            <td>{judge ? `${judge.display_name} (${judge.email})` : assignment.user_id}</td>
                            <td>{gameMap.get(assignment.game_id)?.name ?? assignment.game_id}</td>
                            <td>
                              {assignment.category_id
                                ? categoryMap.get(assignment.category_id)?.name ?? assignment.category_id
                                : 'Všechny'}
                            </td>
                            <td>
                              <button type="button" className="ghost" onClick={() => void handleDeleteAssignment(assignment.id)}>
                                Smazat
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {activeSection === 'import-export' ? (
            <section className="admin-card">
              <h2>Import / export hráčů</h2>
              <p className="admin-card-subtitle">CSV hlavička: short_code,team_name,display_name,category</p>
              <label className="admin-field deskovky-field-full">
                <span>CSV import</span>
                <textarea value={csvInput} onChange={(eventTarget) => setCsvInput(eventTarget.target.value)} rows={8} />
              </label>
              <label className="deskovky-checkbox">
                <input
                  type="checkbox"
                  checked={autoGenerateCodes}
                  onChange={(eventTarget) => setAutoGenerateCodes(eventTarget.target.checked)}
                />
                <span>Automaticky generovat short_code, pokud chybí</span>
              </label>
              <div className="admin-card-actions">
                <button type="button" className="admin-button admin-button--primary" onClick={() => void handleImportPlayers()}>
                  Importovat CSV
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={() => void handleExportBadges()}
                >
                  Export visaček (CSV)
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function DeskovkyDashboard({
  auth,
  logout,
}: {
  auth: AuthenticatedState;
  logout: () => Promise<void>;
}) {
  const isMobile = useIsMobileBreakpoint(640);
  const [page, setPage] = useState<DeskovkyPage>(() => resolvePage(window.location.pathname));
  const [context, setContext] = useState<BoardJudgeContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const judgeId = auth.manifest.judge.id;
  const isAdmin = (auth.manifest.station.code || '').trim().toUpperCase() === 'T';

  const navigate = useCallback((nextPage: DeskovkyPage, options?: { replace?: boolean }) => {
    const nextPath = buildCanonicalPath(nextPage);
    if (options?.replace) {
      window.history.replaceState(window.history.state, '', nextPath);
    } else {
      window.history.pushState(window.history.state, '', nextPath);
    }
    setPage(nextPage);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setPage(resolvePage(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const loaded = await loadJudgeContext(judgeId);
        if (cancelled) return;

        setContext(loaded);
        if (loaded.events.length > 0) {
          setSelectedEventId((current) => current ?? loaded.events[0].id);
        } else {
          setSelectedEventId(null);
        }
      } catch (loadError) {
        console.error('Failed to load deskovky context', loadError);
        if (!cancelled) {
          setError('Nepodařilo se načíst přiřazení Deskovek.');
          setContext(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [judgeId]);

  const pageTitle = useMemo(() => {
    switch (page) {
      case 'new-match':
        return 'Nový zápas';
      case 'standings':
        return 'Průběžné pořadí';
      case 'rules':
        return 'Pravidla';
      case 'admin':
        return 'Administrace';
      default:
        return 'Rozhodčí panel';
    }
  }, [page]);

  if (loading) {
    return <LoadingState />;
  }

  if (error || !context) {
    return <ErrorState message={error ?? 'Nepodařilo se načíst data.'} />;
  }

  return (
    <div className="admin-shell deskovky-shell">
      <header className="admin-header">
        <div className="admin-header-inner">
          <div>
            <h1>Deskové hry</h1>
            <p className="admin-subtitle">{pageTitle}</p>
          </div>
          <div className="admin-header-actions">
            <button
              type="button"
              className="admin-button admin-button--secondary admin-button--pill"
              onClick={() => logout()}
              aria-label="Odhlásit se"
            >
              Odhlásit se
            </button>
          </div>
        </div>
      </header>

      <main className="admin-content">
        <section className="admin-card deskovky-nav-card">
          <div className="deskovky-nav-grid" role="tablist" aria-label="Sekce Deskovek">
            <button
              type="button"
              className={`admin-button ${page === 'home' ? 'admin-button--primary' : 'admin-button--secondary'}`}
              onClick={() => navigate('home')}
              aria-label="Přejít na Přehled"
            >
              Přehled
            </button>
            <button
              type="button"
              className={`admin-button ${page === 'new-match' ? 'admin-button--primary' : 'admin-button--secondary'}`}
              onClick={() => navigate('new-match')}
              aria-label="Přejít na Nový zápas"
            >
              Nový zápas
            </button>
            <button
              type="button"
              className={`admin-button ${page === 'standings' ? 'admin-button--primary' : 'admin-button--secondary'}`}
              onClick={() => navigate('standings')}
              aria-label="Přejít na Pořadí"
            >
              Pořadí
            </button>
            <button
              type="button"
              className={`admin-button ${page === 'rules' ? 'admin-button--primary' : 'admin-button--secondary'}`}
              onClick={() => navigate('rules')}
              aria-label="Přejít na Pravidla"
            >
              Pravidla
            </button>
            {isAdmin ? (
              <button
                type="button"
                className={`admin-button ${page === 'admin' ? 'admin-button--primary' : 'admin-button--secondary'}`}
                onClick={() => navigate('admin')}
                aria-label="Přejít na administraci"
              >
                Admin
              </button>
            ) : null}
          </div>
        </section>

        {page === 'home' ? (
          <JudgeHomePage
            judgeId={judgeId}
            context={context}
            selectedEventId={selectedEventId}
            onSelectEventId={setSelectedEventId}
            onNavigate={navigate}
          />
        ) : null}

        {page === 'new-match' ? (
          <NewMatchPage
            judgeId={judgeId}
            context={context}
            selectedEventId={selectedEventId}
            onSelectEventId={setSelectedEventId}
            isMobile={isMobile}
          />
        ) : null}

        {page === 'standings' ? (
          <StandingsPage
            context={context}
            selectedEventId={selectedEventId}
            onSelectEventId={setSelectedEventId}
            isMobile={isMobile}
          />
        ) : null}

        {page === 'rules' ? <RulesPage /> : null}

        {page === 'admin' ? (
          isAdmin ? (
            <AdminPage selectedEventId={selectedEventId} onSelectEventId={setSelectedEventId} isMobile={isMobile} />
          ) : (
            <section className="admin-card">
              <h2>Přístup zamítnut</h2>
              <p className="admin-card-subtitle">
                Administrace Deskovek je dostupná pouze pro kancelář (stanoviště T).
              </p>
            </section>
          )
        ) : null}
      </main>

      <AppFooter variant="minimal" />
    </div>
  );
}

function DeskovkyApp() {
  const { status, logout } = useAuth();

  if (status.state === 'loading') {
    return <LoadingState />;
  }

  if (status.state === 'error') {
    return <ErrorState message={status.message || 'Zkontroluj připojení a zkus to znovu.'} />;
  }

  if (status.state === 'unauthenticated') {
    return <LoginScreen variant="deskovky" />;
  }

  if (status.state === 'password-change-required') {
    return (
      <ChangePasswordScreen
        email={status.email}
        judgeId={status.judgeId}
        pendingPin={status.pendingPin}
        variant="deskovky"
      />
    );
  }

  if (status.state === 'locked') {
    return <LoginScreen requirePinOnly variant="deskovky" />;
  }

  if (status.state === 'authenticated') {
    return <DeskovkyDashboard auth={status} logout={logout} />;
  }

  return null;
}

export default DeskovkyApp;
