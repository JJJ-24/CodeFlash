import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function Index() {
  const db = useSQLiteContext();
  const [tables, setTables] = useState<string[]>([]);

  useEffect(() => {
    db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).then((rows) => setTables(rows.map((r) => r.name)));
  }, [db]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>CodeFlash DB チェック</Text>
      <Text style={styles.subtitle}>作成済みテーブル:</Text>
      {tables.map((t) => (
        <Text key={t} style={styles.table}>
          ✓ {t}
        </Text>
      ))}
      {tables.length === 0 && <Text style={styles.empty}>テーブルなし</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  table: {
    fontSize: 16,
    color: '#2e7d32',
  },
  empty: {
    color: '#999',
  },
});
