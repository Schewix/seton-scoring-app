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

function parseAnswerLetters(value?: string | null) {
  return (value?.match(/[A-D]/gi) || []).map((l) => l.toUpperCase());
}

type ScoreRowRecord = Omit<ScoreRow, 'patrols'> & {
  patrols?: ScoreRow['patrols'] | ScoreRow['patrols'][] | null;
};

type QuizRowRecord = NonNullable<ScoreRow['quiz']> & {
  patrol_id: string;
};

function mapScoreRows(rows: ScoreRowRecord[] = []): ScoreRow[] {
  return rows.map((row) => ({
    ...row,
    patrols: unwrapRelation(row.patrols) ?? null,
  }));
}

interface LoadOptions {
  skipLoader?: boolean;
}

interface LastScoresListProps {
  eventId: string;
  stationId: string;
  isTargetStation: boolean;
}

export function LastScoresList({ eventId, stationId, isTargetStation }: LastScoresListProps) {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hidden, setHidden] = useState(false);

  const refreshTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async ({ skipLoader = false }: LoadOptions = {}) => {
      if (!skipLoader) {
        setLoading(true);
      }

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

        const merged = mapScoreRows((scoresRes.data ?? []) as ScoreRowRecord[]).map((row) => ({
          ...row,
          quiz: quizMap.get(row.patrol_id) || undefined,
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

      setRows(mapScoreRows((scoresRes.data ?? []) as ScoreRowRecord[]));
    },
    [eventId, stationId, isTargetStation]
  );

  useEffect(() => {
    load();
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
              return (
                <li key={row.id} className="score-item">
                  <div className="score-split">
                    <div className="score-points-box">
                      <span className="score-points-value">{row.points}</span>
                      <span className="score-points-label">body</span>
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
                  </div>
                  {row.note ? <p className="score-note">„{row.note}“</p> : null}
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
