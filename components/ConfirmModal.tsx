import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

const isPad = (Platform as any).isPad;

export interface ModalAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  /**
   * 副次的な選択肢（塗りではなく枠線のゴーストで描く）。既定は塗り＝主たる選択肢。
   *
   * 選択肢が2つとも塗りだと、どちらが本筋か読み取れず文言を読み比べることになる。
   * **グレーの塗りにはしない**：iOS ではグレーが無効／キャンセルの記号として読まれ、
   * 実際には遷移する選択肢を「押せないもの」と誤解させるため（このモーダルはキャンセル
   * ボタンを持たず暗幕タップで閉じる作りなので、なおさら紛らわしい）。
   * 塗り／ゴーストの出し分けは 041 の全画面プレビューの ▶ と同じ語彙。
   */
  secondary?: boolean;
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
        <Pressable style={[styles.dialog, { backgroundColor: theme.colors.surface }, isPad && styles.dialogPad]} onPress={() => {}}>
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
                action.secondary
                  ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.primary }
                  : { backgroundColor: action.destructive ? '#E53935' : theme.colors.primary },
                { marginTop: i === 0 ? 8 : 18 },
              ]}
              onPress={action.onPress}
            >
              <Text
                style={[styles.actionBtnText, action.secondary && { color: theme.colors.primary }, { fontSize: theme.fontSize.md }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                numberOfLines={1}
                adjustsFontSizeToFit
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
  // iPad は横幅を広げてボタン文字（日時・「強制アップロード」等）が折り返さないようにする
  dialogPad: { width: 440, maxWidth: '90%' },
  title: { fontWeight: '700', marginBottom: 8 },
  message: { lineHeight: 22, marginBottom: 16 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: -24 },
  actionBtn: { paddingVertical: 14, alignItems: 'center', borderRadius: 12 },
  actionBtnText: { color: '#FFF', fontWeight: '700' },
});
