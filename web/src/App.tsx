import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import localforage from 'localforage';
import QRScanner from './components/QRScanner';
import LastScoresList from './components/LastScoresList';
import TargetAnswersReport from './components/TargetAnswersReport';
import { supabase } from './supabaseClient';
import './App.css';

interface Patrol {
  id: string;
  team_name: string;
  category: string;
  sex: string;
  patrol_code: string;
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
  team_name?: string;
  sex?: string;
}

const ANSWER_CATEGORIES = ['N', 'M', 'S', 'R'] as const;
type CategoryKey = (typeof ANSWER_CATEGORIES)[number];
const QUEUE_KEY = 'web_pending_station_submissions_v1';
const JUDGE_KEY = 'judge_name';

const rawEventId = import.meta.env.VITE_EVENT_ID as string | undefined;
const rawStationId = import.meta.env.VITE_STATION_ID as string | undefined;

if (!rawEventId || !rawStationId) {
  throw new Error('Missing VITE_EVENT_ID or VITE_STATION_ID environment variables.');
}

const eventId = rawEventId;
const stationId = rawStationId;

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

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
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
  const [pendingItems, setPendingItems] = useState<PendingSubmission[]>([]);
  const [showPendingDetails, setShowPendingDetails] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scanActive, setScanActive] = useState(true);
  const [loadingAnswers, setLoadingAnswers] = useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [autoScore, setAutoScore] = useState({ correct: 0, total: 0, given: 0, normalizedGiven: '' });
  const [alerts, setAlerts] = useState<string[]>([]);
  const [showAnswersEditor, setShowAnswersEditor] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const autoScoringManuallySet = useRef(false);

  const updateQueueState = useCallback((items: PendingSubmission[]) => {
    setPendingCount(items.length);
    setPendingItems(items);
    if (items.length === 0) {
      setShowPendingDetails(false);
    }
  }, []);

  const pushAlert = useCallback((message: string) => {
    setAlerts((prev) => [...prev, message]);
    setTimeout(() => {
      setAlerts((prev) => prev.slice(1));
    }, 4500);
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
    const form: Record<CategoryKey, string> = { N: '', M: '', S: '', R: '' };
    (data || []).forEach((row) => {
      map[row.category] = row.correct_answers;
      if (ANSWER_CATEGORIES.includes(row.category as CategoryKey)) {
        form[row.category as CategoryKey] = formatAnswersForInput(row.correct_answers);
      }
    });
    setCategoryAnswers(map);
    setAnswersForm(form);
  }, [pushAlert]);

  useEffect(() => {
    loadCategoryAnswers();
  }, [loadCategoryAnswers]);

  const syncQueue = useCallback(async () => {
    const queue = await readQueue();
    updateQueueState(queue);
    if (!queue.length || syncing) return;

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
    updateQueueState(remaining);
    setSyncing(false);

    if (flushed) {
      pushAlert(`Synchronizováno ${flushed} záznamů.`);
      setLastSavedAt(new Date().toISOString());
    }
  }, [pushAlert, syncing, updateQueueState]);

  useEffect(() => {
    syncQueue();
    const onOnline = () => syncQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncQueue]);

  const resetForm = useCallback(() => {
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
  }, []);

  const fetchPatrol = useCallback(
    async (patrolCode: string) => {
      const { data, error } = await supabase
        .from('patrols')
        .select('id, team_name, category, sex, patrol_code')
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
      setManualCode('');
      autoScoringManuallySet.current = false;

      const stored = categoryAnswers[data.category] || '';
      const total = parseAnswerLetters(stored).length;
      setAutoScore({ correct: 0, total, given: 0, normalizedGiven: '' });
      setUseTargetScoring(Boolean(stored));
    },
    [categoryAnswers, pushAlert]
  );

  const handleScanResult = useCallback(
    async (text: string) => {
      const match = text.match(/seton:\/\/p\/(.+)$/);
      if (!match) {
        pushAlert('Neplatný QR kód. Očekávám seton://p/<code>');
        return;
      }
      await fetchPatrol(match[1]);
    },
    [fetchPatrol, pushAlert]
  );

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
    const updates: { event_id: string; station_id: string; category: string; correct_answers: string }[] = [];
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
      patrol_code: patrol.patrol_code,
      team_name: patrol.team_name,
      sex: patrol.sex,
    };

    const queueBefore = await readQueue();
    const queueWithSubmission = [...queueBefore, submission];
    const handleOfflineFallback = async (message: string) => {
      await writeQueue(queueWithSubmission);
      updateQueueState(queueWithSubmission);
      setShowPendingDetails(true);
      pushAlert(message);
      setLastSavedAt(now);
      resetForm();
    };

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
      await handleOfflineFallback('Offline: průchod uložen do fronty.');
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
      await handleOfflineFallback('Offline: body uložené do fronty.');
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
        await handleOfflineFallback('Offline: odpovědi uložené do fronty.');
        return;
      }
    } else {
      const deleteRes = await supabase
        .from('station_quiz_responses')
        .delete()
        .match({ event_id: eventId, station_id: stationId, patrol_id: patrol.id });
      if (deleteRes.error) {
        await handleOfflineFallback('Offline: odstranění odpovědí čeká ve frontě.');
        return;
      }
    }

    pushAlert(`Uloženo: ${patrol.team_name} (${scorePoints} b)`);
    setLastSavedAt(now);
    resetForm();
    syncQueue();
  }, [
    autoScore,
    judge,
    note,
    patrol,
    points,
    wait,
    useTargetScoring,
    syncQueue,
    pushAlert,
    resetForm,
    updateQueueState,
  ]);

  const totalAnswers = useMemo(
    () => (patrol ? parseAnswerLetters(categoryAnswers[patrol.category] || '').length : 0),
    [patrol, categoryAnswers]
  );
  const heroBadges = useMemo(
    () => [
      `Event: ${shortId(eventId)}`,
      `Stanoviště: ${shortId(stationId)}`,
      pendingCount ? `Offline fronta: ${pendingCount}` : 'Offline fronta prázdná',
    ],
    [pendingCount]
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

  const hasAnyAnswers = useMemo(
    () => ANSWER_CATEGORIES.some((cat) => answersSummary[cat].count > 0),
    [answersSummary]
  );

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-brand">
          <div className="hero-logo" aria-hidden>
            <span>🪢</span>
          </div>
          <div>
            <h1>Uzlování – stanoviště</h1>
            <p>Webová podpora rozhodčích s QR skenerem, automatickým hodnocením a offline frontou.</p>
          </div>
        </div>
        <div className="hero-meta">
          {heroBadges.map((badge) => (
            <span key={badge} className="meta-pill">
              {badge}
            </span>
          ))}
          {lastSavedAt ? (
            <span className="meta-pill subtle">Poslední záznam: {formatTime(lastSavedAt)}</span>
          ) : null}
          {syncing ? <span className="meta-pill subtle">Synchronizuji frontu…</span> : null}
        </div>
      </header>

      <main className="content">
        {alerts.length ? (
          <div className="alerts">
            {alerts.map((msg, idx) => (
              <div key={idx} className="alert">
                {msg}
              </div>
            ))}
          </div>
        ) : null}

        <section className="card answers-card">
          <header className="card-header">
            <div>
              <h2>Správné odpovědi</h2>
              <p className="card-subtitle">Každá kategorie musí mít 12 odpovědí (A–D).</p>
            </div>
            <div className="card-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setShowAnswersEditor((prev) => !prev)}
              >
                {showAnswersEditor ? 'Zobrazit přehled' : 'Upravit odpovědi'}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={loadCategoryAnswers}
                disabled={loadingAnswers}
              >
                {loadingAnswers ? 'Načítám…' : 'Obnovit'}
              </button>
            </div>
          </header>
          {showAnswersEditor ? (
            <div className="answers-editor">
              <p className="card-hint">Zadej 12 odpovědí (A/B/C/D) pro každou kategorii.</p>
              <div className="answers-grid">
                {ANSWER_CATEGORIES.map((cat) => (
                  <label key={cat} className="answers-field">
                    <span>{cat}</span>
                    <input
                      value={answersForm[cat]}
                      onChange={(event) =>
                        setAnswersForm((prev) => ({ ...prev, [cat]: event.target.value.toUpperCase() }))
                      }
                      placeholder="např. A B C D …"
                    />
                  </label>
                ))}
              </div>
              <div className="answers-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={saveCategoryAnswers}
                  disabled={savingAnswers}
                >
                  {savingAnswers ? 'Ukládám…' : 'Uložit správné odpovědi'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={loadCategoryAnswers}
                  disabled={loadingAnswers}
                >
                  Znovu načíst
                </button>
              </div>
            </div>
          ) : (
            <div className="answers-summary">
              {ANSWER_CATEGORIES.map((cat) => {
                const summary = answersSummary[cat];
                return (
                  <div key={cat} className="answers-summary-row">
                    <span className="answers-tag">{cat}</span>
                    <span className="answers-value">
                      {summary.count ? `${summary.count} • ${summary.letters.join(' ')}` : 'Nenastaveno'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {!showAnswersEditor && !hasAnyAnswers && !loadingAnswers ? (
            <p className="card-hint">Správné odpovědi zatím nejsou nastavené.</p>
          ) : null}
          {!showAnswersEditor && loadingAnswers ? <p className="card-hint">Načítám…</p> : null}
        </section>

        <section className="card scanner-card">
          <div className="scanner-icon" aria-hidden>
            <span>📷</span>
          </div>
          <div className="scanner-copy">
            <h2>Skener hlídek</h2>
            <p>Naskenuj QR kód nebo zadej kód ručně. Po načtení se formulář otevře automaticky.</p>
          </div>
          <div className="scanner-wrapper">
            <QRScanner active={scanActive} onResult={handleScanResult} onError={(err) => console.error(err)} />
            <div className="manual-entry">
              <label>
                Ruční kód
                <input
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="např. NH-15"
                />
              </label>
              <button
                type="button"
                className="primary"
                onClick={() => manualCode.trim() && fetchPatrol(manualCode.trim())}
              >
                Načíst hlídku
              </button>
            </div>
            {patrol ? (
              <div className="scanner-preview">
                <strong>{patrol.team_name}</strong>
                <span>
                  {patrol.category}/{patrol.sex}
                </span>
              </div>
            ) : (
              <p className="scanner-placeholder">Nejprve naskenuj QR kód hlídky.</p>
            )}
          </div>
        </section>

        <section className="card form-card">
          <header className="card-header">
            <div>
              <h2>Stanovištní formulář</h2>
              <p className="card-subtitle">Vyplň body, čekací dobu, poznámku a potvrď uložení.</p>
            </div>
            <button type="button" className="ghost" onClick={resetForm}>
              Vymazat
            </button>
          </header>
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
                <input value={judge} onChange={(event) => setJudge(event.target.value)} placeholder="Jméno" />
              </label>
              <label>
                Čekací doba (minuty)
                <input value={wait} onChange={(event) => setWait(event.target.value)} type="number" min={0} />
              </label>
              <label>
                Poznámka
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
              </label>
              <label className="switch-field">
                <input
                  type="checkbox"
                  checked={useTargetScoring}
                  onChange={(event) => {
                    autoScoringManuallySet.current = true;
                    setUseTargetScoring(event.target.checked);
                  }}
                />
                <span>Vyhodnotit terčový úsek</span>
              </label>
              {useTargetScoring ? (
                <div className="auto-section">
                  <label>
                    Odpovědi hlídky ({totalAnswers || '–'})
                    <input
                      value={answersInput}
                      onChange={(event) => setAnswersInput(event.target.value.toUpperCase())}
                      placeholder="např. A B C D …"
                    />
                  </label>
                  <p className="auto-score">Správně: {autoScore.correct} / {autoScore.total}</p>
                  {answersError ? <p className="error-text">{answersError}</p> : null}
                </div>
              ) : (
                <label>
                  Body (-12 až 12)
                  <input
                    value={points}
                    onChange={(event) => setPoints(event.target.value)}
                    type="number"
                    min={-12}
                    max={12}
                  />
                </label>
              )}
              <button type="button" className="primary" onClick={handleSave}>
                Uložit záznam
              </button>
            </div>
          ) : (
            <p className="form-placeholder">Nejprve naskenuj hlídku a otevři formulář.</p>
          )}
          {pendingCount > 0 ? (
            <div className="pending-banner">
              <div className="pending-banner-main">
                <div>
                  Čeká na odeslání: {pendingCount} {syncing ? '(synchronizuji…)' : ''}
                </div>
                <div className="pending-banner-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setShowPendingDetails((prev) => !prev)}
                  >
                    {showPendingDetails ? 'Skrýt frontu' : 'Zobrazit frontu'}
                  </button>
                  <button type="button" onClick={syncQueue} disabled={syncing}>
                    {syncing ? 'Pracuji…' : 'Odeslat nyní'}
                  </button>
                </div>
              </div>
              {showPendingDetails ? (
                <div className="pending-preview">
                  {pendingItems.length === 0 ? (
                    <p>Fronta je prázdná.</p>
                  ) : (
                    <div className="table-scroll">
                      <table className="pending-table">
                        <thead>
                          <tr>
                            <th>Hlídka</th>
                            <th>Body / Terč</th>
                            <th>Rozhodčí</th>
                            <th>Poznámka</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pendingItems.map((item, index) => {
                            const answers = item.useTargetScoring
                              ? formatAnswersForInput(item.normalizedAnswers || '')
                              : '';
                            const patrolLabel = item.team_name || 'Neznámá hlídka';
                            const codeLabel = item.patrol_code ? ` (${item.patrol_code})` : '';
                            const categoryLabel = item.sex ? `${item.category}/${item.sex}` : item.category;
                            return (
                              <tr key={`${item.patrol_id}-${item.arrived_at}-${index}`}>
                                <td>
                                  <div className="pending-patrol">
                                    <strong>
                                      {patrolLabel}
                                      {codeLabel}
                                    </strong>
                                    <span className="pending-subline">{categoryLabel}</span>
                                    <span className="pending-subline">Čekání: {item.wait_minutes} min</span>
                                  </div>
                                </td>
                                <td>
                                  <div className="pending-score">
                                    <span className="pending-score-points">{item.points} b</span>
                                    <span className="pending-subline">
                                      {item.useTargetScoring ? 'Terčový úsek' : 'Manuální body'}
                                    </span>
                                    {item.useTargetScoring ? (
                                      <span className="pending-answers">{answers || '—'}</span>
                                    ) : null}
                                  </div>
                                </td>
                                <td>{item.judge || '—'}</td>
                                <td>{item.note ? item.note : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <LastScoresList />
        <TargetAnswersReport />
      </main>
    </div>
  );
}

export default App;
