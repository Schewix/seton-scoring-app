import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { supabase } from '../supabaseClient';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';
import AppFooter from '../components/AppFooter';
import './ScoreboardApp.css';

interface RawResult {
  event_id: string;
  event_name?: string | null;
  patrol_id: string;
  patrol_code: string | null;
  team_name: string;
  category: string;
  sex: string;
  patrol_members?: string | null;
  start_time?: string | null;
  finish_time?: string | null;
  total_seconds?: number | string | null;
  wait_seconds?: number | string | null;
  total_points: number | string | null;
  points_no_T: number | string | null;
  pure_seconds: number | string | null;
  time_points?: number | string | null;
  station_points_breakdown?: Record<string, unknown> | null;
}

interface RawRankedResult extends RawResult {
  rank_in_bracket: number | string;
}

interface Result {
  eventId: string;
  eventName: string | null;
  patrolId: string;
  patrolCode: string | null;
  teamName: string;
  category: string;
  sex: string;
  patrolMembers: string | null;
  startTime: string | null;
  finishTime: string | null;
  totalSeconds: number | null;
  waitSeconds: number | null;
  totalPoints: number | null;
  pointsNoT: number | null;
  pureSeconds: number | null;
  timePoints: number | null;
  stationPointsBreakdown: Record<string, number>;
}

interface RankedResult extends Result {
  rankInBracket: number;
}

interface RankedGroupItem extends RankedResult {
  displayRank: number;
}

interface RankedGroup {
  key: string;
  category: string;
  sex: string;
  items: RankedResult[];
  visibleItems: RankedGroupItem[];
}

const rawEventId = import.meta.env.VITE_EVENT_ID as string | undefined;

if (!rawEventId) {
  throw new Error('Missing VITE_EVENT_ID environment variable.');
}

const REFRESH_INTERVAL_MS = 30_000;

const BRACKET_ORDER = ['N__H', 'N__D', 'M__H', 'M__D', 'S__H', 'S__D', 'R__H', 'R__D'];

const BRACKET_ORDER_INDEX = new Map(BRACKET_ORDER.map((key, index) => [key, index] as const));

const CATEGORY_CODES = ['N', 'M', 'S', 'R'] as const;
type CategoryCode = (typeof CATEGORY_CODES)[number];

const STATION_CATEGORY_REQUIREMENTS: Record<string, readonly CategoryCode[]> = {
  A: ['M', 'S', 'R'],
  B: ['N', 'M', 'S', 'R'],
  C: ['N', 'M', 'S', 'R'],
  D: ['R'],
  F: ['N', 'M', 'S', 'R'],
  J: ['N', 'M', 'S', 'R'],
  K: ['N', 'M'],
  M: ['M', 'S', 'R'],
  N: ['S', 'R'],
  O: ['N', 'M', 'S', 'R'],
  P: ['N', 'M', 'S', 'R'],
  R: ['N', 'M', 'S', 'R'],
  S: ['M', 'S', 'R'],
  T: ['N', 'M', 'S', 'R'],
  U: ['N', 'M', 'S', 'R'],
  V: ['S', 'R'],
  Z: ['N', 'M', 'S', 'R'],
};

function normaliseCategoryKey(value: string | null | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function isCategoryCode(value: string | null | undefined): value is CategoryCode {
  return value ? (CATEGORY_CODES as readonly string[]).includes(value) : false;
}

function normaliseStationCode(value: string | null | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function selectStationCodesForCategory(
  allStationCodes: readonly string[],
  category: string,
  fallbackCodes: Iterable<string>,
): string[] {
  const normalisedCategory = normaliseCategoryKey(category);
  if (!isCategoryCode(normalisedCategory)) {
    return [...allStationCodes];
  }

  const filtered = allStationCodes.filter((code) => {
    const allowedCategories = STATION_CATEGORY_REQUIREMENTS[code];
    if (!allowedCategories || allowedCategories.length === 0) {
      return true;
    }
    return allowedCategories.includes(normalisedCategory);
  });

  if (filtered.length > 0) {
    return filtered;
  }

  const fallbackFiltered: string[] = [];
  for (const rawCode of fallbackCodes) {
    const normalised = normaliseStationCode(rawCode);
    if (!normalised) {
      continue;
    }
    if (fallbackFiltered.includes(normalised)) {
      continue;
    }
    const allowedCategories = STATION_CATEGORY_REQUIREMENTS[normalised];
    if (allowedCategories && allowedCategories.length > 0 && !allowedCategories.includes(normalisedCategory)) {
      continue;
    }
    fallbackFiltered.push(normalised);
  }

  if (fallbackFiltered.length > 0) {
    return fallbackFiltered;
  }

  return [...allStationCodes];
}

function normaliseText(value: string | null | undefined) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function parseNumber(
  value: number | string | null | undefined,
  fallback: number | null = null,
): number | null {
  if (value === null) return fallback;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseStationPointsBreakdown(value: RawResult['station_points_breakdown']): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).reduce<[string, number][]>((acc, [code, raw]) => {
    const numeric = parseNumber((raw as number | string | null) ?? null);
    const normalisedCode = normaliseStationCode(code);
    if (numeric !== null && normalisedCode) {
      acc.push([normalisedCode, numeric]);
    }
    return acc;
  }, []);

  if (!entries.length) {
    return {};
  }

  return entries.reduce<Record<string, number>>((acc, [code, numeric]) => {
    acc[code] = numeric;
    return acc;
  }, {});
}

function hasPatrolCode(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normaliseResult(raw: RawResult): Result {
  return {
    eventId: raw.event_id,
    eventName: normaliseText(raw.event_name ?? null),
    patrolId: raw.patrol_id,
    patrolCode: raw.patrol_code,
    teamName: raw.team_name,
    category: raw.category,
    sex: raw.sex,
    patrolMembers: normaliseText(raw.patrol_members ?? null),
    startTime: normaliseText(raw.start_time ?? null),
    finishTime: normaliseText(raw.finish_time ?? null),
    totalSeconds: parseNumber(raw.total_seconds),
    waitSeconds: parseNumber(raw.wait_seconds, 0),
    totalPoints: parseNumber(raw.total_points),
    pointsNoT: parseNumber(raw.points_no_T),
    pureSeconds: parseNumber(raw.pure_seconds),
    timePoints: parseNumber(raw.time_points),
    stationPointsBreakdown: parseStationPointsBreakdown(raw.station_points_breakdown ?? null),
  };
}

function normaliseRankedResult(raw: RawRankedResult): RankedResult {
  return {
    ...normaliseResult(raw),
    rankInBracket: parseNumber(raw.rank_in_bracket, 0) || 0,
  };
}

function hasAnyPoints(result: Result) {
  return result.totalPoints !== null || result.pointsNoT !== null;
}

function compareRankedResults(a: RankedResult, b: RankedResult) {
  const aHasPoints = hasAnyPoints(a);
  const bHasPoints = hasAnyPoints(b);

  if (aHasPoints !== bHasPoints) {
    return aHasPoints ? -1 : 1;
  }

  const aRank = a.rankInBracket && a.rankInBracket > 0 ? a.rankInBracket : Number.POSITIVE_INFINITY;
  const bRank = b.rankInBracket && b.rankInBracket > 0 ? b.rankInBracket : Number.POSITIVE_INFINITY;
  if (aRank !== bRank) {
    return aRank - bRank;
  }

  const aPoints = a.totalPoints ?? Number.NEGATIVE_INFINITY;
  const bPoints = b.totalPoints ?? Number.NEGATIVE_INFINITY;
  if (aPoints !== bPoints) {
    return bPoints - aPoints;
  }

  const aPointsNoT = a.pointsNoT ?? Number.NEGATIVE_INFINITY;
  const bPointsNoT = b.pointsNoT ?? Number.NEGATIVE_INFINITY;
  if (aPointsNoT !== bPointsNoT) {
    return bPointsNoT - aPointsNoT;
  }

  const aTime = a.pureSeconds ?? Number.POSITIVE_INFINITY;
  const bTime = b.pureSeconds ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) {
    return aTime - bTime;
  }

  return a.teamName.localeCompare(b.teamName, 'cs');
}

function formatSeconds(seconds: number | null) {
  if (seconds === null) return '—';
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatPoints(value: number | null) {
  if (value === null) return '—';
  return value.toLocaleString('cs-CZ');
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('cs-CZ');
}

function parsePatrolMembersList(members: string | null) {
  if (!members) return [] as string[];
  const parts = members
    .split(/;|\n/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length > 1) {
    return parts;
  }

  const commaParts = members
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (commaParts.length > 1) {
    return commaParts;
  }

  const trimmed = members.trim();
  return trimmed ? [trimmed] : [];
}

type PatrolMember = {
  name: string;
  nickname?: string;
};

function parsePatrolMembers(members: string | null): PatrolMember[] {
  return parsePatrolMembersList(members).map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { name: raw };
    }

    const parenMatch = trimmed.match(/^(.*?)\s*\((.+)\)\s*$/);
    if (parenMatch) {
      const name = parenMatch[1].trim();
      const nickname = parenMatch[2].trim();
      return { name: name || trimmed, nickname: nickname || undefined };
    }

    const dashMatch = trimmed.match(/^(.*?)\s*[–-]\s*(.+)\s*$/);
    if (dashMatch) {
      const name = dashMatch[1].trim();
      const nickname = dashMatch[2].trim();
      return { name: name || trimmed, nickname: nickname || undefined };
    }

    return { name: trimmed };
  });
}

function formatPatrolMembers(members: string | null) {
  const parts = parsePatrolMembersList(members);
  if (!parts.length) {
    return '—';
  }

  return parts.join('\n');
}

function formatMemberColumns(members: string | null, columnCount: number) {
  if (columnCount === 0) {
    return [] as string[];
  }

  const parts = parsePatrolMembersList(members);
  return Array.from({ length: columnCount }, (_, index) => parts[index] ?? '—');
}

function formatStationColumns(
  breakdown: Record<string, number>,
  stationCodes: readonly string[],
) {
  if (!stationCodes.length) {
    return [] as (number | string)[];
  }

  return stationCodes.map((code) => {
    const value = breakdown[code];
    return typeof value === 'number' ? value : '-';
  });
}

function normaliseBracketKey(category: string, sex: string) {
  const cat = (category || '').trim().toUpperCase();
  const sexPart = (sex || '').trim().toUpperCase();
  return `${cat}__${sexPart}`;
}

function compareBrackets(aCategory: string, aSex: string, bCategory: string, bSex: string) {
  const aKey = normaliseBracketKey(aCategory, aSex);
  const bKey = normaliseBracketKey(bCategory, bSex);
  const aIndex = BRACKET_ORDER_INDEX.get(aKey);
  const bIndex = BRACKET_ORDER_INDEX.get(bKey);

  if (aIndex !== undefined || bIndex !== undefined) {
    if (aIndex === undefined) return 1;
    if (bIndex === undefined) return -1;
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
  }

  return aKey.localeCompare(bKey);
}

function formatCategoryLabel(category: string, sex?: string) {
  const cat = (category || '').trim().toUpperCase();
  const sexPart = (sex || '').trim().toUpperCase();

  if (cat && sexPart) {
    return `${cat}${sexPart}`;
  }

  if (cat) return cat;
  if (sexPart) return sexPart;
  return '—';
}

function formatPatrolNumber(patrolCode: string | null, fallback?: string) {
  if (patrolCode) {
    const normalized = patrolCode.trim();
    if (normalized) {
      return normalized.toUpperCase();
    }
  }

  if (fallback && fallback.trim()) {
    return fallback;
  }

  return '—';
}

function createFallbackPatrolCode(category: string, sex: string, rank: number) {
  const categoryLabel = formatCategoryLabel(category, sex);
  if (categoryLabel === '—') {
    return undefined;
  }

  if (!Number.isFinite(rank) || rank <= 0) {
    return undefined;
  }

  return `${categoryLabel}-${rank}`;
}

function ScoreboardApp() {
  const [ranked, setRanked] = useState<RankedResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [eventName, setEventName] = useState<string>(() => {
    return normaliseText((import.meta.env.VITE_EVENT_NAME as string | undefined) ?? null) ?? '';
  });
  const [exporting, setExporting] = useState(false);
  const [stationCodes, setStationCodes] = useState<string[]>([]);
  const [expandedPatrolId, setExpandedPatrolId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
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
    if (normaliseText(eventName)) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('events_public')
          .select('name')
          .eq('id', rawEventId)
          .maybeSingle();
        if (!isMountedRef.current || cancelled) return;
        if (error) {
          console.error('Failed to load event name', error);
          return;
        }
        const row = data as { name?: string | null } | null;
        const fetchedName = normaliseText(row?.name ?? null);
        if (fetchedName) {
          setEventName(fetchedName);
        }
      } catch (err) {
        if (!isMountedRef.current || cancelled) return;
        console.error('Failed to load event name', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventName, rawEventId]);

  const togglePatrolDetails = useCallback((patrolId: string) => {
    setExpandedPatrolId((prev) => (prev === patrolId ? null : patrolId));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadStations = async () => {
      try {
        const { data, error } = await supabase
          .from('stations')
          .select('code')
          .eq('event_id', rawEventId)
          .order('code', { ascending: true });

        if (!isMountedRef.current || cancelled) {
          return;
        }

        if (error) {
          console.error('Failed to load station list for export', error);
          return;
        }

        if (!Array.isArray(data)) {
          return;
        }

        const uniqueCodesSet = new Set<string>();
        data.forEach((row) => {
          const normalisedCode = normaliseStationCode(
            typeof row.code === 'string' ? row.code : null,
          );
          if (normalisedCode) {
            uniqueCodesSet.add(normalisedCode);
          }
        });

        setStationCodes(Array.from(uniqueCodesSet));
      } catch (err) {
        if (!isMountedRef.current || cancelled) {
          return;
        }
        console.error('Failed to load station list for export', err);
      }
    };

    loadStations();

    return () => {
      cancelled = true;
    };
  }, [rawEventId]);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('scoreboard_view')
        .select('*')
        .eq('event_id', rawEventId)
        .order('category', { ascending: true })
        .order('sex', { ascending: true })
        .order('rank_in_bracket', { ascending: true });

      if (!isMountedRef.current) {
        return;
      }

      let normalised = Array.isArray(data) ? data.map(normaliseRankedResult) : [];

      const missingIds = normalised
        .filter((item) => !hasPatrolCode(item.patrolCode))
        .map((item) => item.patrolId);

      const uniqueMissingIds = Array.from(new Set(missingIds));

      if (uniqueMissingIds.length) {
        type PatrolCodeRow = { id: string; patrol_code: string | null };
        const { data: patrolRows, error: patrolError } = await supabase
          .from('patrols')
          .select('id, patrol_code')
          .eq('event_id', rawEventId)
          .in('id', uniqueMissingIds);

        if (!isMountedRef.current) {
          return;
        }

        if (patrolError) {
          console.error('Failed to load patrol codes for scoreboard', patrolError);
        }

        if (patrolRows && patrolRows.length) {
          const codeMap = new Map<string, string>();
          patrolRows.forEach((row: PatrolCodeRow) => {
            if (hasPatrolCode(row.patrol_code)) {
              codeMap.set(row.id, row.patrol_code!.trim());
            }
          });

          if (codeMap.size) {
            normalised = normalised.map((item) => {
              if (hasPatrolCode(item.patrolCode)) {
                return item;
              }

              const fallbackCode = codeMap.get(item.patrolId);
              if (fallbackCode) {
                return { ...item, patrolCode: fallbackCode };
              }

              return item;
            });
          }
        }
      }

      setRanked(normalised);

      const derivedEventName = normalised.find((item) => item.eventName)?.eventName;
      if (derivedEventName) {
        setEventName((prev) => (prev === derivedEventName ? prev : derivedEventName));
      }

      if (error) {
        console.error('Failed to load ranked standings', error);
        setError('Nepodařilo se načíst pořadí podle kategorií.');
      } else {
        setError(null);
        setLastUpdatedAt(new Date());
      }
    } catch (err) {
      console.error('Failed to load scoreboard data', err);
      if (!isMountedRef.current) return;
      setError('Nepodařilo se načíst pořadí podle kategorií. Zkuste to prosím znovu.');
      setRanked([]);
    } finally {
      if (!isMountedRef.current) {
        return;
      }
      setLoading(false);
      setRefreshing(false);
    }
  }, [rawEventId]);

  useEffect(() => {
    let interval: number | undefined;

    const initialise = async () => {
      await loadData();
      if (!isMountedRef.current) return;

      interval = window.setInterval(() => {
        loadData();
      }, REFRESH_INTERVAL_MS);
    };

    initialise();

    return () => {
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [loadData]);

  useEffect(() => {
    document.title = 'Zelena liga';
  }, []);

  const groupedRanked = useMemo(() => {
    const groups = new Map<string, RankedGroup>();

    ranked.forEach((item) => {
      const key = normaliseBracketKey(item.category, item.sex);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          category: item.category,
          sex: item.sex,
          items: [],
          visibleItems: [],
        });
      }
      groups.get(key)!.items.push(item);
    });

    return Array.from(groups.values())
      .map((group) => {
        const rankedItems = [...group.items]
          .sort(compareRankedResults)
          .map((item, index) => ({ ...item, displayRank: index + 1 }));
        const visibleItems = rankedItems;
        return {
          ...group,
          items: rankedItems,
          visibleItems,
        };
      })
      .sort((a, b) => compareBrackets(a.category, a.sex, b.category, b.sex));
  }, [ranked]);

  const handleRefresh = useCallback(() => {
    loadData();
  }, [loadData]);

  const handleExport = useCallback(async () => {
    if (!groupedRanked.length || exporting) {
      return;
    }

    const allMembers = groupedRanked.flatMap((group) =>
      group.visibleItems.map((row) => parsePatrolMembersList(row.patrolMembers)),
    );
    const maxMemberCount = allMembers.reduce((max, members) => Math.max(max, members.length), 0);

    const fallbackStationCodesSet = new Set<string>();
    groupedRanked.forEach((group) => {
      group.visibleItems.forEach((row) => {
        Object.keys(row.stationPointsBreakdown).forEach((code) => {
          const normalisedCode = normaliseStationCode(code);
          if (normalisedCode) {
            fallbackStationCodesSet.add(normalisedCode);
          }
        });
      });
    });

    const fallbackStationCodes = Array.from(fallbackStationCodesSet).sort((a, b) => a.localeCompare(b, 'cs'));
    const preferredStationCodes = stationCodes.length ? stationCodes : fallbackStationCodes;
    const stationCodesForExport = Array.from(
      new Set(
        preferredStationCodes
          .concat(fallbackStationCodes)
          .map((code) => normaliseStationCode(code))
          .filter((code): code is string => Boolean(code)),
      ),
    );

    const sortedStationCodes = stationCodesForExport;

    const memberHeaders = Array.from({ length: maxMemberCount }, (_, index) => `Člen ${index + 1}`);

    try {
      setExporting(true);
      const workbook = new ExcelJS.Workbook();

      groupedRanked.forEach((group) => {
        const sheetName = formatCategoryLabel(group.category, group.sex);
        const groupStationCodes = new Set<string>();
        group.visibleItems.forEach((row) => {
          Object.keys(row.stationPointsBreakdown).forEach((code) => {
            const normalisedCode = normaliseStationCode(code);
            if (normalisedCode) {
              groupStationCodes.add(normalisedCode);
            }
          });
        });
        const sheetStationCodes = selectStationCodesForCategory(sortedStationCodes, group.category, groupStationCodes);
        const stationHeaders = sheetStationCodes.map((code) => `Body ${code}`);
        const rows = [
          [
            '#',
            'Hlídka',
            'Tým',
            ...memberHeaders,
            'Čas startu',
            'Čas doběhu',
            'Celkový čas na trati',
            'Čekání',
            'Čas na trati bez čekání',
            ...stationHeaders,
            'Body celkem',
            'Body bez času',
          ],
          ...group.visibleItems.map((row) => {
            const displayRank = row.displayRank > 0 ? row.displayRank : row.rankInBracket;
            const fallbackCode = createFallbackPatrolCode(group.category, group.sex, displayRank);
            const memberCells = formatMemberColumns(row.patrolMembers, maxMemberCount);
            const stationCells = formatStationColumns(row.stationPointsBreakdown, sheetStationCodes);
            return [
              displayRank,
              formatPatrolNumber(row.patrolCode, fallbackCode),
              row.teamName,
              ...memberCells,
              formatDateTime(row.startTime),
              formatDateTime(row.finishTime),
              formatSeconds(row.totalSeconds),
              formatSeconds(row.waitSeconds),
              formatSeconds(row.pureSeconds),
              ...stationCells,
              row.totalPoints ?? '',
              row.pointsNoT ?? '',
            ];
          }),
        ];
        if (rows.length === 1) {
          const emptyMemberCells = Array.from({ length: maxMemberCount }, () => '—');
          const emptyStationCells = Array.from({ length: sheetStationCodes.length }, () => '—');
          rows.push([
            '—',
            '—',
            'Žádné výsledky v této kategorii.',
            ...emptyMemberCells,
            '—',
            '—',
            '—',
            '—',
            '—',
            ...emptyStationCells,
            '',
            '',
          ]);
        }
        const worksheet = workbook.addWorksheet(sheetName || '—');
        worksheet.addRows(rows);
      });

      const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
      const rawName = eventName || 'vysledky';
      const safeName = rawName
        .trim()
        .replace(/[\\/?%*:|"<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/ /g, '-');
      const fileName = `${safeName || 'vysledky'}-${timestamp}.xlsx`;

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
    } catch (err) {
      console.error('Failed to export scoreboard data', err);
    } finally {
      setExporting(false);
    }
  }, [eventName, exporting, groupedRanked, stationCodes]);

  const eventLabel = eventName || 'Název závodu není k dispozici';
  const lastUpdatedLabel = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    : 'Čekám na data';
  const lastUpdatedHint = refreshing
    ? 'Načítám čerstvá data…'
    : lastUpdatedAt
      ? 'Automatická aktualizace každých 30 s.'
      : 'Zobrazí se po načtení výsledků.';

  const statusState = error ? 'error' : isOnline ? 'online' : 'offline';
  const statusLabel = error ? 'Chyba synchronizace' : isOnline ? 'Online' : 'Offline';

    return (
      <div className="scoreboard-app">
        <header className="scoreboard-hero">
          <div className="scoreboard-hero-top">
            <div className="scoreboard-hero-brand">
              <a
                className="scoreboard-hero-logo"
                href="https://zelenaliga.cz"
                target="_blank"
                rel="noreferrer"
              >
                <img src={zelenaLigaLogo} alt="Logo Setonův závod - aplikace" />
              </a>
              <div>
                <span className="scoreboard-hero-eyebrow">Setonův závod - aplikace</span>
                <h1>Výsledkový přehled</h1>
                <p className="scoreboard-hero-description">
                  Živá tabulka výsledků Setonova závodu s automatickým obnovováním dat.
                </p>
              </div>
            </div>
            <div className="scoreboard-hero-actions">
              <div className="scoreboard-action-buttons">
                <button
                  type="button"
                  className="scoreboard-button scoreboard-button--ghost"
                  onClick={handleExport}
                  disabled={!groupedRanked.length || loading || exporting}
                >
                  {exporting ? 'Exportuji…' : 'Exportovat výsledky'}
                </button>
                <button
                  type="button"
                  className="scoreboard-button scoreboard-button--primary"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  {refreshing ? 'Aktualizuji…' : 'Aktualizovat'}
                </button>
              </div>
              <div className="scoreboard-status" data-state={statusState}>
                <span className="scoreboard-status-dot" aria-hidden="true" />
                <span>{statusLabel}</span>
              </div>
            </div>
          </div>
          <div className="scoreboard-hero-meta">
            <div className="scoreboard-summary">
              <span className="scoreboard-summary-label">Závod</span>
              <strong>{eventLabel}</strong>
              <span className="scoreboard-summary-sub">
                Data pochází z pohledu Supabase <code>scoreboard_view</code>.
              </span>
            </div>
            <div className="scoreboard-summary">
              <span className="scoreboard-summary-label">Poslední aktualizace</span>
              <strong>{lastUpdatedLabel}</strong>
              <span className="scoreboard-summary-sub">{lastUpdatedHint}</span>
            </div>
          </div>
        </header>

        <main className="scoreboard-content">
          {error && <div className="scoreboard-error">{error}</div>}

          <section className="scoreboard-section">
            <div className="scoreboard-section-header">
              <h2>Pořadí podle kategorií</h2>
              {groupedRanked.length ? (
                <p className="scoreboard-section-hint">
                  Přehled je seřazen podle předem definovaných kategorií závodu.
                </p>
              ) : null}
            </div>
            {loading && !groupedRanked.length ? (
              <div className="scoreboard-placeholder">Načítám data…</div>
            ) : groupedRanked.length ? (
              <div className="scoreboard-groups">
                {groupedRanked.map((group) => {
                  const displayRows = group.items;
                  return (
                    <div key={group.key} className="scoreboard-group">
                      <h3>{formatCategoryLabel(group.category, group.sex)}</h3>
                      <table className="scoreboard-table scoreboard-table--compact">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Hlídka</th>
                            <th>Body</th>
                            <th>Body bez T</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows.length ? (
                            displayRows.map((row) => {
                              const displayRank =
                                row.displayRank > 0 ? row.displayRank : row.rankInBracket;
                              const fallbackCode = createFallbackPatrolCode(
                                group.category,
                                group.sex,
                                displayRank,
                              );
                              const members = parsePatrolMembers(row.patrolMembers);
                              const isExpanded = expandedPatrolId === row.patrolId;
                              return (
                                <tr key={row.patrolId} className={isExpanded ? 'scoreboard-row-expanded' : undefined}>
                                  <td>{displayRank}</td>
                                  <td className="scoreboard-team">
                                    <strong>{formatPatrolNumber(row.patrolCode, fallbackCode)}</strong>
                                    <button
                                      type="button"
                                      className="scoreboard-row-toggle"
                                      aria-expanded={isExpanded}
                                      onClick={() => togglePatrolDetails(row.patrolId)}
                                    >
                                      {isExpanded ? 'Skrýt hlídku' : 'Zobrazit hlídku'}
                                    </button>
                                    {isExpanded ? (
                                      <div className="scoreboard-row-details">
                                        <div className="scoreboard-row-details-item">
                                          <span className="scoreboard-row-details-label">Oddíl</span>
                                          <span className="scoreboard-row-details-value">{row.teamName}</span>
                                        </div>
                                        <div className="scoreboard-row-details-item">
                                          <span className="scoreboard-row-details-label">Členové</span>
                                          {members.length ? (
                                            <ul className="scoreboard-row-members">
                                              {members.map((member, index) => (
                                                <li key={`${row.patrolId}-member-${index}`}>
                                                  <span>{member.name}</span>
                                                  {member.nickname ? (
                                                    <span className="scoreboard-row-nickname">{member.nickname}</span>
                                                  ) : null}
                                                </li>
                                              ))}
                                            </ul>
                                          ) : (
                                            <span className="scoreboard-row-details-value">Bez záznamu členů.</span>
                                          )}
                                        </div>
                                      </div>
                                    ) : null}
                                  </td>
                                  <td>{formatPoints(row.totalPoints)}</td>
                                  <td>{formatPoints(row.pointsNoT)}</td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr className="scoreboard-table-empty">
                              <td colSpan={4}>Žádné výsledky v této kategorii.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="scoreboard-placeholder">Zatím nejsou žádné výsledky.</div>
            )}
          </section>
        </main>
        <AppFooter variant="minimal" className="scoreboard-footer" />
      </div>
    );
  }

export default ScoreboardApp;
