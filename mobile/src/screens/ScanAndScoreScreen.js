import React, { useEffect, useState } from 'react';
import { View, Text, Button, TextInput, Alert, StyleSheet } from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { supabase } from '../supabase';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra || {};

export default function ScanAndScoreScreen() {
  const eventId = extra.EXPO_PUBLIC_EVENT_ID;
  const stationId = extra.EXPO_PUBLIC_STATION_ID;

  const [hasPermission, setHasPermission] = useState(null);
  const [scanned, setScanned] = useState(false);
  const [patrol, setPatrol] = useState(null);
  const [points, setPoints] = useState('');
  const [wait, setWait] = useState('0');
  const [note, setNote] = useState('');
  const [judge, setJudge] = useState('');

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

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
  };

  const save = async () => {
    if (!patrol) return;
    const pts = parseInt(points, 10);
    const w = parseInt(wait, 10) || 0;
    if (Number.isNaN(pts)) {
      Alert.alert('Chyba', 'Body musí být celé číslo.');
      return;
    }
    const now = new Date().toISOString();
    await supabase.from('station_passages').upsert({
      event_id: eventId,
      patrol_id: patrol.id,
      station_id: stationId,
      arrived_at: now,
      wait_minutes: w
    }, { onConflict: 'event_id,patrol_id,station_id' });

    const { error } = await supabase.from('station_scores').upsert({
      event_id: eventId,
      patrol_id: patrol.id,
      station_id: stationId,
      points: pts,
      judge,
      note
    }, { onConflict: 'event_id,patrol_id,station_id' });

    if (error) {
      Alert.alert('Nepovedlo se uložit', String(error.message));
      return;
    }
    Alert.alert('Uloženo', `${patrol.team_name}: ${pts} b`);
    setScanned(false); setPatrol(null); setPoints(''); setWait('0'); setNote('');
  };

  if (hasPermission === null) return <Text>Žádám oprávnění ke kameře…</Text>;
  if (hasPermission === false) return <Text>Bez přístupu ke kameře nelze skenovat QR.</Text>;

  return (
    <View style={{ flex: 1 }}>
      {!scanned && !patrol && (
        <BarCodeScanner onBarCodeScanned={onScan} style={{ flex: 1, borderRadius: 12 }} />
      )}
      {patrol && (
        <View style={styles.card}>
          <Text style={styles.h2}>{patrol.team_name} • {patrol.category}/{patrol.sex}</Text>
          <TextInput style={styles.input} placeholder="Body (0–12; u T −12..12)" keyboardType="number-pad" value={points} onChangeText={setPoints} />
          <TextInput style={styles.input} placeholder="Čekací doba (minuty)" keyboardType="number-pad" value={wait} onChangeText={setWait} />
          <TextInput style={styles.input} placeholder="Rozhodčí (jméno)" value={judge} onChangeText={setJudge} />
          <TextInput style={[styles.input,{height:80}]} placeholder="Poznámka" value={note} onChangeText={setNote} multiline />
          <Button title="Uložit" onPress={save} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#f6f6f6', padding: 12, borderRadius: 12 },
  h2: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 8 }
});
