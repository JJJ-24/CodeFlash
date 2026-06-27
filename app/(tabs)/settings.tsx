import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { constants as KeyCommand } from 'react-native-key-command';

import { useKeyCommands } from '@/lib/useKeyCommands';

import { settingsStyles as styles } from '@/components/settings/styles';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useProStore } from '@/store/pro';

interface NavItem {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  locked?: boolean;
  onPress: () => void;
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { isPro } = useProStore();
  // 034: タブ切替（,/.）をネイティブキーコマンドで受ける（隠し TextInput を撤去）。
  // フックが「画面フォーカス中 かつ keyboardShortcutsEnabled」を内部で gate する。
  useKeyCommands([
    { input: '.', handler: () => router.navigate('/(tabs)') },
    { input: ',', handler: () => router.navigate('/(tabs)/stats') },
    // 矢印キー: 左右=,/.（設定タブはリストが無いので上下は割り当てない）
    { input: KeyCommand.keyInputRightArrow, handler: () => router.navigate('/(tabs)') },
    { input: KeyCommand.keyInputLeftArrow, handler: () => router.navigate('/(tabs)/stats') },
  ]);

  const navItems: NavItem[] = [
    { key: 'display', label: t('settings.display'), icon: 'color-palette-outline', onPress: () => router.push('/settings/display') },
    { key: 'notifications', label: t('notification.title'), icon: 'notifications-outline', onPress: () => router.push('/settings/notifications') },
    { key: 'study', label: t('settings.fsrs'), icon: 'school-outline', locked: !isPro, onPress: () => router.push(isPro ? '/settings/study' : '/paywall') },
    { key: 'sync', label: t('sync.title'), icon: 'cloud-outline', locked: !isPro, onPress: () => router.push(isPro ? '/settings/sync' : '/paywall') },
    { key: 'data', label: t('dataManagement.title'), icon: 'folder-outline', onPress: () => router.push('/settings/data') },
    { key: 'about', label: t('about.title'), icon: 'information-circle-outline', onPress: () => router.push('/about') },
  ];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.container}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        scrollsToTop={false}
      >
        {/* Pro プラン */}
        <Pressable
          style={[styles.card, styles.proCard, { backgroundColor: theme.colors.surface }]}
          onPress={() => !isPro && router.push('/paywall')}
          onLongPress={() => { if (__DEV__) useProStore.getState().setIsPro(!isPro); }}
          disabled={isPro && !__DEV__}
        >
          <View style={styles.proRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.proTitleRow}>
                <Text style={[styles.proTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                  CodeFlash Pro
                </Text>
                {isPro && (
                  <View style={[styles.proBadge, { backgroundColor: theme.colors.primary }]}>
                    <Text style={[styles.proBadgeText, { fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>Pro</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.proSubtitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {isPro ? t('pro.alreadyPro') : t('pro.paywallSubtitle')}
              </Text>
            </View>
            {isPro ? (
              <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
            ) : (
              <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
            )}
          </View>
        </Pressable>

        {/* 各設定カテゴリ（タップで詳細画面へ）— 1項目1カードのブロックスタイル */}
        {navItems.map((item) => (
          <Pressable
            key={item.key}
            style={[styles.card, styles.navRow, { backgroundColor: theme.colors.surface }]}
            onPress={item.onPress}
          >
            <Ionicons name={item.icon} size={theme.fontSize.xl} color={theme.colors.primary} />
            <Text style={[styles.navRowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
              {item.label}
            </Text>
            {item.locked && (
              <Ionicons name="lock-closed" size={theme.fontSize.sm} color={theme.colors.primary} />
            )}
            <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
