import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
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
  total_points: number | string | null;
  points_no_T: number | string | null;
  pure_seconds: number | string | null;
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
  totalPoints: number | null;
  pointsNoT: number | null;
  pureSeconds: number | null;
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
  items: RankedGroupItem[];
}

const rawEventId = import.meta.env.VITE_EVENT_ID as string | undefined;

if (!rawEventId) {
  throw new Error('Missing VITE_EVENT_ID environment variable.');
}

const REFRESH_INTERVAL_MS = 30_000;

const BRACKET_ORDER = ['N__H', 'N__D', 'M__H', 'M__D', 'S__H', 'S__D', 'R__H', 'R__D'];

const BRACKET_ORDER_INDEX = new Map(BRACKET_ORDER.map((key, index) => [key, index] as const));

function normaliseText(value: string | null | undefined) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function parseNumber(value: number | string | null, fallback: number | null = null): number | null {
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
    totalPoints: parseNumber(raw.total_points),
    pointsNoT: parseNumber(raw.points_no_T),
    pureSeconds: parseNumber(raw.pure_seconds),
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
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
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

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('results_ranked')
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
    const groups = new Map<string, { key: string; category: string; sex: string; items: RankedResult[] }>();

    ranked.forEach((item) => {
      const key = `${item.category}__${item.sex}`;
      if (!groups.has(key)) {
        groups.set(key, { key, category: item.category, sex: item.sex, items: [] });
      }
      groups.get(key)!.items.push(item);
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        items: [...group.items]
          .sort(compareRankedResults)
          .map((item, index) => ({ ...item, displayRank: index + 1 })),
      }))
      .sort((a, b) => compareBrackets(a.category, a.sex, b.category, b.sex));
  }, [ranked]);

  const handleRefresh = useCallback(() => {
    loadData();
  }, [loadData]);

  const handleExport = useCallback(() => {
    if (!groupedRanked.length || exporting) {
      return;
    }

    try {
      setExporting(true);
      const workbook = XLSX.utils.book_new();

      groupedRanked.forEach((group) => {
        const sheetName = formatCategoryLabel(group.category, group.sex);
        const rows = [
          ['#', 'Hlídka', 'Tým', 'Body', 'Body bez T'],
          ...group.items.map((row) => {
            const displayRank = row.displayRank > 0 ? row.displayRank : row.rankInBracket;
            const fallbackCode = createFallbackPatrolCode(group.category, group.sex, displayRank);
            return [
              displayRank,
              formatPatrolNumber(row.patrolCode, fallbackCode),
              row.teamName,
              row.totalPoints ?? '',
              row.pointsNoT ?? '',
            ];
          }),
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName || '—');
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

      XLSX.writeFile(workbook, fileName);
    } catch (err) {
      console.error('Failed to export scoreboard data', err);
    } finally {
      setExporting(false);
    }
  }, [eventName, exporting, groupedRanked]);

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

  return (
    <div className="scoreboard-app">
      <header className="scoreboard-hero">
        <div className="scoreboard-hero-top">
          <div className="scoreboard-hero-brand">
            <div className="scoreboard-hero-logo">
              <img src={zelenaLigaLogo} alt="Logo Zelená liga" />
            </div>
            <div>
              <span className="scoreboard-hero-eyebrow">Zelená liga</span>
              <h1>Výsledkový přehled</h1>
              <p className="scoreboard-hero-description">
                Živá tabulka výsledků závodu s automatickým obnovováním dat.
              </p>
            </div>
          </div>
          <div className="scoreboard-hero-actions">
            <button
              type="button"
              className="scoreboard-button scoreboard-button--ghost"
              onClick={handleExport}
              disabled={!groupedRanked.length || loading || exporting}
            >
              {exporting ? 'Exportuji…' : 'Exportovat Excel'}
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
        </div>
        <div className="scoreboard-hero-meta">
          <div className="scoreboard-summary">
            <span className="scoreboard-summary-label">Závod</span>
            <strong>{eventLabel}</strong>
            <span className="scoreboard-summary-sub">
              Data pochází z tabulky Supabase <code>results_ranked</code>.
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
              {groupedRanked.map((group) => (
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
                      {group.items.map((row) => {
                        const displayRank = row.displayRank > 0 ? row.displayRank : row.rankInBracket;
                        const fallbackCode = createFallbackPatrolCode(
                          group.category,
                          group.sex,
                          displayRank,
                        );
                        return (
                          <tr key={row.patrolId}>
                            <td>{displayRank}</td>
                            <td className="scoreboard-team">
                              <strong>{formatPatrolNumber(row.patrolCode, fallbackCode)}</strong>
                            </td>
                            <td>{formatPoints(row.totalPoints)}</td>
                            <td>{formatPoints(row.pointsNoT)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            <div className="scoreboard-placeholder">Zatím nejsou žádné výsledky.</div>
          )}
        </section>
      </main>
      <AppFooter className="scoreboard-footer" />
    </div>
  );
}

export default ScoreboardApp;
