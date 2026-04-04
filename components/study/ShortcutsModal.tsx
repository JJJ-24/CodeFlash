import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

interface ShortcutItem {
  key: string;
  descKey: string;
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
  maxHeight?: string | number;
}

export function ShortcutsModal({ visible, onClose, shortcuts, sections, maxHeight = '70%' }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface, maxHeight }]}>
          <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}>
            {t('settings.keyboardShortcuts')}
          </Text>
          <ScrollView>
            {sections ? (
              sections.map((section) => (
                <View key={section.title}>
                  <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}>
                    {section.title}
                  </Text>
                  {section.items.map((item) => (
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
                </View>
              ))
            ) : (
              (shortcuts ?? []).map((item) => (
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
              ))
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
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
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
