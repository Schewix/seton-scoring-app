import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { supabase } from '../supabase';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra || {};

const parseAnswerLetters = (value = '') => (value.match(/[A-D]/gi) || []).map((l) => l.toUpperCase());

export default function LastScoresList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const eventId = extra.EXPO_PUBLIC_EVENT_ID;
  const stationId = extra.EXPO_PUBLIC_STATION_ID;

  const load = async () => {
    setLoading(true);
    const [scoresRes, quizRes] = await Promise.all([
      supabase
        .from('station_scores')
        .select('created_at, points, note, judge, patrol_id, patrols(team_name,category,sex)')
        .eq('event_id', eventId)
        .eq('station_id', stationId)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('station_quiz_responses')
        .select('patrol_id, correct_count, answers, updated_at')
        .eq('event_id', eventId)
        .eq('station_id', stationId)
    ]);

    if (!scoresRes.error && !quizRes.error) {
      const quizMap = new Map();
      (quizRes.data || []).forEach((row) => {
        quizMap.set(row.patrol_id, row);
      });
      const merged = (scoresRes.data || []).map((row) => ({
        ...row,
        quiz: quizMap.get(row.patrol_id) || null
      }));
      setRows(merged);
    } else {
      setRows(scoresRes.data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <View style={styles.card}>
      <Text style={styles.h2}>Poslední záznamy ({loading ? '…' : rows.length})</Text>
      <FlatList
        data={rows}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => {
          const p = item.patrols || {};
          const quiz = item.quiz;
          const quizLetters = parseAnswerLetters((quiz && quiz.answers) || '');
          return (
            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{p.team_name} • {p.category}/{p.sex}</Text>
                <Text style={styles.sub}>Body: {item.points} {item.judge ? `• ${item.judge}` : ''}</Text>
                {quiz ? (
                  <Text style={styles.sub}>
                    Terčový úsek: {quiz.correct_count}
                    {quizLetters.length ? `/${quizLetters.length} • ${quizLetters.join(' ')}` : ''}
                  </Text>
                ) : null}
                {item.note ? <Text style={styles.note}>„{item.note}“</Text> : null}
                <Text style={styles.sub}>{new Date(item.created_at).toLocaleString()}</Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={{opacity:0.6}}>Žádné záznamy…</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#f6f6f6', borderRadius: 12, padding: 12, marginTop: 12 },
  h2: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  item: { backgroundColor:'#fff', borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 10, marginBottom: 8 },
  title: { fontWeight: '700' },
  sub: { opacity: 0.7, fontSize: 12 },
  note: { fontStyle: 'italic', marginTop: 4 }
});
