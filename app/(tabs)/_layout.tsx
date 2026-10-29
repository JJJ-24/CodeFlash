import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Text, type ColorValue } from 'react-native';

import { useLockedHeaderHeights, useLockedTopInset } from '@/lib/useLockedTopInset';
import { useRestoreStatusBar } from '@/lib/useRestoreStatusBar';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { horizontalSafeAreaLayout } from '@/components/HorizontalSafeAreaLayout';
import { renderTabBar } from '@/components/BandTabBar';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

// tabBarIcon の color は SDK 58 から ColorValue 型。渡ってくるのは既定のタブ色（文字列）なので Ionicons の型へ寄せる
function TabIcon({ name, color, size }: { name: IoniconsName; color: ColorValue; size: number }) {
  return <Ionicons name={name} size={size} color={color as string} />;
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
  // 高さもホームの自前ヘッダーと同じ計算にそろえる（標準ヘッダーは別経路の画面サイズで計算するので、
  // iPhone Duo を開いた横向きでホームと食い違った＝lib/useLockedTopInset.ts の useLockedHeaderHeights）
  const headerHeights = useLockedHeaderHeights();

  return (
    <Tabs
      // 中身（標準ヘッダーの下）を左右の safe area の内側に置く。標準ヘッダーとタブバーは自分で避ける
      screenLayout={horizontalSafeAreaLayout}
      // iPhone Duo の閉じた状態だけ、タブのボタンを右の帯（safe area の外）の中へ移す。それ以外は標準のタブバー
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: true,
        headerStatusBarHeight: headerTopInset,
        headerStyle: { backgroundColor: theme.colors.surface, height: headerHeights.total },
        headerTintColor: theme.colors.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        // iPhone の横向き（Duo を開いたとき）は既定だとラベルが横並びの細いバー（32pt）になり、縦向き（49pt）と高さが変わる。
        // iPad は縦横とも 49pt なので、iPhone も縦向きと同じ「アイコンの下にラベル」（49pt）に固定してそろえる。iPad は既定のまま
        ...(!(Platform as any).isPad && { tabBarLabelPosition: 'below-icon' as const }),
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
          headerTitle: () => <Text pointerEvents="none" style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('tabs.study')}</Text>,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="book-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: t('tabs.stats'),
          headerTitle: () => <Text pointerEvents="none" style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('tabs.stats')}</Text>,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="bar-chart-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          headerTitle: () => <Text pointerEvents="none" style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>{t('tabs.settings')}</Text>,
          tabBarIcon: ({ color, size }) => (
            <TabIcon name="settings-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
