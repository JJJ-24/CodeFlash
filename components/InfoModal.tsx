import { useEffect, useRef } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { restoreAfterAlert, useAlertPresence } from '@/lib/alertFocus';
import { useExclusiveKeyCommands } from '@/lib/useKeyCommands';

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
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // ⚠️ **高さの上限とスクロールは必須**：ダイアログは中央寄せなので、中身が画面より高くなると
  // 上下**両方**へはみ出し、タイトルがステータスバー／ダイナミックアイランドに隠れ、OK ボタンも
  // 画面外へ出る。説明文は文字サイズ次第でいくらでも伸びる（アプリ「大」1.2 × iOS の文字サイズ
  // 最大 1.5＝本文 28.8pt。本文幅 232pt では日本語で1行8字ほどになり、現在の日本語でも溢れる）。
  // タイトルと OK は固定し、本文だけスクロールさせる（iOS 標準のアラートと同じ挙動）。
  const maxHeight = Math.max(200, height - insets.top - insets.bottom - 48);
  // 開くフェードは **JS 側でやる**（Modal は `animationType="none"`）。
  // ⚠️ iOS は **VC のトランジション中はタッチを配送しない**ので、`animationType="fade"` だと
  // 提示アニメーション（約0.3秒）に始めたスワイプが丸ごと捨てられ、**開いた直後の1回目の
  // スクロールが空振りする**（実機で確認）。タッチを止めているのは VC のトランジションであって
  // 見た目のフェードではないので、提示を即時にしてフェードだけ Animated に移せば両立する。
  // 閉じるときは従来どおり即時（下の画面のタッチを止めないため＝この3つで揃えてある）。
  const fade = useRef(new Animated.Value(0)).current;
  // 054：裏の入力欄にカーソルがあれば外して少し待ってから出す（lib/alertFocus.ts）
  const shown = useAlertPresence(visible);
  useEffect(() => {
    if (!shown) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [shown, fade]);
  // 054：Return／Esc＝閉じる（OK）。独占登録＝表示中は裏の画面のキーが反応しない
  //（画面ごとに書いていた Return＝OK は、独占中は反応しないので二重にならない）。
  // OK だけのアラートは閉じる＝キャンセルと同じ扱い＝入力欄のカーソルを戻す。
  const close = () => { restoreAfterAlert(); onClose(); };
  useExclusiveKeyCommands([
    { input: KeyCommand.keyInputEnter, handler: close },
    { input: KeyCommand.keyInputEscape, handler: close },
  ], visible);
  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={close}>
      <Animated.View style={[styles.overlay, { opacity: fade }]}>
        {/* ⚠️ **背景（タップで閉じる）を ScrollView の祖先にしない**＝兄弟として背面に敷く。
            Fabric の `_shouldDisableScrollInteraction` は「スクロールビューの祖先に JS レスポンダ
            （Pressable 等）がいる」と `touchesShouldCancelInContentView` を NO にするので、
            押せる要素の無い本文から始めたドラッグでスクロールが始まらない（開いた直後に数回
            空振りする症状。CLAUDE.md の「余白タップの配置ルール」と同じ罠）。
            ダイアログ自身も素の View にする＝レスポンダを持たないので、その上のタップは
            背面の背景まで届かず「閉じない」も成立する（兄弟なのでバブリングしない）。 */}
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
        <View style={[styles.dialog, { backgroundColor: theme.colors.surface, maxHeight }, isPad && styles.dialogPad]}>
          {!!title && (
            <Text
              style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {title}
            </Text>
          )}
          {/* 本文だけをスクロールさせる（タイトルと OK は常に見える）。
              ⚠️ `alwaysBounceVertical={false}`＝収まっているときに弾ませない。 */}
          <ScrollView
            style={styles.messageScroll}
            contentContainerStyle={styles.messageContent}
            alwaysBounceVertical={false}
          >
            {typeof message === 'string' ? (
              <Text
                style={[styles.message, { color: title ? theme.colors.textSecondary : theme.colors.text, fontSize: theme.fontSize.md }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {message}
              </Text>
            ) : (
              message
            )}
          </ScrollView>
          <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
          <Pressable style={styles.okBtn} onPress={close}>
            <Text
              style={[styles.okBtnText, { color: theme.colors.primary, fontSize: theme.fontSize.md }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {okLabel}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
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
  // flexGrow:0＝中身が短いときに伸びない／flexShrink:1＝上限に当たったら縮んでスクロールする
  messageScroll: { flexGrow: 0, flexShrink: 1, marginBottom: 16 },
  messageContent: { flexGrow: 1 },
  message: { lineHeight: 22 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: -24 },
  okBtn: { paddingVertical: 14, alignItems: 'center' },
  okBtnText: { fontWeight: '600' },
});
