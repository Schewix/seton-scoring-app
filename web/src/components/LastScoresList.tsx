import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { unwrapRelation } from './utils';

interface ScoreRow {
  id: string;
  created_at: string;
  points: number;
  note: string | null;
  judge: string | null;
  patrol_id: string;
  waitMinutes: number | null;
  waitRecorded: boolean;
  patrols?: {
    patrol_code: string | null;
    team_name: string;
    category: string;
    sex: string;
  } | null;
  quiz?: {
    correct_count: number;
    answers: string | null;
    updated_at: string;
  } | null;
}

type StationScorePayloadInput = {
  event_id: string;
  station_id: string;
  patrol_id: string;
  category: string;
  arrived_at: string;
  wait_minutes: number;
  points: number;
  note: string;
  use_target_scoring: boolean;
  normalized_answers: string | null;
  finish_time: string | null;
  patrol_code: string;
  team_name?: string;
  sex?: string;
};

function parseAnswerLetters(value?: string | null) {
  return (value?.match(/[A-D]/gi) || []).map((l) => l.toUpperCase());
}

const WAIT_MINUTES_MAX = 600;

function formatWaitMinutesValue(totalMinutes: number) {
  const clamped = Math.max(0, Math.min(WAIT_MINUTES_MAX, Math.round(totalMinutes)));
  const hours = Math.floor(clamped / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (clamped % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatWaitLabel(totalMinutes: number | null) {
  if (typeof totalMinutes !== 'number' || Number.isNaN(totalMinutes)) {
    return '—';
  }
  return formatWaitMinutesValue(totalMinutes);
}

function parseWaitInput(value: string) {
  const trimmed = value.trim();
  if (trimmed === '') {
    return NaN;
  }

  const match = trimmed.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) {
    return NaN;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const total = hours * 60 + minutes;
  if (!Number.isInteger(total) || total < 0 || total > WAIT_MINUTES_MAX) {
    return NaN;
  }
  return total;
}

type ScoreRowRecord = Omit<ScoreRow, 'patrols' | 'waitMinutes' | 'waitRecorded'> & {
  patrols?: ScoreRow['patrols'] | ScoreRow['patrols'][] | null;
};

type QuizRowRecord = NonNullable<ScoreRow['quiz']> & {
  patrol_id: string;
};

function mapScoreRows(rows: ScoreRowRecord[] = []): ScoreRow[] {
  return rows.map((row) => ({
    ...row,
    patrols: unwrapRelation(row.patrols) ?? null,
    waitMinutes: null,
    waitRecorded: false,
  }));
}

interface LoadOptions {
  skipLoader?: boolean;
}

interface LastScoresListProps {
  eventId: string;
  stationId: string;
  isTargetStation: boolean;
  onQueueScoreUpdate: (payload: StationScorePayloadInput) => Promise<boolean>;
}

export function LastScoresList({
  eventId,
  stationId,
  isTargetStation,
  onQueueScoreUpdate,
}: LastScoresListProps) {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPoints, setEditPoints] = useState('');
  const [editWait, setEditWait] = useState(formatWaitMinutesValue(0));
  const [editNote, setEditNote] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const refreshTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async ({ skipLoader = false }: LoadOptions = {}) => {
      if (!skipLoader) {
        setLoading(true);
      }

      const loadWaits = async (patrolIds: string[]) => {
        if (!patrolIds.length) {
          return new Map<string, number | null>();
        }

        const { data, error } = await supabase
          .from('station_passages')
          .select('patrol_id, wait_minutes')
          .eq('event_id', eventId)
          .eq('station_id', stationId)
          .in('patrol_id', patrolIds);

        if (error) {
          console.error('Nepodařilo se načíst čekání hlídek', error);
          return new Map<string, number | null>();
        }

        const map = new Map<string, number | null>();
        (data ?? []).forEach((row) => {
          if (row.patrol_id) {
            map.set(row.patrol_id, row.wait_minutes ?? null);
          }
        });
        return map;
      };

      const scoresQuery = supabase
        .from('station_scores')
        .select(
          'id, created_at, points, note, judge, patrol_id, patrols(patrol_code, team_name, category, sex)'
        )
        .eq('event_id', eventId)
        .eq('station_id', stationId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (isTargetStation) {
        const [scoresRes, quizRes] = await Promise.all([
          scoresQuery,
          supabase
            .from('station_quiz_responses')
            .select('patrol_id, correct_count, answers, updated_at')
            .eq('event_id', eventId)
            .eq('station_id', stationId),
        ]);

        setLoading(false);

        if (scoresRes.error || quizRes.error) {
          console.error('Nepodařilo se načíst poslední záznamy', scoresRes.error, quizRes.error);
          return;
        }

        const quizMap = new Map<string, ScoreRow['quiz']>();
        ((quizRes.data ?? []) as QuizRowRecord[]).forEach((item) => {
          const { patrol_id, ...quiz } = item;
          quizMap.set(patrol_id, quiz);
        });

        const baseRows = mapScoreRows((scoresRes.data ?? []) as ScoreRowRecord[]);
        const waitMap = await loadWaits(baseRows.map((row) => row.patrol_id));
        const merged = baseRows.map((row) => ({
          ...row,
          quiz: quizMap.get(row.patrol_id) || undefined,
          waitMinutes: waitMap.get(row.patrol_id) ?? null,
          waitRecorded: waitMap.has(row.patrol_id),
        }));

        setRows(merged);
        return;
      }

      const scoresRes = await scoresQuery;
      setLoading(false);

      if (scoresRes.error) {
        console.error('Nepodařilo se načíst poslední záznamy', scoresRes.error);
        return;
      }

      const baseRows = mapScoreRows((scoresRes.data ?? []) as ScoreRowRecord[]);
      const waitMap = await loadWaits(baseRows.map((row) => row.patrol_id));
      setRows(
        baseRows.map((row) => ({
          ...row,
          waitMinutes: waitMap.get(row.patrol_id) ?? null,
          waitRecorded: waitMap.has(row.patrol_id),
        }))
      );
    },
    [eventId, stationId, isTargetStation]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void load({ skipLoader: true });
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [load]);

  const scheduleRealtimeRefresh = useCallback(() => {
    if (refreshTimeout.current) {
      clearTimeout(refreshTimeout.current);
    }
    refreshTimeout.current = setTimeout(() => {
      load({ skipLoader: true });
    }, 250);
  }, [load]);

  useEffect(() => {
    const handleScopedRefresh = (
      payload: RealtimePostgresChangesPayload<{ event_id?: string; station_id?: string }>
    ) => {
      const record = (payload.new ?? payload.old) as
        | { event_id?: string; station_id?: string }
        | null;
      if (!record || record.event_id !== eventId || record.station_id !== stationId) {
        return;
      }
      scheduleRealtimeRefresh();
    };

    const channel = supabase
      .channel(`station-scores-${eventId}-${stationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'station_scores' },
        handleScopedRefresh
      );

    if (isTargetStation) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'station_quiz_responses' },
        handleScopedRefresh
      );
    }

    channel.subscribe();

    return () => {
      if (refreshTimeout.current) {
        clearTimeout(refreshTimeout.current);
        refreshTimeout.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [scheduleRealtimeRefresh, eventId, stationId, isTargetStation]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load({ skipLoader: true });
    setRefreshing(false);
  };

  const beginEdit = (row: ScoreRow) => {
    setEditingId(row.id);
    setEditPoints(String(row.points));
    setEditWait(formatWaitMinutesValue(row.waitMinutes ?? 0));
    setEditNote(row.note ?? '');
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const saveEdit = async (row: ScoreRow) => {
    const pointsValue = Number(editPoints.trim());
    const waitValue = parseWaitInput(editWait);
    if (!Number.isInteger(pointsValue) || pointsValue < 0 || pointsValue > 12) {
      setEditError('Body musí být celé číslo 0–12.');
      return;
    }
    if (!Number.isInteger(waitValue) || waitValue < 0 || waitValue > WAIT_MINUTES_MAX) {
      setEditError(`Čekání musí být čas v rozsahu 00:00–${formatWaitMinutesValue(WAIT_MINUTES_MAX)}.`);
      return;
    }

    setSavingId(row.id);
    setEditError(null);

    const trimmedNote = editNote.trim();
    if (!row.patrols?.category) {
      setEditError('Nepodařilo se načíst kategorii hlídky.');
      setSavingId(null);
      return;
    }
    const payload: StationScorePayloadInput = {
      event_id: eventId,
      station_id: stationId,
      patrol_id: row.patrol_id,
      category: row.patrols.category,
      arrived_at: row.created_at,
      wait_minutes: waitValue,
      points: pointsValue,
      note: trimmedNote ? trimmedNote : '',
      use_target_scoring: Boolean(row.quiz),
      normalized_answers: row.quiz?.answers ?? null,
      finish_time: null,
      patrol_code: row.patrols.patrol_code ?? row.patrol_id,
      team_name: row.patrols?.team_name ?? undefined,
      sex: row.patrols?.sex ?? undefined,
    };

    const queued = await onQueueScoreUpdate(payload);
    if (!queued) {
      setEditError('Nepodařilo se uložit body.');
      setSavingId(null);
      return;
    }

    setRows((prev) =>
      prev.map((item) =>
        item.id === row.id
          ? {
            ...item,
            points: pointsValue,
            note: trimmedNote ? trimmedNote : null,
            waitMinutes: waitValue,
            waitRecorded: item.waitRecorded || waitValue !== 0,
          }
          : item
      )
    );
    setSavingId(null);
    setEditingId(null);
  };

  const countLabel = loading ? '…' : rows.length;

  return (
    <section className="card">
      <header className="card-header">
        <h2>
          Poslední záznamy{' '}
          <span className="card-hint">({countLabel})</span>
        </h2>
        <div className="card-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => setHidden((prev) => !prev)}
          >
            {hidden ? 'Zobrazit záznamy' : 'Skrýt záznamy'}
          </button>
          <button type="button" onClick={handleRefresh} disabled={loading || refreshing}>
            {refreshing ? 'Obnovuji…' : 'Obnovit'}
          </button>
        </div>
      </header>
      {hidden ? (
        <p>Poslední záznamy jsou skryté.</p>
      ) : (
        <>
          {loading && rows.length === 0 ? <p>Načítání…</p> : null}
          {rows.length === 0 && !loading ? <p>Žádné záznamy.</p> : null}
          <ul className="score-list">
            {rows.map((row) => {
              const patrol =
                row.patrols ||
                ({
                  patrol_code: null,
                  team_name: 'Neznámá hlídka',
                  category: '?',
                  sex: '?',
                } satisfies ScoreRow['patrols']);
              const quizLetters = parseAnswerLetters(row.quiz?.answers);
              const isEditing = editingId === row.id;
              return (
                <li key={row.id} className="score-item">
                  <div className="score-split">
                    <div className="score-points-box">
                      <span className="score-points-value">{row.points}</span>
                      <span className="score-points-label">body</span>
                      <span className="score-wait-label">
                        Čekání: {formatWaitLabel(row.waitMinutes)}
                      </span>
                    </div>
                    <div className="score-team-box">
                      <strong>{patrol.team_name}</strong>
                      <span className="score-team-meta">
                        {patrol.patrol_code
                          ? patrol.patrol_code
                          : `${patrol.category}/${patrol.sex}`}
                      </span>
                    </div>
                  </div>
                  <div className="score-meta">
                    <span>{new Date(row.created_at).toLocaleString()}</span>
                    {row.judge ? <span>{row.judge}</span> : null}
                    <button
                      type="button"
                      className="ghost score-edit-toggle"
                      onClick={() => (isEditing ? cancelEdit() : beginEdit(row))}
                    >
                      {isEditing ? 'Zavřít editaci' : 'Upravit'}
                    </button>
                  </div>
                  {row.note ? <p className="score-note">„{row.note}“</p> : null}
                  {isEditing ? (
                    <div className="score-edit">
                      <label>
                        Body
                        <input
                          type="number"
                          min={0}
                          max={12}
                          inputMode="numeric"
                          value={editPoints}
                          onChange={(event) => setEditPoints(event.target.value)}
                          disabled={savingId === row.id}
                        />
                      </label>
                      <label>
                        Čekání (HH:MM)
                        <input
                          type="time"
                          step={60}
                          min="00:00"
                          max={formatWaitMinutesValue(WAIT_MINUTES_MAX)}
                          value={editWait}
                          onChange={(event) => setEditWait(event.target.value)}
                          disabled={savingId === row.id}
                        />
                      </label>
                      <label>
                        Poznámka
                        <textarea
                          value={editNote}
                          onChange={(event) => setEditNote(event.target.value)}
                          disabled={savingId === row.id}
                        />
                      </label>
                      <div className="score-edit-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => saveEdit(row)}
                          disabled={savingId === row.id}
                        >
                          {savingId === row.id ? 'Ukládám…' : 'Uložit změny'}
                        </button>
                        <button type="button" onClick={cancelEdit} disabled={savingId === row.id}>
                          Zrušit
                        </button>
                      </div>
                      {editError ? <p className="error-text">{editError}</p> : null}
                    </div>
                  ) : null}
                  {isTargetStation && row.quiz ? (
                    <div className="score-quiz">
                      Terčový úsek: {row.quiz.correct_count}
                      {quizLetters.length ? `/${quizLetters.length} • ${quizLetters.join(' ')}` : ''}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

export default LastScoresList;
