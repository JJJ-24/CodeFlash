import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { DECK_ICON_CATEGORIES, type DeckIconName } from '@/lib/deckIcons';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

interface Props {
  visible: boolean;
  selected: DeckIconName | null;
  /** ハイライト色（プレビューと合わせるためデッキ選択中カラーを渡す） */
  highlightColor: string;
  onSelect: (icon: DeckIconName | null) => void;
  onClose: () => void;
}

const CELL_SIZE = 56;

export function IconPickerModal({ visible, selected, highlightColor, onSelect, onClose }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();

  function renderCell(icon: DeckIconName | null) {
    const isSelected = selected === icon;
    return (
      <Pressable
        key={icon ?? '__none__'}
        onPress={() => {
          onSelect(icon);
          onClose();
        }}
        style={[
          styles.cell,
          {
            backgroundColor: isSelected ? highlightColor + '20' : theme.colors.background,
            borderColor: isSelected ? highlightColor : theme.colors.border,
          },
        ]}
      >
        <Ionicons
          name={(icon ?? 'close-circle-outline') as any}
          size={28}
          color={isSelected ? highlightColor : icon ? theme.colors.text : theme.colors.textSecondary}
        />
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.closeArea} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.header}>
            <Text
              style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t('deck.iconPickerTitle')}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={26} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 12 }}>
            <Text
              style={[styles.categoryLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t('deck.iconCategory.none')}
            </Text>
            <View style={styles.grid}>{renderCell(null)}</View>
            {DECK_ICON_CATEGORIES.map((cat) => (
              <View key={cat.key}>
                <Text
                  style={[styles.categoryLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {t(`deck.iconCategory.${cat.key}`)}
                </Text>
                <View style={styles.grid}>{cat.icons.map((icon) => renderCell(icon))}</View>
              </View>
            ))}
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
  closeArea: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    maxHeight: '75%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontWeight: '700',
  },
  categoryLabel: {
    fontWeight: '600',
    paddingHorizontal: 4,
    paddingTop: 16,
    paddingBottom: 6,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    margin: 4,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
