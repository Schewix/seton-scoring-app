import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { supabase } from '../supabase';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra || {};

export default function LastScoresList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const eventId = extra.EXPO_PUBLIC_EVENT_ID;
  const stationId = extra.EXPO_PUBLIC_STATION_ID;

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('station_scores')
      .select('created_at, points, note, judge, patrols(team_name,category,sex)')
      .eq('event_id', eventId)
      .eq('station_id', stationId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (!error) setRows(data || []);
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
          return (
            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{p.team_name} • {p.category}/{p.sex}</Text>
                <Text style={styles.sub}>Body: {item.points} {item.judge ? `• ${item.judge}` : ''}</Text>
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
