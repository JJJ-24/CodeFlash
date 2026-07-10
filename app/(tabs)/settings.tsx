import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeScrollsToTop } from '@/lib/useSafeScrollsToTop';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { constants as KeyCommand } from 'react-native-key-command';

import { useKeyCommands } from '@/lib/useKeyCommands';
import { useShortcutsHeader } from '@/hooks/useShortcutsHeader';

import { settingsStyles as styles } from '@/components/settings/styles';
import { ShortcutsModal } from '@/components/study/ShortcutsModal';

import { getTrialRemainingMs } from '@/lib/proTrial';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useProStore } from '@/store/pro';
import { useSettingsStore } from '@/store/settings';

const SETTINGS_SHORTCUT_SECTIONS = [
  { titleKey: 'shortcut.catFocus', items: [
    { key: 'J / K', descKey: 'shortcut.focusNextPrev' },
    { key: 'Return', descKey: 'shortcut.openFocused' },
  ] },
  { titleKey: 'shortcut.catNavigate', items: [
    { key: 'Tab / ⇧Tab', descKey: 'shortcut.tabNextPrev' },
  ] },
  { titleKey: 'shortcut.catOther', items: [
    { key: 'ESC', descKey: 'shortcut.esc' },
    { key: '?', descKey: 'shortcut.showShortcuts' },
  ] },
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
  // isPro は実効値（購入 or トライアル中）。Pro カードの導線は purchased で分岐する：
  // トライアル中もカードから paywall を開けるようにする（体験中も購入可能・035）
  const { isPro, purchased, trialActive } = useProStore();
  const trialDaysLeft = trialActive
    ? Math.max(1, Math.ceil(getTrialRemainingMs() / (24 * 60 * 60 * 1000)))
    : 0;
  const { keyboardShortcutsEnabled } = useSettingsStore();
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  useShortcutsHeader(keyboardShortcutsEnabled, () => setShowShortcutsModal(true));

  const navItems: NavItem[] = [
    { key: 'display', label: t('settings.display'), icon: 'color-palette-outline', onPress: () => router.push('/settings/display') },
    { key: 'notifications', label: t('notification.title'), icon: 'notifications-outline', onPress: () => router.push('/settings/notifications') },
    { key: 'study', label: t('settings.studySettings'), icon: 'school-outline', locked: !isPro, onPress: () => router.push(isPro ? '/settings/study' : '/paywall') },
    { key: 'sync', label: t('sync.title'), icon: 'cloud-outline', locked: !isPro, onPress: () => router.push(isPro ? '/settings/sync' : '/paywall') },
    { key: 'data', label: t('dataManagement.title'), icon: 'folder-outline', onPress: () => router.push('/settings/data') },
    { key: 'about', label: t('about.title'), icon: 'information-circle-outline', onPress: () => router.push('/about') },
  ];

  // ---- キーボード操作（034）：Pro カード(0) ＋ navItems(1..n) を J/K でフォーカス、Return で開く ----
  // 値変更はタップ限定（誤操作防止）。ここはナビゲーションのみ。
  const proPress = () => { if (!purchased) router.push('/paywall'); };
  const focusActions: (() => void)[] = [proPress, ...navItems.map((n) => n.onPress)];
  const focusCount = focusActions.length;
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  // ステータスバータップで先頭へ（iOS標準 scrollsToTop）。フォーカス中の画面だけ有効にする
  // （有効候補が複数あると iOS が機能を無効化するため）。さらに iPadOS 26 はポップ遷移終了時に
  // scrollsToTop を誤発火させる（下へスクロールした状態で push 画面から戻ると一瞬ちらつく）ため、
  // フォーカス直後 800ms も無効のままにする（詳細は lib/useSafeScrollsToTop.ts）。
  const scrollsToTopArmed = useSafeScrollsToTop();
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
        contentContainerStyle={{ flexGrow: 1 }}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        scrollsToTop={scrollsToTopArmed}
      >
        {/* 余白タップでフォーカス解除。Pressable は必ずスクロール内容の「内側」に置く
            （ScrollView の祖先に置くと押せる要素のない場所からのドラッグでスクロールが始まらない。
            詳細は stats.tsx の同コメント参照） */}
        <Pressable style={[styles.container, { flexGrow: 1 }]} onPress={() => setFocusedIndex(null)}>
        {/* Pro プラン */}
        <Pressable
          style={[styles.card, styles.proCard, { backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: focusedIndex === 0 ? theme.colors.primary : 'transparent' }]}
          onLayout={(e) => { itemLayouts.current.set(0, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }); }}
          onPress={() => { setFocusedIndex(0); if (!purchased) router.push('/paywall'); }}
          onLongPress={() => { if (__DEV__) useProStore.getState().setPurchased(!useProStore.getState().purchased); }}
          disabled={purchased && !__DEV__}
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
                {purchased ? t('pro.alreadyPro')
                  : trialActive ? t('pro.trialRemaining', { count: trialDaysLeft })
                  : t('pro.paywallSubtitle')}
              </Text>
            </View>
            {purchased ? (
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
        </Pressable>
      </ScrollView>
      <ShortcutsModal
        visible={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        sections={SETTINGS_SHORTCUT_SECTIONS.map((s) => ({ title: t(s.titleKey), items: s.items }))}
      />
    </View>
  );
}
