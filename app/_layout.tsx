import '@/lib/i18n';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { Suspense, useEffect } from 'react';
import { ActivityIndicator, AppState, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { migrateDbIfNeeded } from '@/lib/database/schema';
import { cleanupOrphanImages } from '@/lib/image';
import { cancelAllReminders, scheduleDailyReminder, updateBadgeCount } from '@/lib/notifications';
import { initializePurchases, restoreProStatus } from '@/lib/purchases';
import { useTheme } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import { useThemeStore } from '@/store/theme';

initializePurchases();

function RootStack() {
  const theme = useTheme();
  const baseNavTheme = theme.dark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseNavTheme,
    colors: {
      ...baseNavTheme.colors,
      primary:    theme.colors.primary,
      background: theme.colors.background,
      card:       theme.colors.surface,
      text:       theme.colors.text,
      border:     theme.colors.border,
    },
  };
  const db = useSQLiteContext();
  const { notificationEnabled, notificationHour, notificationMinute } = useSettingsStore();

  useEffect(() => {
    cleanupOrphanImages(db).catch(() => {});
    restoreProStatus().catch(() => {});
  }, []);

  // アプリがフォアグラウンドに戻るたびに通知を再スケジュール（OS による消去に対応）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        if (notificationEnabled) {
          scheduleDailyReminder(notificationHour, notificationMinute).catch(() => {});
        } else {
          cancelAllReminders().catch(() => {});
        }
        updateBadgeCount(db).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [notificationEnabled, notificationHour, notificationMinute]);

  return (
    <ThemeProvider value={navigationTheme}>
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
        headerBackTitle: '',
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: '' }} />
      <Stack.Screen name="deck/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="deck/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="deck/[id]/edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="deck/[id]/card/new" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="deck/[id]/card/[cardId]/edit" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="tags/index" options={{ headerShown: false }} />
      <Stack.Screen name="tags/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="tags/[tagId]/edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="tags/[tagId]/cards" options={{ headerShown: false }} />
      <Stack.Screen
        name="study/session"
        options={{ headerShown: false, animation: 'fade', title: '' }}
      />
      <Stack.Screen name="search" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
    </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const hydrated = useThemeStore((s) => s.hydrated);
  const preference = useThemeStore((s) => s.preference);
  const colorScheme = useColorScheme();
  const isDark = preference === 'dark' || (preference === 'system' && colorScheme === 'dark');
  const surfaceColor = isDark ? '#1E1E1E' : '#FFFFFF';

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: surfaceColor }}>
      <Suspense
        fallback={
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator />
          </View>
        }
      >
        <SQLiteProvider databaseName="codeflash.db" onInit={migrateDbIfNeeded}>
          {hydrated ? <RootStack /> : <View style={{ flex: 1, backgroundColor: surfaceColor }} />}
        </SQLiteProvider>
      </Suspense>
    </GestureHandlerRootView>
  );
}
