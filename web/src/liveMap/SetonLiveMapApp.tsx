import { useCallback, useEffect, useMemo, useState } from 'react';
import ChangePasswordScreen from '../auth/ChangePasswordScreen';
import LoginScreen from '../auth/LoginScreen';
import { useAuth } from '../auth/context';
import AppFooter from '../components/AppFooter';
import { supabase } from '../supabaseClient';
import { MAP_ADMIN_ROUTE } from '../routing';
import {
  buildLivePatrolStates,
  buildStationLiveSummaries,
  createStationOrder,
  formatPatrolLabel,
  queueSeverity,
} from './liveMapData';
import type {
  EventMapRow,
  LivePatrolState,
  MapPassage,
  MapPatrol,
  MapStationScore,
  MapStation,
  MapTiming,
  StationMapPosition,
} from './types';
import './SetonLiveMapApp.css';

function toIso(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function formatDateTime(value: string | null | undefined) {
  const normalized = toIso(value);
  if (!normalized) {
    return '—';
  }
  return new Date(normalized).toLocaleString('cs-CZ');
}

function formatMinutes(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(1).replace('.', ',')} min`;
}

function formatRoundedMinutes(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return '—';
  }
  return `${Math.max(0, Math.round(Number(value)))} min`;
}

type ParsedPatrolCode = {
  category: string;
  sex: 'H' | 'D' | '';
  number: number;
};

type PatrolSearchMatch = {
  patrolId: string;
  patrolCode: string;
  teamName: string;
  status: LivePatrolState['status'] | 'nestartovala';
  stationId: string | null;
  stationCode: string;
  stationName: string;
  latestAt: string | null;
  waitMinutes: number;
};

type PatrolSearchResult = {
  query: string;
  matches: PatrolSearchMatch[];
  error: string | null;
};

function parsePatrolCode(raw: string): ParsedPatrolCode | null {
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, '');
  const match = normalized.match(/^([NMSR])([HD])?[-]?(\d{1,3})$/);
  if (!match) {
    return null;
  }

  const number = Number.parseInt(match[3], 10);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  const sex = (match[2] ?? '') as 'H' | 'D' | '';
  return {
    category: match[1],
    sex,
    number,
  };
}

function formatParsedPatrolCode(parsed: ParsedPatrolCode, includeSex = true) {
  const sex = includeSex ? parsed.sex : '';
  return `${parsed.category}${sex}-${parsed.number}`;
}

function patrolStatusLabel(status: LivePatrolState['status'] | 'nestartovala') {
  switch (status) {
    case 'plni':
      return 'Plní';
    case 'ceka':
      return 'Čeká';
    case 'dobehla':
      return 'Doběhla';
    case 'nestartovala':
      return 'Nestartovala';
    default:
      return 'Na trase';
  }
}

function parsePatrolFromRecord(patrol: MapPatrol): ParsedPatrolCode | null {
  const fromCode = parsePatrolCode(patrol.patrol_code ?? '');
  if (fromCode) {
    return fromCode;
  }

  const categoryRaw = (patrol.category ?? '').trim().toUpperCase();
  let category = categoryRaw;
  let sexFromCategory: 'H' | 'D' | '' = '';
  if (/^[NMSR][HD]$/.test(categoryRaw)) {
    category = categoryRaw.slice(0, 1);
    sexFromCategory = categoryRaw.slice(1) as 'H' | 'D';
  }
  if (!['N', 'M', 'S', 'R'].includes(category)) {
    return null;
  }

  const sexRaw = (patrol.sex ?? '').trim().toUpperCase();
  const sex = sexRaw === 'H' || sexRaw === 'D' ? sexRaw : sexFromCategory;
  const numberMatch = (patrol.patrol_code ?? '').toUpperCase().match(/(\d{1,4})/);
  if (!numberMatch) {
    return null;
  }

  const number = Number.parseInt(numberMatch[1], 10);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return {
    category,
    sex,
    number,
  };
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function upsertById<T extends { id: string }>(items: readonly T[], row: T): T[] {
  const index = items.findIndex((item) => item.id === row.id);
  if (index < 0) {
    return [...items, row];
  }
  const next = [...items];
  next[index] = row;
  return next;
}

function upsertTiming(items: readonly MapTiming[], row: MapTiming): MapTiming[] {
  const key = `${row.event_id}:${row.patrol_id}`;
  const index = items.findIndex((item) => `${item.event_id}:${item.patrol_id}` === key);
  if (index < 0) {
    return [...items, row];
  }
  const next = [...items];
  next[index] = row;
  return next;
}

function LiveMapDashboard({
  eventId,
  eventName,
  logout,
}: {
  eventId: string;
  eventName: string;
  logout: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventMap, setEventMap] = useState<EventMapRow | null>(null);
  const [stations, setStations] = useState<MapStation[]>([]);
  const [positions, setPositions] = useState<StationMapPosition[]>([]);
  const [patrols, setPatrols] = useState<MapPatrol[]>([]);
  const [timings, setTimings] = useState<MapTiming[]>([]);
  const [passages, setPassages] = useState<MapPassage[]>([]);
  const [stationScores, setStationScores] = useState<MapStationScore[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [searchResult, setSearchResult] = useState<PatrolSearchResult | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const [mapRes, stationRes, positionRes, patrolRes, timingRes, passageRes, scoreRes] = await Promise.all([
        supabase
          .from('event_maps')
          .select('id,event_id,image_url,created_at')
          .eq('event_id', eventId)
          .maybeSingle(),
        supabase
          .from('stations')
          .select('id,event_id,code,name')
          .eq('event_id', eventId),
        supabase
          .from('station_map_positions')
          .select('id,event_id,station_id,x_percent,y_percent,created_at')
          .eq('event_id', eventId),
        supabase
          .from('patrols')
          .select('id,event_id,team_name,patrol_code,category,sex,active,disqualified')
          .eq('event_id', eventId),
        supabase
          .from('timings')
          .select('event_id,patrol_id,start_time,finish_time')
          .eq('event_id', eventId),
        supabase
          .from('station_passages')
          .select('id,event_id,station_id,patrol_id,arrived_at,left_at,wait_minutes,client_created_at')
          .eq('event_id', eventId),
        supabase
          .from('station_scores')
          .select('id,event_id,station_id,patrol_id,created_at,client_created_at')
          .eq('event_id', eventId),
      ]);

      const failed = [
        mapRes.error,
        stationRes.error,
        positionRes.error,
        patrolRes.error,
        timingRes.error,
        passageRes.error,
        scoreRes.error,
      ].find(Boolean);
      if (failed) {
        throw failed;
      }

      setEventMap((mapRes.data ?? null) as EventMapRow | null);
      setStations(((stationRes.data ?? []) as MapStation[]).map((station) => ({
        ...station,
        code: (station.code ?? '').trim().toUpperCase(),
      })));
      setPositions(((positionRes.data ?? []) as StationMapPosition[]).map((position) => ({
        ...position,
        x_percent: clampPercent(Number(position.x_percent ?? 0)),
        y_percent: clampPercent(Number(position.y_percent ?? 0)),
      })));
      setPatrols(((patrolRes.data ?? []) as MapPatrol[]).map((patrol) => ({
        ...patrol,
        patrol_code: (patrol.patrol_code ?? '').trim(),
      })));
      setTimings((timingRes.data ?? []) as MapTiming[]);
      setPassages(((passageRes.data ?? []) as MapPassage[]).map((passage) => ({
        ...passage,
        wait_minutes: Math.max(0, Number(passage.wait_minutes ?? 0) || 0),
      })));
      setStationScores((scoreRes.data ?? []) as MapStationScore[]);
      setLastSyncAt(new Date().toISOString());
    } catch (loadError) {
      console.error('Failed to load live map data', loadError);
      setError('Nepodařilo se načíst živá data mapy průchodů.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const ordered = createStationOrder(stations);
    if (!ordered.length) {
      setSelectedStationId(null);
      return;
    }
    if (selectedStationId && ordered.some((station) => station.id === selectedStationId)) {
      return;
    }
    setSelectedStationId(ordered[0].id);
  }, [selectedStationId, stations]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const mediaQuery = window.matchMedia('(max-width: 1020px)');
    const applyLayoutMode = () => {
      if (mediaQuery.matches) {
        setIsDetailOpen(false);
      } else {
        setIsDetailOpen(true);
      }
    };
    applyLayoutMode();
    const listener = () => applyLayoutMode();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
    mediaQuery.addListener(listener);
    return () => mediaQuery.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!selectedStationId || typeof window === 'undefined') {
      return;
    }
    if (window.matchMedia('(max-width: 1020px)').matches) {
      setIsDetailOpen(true);
    }
  }, [selectedStationId]);

  useEffect(() => {
    const channel = supabase
      .channel(`seton-live-map-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'station_passages', filter: `event_id=eq.${eventId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const row = payload.old as { id?: string };
            if (row.id) {
              setPassages((current) => current.filter((item) => item.id !== row.id));
            }
          } else {
            const row = payload.new as MapPassage;
            setPassages((current) => upsertById(current, {
              ...row,
              wait_minutes: Math.max(0, Number(row.wait_minutes ?? 0) || 0),
            }));
          }
          setLastSyncAt(new Date().toISOString());
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'timings', filter: `event_id=eq.${eventId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const row = payload.old as { patrol_id?: string; event_id?: string };
            if (row.event_id && row.patrol_id) {
              const key = `${row.event_id}:${row.patrol_id}`;
              setTimings((current) => current.filter((item) => `${item.event_id}:${item.patrol_id}` !== key));
            }
          } else {
            const row = payload.new as MapTiming;
            setTimings((current) => upsertTiming(current, row));
          }
          setLastSyncAt(new Date().toISOString());
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'patrols', filter: `event_id=eq.${eventId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const row = payload.old as { id?: string };
            if (row.id) {
              setPatrols((current) => current.filter((item) => item.id !== row.id));
            }
          } else {
            const row = payload.new as MapPatrol;
            setPatrols((current) => upsertById(current, row));
          }
          setLastSyncAt(new Date().toISOString());
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'station_scores', filter: `event_id=eq.${eventId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const row = payload.old as { id?: string };
            if (row.id) {
              setStationScores((current) => current.filter((item) => item.id !== row.id));
            }
          } else {
            const row = payload.new as MapStationScore;
            setStationScores((current) => upsertById(current, row));
          }
          setLastSyncAt(new Date().toISOString());
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'station_map_positions', filter: `event_id=eq.${eventId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const row = payload.old as { id?: string };
            if (row.id) {
              setPositions((current) => current.filter((item) => item.id !== row.id));
            }
          } else {
            const row = payload.new as StationMapPosition;
            setPositions((current) => upsertById(current, {
              ...row,
              x_percent: clampPercent(Number(row.x_percent ?? 0)),
              y_percent: clampPercent(Number(row.y_percent ?? 0)),
            }));
          }
          setLastSyncAt(new Date().toISOString());
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_maps', filter: `event_id=eq.${eventId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setEventMap(null);
          } else {
            setEventMap((payload.new as EventMapRow) ?? null);
          }
          setLastSyncAt(new Date().toISOString());
        },
      )
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      setRealtimeConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [eventId]);

  const patrolById = useMemo(() => new Map(patrols.map((patrol) => [patrol.id, patrol] as const)), [patrols]);

  const sortedStations = useMemo(() => createStationOrder(stations), [stations]);
  const stationById = useMemo(() => new Map(sortedStations.map((station) => [station.id, station] as const)), [sortedStations]);

  const liveStates = useMemo(
    () =>
      buildLivePatrolStates({
        patrols,
        timings,
        passages,
        now: Date.now(),
      }),
    [passages, patrols, timings],
  );

  const stationSummaries = useMemo(
    () =>
      buildStationLiveSummaries({
        stations: sortedStations,
        positions,
        passages,
        stationScores,
        livePatrols: liveStates.onCourse,
        patrolById,
      }),
    [liveStates.onCourse, passages, patrolById, positions, sortedStations, stationScores],
  );

  const summaryByStationId = useMemo(
    () => new Map(stationSummaries.map((summary) => [summary.station.id, summary] as const)),
    [stationSummaries],
  );

  const selectedSummary = selectedStationId ? summaryByStationId.get(selectedStationId) ?? null : null;

  const searchablePatrols = useMemo(
    () => [
      ...liveStates.onCourse.map((state) => ({
        patrol: state.patrol,
        status: state.status as PatrolSearchMatch['status'],
        stationId: state.currentStationId,
        latestAt: state.latestArrivalAt,
        waitMinutes: state.waitMinutes,
        parsed: parsePatrolFromRecord(state.patrol),
      })),
      ...liveStates.finished.map((state) => ({
        patrol: state.patrol,
        status: 'dobehla' as PatrolSearchMatch['status'],
        stationId: state.currentStationId,
        latestAt: state.latestArrivalAt,
        waitMinutes: state.waitMinutes,
        parsed: parsePatrolFromRecord(state.patrol),
      })),
      ...liveStates.notStarted.map((state) => ({
        patrol: state.patrol,
        status: 'nestartovala' as PatrolSearchMatch['status'],
        stationId: null,
        latestAt: null,
        waitMinutes: 0,
        parsed: parsePatrolFromRecord(state.patrol),
      })),
    ],
    [liveStates.finished, liveStates.notStarted, liveStates.onCourse],
  );

  const mapReady = Boolean(eventMap?.image_url);
  const stationsWithPosition = stationSummaries.filter((summary) => Boolean(summary.position));
  const stationsMissingPosition = stationSummaries.filter((summary) => !summary.position);
  const waitingCount = liveStates.onCourse.filter((state) => state.status === 'ceka').length;
  const servingCount = liveStates.onCourse.filter((state) => state.status === 'plni').length;
  const detailToggleLabel = isDetailOpen ? 'Skrýt detail' : 'Detail stanoviště';

  const runPatrolSearch = useCallback((rawQuery: string): PatrolSearchResult => {
    const parsed = parsePatrolCode(rawQuery);
    if (!parsed) {
      return {
        query: rawQuery.trim(),
        matches: [],
        error: 'Použij formát NH-1 nebo N-1.',
      };
    }

    const matches = searchablePatrols
      .filter((candidate) => {
        if (!candidate.parsed) {
          return false;
        }
        if (candidate.parsed.category !== parsed.category) {
          return false;
        }
        if (candidate.parsed.number !== parsed.number) {
          return false;
        }
        if (parsed.sex) {
          return candidate.parsed.sex === parsed.sex;
        }
        return true;
      })
      .map<PatrolSearchMatch>((candidate) => {
        const station = candidate.stationId ? stationById.get(candidate.stationId) : null;
        return {
          patrolId: candidate.patrol.id,
          patrolCode: formatPatrolLabel(candidate.patrol),
          teamName: candidate.patrol.team_name || 'Bez názvu',
          status: candidate.status,
          stationId: candidate.stationId,
          stationCode: station?.code ?? '—',
          stationName: station?.name ?? 'Bez stanoviště',
          latestAt: candidate.latestAt,
          waitMinutes: candidate.waitMinutes,
        };
      })
      .sort((a, b) => {
        const aTs = Date.parse(a.latestAt ?? '');
        const bTs = Date.parse(b.latestAt ?? '');
        if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) {
          return bTs - aTs;
        }
        if (Number.isFinite(aTs) && !Number.isFinite(bTs)) {
          return -1;
        }
        if (!Number.isFinite(aTs) && Number.isFinite(bTs)) {
          return 1;
        }
        return a.patrolCode.localeCompare(b.patrolCode, 'cs');
      });

    return {
      query: formatParsedPatrolCode(parsed, Boolean(parsed.sex)),
      matches,
      error: null,
    };
  }, [searchablePatrols, stationById]);

  const focusStation = useCallback((stationId: string | null) => {
    if (!stationId) {
      return;
    }
    setSelectedStationId(stationId);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1020px)').matches) {
      setIsDetailOpen(true);
    }
  }, []);

  const handleSearchSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = searchInput.trim();
    if (!trimmed) {
      setSearchResult({
        query: '',
        matches: [],
        error: 'Zadej číslo hlídky.',
      });
      return;
    }
    const result = runPatrolSearch(trimmed);
    setSearchResult(result);
    const firstWithStation = result.matches.find((match) => Boolean(match.stationId));
    if (firstWithStation?.stationId) {
      focusStation(firstWithStation.stationId);
    }
  }, [focusStation, runPatrolSearch, searchInput]);

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  if (loading) {
    return (
      <div className="live-map-shell live-map-shell--center">
        <div className="live-map-card live-map-card--narrow">
          <h1>Načítám živou mapu…</h1>
        </div>
        <AppFooter variant="minimal" />
      </div>
    );
  }

  return (
    <div className={`live-map-shell ${isMapFullscreen ? 'live-map-shell--map-fullscreen' : ''}`}>
      <header className="live-map-hud">
        <div className="live-map-hud-main">
          <div className="live-map-title-wrap">
            <h1>Živá mapa průchodů</h1>
            <p>
              {eventName} · Interní dispečink výpočetky
            </p>
          </div>
          <div className="live-map-hud-statuses">
            <span className={`live-map-badge ${realtimeConnected ? 'live-map-badge--ok' : 'live-map-badge--warn'}`}>
              {realtimeConnected ? 'Realtime připojeno' : 'Realtime odpojeno'}
            </span>
            <span className="live-map-badge live-map-badge--neutral">Sync: {formatDateTime(lastSyncAt)}</span>
          </div>
        </div>
        <section className="live-map-search" aria-label="Vyhledání hlídky">
          <form className="live-map-search-form" onSubmit={handleSearchSubmit}>
            <label htmlFor="live-map-patrol-search">Najít hlídku</label>
            <div className="live-map-search-row">
              <input
                id="live-map-patrol-search"
                type="text"
                value={searchInput}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSearchInput(value);
                  if (!value.trim()) {
                    setSearchResult(null);
                  }
                }}
                placeholder="NH-1 nebo N-1"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="live-map-button live-map-button--primary">
                Najít
              </button>
            </div>
          </form>
          {searchResult ? (
            searchResult.error ? (
              <p className="live-map-search-note live-map-search-note--error">{searchResult.error}</p>
            ) : searchResult.matches.length === 0 ? (
              <p className="live-map-search-note">Hlídka {searchResult.query} nebyla nalezena.</p>
            ) : (
              <ul className="live-map-search-results">
                {searchResult.matches.map((match) => (
                  <li key={match.patrolId}>
                    <div>
                      <strong>{match.patrolCode}</strong>
                      <span>{match.teamName}</span>
                      <em>
                        {patrolStatusLabel(match.status)} · {match.stationId ? `${match.stationCode} · ${match.stationName}` : 'Bez stanoviště'}
                      </em>
                      <small>Naposledy: {formatDateTime(match.latestAt)}</small>
                    </div>
                    {match.stationId ? (
                      <button
                        type="button"
                        className="live-map-button live-map-button--secondary"
                        onClick={() => focusStation(match.stationId)}
                      >
                        Otevřít
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="live-map-search-hint">Vyhledávání funguje pro NH-1 i N-1.</p>
          )}
        </section>
        <div className="live-map-hud-stats">
          <article className="live-map-stat-pill">
            <span>Na trase</span>
            <strong>{liveStates.onCourse.length}</strong>
          </article>
          <article className="live-map-stat-pill">
            <span>Čeká</span>
            <strong>{waitingCount}</strong>
          </article>
          <article className="live-map-stat-pill">
            <span>Plní</span>
            <strong>{servingCount}</strong>
          </article>
          <article className="live-map-stat-pill">
            <span>Doběhly</span>
            <strong>{liveStates.finished.length}</strong>
          </article>
          <article className="live-map-stat-pill">
            <span>Nestart</span>
            <strong>{liveStates.notStarted.length}</strong>
          </article>
        </div>
        <div className="live-map-hud-actions">
          <a className="live-map-button live-map-button--secondary" href={MAP_ADMIN_ROUTE}>
            Editor mapy
          </a>
          <button
            type="button"
            className="live-map-button live-map-button--secondary"
            onClick={() => void refreshData()}
            disabled={refreshing}
          >
            {refreshing ? 'Obnovuji…' : 'Obnovit'}
          </button>
          <button
            type="button"
            className="live-map-button live-map-button--secondary"
            onClick={() => setIsDetailOpen((current) => !current)}
          >
            {detailToggleLabel}
          </button>
          <button
            type="button"
            className="live-map-button live-map-button--secondary"
            onClick={() => setIsMapFullscreen((current) => !current)}
          >
            {isMapFullscreen ? 'Konec fullscreen' : 'Fullscreen mapy'}
          </button>
          <button type="button" className="live-map-button live-map-button--secondary" onClick={() => logout()}>
            Odhlásit se
          </button>
        </div>
      </header>

      <main className="live-map-main">
        {error ? <p className="live-map-error">{error}</p> : null}
        <section className="live-map-stage">
          <article className="live-map-map-wrap">
            <header className="live-map-map-head">
              <h2>Mapa závodu</h2>
              <p>Klikni na stanoviště pro živý detail fronty a průchodů.</p>
            </header>

            {mapReady ? (
              <div className="live-map-canvas">
                <img src={eventMap?.image_url} alt="Mapa závodu" />
                {stationsWithPosition.map((summary) => {
                  const position = summary.position;
                  if (!position) {
                    return null;
                  }
                  const severity = queueSeverity(summary.waitingCount);
                  const isSelected = selectedStationId === summary.station.id;
                  return (
                    <button
                      key={summary.station.id}
                      type="button"
                      className={`live-map-marker live-map-marker--${severity} ${summary.servingCount > 0 ? 'live-map-marker--pulse' : ''} ${
                        isSelected ? 'live-map-marker--selected' : ''
                      }`}
                      style={{
                        left: `${position.x_percent}%`,
                        top: `${position.y_percent}%`,
                      }}
                      title={`${summary.station.code} · ${summary.station.name} · plní: ${summary.servingCount}, čeká: ${summary.waitingCount}`}
                      onClick={() => setSelectedStationId(summary.station.id)}
                    >
                      <span className="live-map-marker-code">{summary.station.code}</span>
                      <span className="live-map-marker-badges">
                        <span><small>P</small>{summary.servingCount}</span>
                        <span><small>Č</small>{summary.waitingCount}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="live-map-empty">
                <h3>Mapa zatím není nahraná</h3>
                <p>V editoru mapy nahraj obrázek závodu a nastav pozice stanovišť.</p>
              </div>
            )}

            <div className="live-map-map-foot">
              <div className="live-map-legend">
                <span><i className="live-map-dot live-map-dot--ok" /> Bez fronty</span>
                <span><i className="live-map-dot live-map-dot--warn" /> 1–2 čekající</span>
                <span><i className="live-map-dot live-map-dot--critical" /> 3+ čekajících</span>
              </div>
              {stationsMissingPosition.length > 0 ? (
                <p className="live-map-note">
                  Bez pozice: {stationsMissingPosition.map((item) => item.station.code).join(', ')}
                </p>
              ) : null}
            </div>
          </article>

          <aside className={`live-map-detail-panel ${isDetailOpen ? 'is-open' : ''}`}>
            <div className="live-map-detail-handle">
              <button
                type="button"
                className="live-map-detail-toggle"
                onClick={() => setIsDetailOpen((current) => !current)}
              >
                {isDetailOpen ? 'Skrýt panel' : 'Zobrazit detail'}
              </button>
            </div>
            <header className="live-map-section-header">
              <h2>Detail stanoviště</h2>
              <p>{selectedSummary ? `${selectedSummary.station.code} · ${selectedSummary.station.name}` : 'Vyber stanoviště na mapě.'}</p>
            </header>

            {selectedSummary ? (
              <>
                <div className="live-map-detail-metrics">
                  <div>
                    <span>Plní</span>
                    <strong>{selectedSummary.servingCount}</strong>
                  </div>
                  <div>
                    <span>Čeká</span>
                    <strong>{selectedSummary.waitingCount}</strong>
                  </div>
                  <div>
                    <span>Průměr čekání</span>
                    <strong>{formatMinutes(selectedSummary.averageWaitMinutes)}</strong>
                  </div>
                  <div>
                    <span>Průměr plnění</span>
                    <strong>{formatMinutes(selectedSummary.averageServiceMinutes)}</strong>
                  </div>
                </div>

                <div className="live-map-detail-group">
                  <h3>Právě plní</h3>
                  {selectedSummary.servingPatrols.length === 0 ? (
                    <p>Žádná hlídka.</p>
                  ) : (
                    <ul className="live-map-chip-list">
                      {selectedSummary.servingPatrols.map((state) => (
                        <li key={`serving-${state.patrol.id}`}>
                          <strong>{formatPatrolLabel(state.patrol)}</strong>
                          <span>{state.patrol.team_name || 'Bez názvu'}</span>
                          <em>plnění · čekání {formatRoundedMinutes(state.waitMinutes)}</em>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="live-map-detail-group">
                  <h3>Čekající hlídky</h3>
                  {selectedSummary.waitingPatrols.length === 0 ? (
                    <p>Žádná hlídka.</p>
                  ) : (
                    <ul className="live-map-chip-list">
                      {selectedSummary.waitingPatrols.map((state) => (
                        <li key={`waiting-${state.patrol.id}`}>
                          <strong>{formatPatrolLabel(state.patrol)}</strong>
                          <span>{state.patrol.team_name || 'Bez názvu'}</span>
                          <em>čekání {formatRoundedMinutes(state.waitMinutes)}</em>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="live-map-detail-group">
                  <h3>Poslední průchody</h3>
                  {selectedSummary.recentPassages.length === 0 ? (
                    <p>Zatím žádné průchody.</p>
                  ) : (
                    <ul className="live-map-chip-list">
                      {selectedSummary.recentPassages.map((passage) => (
                        <li key={passage.id}>
                          <strong>{passage.patrolCode}</strong>
                          <span>{formatDateTime(passage.arrivedAt)}</span>
                          <em>čekání {formatRoundedMinutes(passage.waitMinutes)}</em>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p>Vyber stanoviště kliknutím na bod v mapě.</p>
            )}
          </aside>
        </section>
      </main>
      <AppFooter variant="minimal" />
    </div>
  );
}

function SetonLiveMapApp() {
  const { status, logout } = useAuth();

  if (status.state === 'loading') {
    return (
      <div className="live-map-shell live-map-shell--center">
        <div className="live-map-card live-map-card--narrow">
          <h1>Načítám…</h1>
        </div>
        <AppFooter variant="minimal" />
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <div className="live-map-shell live-map-shell--center">
        <div className="live-map-card live-map-card--narrow">
          <h1>Nelze načíst aplikaci</h1>
          <p>{status.message || 'Zkontroluj připojení nebo konfiguraci a zkus to znovu.'}</p>
          <button type="button" className="live-map-button live-map-button--primary" onClick={() => window.location.reload()}>
            Zkusit znovu
          </button>
        </div>
        <AppFooter variant="minimal" />
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
    const stationCode = status.manifest.station.code.trim().toUpperCase();
    if (stationCode !== 'T') {
      return (
        <div className="live-map-shell live-map-shell--center">
          <div className="live-map-card live-map-card--narrow">
            <h1>Přístup zamítnut</h1>
            <p>Živá mapa průchodů je dostupná pouze pro výpočetku (stanoviště T).</p>
            <button type="button" className="live-map-button live-map-button--secondary" onClick={() => void logout()}>
              Odhlásit se
            </button>
          </div>
          <AppFooter variant="minimal" />
        </div>
      );
    }

    return (
      <LiveMapDashboard
        eventId={status.manifest.event.id}
        eventName={status.manifest.event.name}
        logout={logout}
      />
    );
  }

  return null;
}

export default SetonLiveMapApp;
