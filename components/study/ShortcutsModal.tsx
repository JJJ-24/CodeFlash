import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

interface ShortcutItem {
  key: string;
  descKey: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  shortcuts: ShortcutItem[];
}

export function ShortcutsModal({ visible, onClose, shortcuts }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>
            {t('settings.keyboardShortcuts')}
          </Text>
          <ScrollView>
            {shortcuts.map((item) => (
              <View key={item.key} style={[styles.row, { borderBottomColor: theme.colors.border }]}>
                <View style={[styles.keyBadge, { backgroundColor: theme.colors.background }]}>
                  <Text style={{ fontFamily: 'monospace', fontSize: theme.fontSize.sm, color: theme.colors.text }}>
                    {item.key}
                  </Text>
                </View>
                <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}>
                  {t(item.descKey)}
                </Text>
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
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  title: {
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingBottom: 12,
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
    minWidth: 44,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
});
