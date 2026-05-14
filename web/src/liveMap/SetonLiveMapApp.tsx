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

  const mapReady = Boolean(eventMap?.image_url);
  const stationsWithPosition = stationSummaries.filter((summary) => Boolean(summary.position));
  const stationsMissingPosition = stationSummaries.filter((summary) => !summary.position);

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
    <div className="live-map-shell">
      <header className="live-map-header">
        <div className="live-map-header-inner">
          <div>
            <h1>Živá mapa průchodů</h1>
            <p>
              {eventName} · Interní dispečink výpočetky
            </p>
          </div>
          <div className="live-map-header-actions">
            <a className="live-map-button live-map-button--secondary" href={MAP_ADMIN_ROUTE}>
              Editor mapy
            </a>
            <button
              type="button"
              className="live-map-button live-map-button--secondary"
              onClick={() => void refreshData()}
              disabled={refreshing}
            >
              {refreshing ? 'Obnovuji…' : 'Obnovit data'}
            </button>
            <button type="button" className="live-map-button live-map-button--secondary" onClick={() => logout()}>
              Odhlásit se
            </button>
          </div>
        </div>
      </header>

      <main className="live-map-content">
        <section className="live-map-card live-map-card--metrics">
          <div className="live-map-metrics">
            <article>
              <span>Na trase</span>
              <strong>{liveStates.onCourse.length}</strong>
            </article>
            <article>
              <span>Čeká</span>
              <strong>{liveStates.onCourse.filter((state) => state.status === 'ceka').length}</strong>
            </article>
            <article>
              <span>Plní</span>
              <strong>{liveStates.onCourse.filter((state) => state.status === 'plni').length}</strong>
            </article>
            <article>
              <span>Doběhly</span>
              <strong>{liveStates.finished.length}</strong>
            </article>
            <article>
              <span>Nestartovaly</span>
              <strong>{liveStates.notStarted.length}</strong>
            </article>
          </div>
          <div className="live-map-status-row">
            <span className={`live-map-badge ${realtimeConnected ? 'live-map-badge--ok' : 'live-map-badge--warn'}`}>
              {realtimeConnected ? 'Realtime připojeno' : 'Realtime odpojeno'}
            </span>
            <span className="live-map-badge live-map-badge--neutral">Poslední sync: {formatDateTime(lastSyncAt)}</span>
          </div>
          {error ? <p className="live-map-error">{error}</p> : null}
        </section>

        <section className="live-map-grid">
          <article className="live-map-card live-map-card--map">
            <header className="live-map-section-header">
              <h2>Mapa závodu</h2>
              <p>Klikni na stanoviště pro detail fronty a průchodů.</p>
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
                        <span>{summary.servingCount}</span>
                        <span>{summary.waitingCount}</span>
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
          </article>

          <aside className="live-map-card live-map-card--detail">
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
                  <h3>Aktuálně plní</h3>
                  {selectedSummary.servingPatrols.length === 0 ? (
                    <p>Žádná hlídka.</p>
                  ) : (
                    <ul>
                      {selectedSummary.servingPatrols.map((state) => (
                        <li key={`serving-${state.patrol.id}`}>
                          <strong>{formatPatrolLabel(state.patrol)}</strong>
                          <span>{state.patrol.team_name || 'Bez názvu'}</span>
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
                    <ul>
                      {selectedSummary.waitingPatrols.map((state) => (
                        <li key={`waiting-${state.patrol.id}`}>
                          <strong>{formatPatrolLabel(state.patrol)}</strong>
                          <span>{state.patrol.team_name || 'Bez názvu'}</span>
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
                    <ul>
                      {selectedSummary.recentPassages.map((passage) => (
                        <li key={passage.id}>
                          <strong>{passage.patrolCode}</strong>
                          <span>{formatDateTime(passage.arrivedAt)}</span>
                          <span>Čekání: {passage.waitMinutes} min</span>
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
