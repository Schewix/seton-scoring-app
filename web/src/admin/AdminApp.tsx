import { useCallback, useEffect, useState } from 'react';
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

const API_BASE_URL = env.VITE_AUTH_API_URL?.replace(/\/$/, '') ?? '';

type AuthenticatedState = Extract<AuthStatus, { state: 'authenticated' }>;

type AnswersFormState = Record<CategoryKey, string>;

type AnswersSummary = Record<CategoryKey, { letters: string[]; updatedAt: string | null }>;

type StationPassageRow = {
  stationId: string;
  stationCode: string;
  stationName: string;
  totals: Record<CategoryKey, number>;
  total: number;
};

type EventState = {
  name: string;
  scoringLocked: boolean;
};

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

  const [eventState, setEventState] = useState<EventState>({
    name: manifest.event.name,
    scoringLocked: manifest.event.scoringLocked,
  });
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [lockUpdating, setLockUpdating] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

    const [stationsRes, passagesRes] = await Promise.all([
      supabase
        .from('stations')
        .select('id, code, name')
        .eq('event_id', eventId)
        .order('code'),
      supabase
        .from('station_passages')
        .select('station_id, patrols(category)')
        .eq('event_id', eventId),
    ]);

    setStationLoading(false);

    if (stationsRes.error || passagesRes.error) {
      console.error('Failed to load station passages overview', stationsRes.error, passagesRes.error);
      setStationError('Nepodařilo se načíst průchody stanovišť.');
      setStationRows([]);
      return;
    }

    const stations = new Map<string, { code: string; name: string }>();
    ((stationsRes.data ?? []) as { id: string; code: string; name: string }[]).forEach((station) => {
      stations.set(station.id, {
        code: (station.code || '').trim().toUpperCase(),
        name: station.name,
      });
    });

    const totals = new Map<string, StationPassageRow>();
    stations.forEach((station, id) => {
      const baseTotals: Record<CategoryKey, number> = { N: 0, M: 0, S: 0, R: 0 };
      totals.set(id, {
        stationId: id,
        stationCode: station.code,
        stationName: station.name,
        totals: baseTotals,
        total: 0,
      });
    });

    ((passagesRes.data ?? []) as { station_id: string; patrols?: { category?: string | null } | null }[]).forEach((row) => {
      const station = totals.get(row.station_id);
      if (!station) {
        return;
      }
      const category = row.patrols?.category ?? null;
      const normalized = typeof category === 'string' ? category.trim().toUpperCase() : '';
      if (!isCategoryKey(normalized)) {
        return;
      }
      station.totals[normalized] += 1;
      station.total += 1;
    });

    const sorted = Array.from(totals.values()).sort((a, b) =>
      a.stationCode.localeCompare(b.stationCode, 'cs'),
    );
    setStationRows(sorted);
  }, [eventId]);

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
                    {summary.letters.length
                      ? `${summary.letters.length} odpovědí • ${summary.letters.join(' ')}`
                      : 'Nenastaveno'}
                    {summary.updatedAt ? ` · ${new Date(summary.updatedAt).toLocaleString('cs-CZ')}` : ''}
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
                    {ANSWER_CATEGORIES.map((category) => (
                      <th key={category}>{category}</th>
                    ))}
                    <th>Celkem</th>
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
                      {ANSWER_CATEGORIES.map((category) => (
                        <td key={`${row.stationId}-${category}`}>{row.totals[category]}</td>
                      ))}
                      <td>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
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
    return <AdminDashboard auth={status} refreshManifest={refreshManifest} logout={logout} />;
  }

  return null;
}

export default AdminApp;
