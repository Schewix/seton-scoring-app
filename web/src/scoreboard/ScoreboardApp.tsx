import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import './ScoreboardApp.css';

interface RawResult {
  event_id: string;
  patrol_id: string;
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
  patrolId: string;
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

interface RankedGroup {
  key: string;
  category: string;
  sex: string;
  items: RankedResult[];
}

const rawEventId = import.meta.env.VITE_EVENT_ID as string | undefined;

if (!rawEventId) {
  throw new Error('Missing VITE_EVENT_ID environment variable.');
}

const REFRESH_INTERVAL_MS = 30_000;

const BRACKET_ORDER = [
  'N__H',
  'N__D',
  'M__H',
  'M__D',
  'S__H',
  'S__D',
  'R__H',
  'R__D',
];

const BRACKET_ORDER_INDEX = new Map(BRACKET_ORDER.map((key, index) => [key, index] as const));

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

function normaliseResult(raw: RawResult): Result {
  return {
    eventId: raw.event_id,
    patrolId: raw.patrol_id,
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

function ScoreboardApp() {
  const [overall, setOverall] = useState<Result[]>([]);
  const [ranked, setRanked] = useState<RankedResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    setError(null);
    setRefreshing(true);

    const [{ data: overallData, error: overallError }, { data: rankedData, error: rankedError }] =
      await Promise.all([
        supabase
          .from('results')
          .select('*')
          .eq('event_id', rawEventId)
          .order('total_points', { ascending: false })
          .order('points_no_T', { ascending: false })
          .order('pure_seconds', { ascending: true }),
        supabase
          .from('results_ranked')
          .select('*')
          .eq('event_id', rawEventId)
          .order('category', { ascending: true })
          .order('sex', { ascending: true })
          .order('rank_in_bracket', { ascending: true }),
      ]);

    if (!isMountedRef.current) {
      return;
    }

    if (overallError || rankedError) {
      console.error('Failed to load scoreboard data', overallError || rankedError);
      setError('Nepodařilo se načíst výsledky. Zkuste to prosím znovu.');
    }

    if (overallData) {
      setOverall(overallData.map(normaliseResult));
    }

    if (rankedData) {
      setRanked(rankedData.map(normaliseRankedResult));
    }

    setLastUpdatedAt(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

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
    document.title = 'Seton – Výsledky';
  }, []);

  const groupedRanked = useMemo(() => {
    const groups = new Map<string, RankedGroup>();

    ranked.forEach((item) => {
      const key = `${item.category}__${item.sex}`;
      if (!groups.has(key)) {
        groups.set(key, { key, category: item.category, sex: item.sex, items: [] });
      }
      groups.get(key)!.items.push(item);
    });

    return Array.from(groups.values()).sort((a, b) => compareBrackets(a.category, a.sex, b.category, b.sex));
  }, [ranked]);

  const handleRefresh = useCallback(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="scoreboard-app">
      <header className="scoreboard-header">
        <div>
          <h1>Výsledkový přehled</h1>
          <p className="scoreboard-subtitle">
            Data z pohledů Supabase <code>results</code> a <code>results_ranked</code>.
          </p>
        </div>
        <div className="scoreboard-meta">
          {lastUpdatedAt && (
            <span>
              Aktualizováno: {lastUpdatedAt.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button type="button" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Aktualizuji…' : 'Aktualizovat' }
          </button>
        </div>
      </header>

      {error && <div className="scoreboard-error">{error}</div>}

      <section className="scoreboard-section">
        <h2>Celkové pořadí</h2>
        {loading && !overall.length ? (
          <div className="scoreboard-placeholder">Načítám data…</div>
        ) : overall.length ? (
          <table className="scoreboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Tým</th>
                <th>Kategorie</th>
                <th>Body</th>
                <th>Body bez T</th>
                <th>Čistý čas</th>
              </tr>
            </thead>
            <tbody>
              {overall.map((row, index) => (
                <tr key={row.patrolId}>
                  <td>{index + 1}</td>
                  <td className="scoreboard-team">
                    <strong>{row.teamName}</strong>
                    <span className="scoreboard-team-meta">{row.sex}</span>
                  </td>
                  <td>{formatCategoryLabel(row.category, row.sex)}</td>
                  <td>{formatPoints(row.totalPoints)}</td>
                  <td>{formatPoints(row.pointsNoT)}</td>
                  <td>{formatSeconds(row.pureSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="scoreboard-placeholder">Zatím nejsou žádné výsledky.</div>
        )}
      </section>

      <section className="scoreboard-section">
        <h2>Pořadí podle kategorií</h2>
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
                      <th>Tým</th>
                      <th>Body</th>
                      <th>Body bez T</th>
                      <th>Čistý čas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((row) => (
                      <tr key={row.patrolId}>
                        <td>{row.rankInBracket}</td>
                        <td className="scoreboard-team">
                          <strong>{row.teamName}</strong>
                        </td>
                        <td>{formatPoints(row.totalPoints)}</td>
                        <td>{formatPoints(row.pointsNoT)}</td>
                        <td>{formatSeconds(row.pureSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : (
          <div className="scoreboard-placeholder">Zatím nejsou žádné výsledky.</div>
        )}
      </section>
    </div>
  );
}

export default ScoreboardApp;
