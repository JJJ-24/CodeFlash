import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { constants as KeyCommand } from 'react-native-key-command';

import { useKeyCommands } from '@/lib/useKeyCommands';
import { useShortcutsHeader } from '@/hooks/useShortcutsHeader';

import { settingsStyles as styles } from '@/components/settings/styles';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useProStore } from '@/store/pro';
import { useSettingsStore } from '@/store/settings';

const SETTINGS_SHORTCUTS = [
  { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
  { key: 'Return', descKey: 'shortcut.openFocused' },
  { key: 'Tab / ⇧Tab', descKey: 'shortcut.tabNextPrev' },
  { key: '?', descKey: 'shortcut.showShortcuts' },
  { key: 'ESC', descKey: 'shortcut.esc' },
];

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
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  useShortcutsHeader(keyboardShortcutsEnabled, () => setShowShortcutsModal(true));

  const navItems: NavItem[] = [
    { key: 'display', label: t('settings.display'), icon: 'color-palette-outline', onPress: () => router.push('/settings/display') },
    { key: 'notifications', label: t('notification.title'), icon: 'notifications-outline', onPress: () => router.push('/settings/notifications') },
    { key: 'study', label: t('settings.fsrs'), icon: 'school-outline', locked: !isPro, onPress: () => router.push(isPro ? '/settings/study' : '/paywall') },
    { key: 'sync', label: t('sync.title'), icon: 'cloud-outline', locked: !isPro, onPress: () => router.push(isPro ? '/settings/sync' : '/paywall') },
    { key: 'data', label: t('dataManagement.title'), icon: 'folder-outline', onPress: () => router.push('/settings/data') },
    { key: 'about', label: t('about.title'), icon: 'information-circle-outline', onPress: () => router.push('/about') },
  ];

  // ---- キーボード操作（034）：Pro カード(0) ＋ navItems(1..n) を J/K でフォーカス、Return で開く ----
  // 値変更はタップ限定（誤操作防止）。ここはナビゲーションのみ。
  const proPress = () => { if (!isPro) router.push('/paywall'); };
  const focusActions: (() => void)[] = [proPress, ...navItems.map((n) => n.onPress)];
  const focusCount = focusActions.length;
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const viewportHRef = useRef(0);
  const itemLayouts = useRef<Map<number, { y: number; h: number }>>(new Map());

  function scrollIntoView(index: number) {
    const l = itemLayouts.current.get(index);
    if (!l) return;
    const top = scrollYRef.current;
    const vh = viewportHRef.current;
    if (l.y < top + 8) scrollRef.current?.scrollTo({ y: Math.max(0, l.y - 8), animated: true });
    else if (l.y + l.h > top + vh - 8) scrollRef.current?.scrollTo({ y: l.y + l.h - vh + 8, animated: true });
  }
  function moveFocus(dir: number) {
    setFocusedIndex((prev) => {
      let next: number | null;
      if (dir > 0) next = prev === null ? 0 : prev === focusCount - 1 ? null : prev + 1;
      else next = prev === null ? focusCount - 1 : prev === 0 ? null : prev - 1;
      if (next !== null) setTimeout(() => scrollIntoView(next as number), 0);
      return next;
    });
  }
  function openFocused() {
    if (focusedIndex !== null) focusActions[focusedIndex]?.();
  }

  useKeyCommands([
    // タブ切替は Tab/Shift+Tab に一本化（設定はフィルターが無いので ,/.・←/→ は割り当てない）
    { input: '\t', handler: () => router.navigate('/(tabs)') },
    { input: '\t', modifierFlags: KeyCommand.keyModifierShift, handler: () => router.navigate('/(tabs)/stats') },
    // 設定カテゴリのフォーカス移動・展開
    { input: 'j', handler: () => moveFocus(1) },
    { input: 'k', handler: () => moveFocus(-1) },
    { input: KeyCommand.keyInputDownArrow, handler: () => moveFocus(1) },
    { input: KeyCommand.keyInputUpArrow, handler: () => moveFocus(-1) },
    { input: KeyCommand.keyInputEnter, handler: () => openFocused() },
    // ?（Shift+/）= ショートカット一覧を開く（閉じる/トグルは ShortcutsModal 側が担当）
    { input: '/', modifierFlags: KeyCommand.keyModifierShift, handler: () => setShowShortcutsModal((v) => !v) },
  // ショートカット一覧表示中は背景ナビを解除（Esc は別フックで常時有効）。
  ], !showShortcutsModal);

  // ESC は常時有効：ショートカット一覧を閉じる → フォーカス解除。
  useKeyCommands([
    { input: KeyCommand.keyInputEscape, handler: () => { if (showShortcutsModal) { setShowShortcutsModal(false); return; } setFocusedIndex(null); } },
  ]);

  // ショートカット一覧（OK のみ）表示中は Return=OK で閉じる。
  useKeyCommands([
    { input: KeyCommand.keyInputEnter, handler: () => setShowShortcutsModal(false) },
  ], showShortcutsModal);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
        onLayout={(e) => { viewportHRef.current = e.nativeEvent.layout.height; }}
        scrollEventThrottle={16}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.container}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        scrollsToTop={false}
      >
        {/* Pro プラン */}
        <Pressable
          style={[styles.card, styles.proCard, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: focusedIndex === 0 ? theme.colors.primary : 'transparent' }]}
          onLayout={(e) => { itemLayouts.current.set(0, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }); }}
          onPress={() => { setFocusedIndex(0); if (!isPro) router.push('/paywall'); }}
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
        {navItems.map((item, i) => (
          <Pressable
            key={item.key}
            style={[styles.card, styles.navRow, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: focusedIndex === i + 1 ? theme.colors.primary : 'transparent' }]}
            onLayout={(e) => { itemLayouts.current.set(i + 1, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }); }}
            onPress={() => { setFocusedIndex(i + 1); item.onPress(); }}
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
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        shortcuts={SETTINGS_SHORTCUTS}
      />
    </View>
  );
}
