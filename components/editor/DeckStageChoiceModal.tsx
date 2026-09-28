import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { usePickerKeys } from '@/components/settings/usePickerKeys';
import { DECK_STAGE_KEYS, type DeckStageKind } from '@/lib/deckStageLabels';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import type { DeckStage } from '@/types';

interface Props {
  visible: boolean;
  kind: DeckStageKind;
  stages: DeckStage[];
  /** いま積まれている土台（`null`＝使わない・解決できない参照） */
  activeStageId: string | null;
  /** `null`＝使わない */
  onSelect: (stageId: string | null) => void;
  onClose: () => void;
}

/**
 * 058：デッキ土台が2つ以上あるブロックで、どれを積むかをキーで選ぶ一覧（J/K で止まって Return）。
 * 中身はブロックの `DeckStagePicker` のチップと同じ（「使わない」＋各土台）。
 * H/L・`,`/`.` でチップを送る案は不採用＝カード編集では表/裏/メモのタブ切替に使っている。
 *
 * 中央ダイアログの規約どおり `animationType="none"`＋JS フェード・背景は一覧の兄弟。
 * 矢印は iPhone のみ（カードエディタの上に出る＝iPad で登録すると編集中のカーソル移動を奪う）。
 */
export function DeckStageChoiceModal({ visible, kind, stages, activeStageId, onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const keys = DECK_STAGE_KEYS[kind];

  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [visible, fade]);

  const items: (string | null)[] = [null, ...stages.map((st) => st.id)];
  const picker = usePickerKeys({
    visible,
    items,
    value: activeStageId,
    onPick: onSelect,
    onClose,
    arrows: !(Platform as any).isPad,
  });

  const rowStyle = {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', opacity: fade }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, maxHeight: '75%', overflow: 'hidden', marginHorizontal: 24 }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Text
              style={{ color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '700' }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t(keys.pickerLabel)}
            </Text>
          </View>
          <ScrollView ref={picker.scrollRef} {...picker.scrollProps}>
            {items.map((id, i) => {
              const stage = id ? stages.find((st) => st.id === id) : undefined;
              const label = id === null
                ? t('editor.deckStageNone')
                : stage?.name.trim() || t(keys.defaultName, { n: i });
              return (
                <Pressable
                  key={id ?? '__none'}
                  onPress={() => { onSelect(id); onClose(); }}
                  onLayout={picker.rowLayout(i)}
                  style={[rowStyle, picker.focusedIndex === i && { backgroundColor: theme.colors.primaryLight }]}
                >
                  <Text
                    style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}
                    numberOfLines={1}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                  >
                    {label}
                  </Text>
                  {id === activeStageId && (
                    <Ionicons name="checkmark" size={theme.fontSize.lg} color={theme.colors.primary} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}
