import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ScanAndScoreScreen from './src/screens/ScanAndScoreScreen';
import LastScoresList from './src/components/LastScoresList';

const extra = Constants.expoConfig?.extra || {};

export default function App() {
  const [judge, setJudge] = useState('');
  useEffect(() => {
    (async () => {
      const j = await AsyncStorage.getItem('judge_name');
      if (j) setJudge(j);
    })();
  }, []);
  useEffect(() => {
    AsyncStorage.setItem('judge_name', judge || '');
  }, [judge]);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.h1}>Seton – Bodování stanoviště</Text>
      <View style={styles.info}>
        <Text style={styles.small}>
          Event: <Text style={styles.mono}>{extra.EXPO_PUBLIC_EVENT_ID?.slice(0,8)}…</Text>{' '}
          • Stanoviště: <Text style={styles.mono}>{extra.EXPO_PUBLIC_STATION_ID?.slice(0,8)}…</Text>
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Rozhodčí (uloží se jen lokálně)"
          value={judge}
          onChangeText={setJudge}
        />
      </View>

      <View style={{ flex: 1 }}>
        <ScanAndScoreScreen />
      </View>

      <LastScoresList />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 12 },
  h1: { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  info: { backgroundColor: '#f6f6f6', padding: 10, borderRadius: 12, marginBottom: 8 },
  small: { fontSize: 12, opacity: 0.7 },
  mono: { fontFamily: 'Courier', fontSize: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginTop: 8 }
});
