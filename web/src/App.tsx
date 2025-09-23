import { FormEvent, useEffect, useMemo, useState } from 'react';
import './App.css';

type Category = 'Nejmladší' | 'Mladší' | 'Starší';

interface Patrol {
  code: string;
  name: string;
  category: Category;
}

interface ScoreEntry {
  id: number;
  patrol: Patrol;
  points: number;
  waitMinutes: number;
  note: string;
  judge: string;
  savedAt: string;
}

const CATEGORY_OPTIONS: Category[] = ['Nejmladší', 'Mladší', 'Starší'];

const SAMPLE_PATROLS: Patrol[] = [
  { code: 'NH-15', name: 'Svrčci', category: 'Nejmladší' },
  { code: 'SK-07', name: 'Skalice', category: 'Mladší' },
  { code: 'KV-04', name: 'Kamzíci', category: 'Starší' },
  { code: 'LT-03', name: 'Letohrádek', category: 'Mladší' },
];

const INITIAL_ENTRIES: ScoreEntry[] = [
  {
    id: 1,
    patrol: { code: 'NH-15', name: 'Svrčci', category: 'Nejmladší' },
    points: 10,
    waitMinutes: 0,
    note: '',
    judge: 'Jana',
    savedAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
  },
  {
    id: 2,
    patrol: { code: 'SK-07', name: 'Skalice', category: 'Mladší' },
    points: 9,
    waitMinutes: 3,
    note: 'Potřebovali doladit uzel číslo 4.',
    judge: 'Petr',
    savedAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
  },
];

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

function App() {
  const [patrolPointer, setPatrolPointer] = useState(0);
  const [patrolCode, setPatrolCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [category, setCategory] = useState<Category>('Nejmladší');
  const [points, setPoints] = useState('0');
  const [waitMinutes, setWaitMinutes] = useState('0');
  const [note, setNote] = useState('');
  const [judge, setJudge] = useState('');
  const [entries, setEntries] = useState<ScoreEntry[]>(INITIAL_ENTRIES);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const lastSavedAt = useMemo(() => entries[0]?.savedAt ?? null, [entries]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(''), 3500);
    return () => clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(''), 4500);
    return () => clearTimeout(timeout);
  }, [error]);

  const handleScan = () => {
    const nextPatrol = SAMPLE_PATROLS[patrolPointer % SAMPLE_PATROLS.length];
    setPatrolPointer((prev) => prev + 1);
    setPatrolCode(nextPatrol.code);
    setTeamName(nextPatrol.name);
    setCategory(nextPatrol.category);
    setPoints('0');
    setWaitMinutes('0');
    setNote('');
    setFeedback(`Hlídka ${nextPatrol.name} připravena k hodnocení.`);
    setError('');
  };

  const clearForm = () => {
    setTeamName('');
    setCategory('Nejmladší');
    setPatrolCode('');
    setPoints('0');
    setWaitMinutes('0');
    setNote('');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTeam = teamName.trim();
    const trimmedJudge = judge.trim();

    if (!trimmedTeam) {
      setError('Vyplň název hlídky.');
      return;
    }

    if (!trimmedJudge) {
      setError('Zadej jméno rozhodčího.');
      return;
    }

    const parsedPoints = Number(points);
    if (!Number.isFinite(parsedPoints)) {
      setError('Body musí být číslo.');
      return;
    }

    const parsedWait = Number(waitMinutes);
    if (!Number.isFinite(parsedWait) || parsedWait < 0) {
      setError('Čekací doba musí být nezáporná.');
      return;
    }

    const entry: ScoreEntry = {
      id: Date.now(),
      patrol: {
        code: patrolCode || 'MAN',
        name: trimmedTeam,
        category,
      },
      points: parsedPoints,
      waitMinutes: parsedWait,
      note: note.trim(),
      judge: trimmedJudge,
      savedAt: new Date().toISOString(),
    };

    setEntries((prev) => [entry, ...prev].slice(0, 8));
    setFeedback('Záznam uložen.');
    setError('');
    clearForm();
  };

  const handleReset = () => {
    clearForm();
    setFeedback('Formulář vymazán.');
    setError('');
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-brand">
          <div className="hero-logo" aria-hidden>
            <span>🪢</span>
          </div>
          <div>
            <h1>Uzlování</h1>
            <p>Webová podpora stanoviště s ukládáním posledních výsledků.</p>
          </div>
        </div>
        <div className="hero-meta">
          <span>K dispozici offline</span>
          {lastSavedAt ? <span>Poslední uložení: {formatTime(lastSavedAt)}</span> : null}
        </div>
      </header>

      <main className="content">
        <section className="card scanner-card">
          <div className="scanner-icon" aria-hidden>
            <span>📷</span>
          </div>
          <h2>Naskenovat hlídku</h2>
          <p>Zatím pracujeme se vzorovými hlídkami, tlačítko je pouze simulace.</p>
          <button type="button" className="primary" onClick={handleScan}>
            Naskenovat hlídku
          </button>
          {patrolCode || teamName ? (
            <div className="scanner-preview">
              <strong>{teamName || 'Neznámá hlídka'}</strong>
              <span>
                {category} {patrolCode ? `• ${patrolCode}` : ''}
              </span>
            </div>
          ) : (
            <p className="scanner-placeholder">Nejprve naskenuj nebo doplň hlídku ručně.</p>
          )}
        </section>

        <section className="card form-card">
          <h2>Nový záznam</h2>
          <p className="form-description">
            Po naskenování hlídku zkontroluj, doplň body a ulož výsledek. Rozhodčí se doplňuje
            automaticky pro další záznamy.
          </p>

          <div className="form-messages">
            {feedback ? <div className="message success">{feedback}</div> : null}
            {error ? <div className="message error">{error}</div> : null}
          </div>

          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Hlídka
              <input
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="např. Svrčci"
              />
            </label>
            <label>
              Kategorie
              <select value={category} onChange={(event) => setCategory(event.target.value as Category)}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Body
              <input
                type="number"
                inputMode="numeric"
                value={points}
                onChange={(event) => setPoints(event.target.value)}
                placeholder="0"
              />
            </label>
            <label>
              Čekací doba (minuty)
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={waitMinutes}
                onChange={(event) => setWaitMinutes(event.target.value)}
              />
            </label>
            <label className="full-width">
              Poznámka
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Upřesnění hodnocení, detaily k disciplíně..."
              />
            </label>
            <label>
              Jméno rozhodčího
              <input
                value={judge}
                onChange={(event) => setJudge(event.target.value)}
                placeholder="např. Jana"
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="primary">
                ULOŽIT
              </button>
              <button type="button" className="ghost" onClick={handleReset}>
                Vymazat
              </button>
            </div>
          </form>
        </section>

        <section className="card list-card">
          <div className="list-header">
            <h2>Poslední hlídky</h2>
            <span className="list-count">{entries.length}</span>
          </div>
          <table className="recent-table">
            <thead>
              <tr>
                <th>Hlídka</th>
                <th>Kategorie</th>
                <th className="align-right">Body</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="empty-state">
                    Zatím nejsou uloženy žádné výsledky.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <div className="cell-primary">{entry.patrol.name}</div>
                      <div className="cell-meta">
                        {entry.patrol.code} • {entry.judge || 'bez rozhodčího'}
                      </div>
                    </td>
                    <td>
                      <span className="category-pill">{entry.patrol.category}</span>
                      <div className="cell-meta">{formatTime(entry.savedAt)}</div>
                    </td>
                    <td className="align-right">
                      <strong>{entry.points}</strong>
                      <div className="cell-meta">
                        {entry.waitMinutes > 0
                          ? `${entry.waitMinutes} min čekání`
                          : 'bez čekání'}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

export default App;
