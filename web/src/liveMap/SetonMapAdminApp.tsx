import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import ChangePasswordScreen from '../auth/ChangePasswordScreen';
import LoginScreen from '../auth/LoginScreen';
import { useAuth } from '../auth/context';
import AppFooter from '../components/AppFooter';
import { env } from '../envVars';
import { ADMIN_ROUTE_PREFIX } from '../routing';
import { supabase } from '../supabaseClient';
import { createStationOrder } from './liveMapData';
import type { EventMapRow, MapStation, StationMapPosition } from './types';
import './SetonMapAdminApp.css';

const BASE_CATEGORY_ORDER = ['N', 'M', 'S', 'R'] as const;
type BaseCategoryKey = (typeof BASE_CATEGORY_ORDER)[number];

type SetupEventRow = {
  id: string;
  name: string;
};

type SetupStationRow = {
  id: string;
  event_id: string;
  code: string | null;
  name: string | null;
  is_split?: boolean | null;
  split_categories?: string[] | null;
};

type PositionDraft = {
  x_percent: number;
  y_percent: number;
} | null;

const API_BASE_URL = env.VITE_AUTH_API_URL?.replace(/\/$/, '') ?? '';
const MAP_BUCKET = 'event-maps';
const MAP_ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function normalizeStationSplitCategories(value: unknown): BaseCategoryKey[] {
  const values = Array.isArray(value) ? value : [];
  const normalized = values
    .map((entry) => (typeof entry === 'string' ? entry.trim().toUpperCase() : ''))
    .filter((entry): entry is BaseCategoryKey => BASE_CATEGORY_ORDER.includes(entry as BaseCategoryKey));
  const dedup = new Set(normalized);
  return BASE_CATEGORY_ORDER.filter((category) => dedup.has(category));
}

function formatStationSplitLabel(station: Pick<MapStation, 'is_split' | 'split_categories'>) {
  if (!station.is_split) {
    return 'Nerozdělené';
  }
  const categories = normalizeStationSplitCategories(station.split_categories);
  if (categories.length === 0) {
    return 'Rozdělené · bez kategorií';
  }
  return `Rozdělené · ${categories.join(', ')}`;
}

function sanitizeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
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

function toPositionDraftMap(positions: readonly StationMapPosition[]) {
  const next = new Map<string, PositionDraft>();
  positions.forEach((position) => {
    next.set(position.station_id, {
      x_percent: clampPercent(Number(position.x_percent ?? 0)),
      y_percent: clampPercent(Number(position.y_percent ?? 0)),
    });
  });
  return next;
}

function MapEditorDashboard({
  eventId,
  eventName,
  accessToken,
  logout,
}: {
  eventId: string;
  eventName: string;
  accessToken: string;
  logout: () => Promise<void>;
}) {
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [events, setEvents] = useState<SetupEventRow[]>([]);
  const [stations, setStations] = useState<SetupStationRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState(eventId);

  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [eventMap, setEventMap] = useState<EventMapRow | null>(null);
  const [positions, setPositions] = useState<StationMapPosition[]>([]);
  const [draftPositions, setDraftPositions] = useState<Map<string, PositionDraft>>(new Map());
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

  const [uploadingMap, setUploadingMap] = useState(false);
  const [savingPositions, setSavingPositions] = useState(false);
  const [draggingStationId, setDraggingStationId] = useState<string | null>(null);

  const mapCanvasRef = useRef<HTMLDivElement | null>(null);

  const selectedStations = useMemo(() => {
    const filtered = stations
      .filter((station) => station.event_id === selectedEventId)
      .map<MapStation>((station) => ({
        id: station.id,
        event_id: station.event_id,
        code: (station.code ?? '').trim().toUpperCase(),
        name: (station.name ?? '').trim(),
        is_split: station.is_split === true,
        split_categories: normalizeStationSplitCategories(station.split_categories),
      }))
      .filter((station) => station.code.length > 0);
    return createStationOrder(filtered);
  }, [selectedEventId, stations]);

  const sortedPositions = useMemo(() => {
    const existingByStationId = new Map(positions.map((position) => [position.station_id, position] as const));
    return selectedStations
      .map((station) => {
        const draft = draftPositions.get(station.id) ?? null;
        const existing = existingByStationId.get(station.id) ?? null;
        if (!draft && !existing) {
          return null;
        }
        const x = draft?.x_percent ?? clampPercent(Number(existing?.x_percent ?? 0));
        const y = draft?.y_percent ?? clampPercent(Number(existing?.y_percent ?? 0));
        return {
          station,
          x_percent: x,
          y_percent: y,
          hasSaved: Boolean(existing),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [draftPositions, positions, selectedStations]);

  const loadSetupData = useCallback(async () => {
    if (!API_BASE_URL) {
      setSetupLoading(false);
      setSetupError('Chybí konfigurace API (VITE_AUTH_API_URL).');
      return;
    }

    setSetupLoading(true);
    setSetupError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/admin/event-state?setup=1`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        current_event_id?: string;
        events?: SetupEventRow[];
        stations?: SetupStationRow[];
      };

      if (!response.ok) {
        throw new Error(body.error || 'Nepodařilo se načíst administraci mapy.');
      }

      const nextEvents = Array.isArray(body.events) ? body.events : [];
      const nextStations = Array.isArray(body.stations) ? body.stations : [];
      const currentEventId = (body.current_event_id ?? '').trim();

      setEvents(nextEvents);
      setStations(nextStations);
      setSelectedEventId((prev) => {
        if (prev && nextEvents.some((eventRow) => eventRow.id === prev)) {
          return prev;
        }
        if (nextEvents.some((eventRow) => eventRow.id === eventId)) {
          return eventId;
        }
        if (currentEventId && nextEvents.some((eventRow) => eventRow.id === currentEventId)) {
          return currentEventId;
        }
        return nextEvents[0]?.id ?? eventId;
      });
    } catch (error) {
      console.error('Failed to load map setup data', error);
      setSetupError(error instanceof Error ? error.message : 'Nepodařilo se načíst administraci mapy.');
    } finally {
      setSetupLoading(false);
    }
  }, [accessToken, eventId]);

  const loadMapData = useCallback(async (targetEventId: string) => {
    if (!targetEventId) {
      setEventMap(null);
      setPositions([]);
      setDraftPositions(new Map());
      return;
    }

    setMapLoading(true);
    setMapError(null);

    try {
      const [mapRes, positionRes] = await Promise.all([
        supabase
          .from('event_maps')
          .select('id,event_id,image_url,created_at')
          .eq('event_id', targetEventId)
          .maybeSingle(),
        supabase
          .from('station_map_positions')
          .select('id,event_id,station_id,x_percent,y_percent,created_at')
          .eq('event_id', targetEventId),
      ]);

      if (mapRes.error) {
        throw mapRes.error;
      }
      if (positionRes.error) {
        throw positionRes.error;
      }

      const loadedPositions = ((positionRes.data ?? []) as StationMapPosition[]).map((position) => ({
        ...position,
        x_percent: clampPercent(Number(position.x_percent ?? 0)),
        y_percent: clampPercent(Number(position.y_percent ?? 0)),
      }));

      setEventMap((mapRes.data ?? null) as EventMapRow | null);
      setPositions(loadedPositions);
      setDraftPositions(toPositionDraftMap(loadedPositions));
      setMapNotice(null);
    } catch (error) {
      console.error('Failed to load map data', error);
      setMapError('Nepodařilo se načíst mapu nebo pozice stanovišť.');
      setEventMap(null);
      setPositions([]);
      setDraftPositions(new Map());
    } finally {
      setMapLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSetupData();
  }, [loadSetupData]);

  useEffect(() => {
    if (!selectedEventId) {
      return;
    }
    void loadMapData(selectedEventId);
  }, [loadMapData, selectedEventId]);

  useEffect(() => {
    if (!selectedStations.length) {
      setSelectedStationId(null);
      return;
    }
    if (selectedStationId && selectedStations.some((station) => station.id === selectedStationId)) {
      return;
    }
    setSelectedStationId(selectedStations[0].id);
  }, [selectedStationId, selectedStations]);

  const updatePositionFromPointer = useCallback((stationId: string, clientX: number, clientY: number) => {
    const canvas = mapCanvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const xPercent = clampPercent(((clientX - rect.left) / rect.width) * 100);
    const yPercent = clampPercent(((clientY - rect.top) / rect.height) * 100);

    setDraftPositions((current) => {
      const next = new Map(current);
      next.set(stationId, {
        x_percent: xPercent,
        y_percent: yPercent,
      });
      return next;
    });
  }, []);

  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedStationId) {
      setMapNotice('Nejdřív vyber stanoviště v seznamu vpravo.');
      return;
    }
    setMapNotice(null);
    updatePositionFromPointer(selectedStationId, event.clientX, event.clientY);
  }, [selectedStationId, updatePositionFromPointer]);

  const handleMarkerPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, stationId: string) => {
    event.preventDefault();
    setSelectedStationId(stationId);
    setDraggingStationId(stationId);
    updatePositionFromPointer(stationId, event.clientX, event.clientY);
  }, [updatePositionFromPointer]);

  useEffect(() => {
    if (!draggingStationId) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      updatePositionFromPointer(draggingStationId, event.clientX, event.clientY);
    };

    const handlePointerUp = () => {
      setDraggingStationId(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingStationId, updatePositionFromPointer]);

  const handleMapFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!file || !selectedEventId) {
      return;
    }

    if (!MAP_ALLOWED_TYPES.has(file.type)) {
      setMapError('Podporované formáty mapy jsou PNG, JPG a WEBP.');
      return;
    }

    setUploadingMap(true);
    setMapError(null);
    setMapNotice(null);

    try {
      const safeName = sanitizeFileName(file.name) || `map-${Date.now()}.png`;
      const path = `${selectedEventId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(MAP_BUCKET)
        .upload(path, file, {
          upsert: true,
          contentType: file.type || undefined,
        });
      if (uploadError) {
        throw uploadError;
      }

      const publicUrl = supabase.storage.from(MAP_BUCKET).getPublicUrl(path).data.publicUrl;
      const { data: upserted, error: upsertError } = await supabase
        .from('event_maps')
        .upsert({
          event_id: selectedEventId,
          image_url: publicUrl,
        }, { onConflict: 'event_id' })
        .select('id,event_id,image_url,created_at')
        .single();

      if (upsertError) {
        throw upsertError;
      }

      setEventMap((upserted ?? null) as EventMapRow | null);
      setMapNotice('Mapa závodu byla nahraná a uložená.');
    } catch (error) {
      console.error('Failed to upload event map', error);
      setMapError('Upload mapy selhal. Zkus to prosím znovu.');
    } finally {
      setUploadingMap(false);
    }
  }, [selectedEventId]);

  const handleSavePositions = useCallback(async () => {
    if (!selectedEventId) {
      return;
    }

    setSavingPositions(true);
    setMapError(null);
    setMapNotice(null);

    try {
      const existingByStation = new Map(positions.map((position) => [position.station_id, position] as const));
      const upsertRows = selectedStations
        .map((station) => {
          const draft = draftPositions.get(station.id) ?? null;
          if (!draft) {
            return null;
          }
          return {
            event_id: selectedEventId,
            station_id: station.id,
            x_percent: clampPercent(draft.x_percent),
            y_percent: clampPercent(draft.y_percent),
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      if (upsertRows.length > 0) {
        const { error: upsertError } = await supabase
          .from('station_map_positions')
          .upsert(upsertRows, { onConflict: 'event_id,station_id' });
        if (upsertError) {
          throw upsertError;
        }
      }

      const clearStationIds = selectedStations
        .map((station) => station.id)
        .filter((stationId) => existingByStation.has(stationId) && !draftPositions.get(stationId));

      if (clearStationIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('station_map_positions')
          .delete()
          .eq('event_id', selectedEventId)
          .in('station_id', clearStationIds);
        if (deleteError) {
          throw deleteError;
        }
      }

      await loadMapData(selectedEventId);
      setMapNotice('Pozice stanovišť byly uložené.');
    } catch (error) {
      console.error('Failed to save station positions', error);
      setMapError('Uložení pozic selhalo.');
    } finally {
      setSavingPositions(false);
    }
  }, [draftPositions, loadMapData, positions, selectedEventId, selectedStations]);

  const handleClearSelectedStation = useCallback(() => {
    if (!selectedStationId) {
      return;
    }
    setDraftPositions((current) => {
      const next = new Map(current);
      next.delete(selectedStationId);
      return next;
    });
    setMapNotice('Pozice vybraného stanoviště byla odebraná. Nezapomeň změnu uložit.');
  }, [selectedStationId]);

  return (
    <div className="map-admin-shell">
      <header className="map-admin-header">
        <div className="map-admin-header-inner">
          <div>
            <h1>Editor mapy průchodů</h1>
            <p>{eventName} · Interní nastavení pro organizaci závodu</p>
          </div>
          <div className="map-admin-actions">
            <a className="map-admin-button map-admin-button--secondary" href={ADMIN_ROUTE_PREFIX}>
              Zpět do adminu
            </a>
            <button type="button" className="map-admin-button map-admin-button--secondary" onClick={() => void loadSetupData()}>
              Obnovit data
            </button>
            <button type="button" className="map-admin-button map-admin-button--secondary" onClick={() => void logout()}>
              Odhlásit se
            </button>
          </div>
        </div>
      </header>

      <main className="map-admin-content">
        <section className="map-admin-card map-admin-toolbar">
          {setupLoading ? <p>Načítám administraci mapy…</p> : null}
          {setupError ? <p className="map-admin-error">{setupError}</p> : null}
          {!setupLoading ? (
            <div className="map-admin-toolbar-grid">
              <label className="map-admin-field" htmlFor="map-admin-event">
                <span>Ročník</span>
                <select
                  id="map-admin-event"
                  value={selectedEventId}
                  onChange={(event) => setSelectedEventId(event.target.value)}
                  disabled={events.length === 0}
                >
                  {events.map((eventRow) => (
                    <option key={eventRow.id} value={eventRow.id}>
                      {eventRow.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="map-admin-field" htmlFor="map-admin-upload">
                <span>Nahrát mapu (PNG/JPG/WEBP)</span>
                <input
                  id="map-admin-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => void handleMapFileChange(event)}
                  disabled={!selectedEventId || uploadingMap}
                />
              </label>
              <button
                type="button"
                className="map-admin-button map-admin-button--primary"
                onClick={() => void handleSavePositions()}
                disabled={!selectedEventId || savingPositions}
              >
                {savingPositions ? 'Ukládám…' : 'Uložit pozice stanovišť'}
              </button>
            </div>
          ) : null}
          {mapError ? <p className="map-admin-error">{mapError}</p> : null}
          {mapNotice ? <p className="map-admin-success">{mapNotice}</p> : null}
        </section>

        <section className="map-admin-grid">
          <article className="map-admin-card map-admin-map-card">
            <header>
              <h2>Mapa závodu</h2>
              <p>Klikni do mapy pro umístění vybraného stanoviště. Marker lze přetáhnout.</p>
            </header>

            {mapLoading ? <p>Načítám mapu…</p> : null}
            {!mapLoading && eventMap?.image_url ? (
              <div className="map-admin-canvas" ref={mapCanvasRef} onClick={handleCanvasClick}>
                <img src={eventMap.image_url} alt="Mapa závodu" />
                {sortedPositions.map(({ station, x_percent, y_percent }) => (
                  <button
                    key={station.id}
                    type="button"
                    className={`map-admin-marker ${selectedStationId === station.id ? 'map-admin-marker--selected' : ''} ${station.is_split ? 'map-admin-marker--split' : ''}`}
                    style={{ left: `${x_percent}%`, top: `${y_percent}%` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedStationId(station.id);
                    }}
                    onPointerDown={(event) => handleMarkerPointerDown(event, station.id)}
                    title={`${station.code} · ${station.name} · ${formatStationSplitLabel(station)}`}
                  >
                    {station.code}
                  </button>
                ))}
              </div>
            ) : null}
            {!mapLoading && !eventMap?.image_url ? (
              <div className="map-admin-empty">
                <h3>Mapa není nahraná</h3>
                <p>Nahraj obrázek mapy, potom nastav pozice stanovišť klikáním.</p>
              </div>
            ) : null}
          </article>

          <aside className="map-admin-card map-admin-stations-card">
            <header>
              <h2>Stanoviště</h2>
              <p>Vyber stanoviště, které chceš umístit nebo upravit.</p>
            </header>

            <div className="map-admin-station-list">
              {selectedStations.length === 0 ? (
                <p>Pro vybraný ročník nejsou dostupná stanoviště.</p>
              ) : (
                selectedStations.map((station) => {
                  const draft = draftPositions.get(station.id) ?? null;
                  const splitLabel = formatStationSplitLabel(station);
                  return (
                    <button
                      key={station.id}
                      type="button"
                      className={`map-admin-station-item ${selectedStationId === station.id ? 'map-admin-station-item--selected' : ''}`}
                      onClick={() => setSelectedStationId(station.id)}
                    >
                      <strong>
                        {station.code}
                        {station.is_split ? <span className="map-admin-station-split-badge">Split</span> : null}
                      </strong>
                      <span>{station.name || 'Bez názvu'}</span>
                      <span className="map-admin-station-split">{splitLabel}</span>
                      <span className="map-admin-station-pos">
                        {draft ? `${draft.x_percent.toFixed(1)}%, ${draft.y_percent.toFixed(1)}%` : 'Bez pozice'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="map-admin-card-actions">
              <button
                type="button"
                className="map-admin-button map-admin-button--secondary"
                onClick={handleClearSelectedStation}
                disabled={!selectedStationId}
              >
                Odebrat pozici vybraného stanoviště
              </button>
            </div>
          </aside>
        </section>
      </main>

      <AppFooter variant="minimal" />
    </div>
  );
}

function SetonMapAdminApp() {
  const { status, logout } = useAuth();

  if (status.state === 'loading') {
    return (
      <div className="map-admin-shell map-admin-shell--center">
        <div className="map-admin-card map-admin-card--narrow">
          <h1>Načítám…</h1>
        </div>
        <AppFooter variant="minimal" />
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <div className="map-admin-shell map-admin-shell--center">
        <div className="map-admin-card map-admin-card--narrow">
          <h1>Nelze načíst aplikaci</h1>
          <p>{status.message || 'Zkontroluj připojení nebo konfiguraci a zkus to znovu.'}</p>
          <button type="button" className="map-admin-button map-admin-button--primary" onClick={() => window.location.reload()}>
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
        <div className="map-admin-shell map-admin-shell--center">
          <div className="map-admin-card map-admin-card--narrow">
            <h1>Přístup zamítnut</h1>
            <p>Editor mapy je dostupný pouze pro výpočetku (stanoviště T).</p>
            <button type="button" className="map-admin-button map-admin-button--secondary" onClick={() => void logout()}>
              Odhlásit se
            </button>
          </div>
          <AppFooter variant="minimal" />
        </div>
      );
    }

    return (
      <MapEditorDashboard
        eventId={status.manifest.event.id}
        eventName={status.manifest.event.name}
        accessToken={status.tokens.accessToken}
        logout={logout}
      />
    );
  }

  return null;
}

export default SetonMapAdminApp;
