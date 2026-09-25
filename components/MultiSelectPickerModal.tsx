import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';

export type PickerItem = { id: string; name: string; color?: string };

interface Props {
  visible: boolean;
  title: string;
  /** 先頭の「すべて」行の文言（検索の絞り込み用）。渡さなければ行を出さない（カード編集のタグ選択） */
  allLabel?: string;
  items: PickerItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** 「すべて」行を押したとき（allLabel と組で渡す） */
  onClearAll?: () => void;
  onClose: () => void;
}

const ALL_ID = '__all__';

/**
 * 複数選択のシート（検索のタグ絞り込み・カード編集のタグ選択〈056〉で共用）。
 * キー：J/K（iPhone は ↑/↓ も）＝移動・Space＝選択/解除・Return/Esc＝閉じる。
 * 表示中のみ発火（`active`＝visible）。親画面は表示中に自分のキーを解除する。
 */
export function MultiSelectPickerModal({ visible, title, allLabel, items, selectedIds, onToggle, onClearAll, onClose }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const allActive = selectedIds.length === 0;

  // 先頭に「すべて」行を含む1次元データ（キーボード操作のフォーカス対象）。
  const data = useMemo<PickerItem[]>(
    () => (allLabel != null ? [{ id: ALL_ID, name: allLabel }, ...items] : items),
    [allLabel, items],
  );
  const [focusedIndex, setFocusedIndex] = useState(0);
  const listRef = useRef<FlatList>(null);
  useEffect(() => { setFocusedIndex(0); }, [visible]);

  function move(dir: number) {
    setFocusedIndex((p) => {
      const n = data.length;
      if (n === 0) return 0;
      const next = (p + dir + n) % n;
      setTimeout(() => listRef.current?.scrollToIndex({ index: next, viewPosition: 0.5, animated: true }), 0);
      return next;
    });
  }
  function activateFocused() {
    const item = data[focusedIndex];
    if (!item) return;
    if (item.id === ALL_ID) onClearAll?.(); else onToggle(item.id);
  }

  useKeyCommands([
    { input: 'j', handler: () => { if (visible) move(1); } },
    { input: 'k', handler: () => { if (visible) move(-1); } },
    { input: ' ', handler: () => { if (visible) activateFocused(); } },
    { input: KeyCommand.keyInputEnter, handler: () => { if (visible) onClose(); } },
    { input: KeyCommand.keyInputEscape, handler: () => { if (visible) onClose(); } },
    ...(((Platform as any).isPad ? [] : [
      { input: KeyCommand.keyInputDownArrow, handler: () => { if (visible) move(1); } },
      { input: KeyCommand.keyInputUpArrow, handler: () => { if (visible) move(-1); } },
    ]) as { input: string; handler: () => void }[]),
  ], visible);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={pickerStyles.overlay} onPress={onClose}>
        <Pressable style={[pickerStyles.sheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
          <Text style={[pickerStyles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {title}
          </Text>
          <FlatList
            ref={listRef}
            data={data}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item, index }) => {
              const isAll = item.id === ALL_ID;
              const active = isAll ? allActive : selectedIds.includes(item.id);
              const focused = focusedIndex === index;
              return (
                <Pressable
                  style={[pickerStyles.item, { backgroundColor: active ? theme.colors.primaryLight : 'transparent', borderWidth: 2, borderColor: focused ? theme.colors.primary : 'transparent' }]}
                  onPress={() => { setFocusedIndex(index); if (isAll) { onClearAll?.(); } else { onToggle(item.id); } }}
                >
                  {item.color ? (
                    <View style={[pickerStyles.colorDot, { backgroundColor: active ? theme.colors.primary : item.color }]} />
                  ) : (
                    <View style={pickerStyles.colorDotPlaceholder} />
                  )}
                  <Text
                    style={[pickerStyles.itemName, { color: active ? theme.colors.primary : theme.colors.text, fontSize: theme.fontSize.md, fontWeight: active ? '600' : '400' }]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {item.name}
                  </Text>
                  {active && !isAll && (
                    <Ionicons name="checkmark" size={20} color={theme.colors.primary} />
                  )}
                </Pressable>
              );
            }}
          />
          <Pressable style={[pickerStyles.cancel, { borderTopColor: theme.colors.border }]} onPress={onClose}>
            <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('common.done')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 検索のデッキ絞り込みピッカー（`DeckMultiSelectPickerModal`）も同じ見た目で使う */
export const pickerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    maxHeight: '65%',
  },
  title: {
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 8,
    gap: 10,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  colorDotPlaceholder: {
    width: 10,
    height: 10,
    flexShrink: 0,
  },
  itemName: {
    fontWeight: '500',
    flex: 1,
  },
  cancel: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
