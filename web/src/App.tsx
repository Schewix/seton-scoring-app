import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import localforage from 'localforage';
import { QRScanner } from './components/QRScanner';
import LastScoresList from './components/LastScoresList';
import { supabase } from './supabaseClient';
import './App.css';

interface Patrol {
  id: string;
  team_name: string;
  category: string;
  sex: string;
}

interface PendingSubmission {
  event_id: string;
  station_id: string;
  patrol_id: string;
  category: string;
  arrived_at: string;
  wait_minutes: number;
  points: number;
  judge: string;
  note: string;
  useTargetScoring: boolean;
  normalizedAnswers: string | null;
  shouldDeleteQuiz: boolean;
  patrol_code: string;
}

const ANSWER_CATEGORIES = ['N', 'M', 'S', 'R'] as const;
type CategoryKey = (typeof ANSWER_CATEGORIES)[number];
const QUEUE_KEY = 'web_pending_station_submissions_v1';
const JUDGE_KEY = 'judge_name';

const eventId = import.meta.env.VITE_EVENT_ID as string | undefined;
const stationId = import.meta.env.VITE_STATION_ID as string | undefined;

if (!eventId || !stationId) {
  throw new Error('Missing VITE_EVENT_ID or VITE_STATION_ID environment variables.');
}

localforage.config({
  name: 'seton-web',
});

function parseAnswerLetters(value = '') {
  return (value.match(/[A-D]/gi) || []).map((l) => l.toUpperCase());
}

function formatAnswersForInput(stored = '') {
  return parseAnswerLetters(stored).join(' ');
}

function packAnswersForStorage(value = '') {
  return parseAnswerLetters(value).join('');
}

function shortId(value: string) {
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}

async function readQueue(): Promise<PendingSubmission[]> {
  const raw = await localforage.getItem<PendingSubmission[]>(QUEUE_KEY);
  return raw || [];
}

async function writeQueue(items: PendingSubmission[]) {
  if (!items.length) {
    await localforage.removeItem(QUEUE_KEY);
  } else {
    await localforage.setItem(QUEUE_KEY, items);
  }
}

function App() {
  const [judge, setJudge] = useState('');
  const [patrol, setPatrol] = useState<Patrol | null>(null);
  const [points, setPoints] = useState('');
  const [wait, setWait] = useState('0');
  const [note, setNote] = useState('');
  const [answersInput, setAnswersInput] = useState('');
  const [answersError, setAnswersError] = useState('');
  const [useTargetScoring, setUseTargetScoring] = useState(false);
  const [categoryAnswers, setCategoryAnswers] = useState<Record<string, string>>({});
  const [answersForm, setAnswersForm] = useState<Record<CategoryKey, string>>({
    N: '',
    M: '',
    S: '',
    R: '',
  });
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scanActive, setScanActive] = useState(true);
  const [loadingAnswers, setLoadingAnswers] = useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [autoScore, setAutoScore] = useState({ correct: 0, total: 0, given: 0, normalizedGiven: '' });
  const [alerts, setAlerts] = useState<string[]>([]);
  const [showAnswersEditor, setShowAnswersEditor] = useState(false);
  const autoScoringManuallySet = useRef(false);

  const pushAlert = useCallback((message: string) => {
    setAlerts((prev) => [...prev, message]);
    setTimeout(() => {
      setAlerts((prev) => prev.slice(1));
    }, 4000);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(JUDGE_KEY);
    if (stored) setJudge(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(JUDGE_KEY, judge);
  }, [judge]);

  const loadCategoryAnswers = useCallback(async () => {
    setLoadingAnswers(true);
    const { data, error } = await supabase
      .from('station_category_answers')
      .select('category, correct_answers')
      .eq('event_id', eventId)
      .eq('station_id', stationId);

    setLoadingAnswers(false);

    if (error) {
      console.error(error);
      pushAlert('Nepodařilo se načíst správné odpovědi.');
      return;
    }

    const map: Record<string, string> = {};
    const form = { ...answersForm };
    (data || []).forEach((row) => {
      map[row.category] = row.correct_answers;
      form[row.category as keyof typeof form] = formatAnswersForInput(row.correct_answers);
    });
    setCategoryAnswers(map);
    setAnswersForm(form);
  }, [answersForm, pushAlert]);

  useEffect(() => {
    loadCategoryAnswers();
  }, [loadCategoryAnswers]);

  const syncQueue = useCallback(async () => {
    const queue = await readQueue();
    setPendingCount(queue.length);
    if (!queue.length) return;
    if (syncing) return;

    setSyncing(true);
    const remaining: PendingSubmission[] = [];
    let flushed = 0;

    for (const item of queue) {
      const resPassage = await supabase
        .from('station_passages')
        .upsert(
          {
            event_id: item.event_id,
            patrol_id: item.patrol_id,
            station_id: item.station_id,
            arrived_at: item.arrived_at,
            wait_minutes: item.wait_minutes,
          },
          { onConflict: 'event_id,patrol_id,station_id' }
        );
      if (resPassage.error) {
        remaining.push(item);
        continue;
      }

      const resScore = await supabase
        .from('station_scores')
        .upsert(
          {
            event_id: item.event_id,
            patrol_id: item.patrol_id,
            station_id: item.station_id,
            points: item.points,
            judge: item.judge,
            note: item.note,
          },
          { onConflict: 'event_id,patrol_id,station_id' }
        );

      if (resScore.error) {
        remaining.push(item);
        continue;
      }

      if (item.useTargetScoring && item.normalizedAnswers) {
        const resQuiz = await supabase
          .from('station_quiz_responses')
          .upsert(
            {
              event_id: item.event_id,
              station_id: item.station_id,
              patrol_id: item.patrol_id,
              category: item.category,
              answers: item.normalizedAnswers,
              correct_count: item.points,
            },
            { onConflict: 'event_id,station_id,patrol_id' }
          );
        if (resQuiz.error) {
          remaining.push(item);
          continue;
        }
      } else if (item.shouldDeleteQuiz) {
        const resDelete = await supabase
          .from('station_quiz_responses')
          .delete()
          .match({ event_id: item.event_id, station_id: item.station_id, patrol_id: item.patrol_id });
        if (resDelete.error) {
          remaining.push(item);
          continue;
        }
      }

      flushed += 1;
    }

    await writeQueue(remaining);
    setPendingCount(remaining.length);
    setSyncing(false);

    if (flushed) {
      pushAlert(`Synchronizováno ${flushed} záznamů.`);
    }
  }, [pushAlert, syncing]);

  useEffect(() => {
    syncQueue();
    const onOnline = () => syncQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncQueue]);

  const resetForm = () => {
    setPatrol(null);
    setPoints('');
    setWait('0');
    setNote('');
    setAnswersInput('');
    setAnswersError('');
    setAutoScore({ correct: 0, total: 0, given: 0, normalizedGiven: '' });
    setUseTargetScoring(false);
    setScanActive(true);
    autoScoringManuallySet.current = false;
  };

  const handleScanResult = async (text: string) => {
    const match = text.match(/seton:\/\/p\/(.+)$/);
    if (!match) {
      pushAlert('Neplatný QR kód. Očekávám seton://p/<code>');
      return;
    }
    await fetchPatrol(match[1]);
  };

  const fetchPatrol = useCallback(async (patrolCode: string) => {
    const { data, error } = await supabase
      .from('patrols')
      .select('id, team_name, category, sex')
      .eq('event_id', eventId)
      .eq('patrol_code', patrolCode)
      .maybeSingle();

    if (error || !data) {
      pushAlert('Hlídka nenalezena.');
      return;
    }

    setPatrol({ ...data });
    setPoints('');
    setWait('0');
    setNote('');
    setAnswersInput('');
    setAnswersError('');
    setScanActive(false);

    autoScoringManuallySet.current = false;
    const stored = categoryAnswers[data.category] || '';
    const total = parseAnswerLetters(stored).length;
    setAutoScore({ correct: 0, total, given: 0, normalizedGiven: '' });
    setUseTargetScoring(Boolean(stored));
  }, [categoryAnswers, pushAlert]);

  useEffect(() => {
    if (!patrol) {
      return;
    }

    const stored = categoryAnswers[patrol.category] || '';
    const total = parseAnswerLetters(stored).length;
    setAutoScore((prev) => ({ ...prev, total }));

    if (!autoScoringManuallySet.current) {
      setUseTargetScoring(Boolean(stored));
    }
  }, [categoryAnswers, patrol]);

  useEffect(() => {
    if (!patrol || !useTargetScoring) {
      setAnswersError('');
      setAutoScore((prev) => ({ ...prev, correct: 0, given: 0, normalizedGiven: '' }));
      return;
    }

    const correctLetters = parseAnswerLetters(categoryAnswers[patrol.category] || '');
    const givenLetters = parseAnswerLetters(answersInput);
    const correct = correctLetters.reduce((acc, letter, index) => (letter === givenLetters[index] ? acc + 1 : acc), 0);
    const normalizedGiven = packAnswersForStorage(answersInput);
    const total = correctLetters.length;

    setAutoScore({ correct, total, given: givenLetters.length, normalizedGiven });

    if (!total) {
      setAnswersError('Pro tuto kategorii nejsou nastavené správné odpovědi.');
    } else if (givenLetters.length !== total) {
      setAnswersError(`Zadaných odpovědí: ${givenLetters.length} / ${total}.`);
    } else {
      setAnswersError('');
    }

    if (total > 0) {
      setPoints(String(correct));
    }
  }, [answersInput, useTargetScoring, patrol, categoryAnswers]);

  const saveCategoryAnswers = useCallback(async () => {
    setSavingAnswers(true);
    const updates = [] as { event_id: string; station_id: string; category: string; correct_answers: string }[];
    const deletions: string[] = [];

    for (const cat of ANSWER_CATEGORIES) {
      const packed = packAnswersForStorage(answersForm[cat]);
      if (!packed) {
        if (categoryAnswers[cat]) deletions.push(cat);
        continue;
      }
      if (packed.length !== 12) {
        pushAlert(`Kategorie ${cat} musí mít 12 odpovědí.`);
        setSavingAnswers(false);
        return;
      }
      updates.push({ event_id: eventId, station_id: stationId, category: cat, correct_answers: packed });
    }

    if (updates.length) {
      const { error } = await supabase
        .from('station_category_answers')
        .upsert(updates, { onConflict: 'event_id,station_id,category' });
      if (error) {
        console.error(error);
        pushAlert('Uložení správných odpovědí selhalo.');
        setSavingAnswers(false);
        return;
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
        console.error(error);
        pushAlert('Některé kategorie se nepodařilo odstranit.');
        setSavingAnswers(false);
        return;
      }
    }

    setSavingAnswers(false);
    pushAlert('Správné odpovědi uloženy.');
    loadCategoryAnswers();
  }, [answersForm, categoryAnswers, loadCategoryAnswers, pushAlert]);

  const handleSave = useCallback(async () => {
    if (!patrol) return;

    let scorePoints = 0;
    let normalizedAnswers: string | null = null;

    if (useTargetScoring) {
      if (!autoScore.total) {
        pushAlert('Pro tuto kategorii nejsou nastavené správné odpovědi.');
        return;
      }
      if (autoScore.given !== autoScore.total) {
        pushAlert(`Je potřeba zadat všech ${autoScore.total} odpovědí.`);
        return;
      }
      scorePoints = autoScore.correct;
      normalizedAnswers = autoScore.normalizedGiven;
    } else {
      const parsed = parseInt(points, 10);
      if (Number.isNaN(parsed) || parsed < -12 || parsed > 12) {
        pushAlert('Body musí být číslo v rozsahu -12 až 12.');
        return;
      }
      scorePoints = parsed;
    }

    const waitValue = wait.trim() === '' ? 0 : parseInt(wait, 10);
    if (Number.isNaN(waitValue) || waitValue < 0) {
      pushAlert('Čekací doba musí být nezáporné číslo.');
      return;
    }

    const now = new Date().toISOString();
    const submission: PendingSubmission = {
      event_id: eventId,
      station_id: stationId,
      patrol_id: patrol.id,
      category: patrol.category,
      arrived_at: now,
      wait_minutes: waitValue,
      points: scorePoints,
      judge,
      note,
      useTargetScoring,
      normalizedAnswers,
      shouldDeleteQuiz: !useTargetScoring,
      patrol_code: '',
    };

    const queueBefore = await readQueue();

    const passageRes = await supabase
      .from('station_passages')
      .upsert(
        {
          event_id: eventId,
          station_id: stationId,
          patrol_id: patrol.id,
          arrived_at: now,
          wait_minutes: waitValue,
        },
        { onConflict: 'event_id,patrol_id,station_id' }
      );

    if (passageRes.error) {
      await writeQueue([...queueBefore, submission]);
      setPendingCount(queueBefore.length + 1);
      pushAlert('Offline: průchod uložen do fronty.');
      resetForm();
      return;
    }

    const scoreRes = await supabase
      .from('station_scores')
      .upsert(
        {
          event_id: eventId,
          station_id: stationId,
          patrol_id: patrol.id,
          points: scorePoints,
          judge,
          note,
        },
        { onConflict: 'event_id,patrol_id,station_id' }
      );

    if (scoreRes.error) {
      await writeQueue([...queueBefore, submission]);
      setPendingCount(queueBefore.length + 1);
      pushAlert('Offline: body uložené do fronty.');
      resetForm();
      return;
    }

    if (useTargetScoring && normalizedAnswers !== null) {
      const quizRes = await supabase
        .from('station_quiz_responses')
        .upsert(
          {
            event_id: eventId,
            station_id: stationId,
            patrol_id: patrol.id,
            category: patrol.category,
            answers: normalizedAnswers,
            correct_count: scorePoints,
          },
          { onConflict: 'event_id,station_id,patrol_id' }
        );
      if (quizRes.error) {
        await writeQueue([...queueBefore, submission]);
        setPendingCount(queueBefore.length + 1);
        pushAlert('Offline: odpovědi uložené do fronty.');
        resetForm();
        return;
      }
    } else {
      const deleteRes = await supabase
        .from('station_quiz_responses')
        .delete()
        .match({ event_id: eventId, station_id: stationId, patrol_id: patrol.id });
      if (deleteRes.error) {
        await writeQueue([...queueBefore, submission]);
        setPendingCount(queueBefore.length + 1);
        pushAlert('Offline: odstranění odpovědí čeká ve frontě.');
        resetForm();
        return;
      }
    }

    pushAlert(`Uloženo: ${patrol.team_name} (${scorePoints} b)`);
    resetForm();
    syncQueue();
  }, [autoScore, judge, note, patrol, points, wait, useTargetScoring, syncQueue, pushAlert]);

  const totalAnswers = useMemo(
    () => (patrol ? parseAnswerLetters(categoryAnswers[patrol.category] || '').length : 0),
    [patrol, categoryAnswers]
  );
  const answersSummary = useMemo(
    () =>
      ANSWER_CATEGORIES.reduce(
        (acc, cat) => {
          const letters = parseAnswerLetters(categoryAnswers[cat] || '');
          acc[cat] = { letters, count: letters.length };
          return acc;
        },
        {} as Record<CategoryKey, { letters: string[]; count: number }>
      ),
    [categoryAnswers]
  );
  const hasAnyAnswers = useMemo(() => ANSWER_CATEGORIES.some((cat) => answersSummary[cat].count > 0), [answersSummary]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Seton – Stanoviště</h1>
          <p>
            Event: <code title={eventId}>{shortId(eventId)}</code>
            {' • '}Stanoviště: <code title={stationId}>{shortId(stationId)}</code>
          </p>
        </div>
        <div className="alerts">
          {alerts.map((msg, idx) => (
            <div key={idx} className="alert">
              {msg}
            </div>
          ))}
        </div>
      </header>

      <main className="layout">
        <section className="card">
          <header className="card-header">
            <h2>Správné odpovědi (12 otázek)</h2>
            <div className="card-actions">
              <button className="secondary" onClick={() => setShowAnswersEditor((prev) => !prev)}>
                {showAnswersEditor ? 'Skrýt editor' : 'Upravit odpovědi'}
              </button>
              <button className="secondary" onClick={loadCategoryAnswers} disabled={loadingAnswers}>
                {loadingAnswers ? 'Načítám…' : 'Obnovit'}
              </button>
            </div>
          </header>
          {showAnswersEditor ? (
            <>
              <p className="card-hint">Zadej 12 odpovědí (A/B/C/D) pro každou kategorii.</p>
              <div className="answers-grid">
                {ANSWER_CATEGORIES.map((cat) => (
                  <label key={cat} className="answers-field">
                    <span>{cat}</span>
                    <input
                      value={answersForm[cat]}
                      onChange={(e) =>
                        setAnswersForm((prev) => ({ ...prev, [cat]: e.target.value.toUpperCase() }))
                      }
                      placeholder="např. A B C D ..."
                    />
                  </label>
                ))}
              </div>
              <button onClick={saveCategoryAnswers} disabled={savingAnswers}>
                {savingAnswers ? 'Ukládám…' : 'Uložit správné odpovědi'}
              </button>
            </>
          ) : (
            <div className="answers-summary">
              {ANSWER_CATEGORIES.map((cat) => {
                const summary = answersSummary[cat];
                return (
                  <div key={cat} className="answers-summary-row">
                    <span className="answers-summary-label">{cat}</span>
                    <span className={summary.count ? 'answers-summary-value' : 'answers-summary-empty'}>
                      {summary.count ? `${summary.count} • ${summary.letters.join(' ')}` : 'nenastaveno'}
                    </span>
                  </div>
                );
              })}
              {!hasAnyAnswers && !loadingAnswers ? (
                <p className="answers-summary-note">Správné odpovědi zatím nejsou nastavené.</p>
              ) : null}
              {loadingAnswers ? <p className="answers-summary-note">Načítám…</p> : null}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Skener hlídek</h2>
          <div className="scanner-wrapper">
            <QRScanner active={scanActive} onResult={handleScanResult} onError={(err) => console.error(err)} />
            <div className="manual-entry">
              <label>
                Ruční kód:
                <input
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="např. NH-15"
                />
              </label>
              <button onClick={() => manualCode.trim() && fetchPatrol(manualCode.trim())}>Načíst hlídku</button>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Formulář stanoviště</h2>
          {patrol ? (
            <div className="form-grid">
              <div className="patrol-meta">
                <strong>{patrol.team_name}</strong>
                <span>
                  {patrol.category}/{patrol.sex}
                </span>
              </div>
              <label>
                Rozhodčí
                <input value={judge} onChange={(e) => setJudge(e.target.value)} placeholder="Jméno" />
              </label>
              <label>
                Čekací doba (minuty)
                <input value={wait} onChange={(e) => setWait(e.target.value)} type="number" min={0} />
              </label>
              <label>
                Poznámka
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
              </label>

              <label className="switch-field">
                <input
                  type="checkbox"
                  checked={useTargetScoring}
                  onChange={(e) => {
                    autoScoringManuallySet.current = true;
                    setUseTargetScoring(e.target.checked);
                  }}
                />
                <span>Vyhodnotit terčový úsek</span>
              </label>

              {useTargetScoring ? (
                <div className="auto-section">
                  <label>
                    Odpovědi hlídky ({totalAnswers || '–'}):
                    <input
                      value={answersInput}
                      onChange={(e) => setAnswersInput(e.target.value.toUpperCase())}
                      placeholder="např. A B C D ..."
                    />
                  </label>
                  <p>
                    Správně: {autoScore.correct} / {autoScore.total}
                  </p>
                  {answersError ? <p className="error-text">{answersError}</p> : null}
                </div>
              ) : (
                <label>
                  Body (-12 až 12)
                  <input value={points} onChange={(e) => setPoints(e.target.value)} type="number" min={-12} max={12} />
                </label>
              )}

              <button onClick={handleSave}>Uložit</button>
              <button className="secondary" onClick={resetForm}>
                Zrušit
              </button>
            </div>
          ) : (
            <p>Nejprve naskenuj hlídku.</p>
          )}
          {pendingCount > 0 ? (
            <div className="pending-banner">
              <p>Čeká na odeslání: {pendingCount}{syncing ? ' (synchronizuji…)' : ''}</p>
              <button onClick={syncQueue} disabled={syncing}>
                {syncing ? 'Synchronizuji…' : 'Odeslat nyní'}
              </button>
            </div>
          ) : null}
        </section>

        <LastScoresList />
      </main>
    </div>
  );
}

export default App;
