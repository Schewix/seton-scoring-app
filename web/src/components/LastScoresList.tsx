import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const eventId = import.meta.env.VITE_EVENT_ID as string | undefined;
const stationId = import.meta.env.VITE_STATION_ID as string | undefined;

if (!eventId || !stationId) {
  throw new Error('Missing VITE_EVENT_ID or VITE_STATION_ID environment variable.');
}

interface ScoreRow {
  id: string;
  created_at: string;
  points: number;
  note: string | null;
  judge: string | null;
  patrol_id: string;
  patrols?: {
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

export function LastScoresList() {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [scoresRes, quizRes] = await Promise.all([
      supabase
        .from('station_scores')
        .select('id, created_at, points, note, judge, patrol_id, patrols(team_name, category, sex)')
        .eq('event_id', eventId)
        .eq('station_id', stationId)
        .order('created_at', { ascending: false })
        .limit(50),
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
    (quizRes.data || []).forEach((item) => {
      quizMap.set(item.patrol_id, item);
    });

    const merged = (scoresRes.data || []).map((row) => ({
      ...row,
      quiz: quizMap.get(row.patrol_id) || undefined,
    }));

    setRows(merged);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
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
        <button onClick={handleRefresh} disabled={loading || refreshing}>
          {refreshing ? 'Obnovuji…' : 'Obnovit'}
        </button>
      </header>
      {loading && rows.length === 0 ? <p>Načítání…</p> : null}
      {rows.length === 0 && !loading ? <p>Žádné záznamy.</p> : null}
      <ul className="score-list">
        {rows.map((row) => {
          const patrol = row.patrols || { team_name: 'Neznámá hlídka', category: '?', sex: '?' };
          const quizLetters = parseAnswerLetters(row.quiz?.answers);
          return (
            <li key={row.id} className="score-item">
              <div className="score-meta">
                <strong>
                  {patrol.team_name} • {patrol.category}/{patrol.sex}
                </strong>
                <span>{new Date(row.created_at).toLocaleString()}</span>
              </div>
              <div className="score-detail">
                <span>
                  Body: <strong>{row.points}</strong>
                </span>
                {row.judge ? <span> • {row.judge}</span> : null}
              </div>
              {row.note ? <p className="score-note">„{row.note}“</p> : null}
              {row.quiz ? (
                <div className="score-quiz">
                  Terčový úsek: {row.quiz.correct_count}
                  {quizLetters.length ? `/${quizLetters.length} • ${quizLetters.join(' ')}` : ''}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default LastScoresList;
