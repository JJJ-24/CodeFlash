import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

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
  maxHeight?: ViewStyle['maxHeight'];
}

export function ShortcutsModal({ visible, onClose, shortcuts, sections, maxHeight = '70%' }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface, maxHeight }]}>
          <Text style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('settings.keyboardShortcuts')}
          </Text>
          <ScrollView>
            {sections ? (
              sections.map((section, sectionIndex) => (
                <View key={section.title}>
                  <View style={[styles.sectionHeader, { backgroundColor: theme.colors.background, borderTopColor: theme.colors.border }, sectionIndex > 0 && styles.sectionHeaderSeparator]}>
                    <Text style={{ color: theme.colors.primary, fontSize: theme.fontSize.sm, fontWeight: '700' }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {section.title}
                    </Text>
                  </View>
                  {section.items.map((item) => (
                    <View key={item.key} style={[styles.row, { borderBottomColor: theme.colors.border }]}>
                      <View style={[styles.keyBadge, { backgroundColor: theme.colors.background }, (Platform as any).isPad && styles.keyBadgePad]}>
                        <Text style={{ fontFamily: 'monospace', fontSize: theme.fontSize.sm, color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui} numberOfLines={1}>
                          {item.key}
                        </Text>
                      </View>
                      <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                        {t(item.descKey)}
                      </Text>
                    </View>
                  ))}
                </View>
              ))
            ) : (
              (shortcuts ?? []).map((item) => (
                <View key={item.key} style={[styles.row, { borderBottomColor: theme.colors.border }]}>
                  <View style={[styles.keyBadge, { backgroundColor: theme.colors.background }, (Platform as any).isPad && styles.keyBadgePad]}>
                    <Text style={{ fontFamily: 'monospace', fontSize: theme.fontSize.sm, color: theme.colors.text }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui} numberOfLines={1}>
                      {item.key}
                    </Text>
                  </View>
                  <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
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
    width: 100,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  keyBadgePad: {
    width: 130,
  },
});
