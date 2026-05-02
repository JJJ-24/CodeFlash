import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

export interface ModalAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

interface Props {
  visible: boolean;
  title?: string;
  message: string;
  actions: ModalAction[];
  onClose: () => void;
}

export function ConfirmModal({ visible, title, message, actions, onClose }: Props) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
          {!!title && (
            <Text
              style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {title}
            </Text>
          )}
          <Text
            style={[styles.message, { color: title ? theme.colors.textSecondary : theme.colors.text, fontSize: theme.fontSize.md }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {message}
          </Text>
          <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
          {actions.map((action, i) => (
            <Pressable
              key={i}
              style={[
                styles.actionBtn,
                { backgroundColor: action.destructive ? '#E53935' : theme.colors.primary, marginTop: i === 0 ? 8 : 18 },
              ]}
              onPress={action.onPress}
            >
              <Text
                style={[styles.actionBtnText, { fontSize: theme.fontSize.md }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
          <View style={{ height: 20 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  dialog: {
    width: 280, borderRadius: 16, paddingTop: 24, paddingHorizontal: 24, paddingBottom: 0,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8,
  },
  title: { fontWeight: '700', marginBottom: 8 },
  message: { lineHeight: 22, marginBottom: 16 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: -24 },
  actionBtn: { paddingVertical: 14, alignItems: 'center', borderRadius: 12 },
  actionBtnText: { color: '#FFF', fontWeight: '700' },
});
