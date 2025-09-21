import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Button,
  TextInput,
  Alert,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { supabase } from '../supabase';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra || {};
const CATEGORIES = ['N', 'M', 'S', 'R'];

const parseAnswerLetters = (value = '') => (value.match(/[A-D]/gi) || []).map((l) => l.toUpperCase());
const formatAnswersForInput = (stored = '') => parseAnswerLetters(stored).join(' ');
const packAnswersForStorage = (value = '') => parseAnswerLetters(value).join('');

export default function ScanAndScoreScreen({ judge = '', onJudgeChange = () => {} }) {
  const eventId = extra.EXPO_PUBLIC_EVENT_ID;
  const stationId = extra.EXPO_PUBLIC_STATION_ID;

  const [hasPermission, setHasPermission] = useState(null);
  const [scanned, setScanned] = useState(false);
  const [patrol, setPatrol] = useState(null);
  const [points, setPoints] = useState('');
  const [wait, setWait] = useState('0');
  const [note, setNote] = useState('');

  const [categoryAnswers, setCategoryAnswers] = useState({});
  const [answersForm, setAnswersForm] = useState(() => ({ N: '', M: '', S: '', R: '' }));
  const [answersLoading, setAnswersLoading] = useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [showAnswersEditor, setShowAnswersEditor] = useState(false);

  const [useTargetScoring, setUseTargetScoring] = useState(false);
  const [answersInput, setAnswersInput] = useState('');
  const [answersError, setAnswersError] = useState('');
  const [autoScore, setAutoScore] = useState({ correct: 0, total: 0, given: 0, normalizedGiven: '' });
  const autoScoringManuallySet = useRef(false);

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const loadCategoryAnswers = useCallback(async () => {
    if (!eventId || !stationId) return;
    setAnswersLoading(true);
    const { data, error } = await supabase
      .from('station_category_answers')
      .select('category, correct_answers')
      .eq('event_id', eventId)
      .eq('station_id', stationId);

    if (error) {
      Alert.alert('Chyba', `Nepodařilo se načíst správné odpovědi: ${error.message}`);
      setAnswersLoading(false);
      return;
    }

    const nextMap = {};
    const nextForm = { N: '', M: '', S: '', R: '' };
    (data || []).forEach((row) => {
      nextMap[row.category] = row.correct_answers;
      nextForm[row.category] = formatAnswersForInput(row.correct_answers);
    });
    setCategoryAnswers(nextMap);
    setAnswersForm((prev) => ({ ...prev, ...nextForm }));
    setAnswersLoading(false);
  }, [eventId, stationId]);

  useEffect(() => {
    loadCategoryAnswers();
  }, [loadCategoryAnswers]);

  const onScan = async ({ data }) => {
    setScanned(true);
    const m = String(data).match(/seton:\/\/p\/([A-Za-z0-9_-]+)/);
    if (!m) {
      Alert.alert('Neplatný QR', 'Očekávám kód ve tvaru seton://p/<code>');
      setScanned(false);
      return;
    }
    const patrolCode = m[1];
    const { data: row, error } = await supabase
      .from('patrols')
      .select('id, team_name, category, sex')
      .eq('event_id', eventId)
      .eq('patrol_code', patrolCode)
      .limit(1)
      .maybeSingle();

    if (error || !row) {
      Alert.alert('Hlídka nenalezena', 'Zkontroluj, že QR patří k této akci.');
      setScanned(false);
      return;
    }
    setPatrol(row);
    setPoints('');
    setWait('0');
    setNote('');
    setAnswersInput('');
    setAnswersError('');
    autoScoringManuallySet.current = false;
    const stored = categoryAnswers[row.category] || '';
    setUseTargetScoring(Boolean(stored));
    const total = parseAnswerLetters(stored).length;
    setAutoScore({ correct: 0, total, given: 0, normalizedGiven: '' });
  };

  useEffect(() => {
    if (!patrol) {
      autoScoringManuallySet.current = false;
      setUseTargetScoring(false);
      setAnswersInput('');
      setAnswersError('');
      setAutoScore({ correct: 0, total: 0, given: 0, normalizedGiven: '' });
      return;
    }

    const stored = categoryAnswers[patrol.category] || '';
    const total = parseAnswerLetters(stored).length;
    setAutoScore((prev) => ({ ...prev, total }));
    if (!autoScoringManuallySet.current && stored) {
      setUseTargetScoring(true);
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
    const correct = correctLetters.reduce(
      (sum, letter, index) => (letter === givenLetters[index] ? sum + 1 : sum),
      0
    );
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
    if (!eventId || !stationId) return;
    const updates = [];
    const deletions = [];

    for (const category of CATEGORIES) {
      const inputValue = answersForm[category] || '';
      const packed = packAnswersForStorage(inputValue);
      if (!packed) {
        if (categoryAnswers[category]) deletions.push(category);
        continue;
      }
      if (packed.length !== 12) {
        Alert.alert('Chyba', `Kategorie ${category} musí mít přesně 12 odpovědí (aktuálně ${packed.length}).`);
        return;
      }
      updates.push({
        event_id: eventId,
        station_id: stationId,
        category,
        correct_answers: packed
      });
    }

    setSavingAnswers(true);
    if (updates.length) {
      const { error } = await supabase
        .from('station_category_answers')
        .upsert(updates, { onConflict: 'event_id,station_id,category' });
      if (error) {
        setSavingAnswers(false);
        Alert.alert('Chyba', `Během ukládání došlo k chybě: ${error.message}`);
        return;
      }
    }

    if (deletions.length) {
      const deletePromises = deletions.map((category) =>
        supabase
          .from('station_category_answers')
          .delete()
          .match({ event_id: eventId, station_id: stationId, category })
      );
      const results = await Promise.all(deletePromises);
      const deleteError = results.find((res) => res.error)?.error;
      if (deleteError) {
        setSavingAnswers(false);
        Alert.alert('Chyba', `Nepodařilo se odstranit kategorie: ${deleteError.message}`);
        return;
      }
    }

    setSavingAnswers(false);
    Alert.alert('Uloženo', 'Správné odpovědi byly aktualizovány.');
    setCategoryAnswers((prev) => {
      const next = { ...prev };
      deletions.forEach((category) => {
        delete next[category];
      });
      updates.forEach(({ category, correct_answers }) => {
        next[category] = correct_answers;
      });
      return next;
    });
    setAnswersForm((prev) => {
      const next = { ...prev };
      deletions.forEach((category) => {
        next[category] = '';
      });
      updates.forEach(({ category, correct_answers }) => {
        next[category] = formatAnswersForInput(correct_answers);
      });
      return next;
    });
  }, [answersForm, categoryAnswers, eventId, stationId]);

  const save = async () => {
    if (!patrol) return;

    let pts = 0;
    let normalizedAnswers = null;

    if (useTargetScoring) {
      if (!autoScore.total) {
        Alert.alert('Chyba', 'Pro tuto kategorii nejsou nastavené správné odpovědi.');
        return;
      }
      if (autoScore.given !== autoScore.total) {
        Alert.alert('Chyba', `Je potřeba zadat všech ${autoScore.total} odpovědí.`);
        return;
      }
      pts = autoScore.correct;
      normalizedAnswers = autoScore.normalizedGiven;
    } else {
      const parsedPoints = parseInt(points, 10);
      if (Number.isNaN(parsedPoints)) {
        Alert.alert('Chyba', 'Body musí být celé číslo.');
        return;
      }
      pts = parsedPoints;
    }

    const w = parseInt(wait, 10) || 0;
    const now = new Date().toISOString();
    await supabase.from('station_passages').upsert(
      {
        event_id: eventId,
        patrol_id: patrol.id,
        station_id: stationId,
        arrived_at: now,
        wait_minutes: w
      },
      { onConflict: 'event_id,patrol_id,station_id' }
    );

    const { error } = await supabase.from('station_scores').upsert(
      {
        event_id: eventId,
        patrol_id: patrol.id,
        station_id: stationId,
        points: pts,
        judge,
        note
      },
      { onConflict: 'event_id,patrol_id,station_id' }
    );

    if (error) {
      Alert.alert('Nepovedlo se uložit', String(error.message));
      return;
    }

    if (useTargetScoring && normalizedAnswers !== null) {
      const { error: quizError } = await supabase.from('station_quiz_responses').upsert(
        {
          event_id: eventId,
          patrol_id: patrol.id,
          station_id: stationId,
          category: patrol.category,
          answers: normalizedAnswers,
          correct_count: pts
        },
        { onConflict: 'event_id,station_id,patrol_id' }
      );
      if (quizError) {
        Alert.alert('Nepovedlo se uložit odpovědi', String(quizError.message));
        return;
      }
    }

    if (!useTargetScoring) {
      await supabase
        .from('station_quiz_responses')
        .delete()
        .match({ event_id: eventId, station_id: stationId, patrol_id: patrol.id });
    }

    Alert.alert('Uloženo', `${patrol.team_name}: ${pts} b`);
    setScanned(false);
    setPatrol(null);
    setPoints('');
    setWait('0');
    setNote('');
    setAnswersInput('');
    setAnswersError('');
    setUseTargetScoring(false);
    autoScoringManuallySet.current = false;
  };

  if (hasPermission === null) return <Text>Žádám oprávnění ke kameře…</Text>;
  if (hasPermission === false) return <Text>Bez přístupu ke kameře nelze skenovat QR.</Text>;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.answersPanel}>
        <TouchableOpacity
          style={styles.answersHeader}
          onPress={() => setShowAnswersEditor((prev) => !prev)}
        >
          <Text style={styles.answersTitle}>Správné odpovědi (12 otázek)</Text>
          <Text style={styles.answersToggle}>{showAnswersEditor ? '▴' : '▾'}</Text>
        </TouchableOpacity>
        {answersLoading ? (
          <View style={styles.answersLoader}>
            <ActivityIndicator />
            <Text style={styles.answersLoaderText}>Načítám…</Text>
          </View>
        ) : null}
        {!showAnswersEditor && !answersLoading && (
          <View style={styles.answersSummary}>
            {CATEGORIES.map((cat) => {
              const stored = categoryAnswers[cat];
              const letters = parseAnswerLetters(stored || '');
              return (
                <Text key={cat} style={styles.answersSummaryItem}>
                  {cat}: {letters.length ? `${letters.length} • ${letters.join(' ')}` : 'nenastaveno'}
                </Text>
              );
            })}
          </View>
        )}
        {showAnswersEditor && (
          <View style={styles.answersEditor}>
            {CATEGORIES.map((category) => (
              <View key={category} style={styles.answersRow}>
                <Text style={styles.answersLabel}>{category}</Text>
                <TextInput
                  style={styles.answersInput}
                  value={answersForm[category]}
                  placeholder="např. A B C …"
                  autoCapitalize="characters"
                  onChangeText={(value) =>
                    setAnswersForm((prev) => ({ ...prev, [category]: value.toUpperCase() }))
                  }
                />
              </View>
            ))}
            <Button
              title={savingAnswers ? 'Ukládám…' : 'Uložit správné odpovědi'}
              onPress={saveCategoryAnswers}
              disabled={savingAnswers}
            />
          </View>
        )}
      </View>

      <View style={{ flex: 1 }}>
        {!scanned && !patrol && (
          <BarCodeScanner onBarCodeScanned={onScan} style={{ flex: 1, borderRadius: 12 }} />
        )}
        {patrol && (
          <View style={styles.card}>
            <Text style={styles.h2}>
              {patrol.team_name} • {patrol.category}/{patrol.sex}
            </Text>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Vyhodnotit terčový úsek</Text>
              <Switch
                value={useTargetScoring}
                onValueChange={(value) => {
                  autoScoringManuallySet.current = true;
                  setUseTargetScoring(value);
                }}
              />
            </View>
            {useTargetScoring ? (
              <View style={styles.autoScoringBox}>
                <Text style={styles.smallLabel}>Odpovědi hlídky (A/B/C/D):</Text>
                <TextInput
                  style={[styles.input, styles.answersEntry]}
                  value={answersInput}
                  onChangeText={(value) => setAnswersInput(value.toUpperCase())}
                  placeholder="např. A B C D …"
                  autoCapitalize="characters"
                />
                <Text style={styles.autoScoreSummary}>
                  Správně: {autoScore.correct} / {autoScore.total}
                </Text>
                {answersError ? <Text style={styles.errorText}>{answersError}</Text> : null}
              </View>
            ) : (
              <TextInput
                style={styles.input}
                placeholder="Body (0–12; u T −12..12)"
                keyboardType="number-pad"
                value={points}
                onChangeText={setPoints}
              />
            )}
            <TextInput
              style={styles.input}
              placeholder="Čekací doba (minuty)"
              keyboardType="number-pad"
              value={wait}
              onChangeText={setWait}
            />
            <TextInput
              style={styles.input}
              placeholder="Rozhodčí (jméno)"
              value={judge}
              onChangeText={onJudgeChange}
            />
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="Poznámka"
              value={note}
              onChangeText={setNote}
              multiline
            />
            <Button title="Uložit" onPress={save} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  answersPanel: {
    backgroundColor: '#f2f6ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8
  },
  answersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  answersTitle: { fontWeight: '700', fontSize: 16 },
  answersToggle: { fontSize: 18 },
  answersLoader: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  answersLoaderText: { marginLeft: 8, opacity: 0.7 },
  answersSummary: { marginTop: 8 },
  answersSummaryItem: { fontSize: 12, opacity: 0.7 },
  answersEditor: { marginTop: 8 },
  answersRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  answersLabel: { width: 24, fontWeight: '700' },
  answersInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginLeft: 8
  },
  card: { backgroundColor: '#f6f6f6', padding: 12, borderRadius: 12 },
  h2: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 8 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  switchLabel: { fontWeight: '600' },
  autoScoringBox: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#dfe6ff',
    marginBottom: 8
  },
  answersEntry: { marginBottom: 6 },
  smallLabel: { fontSize: 12, opacity: 0.7, marginBottom: 4 },
  autoScoreSummary: { fontWeight: '600', marginTop: 4 },
  errorText: { color: '#b00020', marginTop: 4 }
});
