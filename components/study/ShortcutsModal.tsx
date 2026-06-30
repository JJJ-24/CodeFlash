import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent, ViewStyle } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useKeyCommands, KEY_PAGE_UP, KEY_PAGE_DOWN, KEY_HOME, KEY_END } from '@/lib/useKeyCommands';
import { useProStore } from '@/store/pro';

interface ShortcutItem {
  key: string;
  descKey: string;
  pro?: boolean;
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  shortcuts?: ShortcutItem[];
  sections?: ShortcutSection[];
  maxHeight?: ViewStyle['maxHeight'];
}

export function ShortcutsModal({ visible, onClose, shortcuts, sections, maxHeight = '70%' }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isPro } = useProStore();

  // 一覧が一画面に収まらないときキーボードでスクロールできるようにする。
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const SCROLL_STEP = 220;
  const scrollBy = (d: number) =>
    scrollRef.current?.scrollTo({ y: Math.max(0, offsetRef.current + d), animated: true });

  // 表示中のキー：?（Shift+/）で閉じる、J/K・U/D・PgUp/PgDn・矢印でスクロール、Home/End で端へ。
  // Esc 閉じは各画面側（常時有効な Esc フック）が担当する。ここで Esc を登録すると、内容一致の
  // ネイティブ登録仕様により、閉じる際に各画面の常時 Esc フックの Esc まで巻き添え削除してしまうため入れない。
  // 一覧表示中は各画面側がメインキーを解除しているので、ここで同じ J/K/U/D 等を登録しても衝突しない。
  // 矢印は iPad のフォーカスエンジン予約を避けて iPhone のみ登録（J/K・U/D で代替可能）。
  useKeyCommands([
    { input: '/', modifierFlags: KeyCommand.keyModifierShift, handler: onClose },
    { input: 'j', handler: () => scrollBy(SCROLL_STEP) },
    { input: 'k', handler: () => scrollBy(-SCROLL_STEP) },
    { input: 'd', handler: () => scrollBy(SCROLL_STEP) },
    { input: 'u', handler: () => scrollBy(-SCROLL_STEP) },
    { input: KEY_PAGE_DOWN, handler: () => scrollBy(SCROLL_STEP) },
    { input: KEY_PAGE_UP, handler: () => scrollBy(-SCROLL_STEP) },
    { input: KEY_HOME, handler: () => scrollRef.current?.scrollTo({ y: 0, animated: true }) },
    { input: KEY_END, handler: () => scrollRef.current?.scrollToEnd({ animated: true }) },
    ...(((Platform as any).isPad ? [] : [
      { input: KeyCommand.keyInputDownArrow, handler: () => scrollBy(SCROLL_STEP) },
      { input: KeyCommand.keyInputUpArrow, handler: () => scrollBy(-SCROLL_STEP) },
    ]) as { input: string; handler: () => void }[]),
  ], visible);

  function renderItem(item: ShortcutItem) {
    const locked = item.pro && !isPro;
    const rowOpacity = locked ? 0.4 : 1;
    return (
      <View key={item.key} style={[styles.row, { borderBottomColor: theme.colors.border, opacity: rowOpacity }]}>
        <View style={[styles.keyBadge, { backgroundColor: theme.colors.background }, (Platform as any).isPad && styles.keyBadgePad]}>
          {/* 長いキー（Tab / ⇧Tab・U / D・PgUp/PgDn 等）はアプリ文字大で幅を超えるため、
              必要なときだけ自動縮小して切れないようにする（短いキーは通常サイズのまま）。 */}
          <Text
            style={{ fontFamily: 'monospace', fontSize: theme.fontSize.sm, color: theme.colors.text, textAlign: 'center', width: '100%' }}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
          >
            {item.key}
          </Text>
        </View>
        <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
          {t(item.descKey)}
        </Text>
        {locked && (
          <View style={[styles.proBadge, { backgroundColor: theme.colors.primary }]}>
            <Text style={{ color: '#FFF', fontSize: theme.fontSize.xs, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('shortcut.proBadge')}
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.baseSurface, maxHeight }]}>
          <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('settings.keyboardShortcuts')}
          </Text>
          <ScrollView
            ref={scrollRef}
            onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => { offsetRef.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
          >
            {sections ? (
              sections.map((section, sectionIndex) => (
                <View key={section.title}>
                  <View style={[styles.sectionHeader, { backgroundColor: theme.colors.background, borderTopColor: theme.colors.border }, sectionIndex > 0 && styles.sectionHeaderSeparator]}>
                    <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {section.title}
                    </Text>
                  </View>
                  {section.items.map(renderItem)}
                </View>
              ))
            ) : (
              (shortcuts ?? []).map(renderItem)
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 36,
  },
  title: {
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sectionHeaderSeparator: {
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  keyBadge: {
    width: 110,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  keyBadgePad: {
    width: 145,
  },
  proBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
