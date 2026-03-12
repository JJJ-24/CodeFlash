import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { migrateDbIfNeeded } from '@/lib/database/schema';

export default function RootLayout() {
  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator />
        </View>
      }
    >
      <SQLiteProvider databaseName="codeflash.db" onInit={migrateDbIfNeeded}>
        <Stack />
      </SQLiteProvider>
    </Suspense>
  );
}
