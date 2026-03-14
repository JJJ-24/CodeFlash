import '@/lib/i18n';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { migrateDbIfNeeded } from '@/lib/database/schema';
import { useTheme } from '@/lib/theme';

function RootStack() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="deck/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="deck/[id]/edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="deck/[id]/card/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="deck/[id]/card/[cardId]/edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="tags/index" options={{ title: '' }} />
      <Stack.Screen name="study/session" options={{ headerShown: true }} />
    </Stack>
  );
}

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
        <RootStack />
      </SQLiteProvider>
    </Suspense>
  );
}
