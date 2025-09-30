import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import './ScoreboardApp.css';

interface RawResult {
  event_id: string;
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

const BRACKET_ORDER = ['N__H', 'N__D', 'M__H', 'M__D', 'S__H', 'S__D', 'R__H', 'R__D'];

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

function formatPatrolNumber(patrolCode: string | null) {
  function formatPatrolNumber(patrolCode: string | null) {
    if (!patrolCode) return '—';
    const normalized = patrolCode.trim();
    if (!normalized) return '—';
    return normalized.toUpperCase();
  }

  function ScoreboardApp() {
    const [overall, setOverall] = useState<Result[]>([]);
    const [ranked, setRanked] = useState<RankedResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
    const [eventName, setEventName] = useState<string>('');
    const isMountedRef = useRef(true);

    useEffect(() => {
      return () => {
        isMountedRef.current = false;
      };
    }, []);

    useEffect(() => {
      (async () => {
        try {
          const { data, error } = await supabase
            .from('events')
            .select('name')
            .eq('id', rawEventId)
            .limit(1);
          if (!isMountedRef.current) return;
          if (error) {
            console.error('Failed to load event name', error);
            setEventName('');
            return;
          }
          const row = Array.isArray(data) && data.length ? data[0] : null;
          setEventName((row as { name?: string } | null)?.name ?? '');
        } catch (err) {
          if (!isMountedRef.current) return;
          console.error('Failed to load event name', err);
          setEventName('');
        }
      })();
    }, [rawEventId]);

    const loadData = useCallback(async () => {
      setRefreshing(true);
      try {
        const [overallRes, rankedRes] = await Promise.all([
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

        const overallError = overallRes.error;
        const rankedError = rankedRes.error;

        if (overallRes.data) {
          setOverall(overallRes.data.map(normaliseResult));
        } else {
          setOverall([]);
        }

        if (rankedRes.data) {
          setRanked(rankedRes.data.map(normaliseRankedResult));
        } else {
          setRanked([]);
        }

        if (overallError && rankedError) {
          console.error('Failed to load scoreboard data', overallError, rankedError);
          setError('Nepodařilo se načíst výsledky. Zkuste to prosím znovu.');
        } else if (overallError) {
          console.error('Failed to load overall standings', overallError);
          setError('Nepodařilo se načíst celkové pořadí.');
        } else if (rankedError) {
          console.error('Failed to load ranked standings', rankedError);
          setError('Nepodařilo se načíst pořadí podle kategorií.');
        } else {
          setError(null);
        }

        setLastUpdatedAt(new Date());
        setLoading(false);
        setRefreshing(false);
      } catch (err) {
        console.error('Failed to load scoreboard data', err);
        if (!isMountedRef.current) return;
        setError('Nepodařilo se načíst výsledky. Zkuste to prosím znovu.');
        setOverall([]);
        setRanked([]);
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
            {eventName ? <p className="scoreboard-subtitle">{eventName}</p> : null}
            {!eventName ? <p className="scoreboard-subtitle subtle">{rawEventId}</p> : null}
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
              {refreshing ? 'Aktualizuji…' : 'Aktualizovat'}
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
                  <th>Hlídka</th>
                  <th>Kategorie</th>
                  <th>Body</th>
                  <th>Body bez T</th>
                  <th>Čistý čas</th>
                </tr>
              </thead>
              <tbody>
                {overall.map((row, index) => (
                  <tr key={row.patrolId}>
                    <RankCell position={index + 1} patrolCode={row.patrolCode} />
                    <td className="scoreboard-team">
                      <strong>{formatPatrolNumber(row.patrolCode)}</strong>
                      <strong>{formatPatrolNumber(row.patrolCode)}</strong>
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
                        <th>Hlídka</th>
                        <th>Body</th>
                        <th>Body bez T</th>
                        <th>Čistý čas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((row) => (
                        <tr key={row.patrolId}>
                          <RankCell position={row.rankInBracket} patrolCode={row.patrolCode} />
                          <td className="scoreboard-team">
                            <strong>{formatPatrolNumber(row.patrolCode)}</strong>
                            <strong>{formatPatrolNumber(row.patrolCode)}</strong>
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
