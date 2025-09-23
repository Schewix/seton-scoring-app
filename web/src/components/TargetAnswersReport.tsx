import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { unwrapRelation } from './utils';

interface TargetRow {
  patrol_id: string;
  correct_count: number;
  answers: string | null;
  updated_at: string;
  category: string | null;
  patrols?: {
    team_name: string;
    category: string;
    sex: string;
    patrol_code: string | null;
  } | null;
}

function parseAnswerLetters(value?: string | null) {
  return (value?.match(/[A-D]/gi) || []).map((l) => l.toUpperCase());
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('cs-CZ');
}

type TargetRowRecord = Omit<TargetRow, 'patrols'> & {
  patrols?: TargetRow['patrols'] | TargetRow['patrols'][] | null;
};

function mapTargetRows(rows: TargetRowRecord[] = []): TargetRow[] {
  return rows.map((row) => ({
    ...row,
    patrols: unwrapRelation(row.patrols) ?? null,
  }));
}

interface TargetAnswersReportProps {
  eventId: string;
  stationId: string;
}

export default function TargetAnswersReport({ eventId, stationId }: TargetAnswersReportProps) {
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from('station_quiz_responses')
      .select('patrol_id, correct_count, answers, updated_at, category, patrols(team_name, category, sex, patrol_code)')
      .eq('event_id', eventId)
      .eq('station_id', stationId)
      .order('updated_at', { ascending: false });

    setLoading(false);

    if (queryError) {
      console.error('Failed to load target answers report', queryError);
      setError('Nepodařilo se načíst terčové odpovědi.');
      return;
    }

    setRows(mapTargetRows((data ?? []) as TargetRowRecord[]));
  }, [eventId, stationId]);

  useEffect(() => {
    load();
  }, [load]);

  const csvContent = useMemo(() => {
    if (!rows.length) {
      return '';
    }

    const header = ['patrol_id', 'patrol_code', 'team_name', 'category', 'sex', 'score', 'answers', 'updated_at'];
    const csvRows = rows.map((row) => {
      const patrol = row.patrols;
      const answers = parseAnswerLetters(row.answers).join(' ');
      const category = patrol?.category ?? row.category ?? '';
      const sex = patrol?.sex ?? '';
      const patrolCode = patrol?.patrol_code ?? '';
      const team = patrol?.team_name ?? '';
      return [
        row.patrol_id,
        patrolCode,
        team,
        category,
        sex,
        row.correct_count.toString(),
        answers,
        new Date(row.updated_at).toISOString(),
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(',');
    });

    return [header.join(','), ...csvRows].join('\n');
  }, [rows]);

  const handleExport = useCallback(() => {
    if (!csvContent) {
      return;
    }
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `target-report-${eventId}-${stationId}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [csvContent, eventId, stationId]);

  return (
    <section className="card target-report">
      <header className="card-header">
        <div>
          <h2>Report terčových odpovědí</h2>
          <p className="card-subtitle">Přehled uložených terčových odpovědí a možnost exportu.</p>
        </div>
        <div className="target-report-actions">
          <button type="button" onClick={load} disabled={loading}>
            {loading ? 'Načítám…' : 'Obnovit'}
          </button>
          <button type="button" onClick={handleExport} disabled={!rows.length}>
            Export CSV
          </button>
        </div>
      </header>
      {error ? <p className="error-text">{error}</p> : null}
      {loading && rows.length === 0 ? <p>Načítání…</p> : null}
      {!loading && rows.length === 0 && !error ? <p>Žádné terčové odpovědi.</p> : null}
      {rows.length > 0 ? (
        <div className="table-scroll">
          <table className="target-table">
            <thead>
              <tr>
                <th>Hlídka</th>
                <th>Kategorie</th>
                <th>Body</th>
                <th>Odpovědi</th>
                <th>Aktualizace</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const patrol = row.patrols;
                const answers = parseAnswerLetters(row.answers);
                const name = patrol?.team_name ?? row.patrol_id;
                const code = patrol?.patrol_code ? ` (${patrol.patrol_code})` : '';
                const category = patrol?.category ?? row.category ?? '—';
                const sex = patrol?.sex ? `/${patrol.sex}` : '';
                return (
                  <tr key={`${row.patrol_id}-${row.updated_at}`}>
                    <td>
                      <div className="target-patrol">
                        <strong>
                          {name}
                          {code}
                        </strong>
                      </div>
                    </td>
                    <td>
                      {category}
                      {sex}
                    </td>
                    <td>{row.correct_count}</td>
                    <td>{answers.length ? answers.join(' ') : '—'}</td>
                    <td>{formatDate(row.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
