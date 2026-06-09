import '@/lib/i18n';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Network from 'expo-network';
import { Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, AppState, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { migrateDbIfNeeded } from '@/lib/database/schema';
import { cleanupOrphanImages } from '@/lib/image';
import { cancelAllScheduledNotifications, scheduleFromDb, updateBadgeCount } from '@/lib/notifications';
import { initializePurchases, restoreProStatus } from '@/lib/purchases';
import { syncNoticeText } from '@/lib/sync/errorText';
import { listLocalBackups, triggerBackgroundUpload, triggerForegroundSync } from '@/lib/sync/syncEngine';
import { useTheme } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';
import { useSyncStore } from '@/store/sync';
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
  const { notificationEnabled } = useSettingsStore();
  const syncHydrated = useSyncStore((s) => s.hydrated);
  const syncEnabled = useSyncStore((s) => s.enabled);

  useEffect(() => {
    // 保持中の自動バックアップが参照する画像は温存する（029 案B）。
    listLocalBackups()
      .then((backups) => cleanupOrphanImages(db, backups.map((b) => b.path)))
      .catch(() => {});
    restoreProStatus().catch(() => {});
  }, []);

  // iCloud 同期の自動トリガー：起動／フォアグラウンド復帰でプル、バックグラウンド移行でアップ。
  // hydrated・enabled の変化で張り直す（無効時はリスナーを張らない）。判定は trigger 内でも再確認する。
  useEffect(() => {
    if (!syncHydrated || !syncEnabled) return;
    triggerForegroundSync(db);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') triggerForegroundSync(db);
      else if (next === 'background') triggerBackgroundUpload(db);
    });
    // ネット接続が復帰したとき（アプリ起動中）に自動同期する。AppState は変化しないため、
    // 使用中にオフライン→オンラインへ戻っても、これが無いと次の前面復帰／背面化まで同期されない。
    // オフライン中に追加した変更を、接続が戻った時点でアップロードできる。
    //
    // 復帰判定は「到達性まで確定（isInternetReachable === true）」を条件にする。WiFi 接続直後は
    // 「つながったが到達性は未確定」という中間状態のイベントが来るため、ここで発火させると
    // 直後の同期判定がまだ offline と出て「接続したのにオフライン」バナーになってしまう。
    const isReachable = (st: Network.NetworkState) =>
      st.isConnected === true && st.isInternetReachable === true;
    let wasOnline = true;
    Network.getNetworkStateAsync()
      .then((st) => {
        wasOnline = isReachable(st);
      })
      .catch(() => {});
    const netSub = Network.addNetworkStateListener((state) => {
      const online = isReachable(state);
      // オフライン→オンラインへの遷移時だけ発火（triggerForegroundSync 側でスロットル・
      // 多重起動ガードも効くため、オンライン中の細かな変化で連発しても実害はない）。
      // 復帰経路ではオフライン案内バナーは出さない（過渡的な offline 判定での誤表示防止）。
      if (online && !wasOnline) triggerForegroundSync(db, { showOfflineNotice: false });
      wasOnline = online;
    });
    return () => {
      sub.remove();
      netSub.remove();
    };
  }, [db, syncHydrated, syncEnabled]);

  // アプリがフォアグラウンドに戻るたびに通知を再スケジュール（OS による消去に対応）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        if (notificationEnabled) {
          scheduleFromDb(db).catch(() => {});
        } else {
          cancelAllScheduledNotifications().catch(() => {});
        }
        updateBadgeCount(db).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [notificationEnabled]);

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
      <Stack.Screen name="about" options={{ headerShown: false }} />
      <Stack.Screen name="settings/display" options={{ headerShown: false }} />
      <Stack.Screen name="settings/notifications" options={{ headerShown: false }} />
      <Stack.Screen name="settings/study" options={{ headerShown: false }} />
      <Stack.Screen name="settings/sync" options={{ headerShown: false }} />
      <Stack.Screen name="settings/sync-merge" options={{ headerShown: false }} />
      <Stack.Screen name="settings/data" options={{ headerShown: false }} />
      <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
    </Stack>
    </ThemeProvider>
  );
}

/**
 * 同期の状況を画面のどこにいても短時間だけ知らせる控えめなバナー。
 * 自動同期の経路（起動／復帰／接続復帰）だけがセットする通知（store の noticeId）を見て表示する。
 * 手動同期の結果は設定画面のアラート＋赤字インラインに任せ、ここには出さない（多重通知を避ける）。
 * - 'error'（赤）: オンラインでの自動同期失敗など
 * - 'info'（控えめ）: オフライン起動で未同期の変更があるときの案内
 * pointerEvents="none" で操作は一切ブロックしない。画面下部に数秒だけ出して自動的に消える。
 */
function SyncNoticeBanner({ isDark }: { isDark: boolean }) {
  const { t } = useTranslation();
  const noticeId = useSyncStore((s) => s.noticeId);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'error' | 'info'>('info');
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // noticeId が変化した瞬間に表示（同じ内容でも showNotice のたびに id が進むので再点灯する）。
    if (noticeId === 0) return; // 初期状態（まだ何も通知していない）
    const { noticeKind, noticeCode } = useSyncStore.getState();
    if (!noticeKind || !noticeCode) return;
    setKind(noticeKind);
    setText(syncNoticeText(noticeCode, t));
    setVisible(true);
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setVisible(false);
        },
      );
    }, 4000);
    return () => clearTimeout(timer);
  }, [noticeId, t, opacity]);

  if (!visible) return null;
  const backgroundColor =
    kind === 'error'
      ? isDark ? '#5C1A16' : '#B3261E'
      : isDark ? '#334155' : '#475569';
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 96,
        opacity,
        backgroundColor,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
      }}
    >
      <Text style={{ color: '#fff', fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </Animated.View>
  );
}

export default function RootLayout() {
  const hydrated = useThemeStore((s) => s.hydrated);
  const preference = useThemeStore((s) => s.preference);
  const colorScheme = useColorScheme();
  const isDark = preference === 'dark' || (preference === 'system' && colorScheme === 'dark');
  const surfaceColor = isDark ? '#1E1E1E' : '#FFFFFF';
  const textColor = isDark ? '#FFFFFF' : '#1A1A1A';
  const { t } = useTranslation();
  const syncStatus = useSyncStore((s) => s.status);
  const syncDirection = useSyncStore((s) => s.direction);
  const syncBlocking = useSyncStore((s) => s.blocking);
  // ユーザー操作の同期（blocking）は決定フェーズから全画面ブロック。
  // 自動同期は実際の転送（direction が立つ）中のみブロックし、リモート確認だけならチラつかせない。
  const showSyncOverlay = syncStatus === 'syncing' && (syncBlocking || syncDirection !== null);

  const syncOverlayText =
    syncDirection === 'upload' ? t('sync.syncingUpload')
    : syncDirection === 'download' ? t('sync.syncingDownload')
    : t('sync.syncing');

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
      {/* 同期中はアプリ全体をブロックして DB 書込み系の操作との競合を防ぐ。
          ダウンロード復元は ATTACH によるデータ入れ替え（接続を閉じない）に変更したため
          ツリーの unmount は発生しないが、入れ替え中の DB アクセス競合を避けるためブロックする。 */}
      <View
        pointerEvents={showSyncOverlay ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, {
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)',
          opacity: showSyncOverlay ? 1 : 0,
        }]}
      >
        {showSyncOverlay && (
          <>
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 12, color: textColor, fontSize: 16 }}>{syncOverlayText}</Text>
          </>
        )}
      </View>
      <SyncNoticeBanner isDark={isDark} />
    </GestureHandlerRootView>
  );
}
