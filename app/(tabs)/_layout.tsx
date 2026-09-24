import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { useLockedTopInset } from '@/lib/useLockedTopInset';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

function TabIcon({ name, color, size }: { name: IoniconsName; color: string; size: number }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  // 学習セッション/コード実行 WebView 後にステータスバーが非表示になった状態で
  // タブへ戻るたびに、多段タイマーで確実に復元する（WKWebView のネイティブクリーンアップは
  // 遅れて発火するため、単発の復元では負けて学習タブ等のヘッダーが縮んだままになる）。
  useRestoreStatusBar();

  // 標準ヘッダー（学習/統計/設定）の上端を、ホームの自前ヘッダーと同じ値にそろえる。
  // 既定の insets.top のままだと、iPad のウィンドウ表示で赤黄青ボタンのぶん（useWindowControlsTopInset）を
  // 足さないためホームだけ高くなり、タブを切り替えるたびにヘッダーの下端が跳ねる。
  // 縮まない値なので、WKWebView の後始末でステータスバーが消えてもヘッダーが縮まない。
  const headerTopInset = useLockedTopInset();

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStatusBarHeight: headerTopInset,
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="home-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="study"
        options={{
          title: t('tabs.study'),
          headerTitle: () => <Text style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('tabs.study')}</Text>,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="book-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: t('tabs.stats'),
          headerTitle: () => <Text style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('tabs.stats')}</Text>,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="bar-chart-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          headerTitle: () => <Text style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('tabs.settings')}</Text>,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="settings-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
