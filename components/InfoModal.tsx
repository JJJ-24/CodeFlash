import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

const isPad = (Platform as any).isPad;

interface Props {
  visible: boolean;
  title?: string;
  message: React.ReactNode;
  onClose: () => void;
  okLabel?: string;
}

export function InfoModal({ visible, title, message, onClose, okLabel = 'OK' }: Props) {
  const theme = useTheme();
  // 閉じるときだけアニメーションを外す（'none' → dismissViewControllerAnimated:NO）。
  // iOS は VC のトランジション中、下の画面へのタッチを配送しないため、フェードアウトの
  // 約0.3秒はスワイプが丸ごと捨てられ、「閉じた直後は一覧を操作できない」ように見える。
  // RN の updateProps は animationType を反映してから visible を見るので、同じレンダーで
  // 両方渡せば「開く＝フェード／閉じる＝即時」になる。
  return (
    <Modal visible={visible} transparent animationType={visible ? 'fade' : 'none'} onRequestClose={onClose}>
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
          {typeof message === 'string' ? (
            <Text
              style={[styles.message, { color: title ? theme.colors.textSecondary : theme.colors.text, fontSize: theme.fontSize.md }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {message}
            </Text>
          ) : (
            <View style={styles.messageNode}>{message}</View>
          )}
          <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
          <Pressable style={styles.okBtn} onPress={onClose}>
            <Text
              style={[styles.okBtnText, { color: theme.colors.primary, fontSize: theme.fontSize.md }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {okLabel}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  dialog: {
    width: 280, borderRadius: 16, paddingTop: 24, paddingHorizontal: 24, paddingBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8,
  },
  // iPad は横幅を少し広げて縦長になりすぎないようにする（狭いスプリットビューでは maxWidth で抑える）
  dialogPad: { width: 440, maxWidth: '90%' },
  title: { fontWeight: '700', marginBottom: 8 },
  message: { lineHeight: 22, marginBottom: 16 },
  messageNode: { marginBottom: 16 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: -24 },
  okBtn: { paddingVertical: 14, alignItems: 'center' },
  okBtnText: { fontWeight: '600' },
});
