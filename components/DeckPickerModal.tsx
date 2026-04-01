import { FlatList, Modal, Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/theme';
import type { Deck } from '@/types';

interface Props {
  visible: boolean;
  title: string;
  decks: Deck[];
  onSelect: (deck: Deck) => void;
  onClose: () => void;
  showCardCount?: boolean;
  emptyMessage?: string;
}

export function DeckPickerModal({ visible, title, decks, onSelect, onClose, showCardCount = false, emptyMessage }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
          <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>
            {title}
          </Text>
          <FlatList
            data={decks}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                style={[styles.item, { borderBottomColor: theme.colors.border }]}
                onPress={() => onSelect(item)}
              >
                <Text style={[styles.itemName, { color: theme.colors.text, fontSize: theme.fontSize.md }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {showCardCount && (
                  <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, flexShrink: 0 }}>
                    {t('home.cards', { count: item.cardCount })}
                  </Text>
                )}
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: theme.colors.textSecondary, fontSize: theme.fontSize.md }]}>
                {emptyMessage ?? t('card.noDeckToMove')}
              </Text>
            }
          />
          <Pressable style={[styles.cancel, { borderTopColor: theme.colors.border }]} onPress={onClose}>
            <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.md, fontWeight: '600' }}>
              {t('common.cancel')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
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
    maxHeight: '60%',
  },
  title: {
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemName: {
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  empty: {
    padding: 20,
    textAlign: 'center',
  },
  cancel: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
