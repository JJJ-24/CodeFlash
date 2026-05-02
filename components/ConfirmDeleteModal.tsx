import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

interface Props {
  visible: boolean;
  message: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDeleteModal({ visible, message, onConfirm, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
          <Text style={[styles.message, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {message}
          </Text>
          <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
          <Pressable style={styles.deleteBtn} onPress={onConfirm}>
            <Text style={[styles.deleteBtnText, { fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('common.delete')}
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialog: {
    width: 280,
    borderRadius: 16,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  message: {
    lineHeight: 22,
    marginBottom: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: -24,
  },
  deleteBtn: {
    marginTop: 8,
    marginBottom: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#E53935',
  },
  deleteBtnText: {
    color: '#FFF',
    fontWeight: '700',
  },
});
