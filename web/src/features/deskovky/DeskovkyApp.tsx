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
  BoardMatchPlayer,
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
  | 'draw'
  | 'disqualify'
  | 'assignments'
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
  { key: 'draw', hash: 'losovani', label: 'Losování' },
  { key: 'disqualify', hash: 'diskvalifikace', label: 'Diskvalifikace' },
  { key: 'assignments', hash: 'stoly', label: 'Rozhodčí a stoly' },
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

function readErrorText(error: unknown, key: 'code' | 'message' | 'details'): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function boardEventMutationErrorMessage(error: unknown, fallback: string): string {
  const code = readErrorText(error, 'code');
  const message = readErrorText(error, 'message').toLowerCase();
  const details = readErrorText(error, 'details').toLowerCase();
  const isDuplicate = code === '23505'
    || message.includes('duplicate key')
    || details.includes('already exists');

  if (isDuplicate) {
    return 'Slug eventu už existuje. Zvol jiný slug.';
  }
  return fallback;
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

function resolveAllowedPage(page: DeskovkyPage, isAdmin: boolean): DeskovkyPage {
  if (!isAdmin) {
    if (page === 'admin' || page === 'standings') {
      return 'home';
    }
    return page;
  }
  if (page === 'home' || page === 'new-match') {
    return 'admin';
  }
  return page;
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

function buildPlacementsFromPoints(
  entries: Array<{ id: string; seat: number; points: string }>,
  pointsOrder: BoardPointsOrder,
): Map<string, number> {
  const scored = entries
    .map((entry) => ({
      id: entry.id,
      seat: entry.seat,
      points: parseNumeric(entry.points),
    }))
    .filter((entry): entry is { id: string; seat: number; points: number } => entry.points !== null)
    .sort((a, b) => {
      if (a.points === b.points) {
        return a.seat - b.seat;
      }
      return pointsOrder === 'asc' ? a.points - b.points : b.points - a.points;
    });

  const placements = new Map<string, number>();
  let index = 0;

  while (index < scored.length) {
    const start = index;
    const tiedPoints = scored[index].points;
    while (index + 1 < scored.length && scored[index + 1].points === tiedPoints) {
      index += 1;
    }

    const end = index;
    const averageRank = ((start + 1) + (end + 1)) / 2;
    for (let i = start; i <= end; i += 1) {
      placements.set(scored[i].id, averageRank);
    }

    index += 1;
  }

  return placements;
}

function resolvePlacementForSave({
  scoringType,
  parsedPoints,
  parsedPlacement,
  autoPlacement,
}: {
  scoringType: BoardScoringType;
  parsedPoints: number | null;
  parsedPlacement: number | null;
  autoPlacement: number | null;
}): number | null {
  if (scoringType === 'placement') {
    return parsedPlacement;
  }
  if (scoringType === 'both') {
    if (parsedPlacement !== null) {
      return parsedPlacement;
    }
    if (parsedPoints !== null) {
      return autoPlacement;
    }
    return null;
  }
  return null;
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

async function loadJudgeContext(
  judgeId: string,
  options?: {
    includeAllEvents?: boolean;
  },
): Promise<BoardJudgeContext> {
  const { data: assignmentsData, error: assignmentsError } = await supabase
    .from('board_judge_assignment')
    .select('id, event_id, user_id, game_id, category_id, table_number, created_at')
    .eq('user_id', judgeId)
    .order('created_at', { ascending: false });

  if (assignmentsError) {
    throw assignmentsError;
  }

  const assignments = ((assignmentsData ?? []) as BoardJudgeAssignment[]).map((assignment) => ({
    ...assignment,
    category_id: assignment.category_id ?? null,
    table_number: assignment.table_number ?? null,
  }));

  const eventIds = unique(assignments.map((assignment) => assignment.event_id));
  const gameIds = unique(assignments.map((assignment) => assignment.game_id));
  const categoryIds = unique(
    assignments
      .map((assignment) => assignment.category_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );

  const loadAllEvents = options?.includeAllEvents === true;

  const [eventsRes, gamesRes, categoriesRes] = await Promise.all([
    loadAllEvents
      ? supabase
        .from('board_event')
        .select('id, slug, name, start_date, end_date, created_at')
        .order('start_date', { ascending: false, nullsFirst: false })
      : eventIds.length
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

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function assignmentMatchesBlockAndTable(
  assignment: BoardJudgeAssignment,
  block: BoardBlock,
  tableNumber: number | null | undefined,
): boolean {
  if (assignment.game_id !== block.game_id) {
    return false;
  }
  if (assignment.category_id && assignment.category_id !== block.category_id) {
    return false;
  }
  if (assignment.table_number === null || assignment.table_number === undefined) {
    return true;
  }
  if (tableNumber === null || tableNumber === undefined) {
    return false;
  }
  return assignment.table_number === tableNumber;
}

type DrawTable = {
  tableNumber: number;
  playerIds: string[];
};

type DrawRound = {
  roundNumber: number;
  tables: DrawTable[];
};

type DrawBlockPlan = {
  block: BoardBlock;
  rounds: DrawRound[];
  usedRelaxedSameTeamRule?: boolean;
};

type OpponentCounts = Map<string, Map<string, number>>;
type DrawAttempt = { groups: BoardPlayer[][]; penalty: number };
const BOARD_DRAW_MAX_TABLES_PER_GAME = 25;
const BOARD_DRAW_MAX_PLAYERS_PER_BLOCK = BOARD_DRAW_MAX_TABLES_PER_GAME * 4;

function getTeamKey(teamName: string | null | undefined): string {
  const raw = (teamName ?? '').trim();
  if (!raw) {
    return '';
  }
  const numberMatch = raw.match(/(?:^|\s)(\d{1,3})\s*\./);
  if (numberMatch?.[1]) {
    return `pto-${numberMatch[1]}`;
  }
  return slugify(raw);
}

function getOpponentCount(opponents: OpponentCounts, playerA: string, playerB: string): number {
  return opponents.get(playerA)?.get(playerB) ?? 0;
}

function addOpponentPair(opponents: OpponentCounts, playerA: string, playerB: string) {
  if (!opponents.has(playerA)) {
    opponents.set(playerA, new Map<string, number>());
  }
  const row = opponents.get(playerA)!;
  row.set(playerB, (row.get(playerB) ?? 0) + 1);
}

function addRoundOpponents(opponents: OpponentCounts, playerIds: string[]) {
  for (let i = 0; i < playerIds.length; i += 1) {
    for (let j = i + 1; j < playerIds.length; j += 1) {
      addOpponentPair(opponents, playerIds[i], playerIds[j]);
      addOpponentPair(opponents, playerIds[j], playerIds[i]);
    }
  }
}

function buildRoundTableSizes(playerCount: number): number[] {
  if (playerCount <= 0) {
    return [];
  }
  if (playerCount <= 4) {
    return [playerCount];
  }
  const tables = Math.min(BOARD_DRAW_MAX_TABLES_PER_GAME, Math.ceil(playerCount / 4));
  const base = Math.floor(playerCount / tables);
  const remainder = playerCount % tables;
  const sizes = Array.from({ length: tables }, (_, index) => base + (index < remainder ? 1 : 0));
  return sizes.sort((a, b) => b - a);
}

function pairPenalty(
  playerA: BoardPlayer,
  playerB: BoardPlayer,
  categoryOpponents: OpponentCounts,
  blockOpponents: OpponentCounts,
): number {
  const sameTeamKey = getTeamKey(playerA.team_name);
  const sameTeam = Boolean(sameTeamKey) && sameTeamKey === getTeamKey(playerB.team_name);
  const blockMeetings = getOpponentCount(blockOpponents, playerA.id, playerB.id);
  const categoryMeetings = getOpponentCount(categoryOpponents, playerA.id, playerB.id);

  return (sameTeam ? 240 : 0) + blockMeetings * 120 + categoryMeetings * 45;
}

function isSameTeam(playerA: BoardPlayer, playerB: BoardPlayer): boolean {
  const teamA = getTeamKey(playerA.team_name);
  return Boolean(teamA) && teamA === getTeamKey(playerB.team_name);
}

function canAddCandidateToGroup(
  candidate: BoardPlayer,
  group: BoardPlayer[],
  blockOpponents: OpponentCounts,
  blockSameTeamCounts: Map<string, number>,
  maxSameTeamOpponentsPerBlock: number | null,
): boolean {
  if (maxSameTeamOpponentsPerBlock === null) {
    return true;
  }

  const candidateCurrentCount = blockSameTeamCounts.get(candidate.id) ?? 0;
  let candidateAdditionalCount = 0;

  for (const current of group) {
    if (!isSameTeam(candidate, current)) {
      continue;
    }

    // The same team-vs-team pair should not repeat in one game block.
    if (getOpponentCount(blockOpponents, candidate.id, current.id) >= 1) {
      return false;
    }

    const currentCount = blockSameTeamCounts.get(current.id) ?? 0;
    if (currentCount + 1 > maxSameTeamOpponentsPerBlock) {
      return false;
    }

    candidateAdditionalCount += 1;
  }

  if (candidateCurrentCount + candidateAdditionalCount > maxSameTeamOpponentsPerBlock) {
    return false;
  }

  return true;
}

function chooseGroupSeed(
  availablePlayers: BoardPlayer[],
  allPlayers: BoardPlayer[],
): BoardPlayer {
  if (availablePlayers.length <= 1) {
    return availablePlayers[0];
  }
  const byDifficulty = [...availablePlayers].sort((a, b) => {
    const aTeam = getTeamKey(a.team_name);
    const bTeam = getTeamKey(b.team_name);
    const aConflicts = aTeam ? allPlayers.filter((player) => getTeamKey(player.team_name) === aTeam).length : 0;
    const bConflicts = bTeam ? allPlayers.filter((player) => getTeamKey(player.team_name) === bTeam).length : 0;
    if (aConflicts !== bConflicts) {
      return bConflicts - aConflicts;
    }
    return a.short_code.localeCompare(b.short_code, 'cs');
  });
  return byDifficulty[0];
}

function evaluateRoundPenalty(
  groups: BoardPlayer[][],
  categoryOpponents: OpponentCounts,
  blockOpponents: OpponentCounts,
  threePlayerCounts: Map<string, number>,
  trioHistory: Set<string>,
): number {
  let penalty = 0;

  for (const group of groups) {
    if (group.length === 3) {
      const trioKey = group
        .map((player) => player.id)
        .sort()
        .join('|');
      if (trioHistory.has(trioKey)) {
        penalty += 220;
      }
      for (const player of group) {
        penalty += (threePlayerCounts.get(player.id) ?? 0) * 30;
      }
    }

    if (group.length === 2) {
      penalty += 90;
    }

    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        penalty += pairPenalty(group[i], group[j], categoryOpponents, blockOpponents);
      }
    }
  }

  return penalty;
}

function buildRoundAttempt(
  players: BoardPlayer[],
  tableSizes: number[],
  categoryOpponents: OpponentCounts,
  blockOpponents: OpponentCounts,
  blockSameTeamCounts: Map<string, number>,
  threePlayerCounts: Map<string, number>,
  trioHistory: Set<string>,
  maxSameTeamOpponentsPerBlock: number | null,
): DrawAttempt | null {
  const available = [...players];
  const groups: BoardPlayer[][] = [];

  for (const targetSize of tableSizes) {
    if (!available.length) {
      break;
    }
    const seed = chooseGroupSeed(available, players);
    const group: BoardPlayer[] = [seed];
    available.splice(available.findIndex((player) => player.id === seed.id), 1);

    while (group.length < targetSize && available.length) {
      const candidatePool = available.filter((player) =>
        canAddCandidateToGroup(
          player,
          group,
          blockOpponents,
          blockSameTeamCounts,
          maxSameTeamOpponentsPerBlock,
        ),
      );
      if (!candidatePool.length) {
        return null;
      }
      let bestIndex = 0;
      let bestPenalty = Number.POSITIVE_INFINITY;

      for (let index = 0; index < candidatePool.length; index += 1) {
        const candidate = candidatePool[index];
        const candidatePenalty = group.reduce(
          (sum, current) => sum + pairPenalty(candidate, current, categoryOpponents, blockOpponents),
          0,
        );
        const threePlayerPenalty = targetSize === 3 ? (threePlayerCounts.get(candidate.id) ?? 0) * 25 : 0;
        const score = candidatePenalty + threePlayerPenalty + Math.random() * 0.01;
        if (score < bestPenalty) {
          bestPenalty = score;
          bestIndex = available.findIndex((player) => player.id === candidate.id);
        }
      }

      group.push(available[bestIndex]);
      available.splice(bestIndex, 1);
    }

    groups.push(group);
  }

  if (available.length) {
    groups[groups.length - 1].push(...available);
  }

  return {
    groups,
    penalty: evaluateRoundPenalty(groups, categoryOpponents, blockOpponents, threePlayerCounts, trioHistory),
  };
}

function findBestRoundAttempt(
  players: BoardPlayer[],
  tableSizes: number[],
  categoryOpponents: OpponentCounts,
  blockOpponents: OpponentCounts,
  blockSameTeamCounts: Map<string, number>,
  threePlayerCounts: Map<string, number>,
  trioHistory: Set<string>,
  maxSameTeamOpponentsPerBlock: number | null,
): DrawAttempt | null {
  // Keep draw quality while preventing long UI freezes in large categories.
  const attempts = Math.min(220, Math.max(60, Math.round(players.length * 2.4)));
  const noImprovementLimit = 64;
  let best: DrawAttempt | null = null;
  let noImprovementCount = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = buildRoundAttempt(
      players,
      tableSizes,
      categoryOpponents,
      blockOpponents,
      blockSameTeamCounts,
      threePlayerCounts,
      trioHistory,
      maxSameTeamOpponentsPerBlock,
    );
    if (!candidate) {
      noImprovementCount += 1;
      continue;
    }
    if (!best || candidate.penalty < best.penalty) {
      best = candidate;
      noImprovementCount = 0;
      if (candidate.penalty <= 0) {
        break;
      }
      continue;
    }

    noImprovementCount += 1;
    if (best && noImprovementCount >= noImprovementLimit) {
      break;
    }
  }

  return best;
}

function generateRoundGroups(
  players: BoardPlayer[],
  tableSizes: number[],
  categoryOpponents: OpponentCounts,
  blockOpponents: OpponentCounts,
  blockSameTeamCounts: Map<string, number>,
  threePlayerCounts: Map<string, number>,
  trioHistory: Set<string>,
): { groups: BoardPlayer[][]; usedRelaxedSameTeamRule: boolean } {
  const strict = findBestRoundAttempt(
    players,
    tableSizes,
    categoryOpponents,
    blockOpponents,
    blockSameTeamCounts,
    threePlayerCounts,
    trioHistory,
    0,
  );
  if (strict) {
    return {
      groups: strict.groups,
      usedRelaxedSameTeamRule: false,
    };
  }

  const relaxed = findBestRoundAttempt(
    players,
    tableSizes,
    categoryOpponents,
    blockOpponents,
    blockSameTeamCounts,
    threePlayerCounts,
    trioHistory,
    1,
  );
  if (relaxed) {
    return {
      groups: relaxed.groups,
      usedRelaxedSameTeamRule: true,
    };
  }

  const unrestricted = findBestRoundAttempt(
    players,
    tableSizes,
    categoryOpponents,
    blockOpponents,
    blockSameTeamCounts,
    threePlayerCounts,
    trioHistory,
    null,
  );
  if (unrestricted) {
    return {
      groups: unrestricted.groups,
      usedRelaxedSameTeamRule: true,
    };
  }

  const sorted = [...players].sort((a, b) => a.short_code.localeCompare(b.short_code, 'cs'));
  const fallback: BoardPlayer[][] = [];
  let cursor = 0;
  for (const size of tableSizes) {
    fallback.push(sorted.slice(cursor, cursor + size));
    cursor += size;
  }
  return {
    groups: fallback,
    usedRelaxedSameTeamRule: true,
  };
}

function planCategoryDraw(categoryPlayers: BoardPlayer[], categoryBlocks: BoardBlock[]): DrawBlockPlan[] {
  const activePlayers = categoryPlayers.filter((player) => !player.disqualified);
  if (activePlayers.length < 2 || !categoryBlocks.length) {
    return [];
  }

  const tableSizes = buildRoundTableSizes(activePlayers.length);
  const categoryOpponents: OpponentCounts = new Map();
  const threePlayerCounts = new Map<string, number>();
  const trioHistory = new Set<string>();

  return categoryBlocks
    .sort((a, b) => a.block_number - b.block_number)
    .map<DrawBlockPlan>((block) => {
      const blockOpponents: OpponentCounts = new Map();
      const blockSameTeamCounts = new Map<string, number>();
      const rounds: DrawRound[] = [];
      let usedRelaxedSameTeamRule = false;

      for (let roundNumber = 1; roundNumber <= 3; roundNumber += 1) {
        const generated = generateRoundGroups(
          activePlayers,
          tableSizes,
          categoryOpponents,
          blockOpponents,
          blockSameTeamCounts,
          threePlayerCounts,
          trioHistory,
        );
        const groups = generated.groups;
        usedRelaxedSameTeamRule = usedRelaxedSameTeamRule || generated.usedRelaxedSameTeamRule;

        rounds.push({
          roundNumber,
          tables: groups.map((group, index) => ({
            tableNumber: index + 1,
            playerIds: group.map((player) => player.id),
          })),
        });

        for (const group of groups) {
          const ids = group.map((player) => player.id);
          addRoundOpponents(categoryOpponents, ids);
          addRoundOpponents(blockOpponents, ids);
          for (let i = 0; i < group.length; i += 1) {
            for (let j = i + 1; j < group.length; j += 1) {
              if (!isSameTeam(group[i], group[j])) {
                continue;
              }
              blockSameTeamCounts.set(group[i].id, (blockSameTeamCounts.get(group[i].id) ?? 0) + 1);
              blockSameTeamCounts.set(group[j].id, (blockSameTeamCounts.get(group[j].id) ?? 0) + 1);
            }
          }
          if (group.length === 3) {
            const trioKey = ids.slice().sort().join('|');
            trioHistory.add(trioKey);
            for (const playerId of ids) {
              threePlayerCounts.set(playerId, (threePlayerCounts.get(playerId) ?? 0) + 1);
            }
          }
        }
      }

      return {
        block,
        rounds,
        usedRelaxedSameTeamRule,
      };
    });
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
}: {
  judgeId: string;
  context: BoardJudgeContext;
  selectedEventId: string | null;
}) {
  const [matchProgress, setMatchProgress] = useState<{ completed: number; total: number } | null>(null);
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
      setMatchProgress(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      const [setup, matchesRes] = await Promise.all([
        loadEventSetup(selectedEventId),
        supabase
          .from('board_match')
          .select('id, event_id, category_id, block_id, round_number, table_number, created_by, created_at, status')
          .eq('event_id', selectedEventId)
          .neq('status', 'void'),
      ]);

      if (cancelled) {
        return;
      }

      setLoading(false);
      if (matchesRes.error) {
        console.error('Failed to load board match progress', matchesRes.error);
        setMatchProgress(null);
        return;
      }

      const blocks = setup.blocks ?? [];
      const games = setup.games ?? [];
      const blockMap = new Map(blocks.map((block) => [block.id, block]));
      const gameMap = new Map(games.map((game) => [game.id, game]));

      const eventAssignments = context.assignments.filter(
        (assignment) => assignment.event_id === selectedEventId && assignment.user_id === judgeId,
      );

      const assignedMatches = ((matchesRes.data ?? []) as BoardMatch[]).filter((match) => {
        const block = blockMap.get(match.block_id);
        if (!block) {
          return false;
        }
        return eventAssignments.some((assignment) =>
          assignmentMatchesBlockAndTable(assignment, block, match.table_number),
        );
      });

      const total = assignedMatches.length;
      if (!total) {
        setMatchProgress({ completed: 0, total: 0 });
        return;
      }

      const matchIds = assignedMatches.map((match) => match.id);
      const { data: rowsData, error: rowsError } = await supabase
        .from('board_match_player')
        .select('match_id, points, placement')
        .in('match_id', matchIds);

      if (cancelled) {
        return;
      }

      if (rowsError) {
        console.error('Failed to load board match rows for progress', rowsError);
        setMatchProgress(null);
        return;
      }

      const rowsByMatch = new Map<string, Array<{ points: number | null; placement: number | null }>>();
      for (const row of (rowsData ?? []) as Array<{ match_id: string; points: number | null; placement: number | null }>) {
        const list = rowsByMatch.get(row.match_id) ?? [];
        list.push({ points: row.points, placement: row.placement });
        rowsByMatch.set(row.match_id, list);
      }

      let completed = 0;
      for (const match of assignedMatches) {
        const block = blockMap.get(match.block_id);
        if (!block) {
          continue;
        }
        const game = gameMap.get(block.game_id);
        const scoringType = game?.scoring_type ?? 'both';
        const rows = rowsByMatch.get(match.id) ?? [];
        if (!rows.length) {
          continue;
        }

        const isMatchComplete = rows.every((row) => {
          const hasPoints = row.points !== null;
          const hasPlacement = row.placement !== null;
          if (scoringType === 'points') {
            return hasPoints;
          }
          if (scoringType === 'placement') {
            return hasPlacement;
          }
          return hasPoints || hasPlacement;
        });

        if (isMatchComplete) {
          completed += 1;
        }
      }

      setMatchProgress({ completed, total });
    })();

    return () => {
      cancelled = true;
    };
  }, [context.assignments, judgeId, selectedEventId]);

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
      <section className="admin-card">
        <header className="admin-card-header">
          <div>
            <h2>Moje přiřazení</h2>
            <p className="admin-card-subtitle">
              {event ? `Event: ${event.name}` : 'Není vybraný event.'}
            </p>
          </div>
          <div className="deskovky-kpi">
            <span>Hotovo / přiřazeno</span>
            <strong>{loading ? '…' : matchProgress ? `${matchProgress.completed}/${matchProgress.total}` : '—'}</strong>
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
                  <p>
                    Stůl: <strong>{assignment.table_number ?? '—'}</strong>
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
        .select('id, event_id, short_code, team_name, display_name, category_id, disqualified, created_at')
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
      .select('id, event_id, category_id, block_id, round_number, table_number, created_by, created_at, status')
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
                        className={`deskovky-slot-status ${entry.player ? 'deskovky-slot-status--loaded' : 'deskovky-slot-status--missing'
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
            <p className="deskovky-mobile-submit-note" title={mobileSubmitHelperText ?? undefined}>
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

function AssignedTableMatchesPage({
  judgeId,
  context,
  selectedEventId,
  isMobile,
}: {
  judgeId: string;
  context: BoardJudgeContext;
  selectedEventId: string | null;
  isMobile: boolean;
}) {
  const [setup, setSetup] = useState<EventSetup | null>(null);
  const [players, setPlayers] = useState<BoardPlayer[]>([]);
  const [matches, setMatches] = useState<BoardMatch[]>([]);
  const [matchPlayers, setMatchPlayers] = useState<BoardMatchPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedStationKey, setSelectedStationKey] = useState('');
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [entries, setEntries] = useState<Array<{ id: string; seat: number; playerId: string; points: string; placement: string }>>([]);

  const eventAssignments = useMemo(
    () =>
      context.assignments.filter(
        (assignment) => assignment.event_id === selectedEventId && assignment.user_id === judgeId,
      ),
    [context.assignments, judgeId, selectedEventId],
  );

  useEffect(() => {
    if (!selectedEventId) {
      setSetup(null);
      setPlayers([]);
      setMatches([]);
      setMatchPlayers([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);

    void (async () => {
      try {
        const loadedSetup = await loadEventSetup(selectedEventId);
        const { data: playersData, error: playersError } = await supabase
          .from('board_player')
          .select('id, event_id, short_code, team_name, display_name, category_id, disqualified, created_at')
          .eq('event_id', selectedEventId);
        if (playersError) {
          throw playersError;
        }

        const { data: matchesData, error: matchesError } = await supabase
          .from('board_match')
          .select('id, event_id, category_id, block_id, round_number, table_number, created_by, created_at, status')
          .eq('event_id', selectedEventId)
          .eq('created_by', judgeId)
          .neq('status', 'void')
          .order('block_id', { ascending: true })
          .order('round_number', { ascending: true })
          .order('table_number', { ascending: true });
        if (matchesError) {
          throw matchesError;
        }

        const loadedMatches = (matchesData ?? []) as BoardMatch[];
        const matchIds = loadedMatches.map((match) => match.id);

        let loadedMatchPlayers: BoardMatchPlayer[] = [];
        if (matchIds.length > 0) {
          const { data: rowsData, error: rowsError } = await supabase
            .from('board_match_player')
            .select('id, match_id, player_id, seat, placement, points, created_at')
            .in('match_id', matchIds)
            .order('seat', { ascending: true });
          if (rowsError) {
            throw rowsError;
          }
          loadedMatchPlayers = (rowsData ?? []) as BoardMatchPlayer[];
        }

        if (cancelled) {
          return;
        }

        setSetup(loadedSetup);
        setPlayers((playersData ?? []) as BoardPlayer[]);
        setMatches(loadedMatches);
        setMatchPlayers(loadedMatchPlayers);
      } catch (loadError) {
        console.error('Failed to load assigned board matches', loadError);
        if (!cancelled) {
          setError('Nepodařilo se načíst rozpis partií.');
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
  }, [judgeId, selectedEventId]);

  const categories = setup?.categories ?? [];
  const games = setup?.games ?? [];
  const blocks = setup?.blocks ?? [];

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const gameMap = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const blockMap = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);
  const playerMap = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);

  const filteredMatchGroups = useMemo(() => {
    const grouped = new Map<string, BoardMatch[]>();
    const mismatched: BoardMatch[] = [];

    for (const match of matches) {
      const block = blockMap.get(match.block_id);
      if (!block) {
        continue;
      }

      const isAssigned = eventAssignments.some((assignment) =>
        assignmentMatchesBlockAndTable(assignment, block, match.table_number),
      );

      if (!isAssigned) {
        mismatched.push(match);
        continue;
      }

      const key = `${match.block_id}|${match.table_number ?? 0}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(match);
      grouped.set(key, bucket);
    }

    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => (a.round_number ?? 0) - (b.round_number ?? 0));
    }

    return { grouped, mismatched };
  }, [blockMap, eventAssignments, matches]);

  const stationMatches = filteredMatchGroups.grouped;
  const mismatchedMatches = filteredMatchGroups.mismatched;

  const stationOptions = useMemo(
    () =>
      Array.from(stationMatches.entries())
        .map(([key, stationRows]) => {
          const firstMatch = stationRows[0];
          const block = blockMap.get(firstMatch.block_id);
          const category = block ? categoryMap.get(block.category_id) : null;
          const game = block ? gameMap.get(block.game_id) : null;
          return {
            key,
            blockNumber: block?.block_number ?? Number.MAX_SAFE_INTEGER,
            tableNumber: firstMatch.table_number ?? Number.MAX_SAFE_INTEGER,
            label: `${category?.name ?? firstMatch.category_id} · blok ${block?.block_number ?? '—'} · ${game?.name ?? 'Hra'} · stůl ${firstMatch.table_number ?? '—'}`,
          };
        })
        .sort(
          (a, b) =>
            a.blockNumber - b.blockNumber
            || a.tableNumber - b.tableNumber
            || a.label.localeCompare(b.label, 'cs'),
        )
        .map(({ key, label }) => ({ key, label })),
    [blockMap, categoryMap, gameMap, stationMatches],
  );

  const mismatchedStationLabels = useMemo(
    () =>
      unique(
        mismatchedMatches.map((match) => {
          const block = blockMap.get(match.block_id);
          const category = block ? categoryMap.get(block.category_id) : null;
          const game = block ? gameMap.get(block.game_id) : null;
          return `${category?.name ?? match.category_id} · blok ${block?.block_number ?? '—'} · ${game?.name ?? 'Hra'} · stůl ${match.table_number ?? '—'}`;
        }),
      ),
    [blockMap, categoryMap, gameMap, mismatchedMatches],
  );
  useEffect(() => {
    if (!stationOptions.length) {
      setSelectedStationKey('');
      return;
    }
    if (!selectedStationKey || !stationOptions.some((option) => option.key === selectedStationKey)) {
      setSelectedStationKey(stationOptions[0].key);
    }
  }, [selectedStationKey, stationOptions]);

  const selectedStationMatches = selectedStationKey ? stationMatches.get(selectedStationKey) ?? [] : [];
  const availableRounds = useMemo(
    () =>
      selectedStationMatches
        .map((match) => match.round_number ?? 0)
        .filter((round) => round > 0)
        .sort((a, b) => a - b),
    [selectedStationMatches],
  );

  useEffect(() => {
    if (!availableRounds.length) {
      setSelectedRound(null);
      return;
    }
    if (!selectedRound || !availableRounds.includes(selectedRound)) {
      setSelectedRound(availableRounds[0]);
    }
  }, [availableRounds, selectedRound]);

  const selectedMatch = useMemo(() => {
    if (!selectedRound) {
      return null;
    }
    return selectedStationMatches.find((match) => match.round_number === selectedRound) ?? null;
  }, [selectedRound, selectedStationMatches]);

  useEffect(() => {
    if (!selectedMatch) {
      setEntries([]);
      return;
    }
    const rows = matchPlayers
      .filter((row) => row.match_id === selectedMatch.id)
      .sort((a, b) => a.seat - b.seat)
      .map((row) => ({
        id: row.id,
        seat: row.seat,
        playerId: row.player_id,
        points: row.points === null ? '' : String(row.points),
        placement: row.placement === null ? '' : String(row.placement),
      }));
    setEntries(rows);
  }, [matchPlayers, selectedMatch]);

  const selectedBlock = selectedMatch ? blockMap.get(selectedMatch.block_id) ?? null : null;
  const selectedGame = selectedBlock ? gameMap.get(selectedBlock.game_id) ?? null : null;
  const selectedCategory = selectedBlock ? categoryMap.get(selectedBlock.category_id) ?? null : null;

  const scoringType = selectedGame?.scoring_type ?? 'both';
  const pointsOrder = selectedGame?.points_order ?? 'desc';
  const scoringInputs = getScoringInputs(scoringType);
  const placementsFromPoints = useMemo(
    () => buildPlacementsFromPoints(entries, pointsOrder),
    [entries, pointsOrder],
  );
  const gameKey = useMemo(
    () => slugify(selectedGame?.name ?? ''),
    [selectedGame?.name],
  );
  const gameRequiresManualTieBreak = gameKey === 'dobble' || gameKey === 'hop' || gameKey === 'ubongo';
  const hasTiedPoints = useMemo(() => {
    const frequencies = new Map<number, number>();
    for (const entry of entries) {
      const points = parseNumeric(entry.points);
      if (points === null) {
        continue;
      }
      frequencies.set(points, (frequencies.get(points) ?? 0) + 1);
    }
    return Array.from(frequencies.values()).some((count) => count > 1);
  }, [entries]);

  const validationError = useMemo(() => {
    if (!entries.length) {
      return 'Partie nemá načtené hráče.';
    }
    for (const entry of entries) {
      const points = parseNumeric(entry.points);
      const placement = parseNumeric(entry.placement);
      if (scoringType === 'points' && points === null) {
        return `Doplň body pro slot ${entry.seat}.`;
      }
      if (scoringType === 'placement' && placement === null) {
        return `Doplň umístění pro slot ${entry.seat}.`;
      }
      if (scoringType === 'both' && points === null) {
        return `Doplň body pro slot ${entry.seat}.`;
      }
    }
    return null;
  }, [entries, scoringType]);

  const handleChangeEntry = useCallback((rowId: string, field: 'points' | 'placement', value: string) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === rowId
          ? {
            ...entry,
            [field]: value,
          }
          : entry,
      ),
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedMatch) {
      setError('Vyber partii.');
      return;
    }
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      for (const entry of entries) {
        const parsedPoints = parseNumeric(entry.points);
        const parsedPlacement = parseNumeric(entry.placement);
        const autoPlacement = placementsFromPoints.get(entry.id) ?? null;

        const { error: updateError } = await supabase
          .from('board_match_player')
          .update({
            points: parsedPoints,
            placement: resolvePlacementForSave({
              scoringType,
              parsedPoints,
              parsedPlacement,
              autoPlacement,
            }),
          })
          .eq('id', entry.id);
        if (updateError) {
          throw updateError;
        }
      }

      setMatchPlayers((current) =>
        current.map((row) => {
          const updated = entries.find((entry) => entry.id === row.id);
          if (!updated) {
            return row;
          }
          const parsedPoints = parseNumeric(updated.points);
          const parsedPlacement = parseNumeric(updated.placement);
          const autoPlacement = placementsFromPoints.get(updated.id) ?? null;
          return {
            ...row,
            points: parsedPoints,
            placement: resolvePlacementForSave({
              scoringType,
              parsedPoints,
              parsedPlacement,
              autoPlacement,
            }),
          };
        }),
      );
      setMessage('Výsledky partie byly uloženy.');
    } catch (saveError) {
      console.error('Failed to save board match results', saveError);
      setError('Nepodařilo se uložit výsledky partie.');
    } finally {
      setSaving(false);
    }
  }, [entries, placementsFromPoints, scoringType, selectedMatch, validationError]);

  const event = useMemo(
    () => context.events.find((item) => item.id === selectedEventId) ?? null,
    [context.events, selectedEventId],
  );

  if (!selectedEventId) {
    return (
      <section className="admin-card">
        <h2>Partie u stolu</h2>
        <p className="admin-card-subtitle">K tomuto účtu zatím není přiřazený žádný event.</p>
      </section>
    );
  }

  return (
    <section className="admin-card">
      <header className="admin-card-header">
        <div>
          <h2>Partie u stolu</h2>
          <p className="admin-card-subtitle">{event?.name ?? 'Event'} · vyber blok/stůl a kolo.</p>
        </div>
      </header>

      {loading ? <p className="admin-card-subtitle">Načítám partie…</p> : null}
      {error ? <p className="admin-error">{error}</p> : null}
      {message ? <p className="admin-success">{message}</p> : null}

      {!loading && stationOptions.length ? (
        <>
          <div className="deskovky-admin-grid">
            <label className="admin-field">
              <span>Blok / hra / stůl</span>
              <select value={selectedStationKey} onChange={(eventTarget) => setSelectedStationKey(eventTarget.target.value)}>
                {stationOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Kolo</span>
              <div className="admin-card-actions deskovky-round-buttons">
                {availableRounds.map((round) => (
                  <button
                    key={round}
                    type="button"
                    className={`admin-button ${selectedRound === round ? 'admin-button--primary' : 'admin-button--secondary'}`}
                    onClick={() => setSelectedRound(round)}
                  >
                    {round}. partie
                  </button>
                ))}
              </div>
            </label>
          </div>

          {selectedMatch ? (
            <>
              <p className="admin-card-subtitle">
                Kategorie: <strong>{selectedCategory?.name ?? selectedMatch.category_id}</strong> · hra:{' '}
                <strong>{selectedGame?.name ?? selectedBlock?.game_id ?? '—'}</strong> · blok{' '}
                <strong>{selectedBlock?.block_number ?? '—'}</strong> · stůl{' '}
                <strong>{selectedMatch.table_number ?? '—'}</strong>
              </p>
              {scoringType !== 'placement' ? (
                <p className="admin-card-subtitle">
                  Pořadí se dopočítává automaticky z bodů ({pointsOrder === 'asc' ? 'nižší body jsou lepší' : 'vyšší body jsou lepší'}).
                </p>
              ) : null}
              {scoringType === 'both' && gameRequiresManualTieBreak && hasTiedPoints ? (
                <p className="admin-card-subtitle">
                  U této hry je při shodě bodů potřeba pořadí ručně upravit podle pravidel partie.
                </p>
              ) : null}

              {isMobile ? (
                <div className="deskovky-match-mobile-list">
                  {entries.map((entry) => {
                    const player = playerMap.get(entry.playerId);
                    return (
                      <article key={entry.id} className="deskovky-admin-mobile-card deskovky-match-mobile-card">
                        <h3>
                          Slot {entry.seat}: {player?.display_name || player?.short_code || entry.playerId}
                        </h3>
                        <p className="deskovky-admin-mobile-meta">
                          Oddíl: <strong>{player?.team_name ?? '—'}</strong>
                        </p>
                        <p className="deskovky-admin-mobile-meta">
                          Kód: <strong>{player?.short_code ?? '—'}</strong>
                        </p>
                        <div className="deskovky-match-mobile-inputs">
                          {scoringInputs.showPoints ? (
                            <label className="admin-field">
                              <span>Body</span>
                              <input
                                type="number"
                                step="0.5"
                                value={entry.points}
                                onChange={(eventTarget) => handleChangeEntry(entry.id, 'points', eventTarget.target.value)}
                              />
                            </label>
                          ) : null}
                          {scoringInputs.showPlacement ? (
                            <label className="admin-field">
                              <span>Pořadí</span>
                              {scoringType === 'placement' ? (
                                <input
                                  type="number"
                                  step="0.5"
                                  min={1}
                                  value={entry.placement}
                                  onChange={(eventTarget) => handleChangeEntry(entry.id, 'placement', eventTarget.target.value)}
                                />
                              ) : (
                                <input
                                  type="number"
                                  step="0.5"
                                  min={1}
                                  value={entry.placement !== '' ? entry.placement : (placementsFromPoints.get(entry.id) ?? '')}
                                  onChange={(eventTarget) => handleChangeEntry(entry.id, 'placement', eventTarget.target.value)}
                                  placeholder="auto"
                                  aria-label={`Pořadí pro slot ${entry.seat}`}
                                />
                              )}
                            </label>
                          ) : null}
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
                        <th>Slot</th>
                        <th>Hráč</th>
                        <th>Oddíl</th>
                        <th>Kód</th>
                        {scoringInputs.showPoints ? <th>Body</th> : null}
                        {scoringInputs.showPlacement ? <th>Pořadí</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => {
                        const player = playerMap.get(entry.playerId);
                        return (
                          <tr key={entry.id}>
                            <td>{entry.seat}</td>
                            <td>{player?.display_name || player?.short_code || entry.playerId}</td>
                            <td>{player?.team_name ?? '—'}</td>
                            <td>{player?.short_code ?? '—'}</td>
                            {scoringInputs.showPoints ? (
                              <td>
                                <input
                                  type="number"
                                  step="0.5"
                                  value={entry.points}
                                  onChange={(eventTarget) => handleChangeEntry(entry.id, 'points', eventTarget.target.value)}
                                />
                              </td>
                            ) : null}
                            {scoringInputs.showPlacement ? (
                              <td>
                                {scoringType === 'placement' ? (
                                  <input
                                    type="number"
                                    step="0.5"
                                    min={1}
                                    value={entry.placement}
                                    onChange={(eventTarget) => handleChangeEntry(entry.id, 'placement', eventTarget.target.value)}
                                  />
                                ) : (
                                  <input
                                    type="number"
                                    step="0.5"
                                    min={1}
                                    value={
                                      entry.placement !== ''
                                        ? entry.placement
                                        : (placementsFromPoints.get(entry.id) ?? '')
                                    }
                                    onChange={(eventTarget) => handleChangeEntry(entry.id, 'placement', eventTarget.target.value)}
                                    placeholder="auto"
                                    aria-label={`Pořadí pro slot ${entry.seat}`}
                                  />
                                )}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="admin-card-actions admin-card-actions--end">
                <button type="button" className="admin-button admin-button--primary" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? 'Ukládám…' : 'Uložit výsledky partie'}
                </button>
              </div>
            </>
          ) : (
            <p className="admin-card-subtitle">Pro vybrané kolo není dostupná partie.</p>
          )}
        </>
      ) : null}

      {!loading && !stationOptions.length ? (
        <>
          <p className="admin-card-subtitle">
            Nemáš přiřazené žádné vylosované partie. Požádej administrátora o losování a přiřazení stolu.
          </p>
          {mismatchedStationLabels.length ? (
            <p className="admin-error">
              Pozor: jsou nalezené partie s tvým účtem, ale mimo tvoje přiřazené stoly/kategorie (
              {mismatchedStationLabels.slice(0, 3).join('; ')}
              {mismatchedStationLabels.length > 3 ? '…' : ''}). Zkontroluj přiřazení stolu a spusť losování znovu.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
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
  const [playedMatchesByGamePlayer, setPlayedMatchesByGamePlayer] = useState<Record<string, number>>({});
  const [totalMatchesByGame, setTotalMatchesByGame] = useState<Record<string, number>>({});
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
  const blockGameMap = useMemo(
    () => new Map((setup?.blocks ?? []).map((block) => [block.id, block.game_id])),
    [setup?.blocks],
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
      setPlayedMatchesByGamePlayer({});
      setTotalMatchesByGame({});
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      const [gameRes, overallRes, playerRes, matchRes] = await Promise.all([
        supabase
          .from('board_game_standings')
          .select('event_id, category_id, game_id, player_id, matches_played, total_points, avg_placement, best_placement, placement_sum, game_rank')
          .eq('event_id', selectedEventId)
          .eq('category_id', selectedCategoryId)
          .order('game_id', { ascending: true }),
        supabase
          .from('board_overall_standings')
          .select('event_id, category_id, player_id, primary_game_id, games_counted, overall_score, game_breakdown, overall_rank')
          .eq('event_id', selectedEventId)
          .eq('category_id', selectedCategoryId)
          .order('overall_rank', { ascending: true }),
        supabase
          .from('board_player')
          .select('id, event_id, short_code, team_name, display_name, category_id, disqualified, created_at')
          .eq('event_id', selectedEventId)
          .eq('category_id', selectedCategoryId)
          .order('short_code', { ascending: true }),
        supabase
          .from('board_match')
          .select('id, block_id, round_number, status')
          .eq('event_id', selectedEventId)
          .eq('category_id', selectedCategoryId)
          .neq('status', 'void'),
      ]);

      if (cancelled) {
        return;
      }

      setLoading(false);

      if (gameRes.error || overallRes.error || playerRes.error || matchRes.error) {
        console.error('Failed to load standings', gameRes.error, overallRes.error, playerRes.error, matchRes.error);
        setError('Nepodařilo se načíst průběžné pořadí.');
        setPlayedMatchesByGamePlayer({});
        setTotalMatchesByGame({});
        return;
      }

      const matches = (matchRes.data ?? []) as Array<Pick<BoardMatch, 'id' | 'block_id' | 'round_number' | 'status'>>;
      const roundsByGame = new Map<string, Set<number>>();
      const matchMetaById = new Map<string, { gameId: string; scoringType: BoardScoringType }>();
      for (const match of matches) {
        const gameId = blockGameMap.get(match.block_id);
        if (!gameId) {
          continue;
        }
        const game = gameMap.get(gameId);
        if (!game) {
          continue;
        }
        matchMetaById.set(match.id, { gameId, scoringType: game.scoring_type });
        if (typeof match.round_number === 'number') {
          const currentRounds = roundsByGame.get(gameId) ?? new Set<number>();
          currentRounds.add(match.round_number);
          roundsByGame.set(gameId, currentRounds);
        }
      }

      const totalByGame: Record<string, number> = {};
      roundsByGame.forEach((rounds, gameId) => {
        totalByGame[gameId] = rounds.size;
      });

      const playedByGamePlayer: Record<string, number> = {};
      if (matchMetaById.size) {
        const { data: matchPlayerData, error: matchPlayerError } = await supabase
          .from('board_match_player')
          .select('match_id, player_id, points, placement')
          .in('match_id', Array.from(matchMetaById.keys()));

        if (cancelled) {
          return;
        }

        if (matchPlayerError) {
          console.error('Failed to load match rows for standings', matchPlayerError);
          setError('Nepodařilo se načíst průběžné pořadí.');
          setPlayedMatchesByGamePlayer({});
          setTotalMatchesByGame({});
          return;
        }

        for (const row of (matchPlayerData ?? []) as Array<{
          match_id: string;
          player_id: string;
          points: number | null;
          placement: number | null;
        }>) {
          const matchMeta = matchMetaById.get(row.match_id);
          if (!matchMeta) {
            continue;
          }

          const hasPoints = row.points !== null;
          const hasPlacement = row.placement !== null;
          const isCompleted = matchMeta.scoringType === 'points'
            ? hasPoints
            : matchMeta.scoringType === 'placement'
              ? hasPlacement
              : hasPoints || hasPlacement;

          if (!isCompleted) {
            continue;
          }

          const key = `${matchMeta.gameId}:${row.player_id}`;
          playedByGamePlayer[key] = (playedByGamePlayer[key] ?? 0) + 1;
        }
      }

      setGameStandings((gameRes.data ?? []) as BoardGameStanding[]);
      setOverallStandings((overallRes.data ?? []) as BoardOverallStanding[]);
      setPlayers((playerRes.data ?? []) as BoardPlayer[]);
      setPlayedMatchesByGamePlayer(playedByGamePlayer);
      setTotalMatchesByGame(totalByGame);
    })();

    return () => {
      cancelled = true;
    };
  }, [blockGameMap, gameMap, selectedCategoryId, selectedEventId]);

  const perGame = useMemo(() => {
    const grouped = new Map<string, BoardGameStanding[]>();
    gameStandings.forEach((standing) => {
      const current = grouped.get(standing.game_id) ?? [];
      current.push(standing);
      grouped.set(standing.game_id, current);
    });

    const toPlacementSum = (row: BoardGameStanding): number => {
      if (row.placement_sum !== null) {
        return Number(row.placement_sum);
      }
      if (row.avg_placement !== null) {
        return Number(row.avg_placement) * Number(row.matches_played);
      }
      return Number.POSITIVE_INFINITY;
    };

    grouped.forEach((rows, gameId) => {
      const game = gameMap.get(gameId);
      const pointsOrder = game?.points_order ?? 'desc';
      rows.sort((left, right) => {
        const leftPlacementSum = toPlacementSum(left);
        const rightPlacementSum = toPlacementSum(right);
        if (leftPlacementSum !== rightPlacementSum) {
          return leftPlacementSum - rightPlacementSum;
        }

        const leftPoints = left.total_points;
        const rightPoints = right.total_points;
        if (leftPoints !== null && rightPoints !== null && leftPoints !== rightPoints) {
          return pointsOrder === 'asc' ? leftPoints - rightPoints : rightPoints - leftPoints;
        }
        if (leftPoints === null && rightPoints !== null) {
          return 1;
        }
        if (leftPoints !== null && rightPoints === null) {
          return -1;
        }

        const leftPlayer = playerMap.get(left.player_id);
        const rightPlayer = playerMap.get(right.player_id);
        const leftLabel = leftPlayer?.display_name || leftPlayer?.team_name || left.player_id;
        const rightLabel = rightPlayer?.display_name || rightPlayer?.team_name || right.player_id;
        return leftLabel.localeCompare(rightLabel, 'cs');
      });
    });

    return grouped;
  }, [gameMap, gameStandings, playerMap]);

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
      <section className="admin-card deskovky-toolbar deskovky-toolbar--sticky-mobile deskovky-toolbar--standings">
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
            {isMobile ? (
              <div className="deskovky-standings-cards">
                {standings.map((row, index) => {
                  const player = playerMap.get(row.player_id);
                  const label = player?.display_name || player?.team_name || row.player_id;
                  const placementSum = row.placement_sum !== null
                    ? Number(row.placement_sum)
                    : row.avg_placement !== null
                      ? Number(row.avg_placement) * Number(row.matches_played)
                      : null;
                  const playedMatches = playedMatchesByGamePlayer[`${gameId}:${row.player_id}`] ?? 0;
                  const totalMatches = totalMatchesByGame[gameId] ?? row.matches_played;
                  return (
                    <article key={`${gameId}-${row.player_id}`} className="deskovky-standings-card">
                      <h3>
                        {index + 1}. {label}
                      </h3>
                      <p>
                        <strong>Součet pořadí:</strong> {placementSum ?? '—'}
                      </p>
                      <p>
                        <strong>Odehráno:</strong> {playedMatches}/{totalMatches}
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
                      <th>Součet pořadí</th>
                      <th>Počet partií</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((row, index) => {
                      const player = playerMap.get(row.player_id);
                      const label = player?.display_name || player?.team_name || row.player_id;
                      const placementSum = row.placement_sum !== null
                        ? Number(row.placement_sum)
                        : row.avg_placement !== null
                          ? Number(row.avg_placement) * Number(row.matches_played)
                          : null;
                      const playedMatches = playedMatchesByGamePlayer[`${gameId}:${row.player_id}`] ?? 0;
                      const totalMatches = totalMatchesByGame[gameId] ?? row.matches_played;
                      return (
                        <tr key={`${gameId}-${row.player_id}`}>
                          <td>{index + 1}</td>
                          <td>{label}</td>
                          <td>{player?.short_code ?? '—'}</td>
                          <td>{row.total_points ?? '—'}</td>
                          <td>{placementSum ?? '—'}</td>
                          <td>{playedMatches}/{totalMatches}</td>
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

function RulesLinks({ className = 'deskovky-rules-links' }: { className?: string }) {
  return (
    <div className={className}>
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
  const [newAssignmentTableNumber, setNewAssignmentTableNumber] = useState('1');

  const [playerSearch, setPlayerSearch] = useState('');
  const [playerCategoryFilter, setPlayerCategoryFilter] = useState('');
  const [selectedDisqualifyPlayerId, setSelectedDisqualifyPlayerId] = useState('');
  const [playerPage, setPlayerPage] = useState(1);
  const [playerPageSize, setPlayerPageSize] = useState(50);
  const [gameSearch, setGameSearch] = useState('');
  const [gameScoringFilter, setGameScoringFilter] = useState<'all' | BoardScoringType>('all');
  const [assignmentJudgeFilter, setAssignmentJudgeFilter] = useState('');
  const [assignmentGameFilter, setAssignmentGameFilter] = useState('');
  const [drawSummary, setDrawSummary] = useState<string | null>(null);
  const [drawRunning, setDrawRunning] = useState(false);
  const [drawProgress, setDrawProgress] = useState<{ label: string; current: number; total: number } | null>(null);

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
        .select('id, event_id, short_code, team_name, display_name, category_id, disqualified, created_at')
        .eq('event_id', selectedEventId)
        .order('short_code', { ascending: true }),
      supabase
        .from('board_judge_assignment')
        .select('id, event_id, user_id, game_id, category_id, table_number, created_at')
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
    setAssignments(
      ((assignmentRes.data ?? []) as BoardJudgeAssignment[]).map((assignment) => ({
        ...assignment,
        category_id: assignment.category_id ?? null,
        table_number: assignment.table_number ?? null,
      })),
    );
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

    const duplicateEvent = events.find((event) => event.slug === slug);
    if (duplicateEvent) {
      setError(`Slug „${slug}“ už používá event „${duplicateEvent.name}“.`);
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
      setError(boardEventMutationErrorMessage(createError, 'Vytvoření eventu selhalo.'));
      return;
    }

    const next = data as BoardEvent;
    setEvents((current) => [next, ...current]);
    onSelectEventId(next.id);
    setMessage('Event byl vytvořen.');
  }, [eventEndDate, eventName, eventSlug, eventStartDate, events, onSelectEventId]);

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

    const duplicateEvent = events.find((event) => event.id !== selectedEventId && event.slug === slug);
    if (duplicateEvent) {
      setError(`Slug „${slug}“ už používá event „${duplicateEvent.name}“.`);
      return;
    }

    setError(null);
    setMessage(null);

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
      setError(boardEventMutationErrorMessage(updateError, 'Uložení eventu selhalo.'));
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
  }, [eventEndDate, eventName, eventSlug, eventStartDate, events, selectedEventId]);

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
    const tableNumber = Number(newAssignmentTableNumber);
    if (!userId || !newAssignmentGameId || !newAssignmentCategoryId) {
      setError('Vyber rozhodčího, hru i kategorii.');
      return;
    }
    if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
      setError('Číslo stolu musí být kladné celé číslo.');
      return;
    }

    const { data, error: createError } = await supabase
      .from('board_judge_assignment')
      .insert({
        event_id: selectedEventId,
        user_id: userId,
        game_id: newAssignmentGameId,
        category_id: newAssignmentCategoryId,
        table_number: tableNumber,
      })
      .select('id, event_id, user_id, game_id, category_id, table_number, created_at')
      .single();

    if (createError || !data) {
      console.error('Failed to create assignment', createError);
      setError('Vytvoření přiřazení selhalo.');
      return;
    }

    setAssignments((current) => [data as BoardJudgeAssignment, ...current]);
    setNewAssignmentCategoryId('');
    setNewAssignmentGameId('');
    setNewAssignmentUserId('');
    setNewAssignmentTableNumber('1');
    setMessage('Přiřazení bylo vytvořeno.');
  }, [newAssignmentCategoryId, newAssignmentGameId, newAssignmentTableNumber, newAssignmentUserId, selectedEventId]);

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

  const handleSetPlayerDisqualified = useCallback(async (playerId: string, disqualified: boolean) => {
    const { error: updateError } = await supabase
      .from('board_player')
      .update({ disqualified })
      .eq('id', playerId);

    if (updateError) {
      console.error('Failed to update board player disqualification', updateError);
      setError('Nepodařilo se uložit diskvalifikaci hráče.');
      return;
    }

    setPlayers((current) =>
      current.map((player) =>
        player.id === playerId
          ? {
            ...player,
            disqualified,
          }
          : player,
      ),
    );
    setMessage(disqualified ? 'Hráč byl diskvalifikován.' : 'Diskvalifikace hráče byla zrušena.');
  }, []);

  const handleGenerateDraw = useCallback(async (mode: 'strict' | 'test' = 'strict') => {
    if (!selectedEventId) {
      setError('Vyber event.');
      return;
    }

    const isTestMode = mode === 'test';
    const confirmed = window.confirm(
      isTestMode
        ? 'Test losování: chybějící stoly se doplní podle dostupných rozhodčích v DB. Pokračovat?'
        : 'Tímto smažeš dosavadní partie deskovek v tomto eventu a vylosuješ nové. Pokračovat?',
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    setMessage(null);
    setDrawSummary(null);
    setDrawProgress({ label: 'Příprava losování…', current: 0, total: 1 });
    setDrawRunning(true);
    await yieldToBrowser();

    try {
      const playersByCategory = new Map<string, BoardPlayer[]>();
      for (const player of players) {
        const list = playersByCategory.get(player.category_id) ?? [];
        list.push(player);
        playersByCategory.set(player.category_id, list);
      }

      const blocksByCategory = new Map<string, BoardBlock[]>();
      for (const block of blocks) {
        const list = blocksByCategory.get(block.category_id) ?? [];
        list.push(block);
        blocksByCategory.set(block.category_id, list);
      }

      const orderedAssignments = assignments
        .filter((assignment) => assignment.event_id === selectedEventId)
        .sort((left, right) => left.created_at.localeCompare(right.created_at));
      const assignmentByKey = new Map<string, BoardJudgeAssignment>();
      const fallbackPoolsByKey = new Map<string, BoardJudgeAssignment[]>();
      const fallbackRotationByKey = new Map<string, number>();

      const pushFallbackPool = (key: string, assignment: BoardJudgeAssignment) => {
        const list = fallbackPoolsByKey.get(key) ?? [];
        list.push(assignment);
        fallbackPoolsByKey.set(key, list);
      };

      const takeFallbackAssignment = (key: string): BoardJudgeAssignment | null => {
        const list = fallbackPoolsByKey.get(key);
        if (!list?.length) {
          return null;
        }
        const index = fallbackRotationByKey.get(key) ?? 0;
        const assignment = list[index % list.length];
        fallbackRotationByKey.set(key, index + 1);
        return assignment;
      };

      const resolveFallbackAssignment = (gameId: string, categoryId: string): BoardJudgeAssignment | null =>
        takeFallbackAssignment(`${gameId}|${categoryId}`)
        ?? takeFallbackAssignment(`${gameId}|*`)
        ?? takeFallbackAssignment(`*|*`);

      for (const assignment of orderedAssignments) {
        pushFallbackPool(`*|*`, assignment);
        pushFallbackPool(`${assignment.game_id}|*`, assignment);
        if (assignment.category_id) {
          pushFallbackPool(`${assignment.game_id}|${assignment.category_id}`, assignment);
        }
        if (!assignment.table_number) {
          continue;
        }
        if (assignment.category_id) {
          assignmentByKey.set(
            `${assignment.event_id}|${assignment.game_id}|${assignment.category_id}|${assignment.table_number}`,
            assignment,
          );
        } else {
          assignmentByKey.set(
            `${assignment.event_id}|${assignment.game_id}|*|${assignment.table_number}`,
            assignment,
          );
        }
      }

      const missingAssignments: string[] = [];
      const relaxedSameTeamBlocks: string[] = [];
      const fallbackJudgeIds = new Set<string>();
      let fallbackAssignmentsUsed = 0;
      const plannedRows: Array<{
        match: Omit<BoardMatch, 'id' | 'created_at' | 'status'>;
        players: string[];
      }> = [];
      const oversizedCategories = categories
        .map((category) => {
          const activePlayers = (playersByCategory.get(category.id) ?? []).filter((player) => !player.disqualified).length;
          return {
            name: category.name,
            activePlayers,
          };
        })
        .filter((item) => item.activePlayers > BOARD_DRAW_MAX_PLAYERS_PER_BLOCK);

      if (oversizedCategories.length) {
        const first = oversizedCategories[0];
        setError(
          `Kategorie ${first.name} má ${first.activePlayers} aktivních hráčů. Pro jednu deskovku je limit ${BOARD_DRAW_MAX_TABLES_PER_GAME} stolů (${BOARD_DRAW_MAX_PLAYERS_PER_BLOCK} hráčů po 4).`,
        );
        return;
      }

      const categoryTotal = Math.max(1, categories.length);
      for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
        const category = categories[categoryIndex];
        setDrawProgress({
          label: `Losuji kategorie… (${categoryIndex + 1}/${categoryTotal})`,
          current: categoryIndex + 1,
          total: categoryTotal,
        });
        await yieldToBrowser();

        const categoryPlayers = playersByCategory.get(category.id) ?? [];
        const categoryBlocks = blocksByCategory.get(category.id) ?? [];
        const blockPlans = planCategoryDraw(categoryPlayers, categoryBlocks);

        for (const blockPlan of blockPlans) {
          if (blockPlan.usedRelaxedSameTeamRule) {
            relaxedSameTeamBlocks.push(`${category.name} · blok ${blockPlan.block.block_number}`);
          }
          for (const round of blockPlan.rounds) {
            for (const table of round.tables) {
              const assignmentKey = `${selectedEventId}|${blockPlan.block.game_id}|${blockPlan.block.category_id}|${table.tableNumber}`;
              const assignmentWildcardKey = `${selectedEventId}|${blockPlan.block.game_id}|*|${table.tableNumber}`;
              let assignment = assignmentByKey.get(assignmentKey) ?? assignmentByKey.get(assignmentWildcardKey);
              if (!assignment && isTestMode) {
                assignment = resolveFallbackAssignment(blockPlan.block.game_id, blockPlan.block.category_id) ?? undefined;
                if (assignment) {
                  fallbackAssignmentsUsed += 1;
                  fallbackJudgeIds.add(assignment.user_id);
                }
              }
              if (!assignment) {
                missingAssignments.push(
                  `${category.name} · blok ${blockPlan.block.block_number} · stůl ${table.tableNumber}`,
                );
                continue;
              }

              plannedRows.push({
                match: {
                  event_id: selectedEventId,
                  category_id: blockPlan.block.category_id,
                  block_id: blockPlan.block.id,
                  round_number: round.roundNumber,
                  table_number: table.tableNumber,
                  created_by: assignment.user_id,
                },
                players: table.playerIds,
              });
            }
          }
        }
      }

      if (missingAssignments.length) {
        if (isTestMode) {
          setError(
            `Ani test losování nenašlo dost rozhodčích. Chybí: ${missingAssignments.slice(0, 6).join('; ')}${missingAssignments.length > 6 ? '…' : ''}`,
          );
        } else {
          setError(
            `Chybí přiřazení rozhodčího ke stolu: ${missingAssignments.slice(0, 6).join('; ')}${missingAssignments.length > 6 ? '…' : ''}`,
          );
        }
        return;
      }

      if (!plannedRows.length) {
        setError('Nebylo co vylosovat. Zkontroluj hráče, bloky a diskvalifikace.');
        return;
      }

      setDrawProgress({ label: 'Mažu předchozí partie…', current: 0, total: 1 });
      await yieldToBrowser();

      const { error: deleteMatchesError } = await supabase
        .from('board_match')
        .delete()
        .eq('event_id', selectedEventId);

      if (deleteMatchesError) {
        console.error('Failed to clear previous board matches', deleteMatchesError);
        setError('Nepodařilo se smazat původní partie.');
        return;
      }

      let insertedMatches = 0;
      let insertedRows = 0;
      const totalRows = plannedRows.length;

      for (let index = 0; index < plannedRows.length; index += 1) {
        const planned = plannedRows[index];
        if (index === 0 || index === totalRows - 1 || (index + 1) % 12 === 0) {
          setDrawProgress({
            label: `Ukládám partie… (${index + 1}/${totalRows})`,
            current: index + 1,
            total: totalRows,
          });
          await yieldToBrowser();
        }

        const { data: insertedMatch, error: insertMatchError } = await supabase
          .from('board_match')
          .insert({
            event_id: planned.match.event_id,
            category_id: planned.match.category_id,
            block_id: planned.match.block_id,
            round_number: planned.match.round_number,
            table_number: planned.match.table_number ?? null,
            created_by: planned.match.created_by,
          })
          .select('id')
          .single();

        if (insertMatchError || !insertedMatch) {
          console.error('Failed to insert drawn board match', insertMatchError);
          setError('Nepodařilo se uložit vylosované partie.');
          return;
        }

        const participantRows = planned.players.map((playerId, index) => ({
          match_id: insertedMatch.id as string,
          player_id: playerId,
          seat: index + 1,
          points: null,
          placement: null,
        }));

        const { error: insertPlayersError } = await supabase
          .from('board_match_player')
          .insert(participantRows);

        if (insertPlayersError) {
          console.error('Failed to insert drawn board match players', insertPlayersError);
          setError('Nepodařilo se uložit hráče do vylosovaných partií.');
          return;
        }

        insertedMatches += 1;
        insertedRows += participantRows.length;
      }

      setMessage('Losování bylo úspěšně vytvořeno.');
      const relaxedSuffix = relaxedSameTeamBlocks.length
        ? ` Uvolněné pravidlo stejný oddíl (max 1× na hráče/hru): ${relaxedSameTeamBlocks.slice(0, 6).join('; ')}${relaxedSameTeamBlocks.length > 6 ? '…' : ''}.`
        : '';
      const testSuffix = isTestMode
        ? ` Test losování: doplněno ${fallbackAssignmentsUsed} stolů podle dostupných rozhodčích (${fallbackJudgeIds.size} rozhodčích).`
        : '';
      setDrawSummary(`Partie: ${insertedMatches} · účasti hráčů: ${insertedRows}.${relaxedSuffix}${testSuffix}`);
      setDrawProgress({ label: 'Dokončeno', current: 1, total: 1 });
      await loadEventDetail();
    } finally {
      setDrawRunning(false);
      setDrawProgress(null);
    }
  }, [assignments, blocks, categories, loadEventDetail, players, selectedEventId]);

  const selectedEventLabel = selectedEvent?.name ?? 'Nevybraný event';
  const sectionStats = useMemo(
    () => [
      { label: 'Kategorie', value: categories.length },
      { label: 'Hry', value: games.length },
      { label: 'Bloky', value: blocks.length },
      { label: 'Hráči', value: players.length },
      { label: 'Diskvalifikace', value: players.filter((player) => player.disqualified).length },
      { label: 'Stoly rozhodčích', value: assignments.filter((assignment) => assignment.table_number).length },
    ],
    [assignments, blocks.length, categories.length, games.length, players],
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

  const selectedDisqualifyPlayer = useMemo(
    () => players.find((player) => player.id === selectedDisqualifyPlayerId) ?? null,
    [players, selectedDisqualifyPlayerId],
  );

  useEffect(() => {
    setPlayerPage(1);
  }, [playerCategoryFilter, playerPageSize, playerSearch, selectedEventId]);

  useEffect(() => {
    if (!selectedDisqualifyPlayerId) {
      return;
    }
    if (!players.some((player) => player.id === selectedDisqualifyPlayerId)) {
      setSelectedDisqualifyPlayerId('');
    }
  }, [players, selectedDisqualifyPlayerId]);

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

  const drawOverview = useMemo(() => {
    const activePlayersTotal = players.filter((player) => !player.disqualified).length;
    const oversizedCategories = categories
      .map((category) => {
        const activePlayers = players.filter((player) => player.category_id === category.id && !player.disqualified).length;
        return activePlayers > BOARD_DRAW_MAX_PLAYERS_PER_BLOCK ? `${category.name} (${activePlayers})` : null;
      })
      .filter((value): value is string => Boolean(value));
    const readyCategories = categories.filter((category) => {
      const categoryPlayers = players.filter((player) => player.category_id === category.id && !player.disqualified);
      const categoryBlocks = blocks.filter((block) => block.category_id === category.id);
      return categoryPlayers.length >= 2 && categoryBlocks.length > 0;
    }).length;
    return {
      activePlayersTotal,
      readyCategories,
      oversizedCategories,
    };
  }, [blocks, categories, players]);

  const drawDisabledReason = useMemo(() => {
    if (!selectedEventId) {
      return 'Nejdřív vyber event.';
    }
    if (drawRunning) {
      return 'Losování právě běží.';
    }
    if (loading) {
      return 'Počkej na načtení administrace.';
    }
    if (drawOverview.activePlayersTotal === 0) {
      return 'V databázi zatím nejsou načtení aktivní účastníci.';
    }
    if (drawOverview.oversizedCategories.length) {
      return `Překročen limit ${BOARD_DRAW_MAX_TABLES_PER_GAME} stolů (${BOARD_DRAW_MAX_PLAYERS_PER_BLOCK} hráčů) v: ${drawOverview.oversizedCategories.slice(0, 2).join(', ')}${drawOverview.oversizedCategories.length > 2 ? '…' : ''}.`;
    }
    if (drawOverview.readyCategories === 0) {
      return 'Žádná kategorie nemá současně hráče a bloky.';
    }
    return null;
  }, [drawOverview.activePlayersTotal, drawOverview.oversizedCategories, drawOverview.readyCategories, drawRunning, loading, selectedEventId]);

  const canGenerateDraw = drawDisabledReason === null;

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
      case 'draw':
        return {
          description: 'Automatické rozlosování partií na 3 kola v každém bloku a přidělení ke stolům.',
          action: {
            label: 'Vylosovat partie',
            kind: 'primary',
            disabled: !canGenerateDraw,
            onClick: () => {
              void handleGenerateDraw();
            },
          },
        };
      case 'disqualify':
        return {
          description: 'Vyhledej hráče a nastav jeho diskvalifikaci. Diskvalifikovaní se neberou do nového losování.',
          action: selectedDisqualifyPlayer
            ? {
              label: selectedDisqualifyPlayer.disqualified ? 'Zrušit diskvalifikaci' : 'Diskvalifikovat',
              kind: selectedDisqualifyPlayer.disqualified ? 'secondary' : 'primary',
              onClick: () => {
                void handleSetPlayerDisqualified(
                  selectedDisqualifyPlayer.id,
                  !Boolean(selectedDisqualifyPlayer.disqualified),
                );
              },
            }
            : undefined,
        };
      case 'assignments':
        return {
          description: 'Přiřazení rozhodčích podle hry, kategorie a čísla stolu.',
          action: {
            label: 'Přidat přiřazení',
            kind: 'primary',
            disabled: !selectedEventId,
            onClick: () => {
              void handleCreateAssignment();
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
    canGenerateDraw,
    handleCreateAssignment,
    handleCreateBlock,
    handleCreateCategory,
    handleCreateGame,
    handleGenerateDraw,
    handleImportPlayers,
    handleSetPlayerDisqualified,
    handleUpdateEvent,
    navigateAdminSection,
    selectedDisqualifyPlayer,
    selectedEventId,
    selectedEventLabel,
    loading,
  ]);

  return (
    <>
      <section className="admin-card">
        <header className="admin-card-header">
          <div>
            <h2>Administrace Deskovek</h2>
            <p className="admin-card-subtitle">Event, losování, diskvalifikace a přiřazení rozhodčích ke stolům.</p>
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
                  className={`admin-button ${activeSection === item.key ? 'admin-button--primary' : 'admin-button--secondary'
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
          {activeSection !== 'draw' ? (
            <section className="admin-card deskovky-admin-section-sticky">
              <header className="deskovky-admin-section-sticky-head">
                <div>
                  <h3>{activeSectionLabel}</h3>
                  <p className="admin-card-subtitle">{sectionHeaderConfig.description}</p>
                </div>
                {sectionHeaderConfig.action ? (
                  <button
                    type="button"
                    className={`admin-button ${sectionHeaderConfig.action.kind === 'primary' ? 'admin-button--primary' : 'admin-button--secondary'
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

              {activeSection === 'assignments' ? (
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
          ) : null}

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
                  onClick={() => navigateAdminSection('draw')}
                  aria-label="Přejít na sekci Losování"
                >
                  Losování
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={() => navigateAdminSection('disqualify')}
                  aria-label="Přejít na sekci Diskvalifikace"
                >
                  Diskvalifikace
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={() => navigateAdminSection('assignments')}
                  aria-label="Přejít na sekci Rozhodčí a stoly"
                >
                  Rozhodčí a stoly
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

          {activeSection === 'draw' ? (
            <section className="admin-card">
              <h2>Losování partií</h2>
              <p className="admin-card-subtitle">
                V každém bloku se vylosují 3 partie na stolech (max. {BOARD_DRAW_MAX_TABLES_PER_GAME} stolů na jednu deskovku). Losování respektuje oddíly a opakování soupeřů.
              </p>
              <p className="admin-card-subtitle">
                Losování spusť až ve chvíli, kdy jsou všichni účastníci nahraní v databázi.
              </p>
              <div className="admin-card-actions">
                <button
                  type="button"
                  className="admin-button admin-button--primary"
                  onClick={() => void handleGenerateDraw()}
                  disabled={!canGenerateDraw}
                  title={drawDisabledReason ?? undefined}
                >
                  {drawRunning ? 'Losuji…' : 'Spustit losování'}
                </button>
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  onClick={() => void handleGenerateDraw('test')}
                  disabled={!canGenerateDraw}
                  title={drawDisabledReason ?? undefined}
                >
                  Test losování
                </button>
              </div>
              {drawProgress ? (
                <div className="deskovky-draw-progress" role="status" aria-live="polite">
                  <p className="admin-card-subtitle">{drawProgress.label}</p>
                  <progress max={drawProgress.total || 1} value={Math.min(drawProgress.current, drawProgress.total || 1)} />
                  <p className="admin-card-subtitle">
                    {Math.round((Math.min(drawProgress.current, drawProgress.total || 1) / (drawProgress.total || 1)) * 100)} %
                  </p>
                </div>
              ) : null}
              {drawDisabledReason ? <p className="admin-card-subtitle">{drawDisabledReason}</p> : null}
              {drawSummary ? <p className="admin-success">{drawSummary}</p> : null}
              {isMobile ? (
                <div className="deskovky-admin-mobile-list">
                  {categories.map((category) => {
                    const categoryPlayers = players.filter((player) => player.category_id === category.id);
                    const activePlayers = categoryPlayers.filter((player) => !player.disqualified);
                    const categoryBlocks = blocks.filter((block) => block.category_id === category.id);
                    return (
                      <article key={category.id} className="deskovky-admin-mobile-card">
                        <h3>{category.name}</h3>
                        <p className="deskovky-admin-mobile-meta">
                          Hráči celkem: <strong>{categoryPlayers.length}</strong>
                        </p>
                        <p className="deskovky-admin-mobile-meta">
                          Aktivní pro los: <strong>{activePlayers.length}</strong>
                        </p>
                        <p className="deskovky-admin-mobile-meta">
                          Bloky: <strong>{categoryBlocks.length}</strong>
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
                        <th>Kategorie</th>
                        <th>Hráči celkem</th>
                        <th>Aktivní pro los</th>
                        <th>Bloky</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map((category) => {
                        const categoryPlayers = players.filter((player) => player.category_id === category.id);
                        const activePlayers = categoryPlayers.filter((player) => !player.disqualified);
                        const categoryBlocks = blocks.filter((block) => block.category_id === category.id);
                        return (
                          <tr key={category.id}>
                            <td>{category.name}</td>
                            <td>{categoryPlayers.length}</td>
                            <td>{activePlayers.length}</td>
                            <td>{categoryBlocks.length}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {activeSection === 'disqualify' ? (
            <section className="admin-card">
              <h2>Diskvalifikace hráčů</h2>
              <div className="deskovky-admin-filters">
                <label className="admin-field">
                  <span>Hledat hráče</span>
                  <input
                    value={playerSearch}
                    onChange={(eventTarget) => setPlayerSearch(eventTarget.target.value)}
                    placeholder="Kód, jméno nebo oddíl…"
                  />
                </label>
                <label className="admin-field">
                  <span>Kategorie</span>
                  <select
                    value={playerCategoryFilter}
                    onChange={(eventTarget) => setPlayerCategoryFilter(eventTarget.target.value)}
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
                  <span>Vybraný hráč</span>
                  <select
                    value={selectedDisqualifyPlayerId}
                    onChange={(eventTarget) => setSelectedDisqualifyPlayerId(eventTarget.target.value)}
                  >
                    <option value="">Vyber hráče</option>
                    {filteredPlayers.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.short_code} · {player.display_name || player.team_name || 'Bez jména'}
                        {player.disqualified ? ' · DSQ' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {selectedDisqualifyPlayer ? (
                <div className="deskovky-admin-grid">
                  <article className="deskovky-assignment-card">
                    <h3>{selectedDisqualifyPlayer.display_name || selectedDisqualifyPlayer.short_code}</h3>
                    <p>
                      <strong>Oddíl:</strong> {selectedDisqualifyPlayer.team_name || '—'}
                    </p>
                    <p>
                      <strong>Kategorie:</strong>{' '}
                      {categoryMap.get(selectedDisqualifyPlayer.category_id)?.name ?? selectedDisqualifyPlayer.category_id}
                    </p>
                    <p>
                      <strong>Stav:</strong> {selectedDisqualifyPlayer.disqualified ? 'Diskvalifikován' : 'Aktivní'}
                    </p>
                    <div className="admin-card-actions">
                      <button
                        type="button"
                        className={`admin-button ${selectedDisqualifyPlayer.disqualified ? 'admin-button--secondary' : 'admin-button--primary'}`}
                        onClick={() =>
                          void handleSetPlayerDisqualified(
                            selectedDisqualifyPlayer.id,
                            !Boolean(selectedDisqualifyPlayer.disqualified),
                          )
                        }
                      >
                        {selectedDisqualifyPlayer.disqualified ? 'Zrušit diskvalifikaci' : 'Diskvalifikovat'}
                      </button>
                    </div>
                  </article>
                </div>
              ) : (
                <p className="admin-card-subtitle">Vyber hráče ze seznamu.</p>
              )}
            </section>
          ) : null}

          {activeSection === 'assignments' ? (
            <section className="admin-card">
              <h2>Přiřazení rozhodčích ke stolům</h2>
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
                  <span>Kategorie</span>
                  <select
                    value={newAssignmentCategoryId}
                    onChange={(eventTarget) => setNewAssignmentCategoryId(eventTarget.target.value)}
                  >
                    <option value="">Vyber kategorii</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-field">
                  <span>Stůl</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={newAssignmentTableNumber}
                    onChange={(eventTarget) => setNewAssignmentTableNumber(eventTarget.target.value)}
                  />
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
                              : '—'}
                          </strong>
                        </p>
                        <p className="deskovky-admin-mobile-meta">
                          Stůl: <strong>{assignment.table_number ?? '—'}</strong>
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
                        <th>Stůl</th>
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
                                : '—'}
                            </td>
                            <td>{assignment.table_number ?? '—'}</td>
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

          {activeSection === 'categories' ? (
            <section className="admin-card">
              <h2>Kategorie</h2>
              <div className="deskovky-admin-grid">
                <label className="admin-field">
                  <span>Název kategorie</span>
                  <input
                    value={newCategoryName}
                    onChange={(eventTarget) => setNewCategoryName(eventTarget.target.value)}
                    placeholder="Např. Kategorie I"
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
              <div className="admin-card-actions">
                <button type="button" className="admin-button admin-button--primary" onClick={() => void handleCreateGame()}>
                  Přidat hru
                </button>
              </div>
              <p className="deskovky-admin-pagination-status">
                Zobrazeno <strong>{filteredGames.length}</strong> z <strong>{games.length}</strong> her{games.length > 0 ? '.' : '.'}
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
  const judgeId = auth.manifest.judge.id;
  const isAdmin = (auth.manifest.station.code || '').trim().toUpperCase() === 'T';
  const [page, setPage] = useState<DeskovkyPage>(() => resolveAllowedPage(resolvePage(window.location.pathname), isAdmin));
  const [context, setContext] = useState<BoardJudgeContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const navigate = useCallback((nextPage: DeskovkyPage, options?: { replace?: boolean }) => {
    const resolvedNextPage = resolveAllowedPage(nextPage, isAdmin);
    const nextPath = buildCanonicalPath(resolvedNextPage);
    if (options?.replace) {
      window.history.replaceState(window.history.state, '', nextPath);
    } else {
      window.history.pushState(window.history.state, '', nextPath);
    }
    setPage(resolvedNextPage);
  }, [isAdmin]);

  useEffect(() => {
    const resolvedPage = resolvePage(window.location.pathname);
    const allowedPage = resolveAllowedPage(resolvedPage, isAdmin);
    if (resolvedPage !== allowedPage) {
      window.history.replaceState(window.history.state, '', buildCanonicalPath(allowedPage));
    }
    setPage(allowedPage);
  }, [isAdmin]);

  useEffect(() => {
    const handlePopState = () => {
      const resolvedPage = resolvePage(window.location.pathname);
      const allowedPage = resolveAllowedPage(resolvedPage, isAdmin);
      if (resolvedPage !== allowedPage) {
        window.history.replaceState(window.history.state, '', buildCanonicalPath(allowedPage));
      }
      setPage(allowedPage);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isAdmin]);

  const navItems = useMemo<ReadonlyArray<{ page: DeskovkyPage; label: string; ariaLabel: string }>>(() => {
    if (isAdmin) {
      return [
        { page: 'admin', label: 'Admin', ariaLabel: 'Přejít na administraci' },
        { page: 'standings', label: 'Pořadí', ariaLabel: 'Přejít na Pořadí' },
        { page: 'rules', label: 'Pravidla', ariaLabel: 'Přejít na Pravidla' },
      ];
    }
    return [
      { page: 'home', label: 'Přehled', ariaLabel: 'Přejít na Přehled' },
      { page: 'new-match', label: 'Nový zápas', ariaLabel: 'Přejít na Nový zápas' },
      { page: 'rules', label: 'Pravidla', ariaLabel: 'Přejít na Pravidla' },
    ];
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const loaded = await loadJudgeContext(judgeId, { includeAllEvents: isAdmin });
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
  }, [isAdmin, judgeId]);

  const pageTitle = useMemo(() => {
    switch (page) {
      case 'new-match':
        return 'Partie u stolu';
      case 'standings':
        return 'Průběžné pořadí';
      case 'rules':
        return 'Pravidla';
      case 'admin':
        return 'Administrace';
      default:
        return '';
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
            {pageTitle ? <p className="admin-subtitle">{pageTitle}</p> : null}
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
            {navItems.map((item) => (
              <button
                key={item.page}
                type="button"
                className={`admin-button ${page === item.page ? 'admin-button--primary' : 'admin-button--secondary'}`}
                onClick={() => navigate(item.page)}
                aria-label={item.ariaLabel}
              >
                {item.label}
              </button>
            ))}
          </div>
          {page === 'rules' ? (
            <div className="deskovky-nav-rules">
              <p className="admin-card-subtitle">Dokumenty se otevřou v nové kartě.</p>
              <RulesLinks className="deskovky-rules-links deskovky-rules-links--inline" />
            </div>
          ) : null}
        </section>

        {page === 'home' ? (
          <JudgeHomePage
            judgeId={judgeId}
            context={context}
            selectedEventId={selectedEventId}
          />
        ) : null}

        {page === 'new-match' ? (
          <AssignedTableMatchesPage
            judgeId={judgeId}
            context={context}
            selectedEventId={selectedEventId}
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
