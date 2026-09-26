import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { popEscDismiss } from '@/lib/escStack';
import { deleteKeySpecs, useKeyCommands } from '@/lib/useKeyCommands';
import { useLockedTopInset } from '@/lib/useLockedTopInset';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';

import { SettingsFocusContext, useFocusRegistry } from './settingsFocus';
import { settingsStyles } from './styles';

interface Props {
  title: string;
  children: ReactNode;
  /** ScrollView の外（最前面）に重ねる要素。モーダルやローディングオーバーレイ用。 */
  overlay?: ReactNode;
  /**
   * 戻る挙動の上書き（モーダルを開いている画面は「先に閉じる」を渡す）。既定は router.back()。
   * direct=true は戻るボタン/FAB/B キー＝インライン info 展開は閉じずに直接戻る（本物のモーダルだけ先に閉じる）。
   * false は Esc＝階層ディスマス（info 展開も1段として閉じる）。
   */
  onBack?: (direct: boolean) => void;
  /**
   * 自前で Esc を持つモーダル（`SpeechLanguageModal` 等）を開いている間 true にして、
   * この画面のキー（Esc / B）を**手放す**。
   * ⚠️ **これが無いと Esc が二重に発火する**＝`useKeyCommands` は登録ごとに listener を張るので、
   * モーダルが閉じると同時にこの画面まで戻ってしまう（034 の「今そのキーを担当するのは誰か」）。
   * ⚠️ 一方 `SegmentedCard` のインライン説明のように**自前でキーを持たない**一時表示は、
   * `escStack` 経由で下の `handleEsc` が閉じる（そちらは suspendKeys の対象ではない）。
   */
  suspendKeys?: boolean;
  /**
   * 053：渡すと**この画面の中の設定項目をキーボードで操作できる**ようになる（渡さない画面は従来どおり
   * Esc / B だけ）。中身は `?` で開くショートカット一覧。項目側は `SettingsFocusCard` /
   * `useSettingsFocusItem`（`settingsFocus.tsx`）で登録する。
   * ⚠️ 渡さない画面ではフォーカス系のキーを一切登録しない＝その画面が自前で持つ Return（情報
   * モーダルの OK 等）と二重に発火しないように。
   */
  shortcuts?: ComponentProps<typeof ShortcutsModal>['sections'];
  /**
   * 053：キーを持たない確認ダイアログ（`ConfirmModal` 等）を出している間 true にする。
   * 背後の項目操作（J/K・H/L・Return 等）を止め、Esc はフォーカス解除を飛ばして `onBack` へ直行させる
   * （＝ダイアログを閉じる）。`suspendKeys` と違い Esc / B は手放さない。
   */
  blockNav?: boolean;
  /** 053：画面固有のキー（通知の N＝追加など）。項目の操作と同じ条件（フォーカス系が有効なとき）で登録する。 */
  extraKeys?: { input: string; modifierFlags?: number; handler: () => void }[];
}

/**
 * 設定のドリルイン用サブ画面の共通シェル。
 * push 遷移時の戻るボタン残像を防ぐため headerShown:false ＋ インラインカスタムヘッダー
 * （CLAUDE.md のカスタムヘッダーパターン。about.tsx と同形）。
 */
export function SettingsDetail({ title, children, overlay, onBack, suspendKeys, shortcuts, blockNav, extraKeys }: Props) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const lockedTopInset = useLockedTopInset();
  const keyNav = shortcuts != null;
  const keyboardShortcutsEnabled = useSettingsStore((s) => s.keyboardShortcutsEnabled);
  const { t } = useTranslation();

  // ---- 053：項目のフォーカス（J/K）と、フォーカス中の項目への操作の委譲（055 で useFocusRegistry に切り出し） ----
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const { registry, focusedIdRef, setFocusedId, moveFocus, moveSection, focused, onViewportLayout, onContentSizeChange } = useFocusRegistry(scrollRef, scrollYRef);

  const [showShortcuts, setShowShortcuts] = useState(false);

  // Esc = 階層ディスマス。ショートカット一覧 → 最前面のインライン展開（SegmentedCard の info 等）→
  // フォーカス解除 → onBack（モーダル→インライン info→戻る）または router.back()。
  // ⚠️ フォーカス解除もこの1ハンドラに入れる＝別フックで登録すると両方発火して戻ってしまう。
  const handleEsc = () => {
    if (showShortcuts) { setShowShortcuts(false); return; }
    if (popEscDismiss()) return;
    if (!blockNav && focusedIdRef.current !== null) { setFocusedId(null); return; }
    if (onBack) onBack(false); else router.back();
  };
  // 戻るボタン / FAB / B = 直接戻る。インライン info 展開は消費しない
  // （本物のモーダルが開いていれば onBack 側が先に閉じる。ボタンはモーダル表示中タップ不可のため実質 B キー用）。
  const handleBack = () => {
    if (onBack) onBack(true); else router.back();
  };
  useKeyCommands([
    { input: 'b', handler: () => { if (!showShortcuts) handleBack(); } },
    { input: KeyCommand.keyInputEscape, handler: handleEsc },
  ], !suspendKeys);

  // 053：項目の操作。キー操作に対応した画面（shortcuts を渡した画面）だけ登録する。
  // 矢印は iPad でも登録する（詳細画面に文字の入力欄が無い＝CLAUDE.md「編集が無い画面は両方で登録」）。
  // ⚠️ 入力欄を持つ画面に広げるときは、その画面だけ矢印を iPhone のみに落とすこと。
  const left = () => focused()?.onLeft?.();
  const right = () => focused()?.onRight?.();
  const leftBig = () => focused()?.onLeftBig?.();
  const rightBig = () => focused()?.onRightBig?.();
  const activate = () => focused()?.onActivate?.();
  const toggle = () => focused()?.onToggle?.();
  const shift = KeyCommand.keyModifierShift;
  useKeyCommands([
    { input: 'j', handler: () => moveFocus(1) },
    { input: 'k', handler: () => moveFocus(-1) },
    { input: KeyCommand.keyInputDownArrow, handler: () => moveFocus(1) },
    { input: KeyCommand.keyInputUpArrow, handler: () => moveFocus(-1) },
    { input: 'h', handler: left },
    { input: ',', handler: left },
    { input: KeyCommand.keyInputLeftArrow, handler: left },
    { input: 'l', handler: right },
    { input: '.', handler: right },
    { input: KeyCommand.keyInputRightArrow, handler: right },
    { input: 'j', modifierFlags: shift, handler: () => moveSection(1) },
    { input: 'k', modifierFlags: shift, handler: () => moveSection(-1) },
    { input: 'h', modifierFlags: shift, handler: leftBig },
    { input: ',', modifierFlags: shift, handler: leftBig },
    { input: KeyCommand.keyInputLeftArrow, modifierFlags: shift, handler: leftBig },
    { input: 'l', modifierFlags: shift, handler: rightBig },
    { input: '.', modifierFlags: shift, handler: rightBig },
    { input: KeyCommand.keyInputRightArrow, modifierFlags: shift, handler: rightBig },
    { input: 's', handler: () => focused()?.onPreview?.() },
    // Return＝開く・入る／Space＝スイッチの ON/OFF（Phase 3 で分けた。docs/053「トグルは Space だけ」）
    { input: KeyCommand.keyInputEnter, handler: activate },
    { input: ' ', handler: toggle },
    ...deleteKeySpecs(() => focused()?.onDelete?.()),
    ...(extraKeys ?? []),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ input: String(n), handler: () => focused()?.onSelect?.(n - 1) })),
    { input: '/', modifierFlags: KeyCommand.keyModifierShift, handler: () => setShowShortcuts(true) },
  ], keyNav && !suspendKeys && !showShortcuts && !blockNav);

  // ショートカット一覧（OK のみ）表示中は Return=OK で閉じる（Esc は上の handleEsc）。
  useKeyCommands([
    { input: KeyCommand.keyInputEnter, handler: () => setShowShortcuts(false) },
  ], keyNav && !suspendKeys && showShortcuts);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* インラインカスタムヘッダー */}
      <View style={{ height: lockedTopInset + 44, backgroundColor: theme.colors.surface }}>
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 44,
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
        }}>
          <View style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }}>
            <Text
              style={{ fontWeight: '600', fontSize: theme.fontSize.lg, color: theme.colors.text }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {title}
            </Text>
          </View>
          <Pressable
            onPress={handleBack}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={4}
          >
            <Ionicons name="chevron-back" size={28} color={theme.colors.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {/* 053：ショートカット一覧を開く（`?` と同じ）。設定タブのヘッダー右端と同じアイコン。
              キー操作に対応した画面（shortcuts を渡した画面）で、キーボードショートカットが ON のときだけ出す
              （OFF のときは一覧のキーがどれも効かない＝押せても意味が無い）。 */}
          {keyNav && keyboardShortcutsEnabled ? (
            <Pressable
              onPress={() => setShowShortcuts(true)}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={4}
              accessibilityLabel={t('settings.keyboardShortcuts')}
            >
              <MaterialIcons name="keyboard" size={22} color={theme.colors.primary} />
            </Pressable>
          ) : (
            <View style={{ width: 36 }} />
          )}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[settingsStyles.container, { paddingBottom: 32 + 56 + 24 + insets.bottom }]}
        onLayout={onViewportLayout}
        onContentSizeChange={onContentSizeChange}
        onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
      >
        <SettingsFocusContext.Provider value={keyNav ? registry : null}>
          {children}
        </SettingsFocusContext.Provider>
      </ScrollView>

      {/* 左下フローティング戻るボタン（カード一覧・タグ管理と同パターン） */}
      <Pressable
        style={[fabStyles.fab, { left: 20, bottom: Math.max(insets.bottom, 16) + 16, backgroundColor: theme.colors.primary }]}
        onPress={handleBack}
        hitSlop={6}
      >
        <Ionicons name="chevron-back" size={28} color="#FFF" />
      </Pressable>

      {overlay}
      {keyNav && (
        <ShortcutsModal visible={showShortcuts} onClose={() => setShowShortcuts(false)} sections={shortcuts} />
      )}
    </View>
  );
}

const fabStyles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
});
