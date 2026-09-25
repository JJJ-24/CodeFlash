import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShortcutsModal } from '@/components/study/ShortcutsModal';
import { popEscDismiss } from '@/lib/escStack';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useLockedTopInset } from '@/lib/useLockedTopInset';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

import { SettingsFocusContext, type SettingsFocusHandlers, type SettingsFocusRegistry } from './settingsFocus';
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
}

/**
 * 設定のドリルイン用サブ画面の共通シェル。
 * push 遷移時の戻るボタン残像を防ぐため headerShown:false ＋ インラインカスタムヘッダー
 * （CLAUDE.md のカスタムヘッダーパターン。about.tsx と同形）。
 */
export function SettingsDetail({ title, children, overlay, onBack, suspendKeys, shortcuts, blockNav }: Props) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const lockedTopInset = useLockedTopInset();
  const keyNav = shortcuts != null;

  // ---- 053：項目のフォーカス（J/K）と、フォーカス中の項目への操作の委譲 ----
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  focusedIdRef.current = focusedId;
  const handlersMap = useRef(new Map<string, { current: SettingsFocusHandlers }>());
  const layoutMap = useRef(new Map<string, { y: number; h: number; getOffset: () => number }>());
  const register = useCallback((id: string, handlers: { current: SettingsFocusHandlers }) => {
    handlersMap.current.set(id, handlers);
    return () => {
      handlersMap.current.delete(id);
      layoutMap.current.delete(id);
      if (focusedIdRef.current === id) setFocusedId(null);
    };
  }, []);
  const setLayout = useCallback((id: string, y: number, h: number, getOffset: () => number) => {
    layoutMap.current.set(id, { y, h, getOffset });
  }, []);
  /** スクロールの中身から見た位置（親の `SettingsFocusGroup` の位置を足す）。毎回計算し直す。 */
  const absLayout = (id: string) => {
    const l = layoutMap.current.get(id);
    return l ? { y: l.getOffset() + l.y, h: l.h } : undefined;
  };
  const registry = useMemo<SettingsFocusRegistry>(() => ({ register, setLayout, focusedId }), [register, setLayout, focusedId]);

  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const viewportHRef = useRef(0);
  // 自動スクロール（設定タブと同じ：上下 8pt の余白を残して見える位置まで）。
  // ⚠️ 位置は毎回 layoutMap から読む＝文字サイズの変更などでレイアウトが動いても最新の値で測る。
  function scrollIntoView(id: string) {
    const l = absLayout(id);
    if (!l) return;
    const top = scrollYRef.current;
    const vh = viewportHRef.current;
    if (l.y < top + 8) scrollRef.current?.scrollTo({ y: Math.max(0, l.y - 8), animated: true });
    else if (l.y + l.h > top + vh - 8) scrollRef.current?.scrollTo({ y: l.y + l.h - vh + 8, animated: true });
  }
  // 並び＝画面上の縦位置の順（条件つきで出る行があっても順序が崩れない）。ヌルサイクル。
  function orderedIds() {
    return [...handlersMap.current.keys()]
      .map((id) => ({ id, l: absLayout(id) }))
      .filter((e): e is { id: string; l: { y: number; h: number } } => e.l !== undefined)
      .sort((a, b) => a.l.y - b.l.y)
      .map((e) => e.id);
  }
  function moveFocus(dir: 1 | -1) {
    const ids = orderedIds();
    if (ids.length === 0) return;
    const cur = focusedIdRef.current;
    const i = cur === null ? -1 : ids.indexOf(cur);
    let next: string | null;
    if (dir > 0) next = i === -1 ? (cur === null ? ids[0] : null) : i === ids.length - 1 ? null : ids[i + 1];
    else next = i === -1 ? (cur === null ? ids[ids.length - 1] : null) : i === 0 ? null : ids[i - 1];
    setFocusedId(next);
    if (next !== null) scrollIntoView(next);
  }
  // ⇧J/⇧K：前後のセクション見出しへ（学習設定など、見出しを持つ画面）。
  // 基準は「いまフォーカスしている行の位置」＝セクションの中の行からでも次の見出しへ跳べる。
  // フォーカスが無ければ ⇧J＝最初の見出し／⇧K＝最後の見出し。
  // **端では反対の端の見出しへ巡回する**（J/K と同じく巡回＝最下部から ⇧J 1回で最上部へ）。
  // ⚠️ J/K と違い「フォーカスなし」は挟まない＝見出しへ跳ぶキーで何も無い状態に着いても意味が無い
  //   （外したいときは Esc）。
  function moveSection(dir: 1 | -1) {
    const ids = orderedIds();
    const isSection = (id: string) => handlersMap.current.get(id)?.current.section === true;
    const sections = ids.filter(isSection);
    if (sections.length === 0) return;
    const cur = focusedIdRef.current;
    const i = cur === null ? -1 : ids.indexOf(cur);
    let next: string | undefined;
    if (i === -1) next = dir > 0 ? sections[0] : sections[sections.length - 1];
    else if (dir > 0) next = ids.slice(i + 1).find(isSection) ?? sections[0];
    else next = ids.slice(0, i).reverse().find(isSection) ?? sections[sections.length - 1];
    if (next === cur) return;
    setFocusedId(next);
    scrollIntoView(next);
  }
  const focused = () => (focusedIdRef.current ? handlersMap.current.get(focusedIdRef.current)?.current : undefined);

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
    { input: KeyCommand.keyInputEnter, handler: activate },
    { input: ' ', handler: activate },
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
          <View style={{ width: 36 }} />
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[settingsStyles.container, { paddingBottom: 32 + 56 + 24 + insets.bottom }]}
        onLayout={(e) => { viewportHRef.current = e.nativeEvent.layout.height; }}
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
