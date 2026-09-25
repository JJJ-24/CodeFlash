import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { forgetAfterAlert, restoreAfterAlert, useAlertPresence } from '@/lib/alertFocus';
import { useExclusiveKeyCommands } from '@/lib/useKeyCommands';

const isPad = (Platform as any).isPad;

interface Props {
  visible: boolean;
  message: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * 削除の確認（削除ボタン1つ）。
 * 054：`ConfirmModal` と同じ形でキーボード操作できる＝**ボタンが1つでも J/K で選んでから Return**
 * （Return 1回で消えないように。開いた時点では未選択）・Esc で閉じる。独占登録（表示中は裏の画面のキーが反応しない）。
 * 矢印は iPhone だけ（iPad はエディタの上に出たとき矢印のキャッシュが残るため）。
 */
export function ConfirmDeleteModal({ visible, message, onConfirm, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // 高さの上限＋本文スクロールは `InfoModal` と同じ理由（中央寄せなので溢れると上下**両方**が
  // 切れ、タイトルがダイナミックアイランドに隠れてボタンも画面外へ出る）。文字サイズ次第で
  // 本文はいくらでも伸びる（長い実例は `pro.trialConfirmMessage`）。
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

  // 054：キャンセルで閉じたら入力欄のカーソルを戻す／削除したら戻さない（ConfirmModal と同じ）
  const cancel = () => { restoreAfterAlert(); onClose(); };
  const confirm = () => { forgetAfterAlert(); onConfirm(); };
  const [selected, setSelected] = useState(false);
  useEffect(() => { setSelected(false); }, [visible]);
  useExclusiveKeyCommands([
    { input: 'j', handler: () => setSelected(true) },
    { input: 'k', handler: () => setSelected(true) },
    ...(isPad ? [] : [
      { input: KeyCommand.keyInputDownArrow, handler: () => setSelected(true) },
      { input: KeyCommand.keyInputUpArrow, handler: () => setSelected(true) },
    ]),
    { input: KeyCommand.keyInputEnter, handler: () => { if (selected) confirm(); } },
    { input: KeyCommand.keyInputEscape, handler: cancel },
  ], visible);

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={cancel}>
      <Animated.View style={[styles.overlay, { opacity: fade }]}>
        {/* ⚠️ **背景（タップで閉じる）を ScrollView の祖先にしない**＝兄弟として背面に敷く。
            Fabric の `_shouldDisableScrollInteraction` は「スクロールビューの祖先に JS レスポンダ
            （Pressable 等）がいる」と `touchesShouldCancelInContentView` を NO にするので、
            押せる要素の無い本文から始めたドラッグでスクロールが始まらない（開いた直後に数回
            空振りする症状。CLAUDE.md の「余白タップの配置ルール」と同じ罠）。
            ダイアログ自身も素の View にする＝レスポンダを持たないので、その上のタップは
            背面の背景まで届かず「閉じない」も成立する（兄弟なのでバブリングしない）。 */}
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessible={false} />
        <View style={[styles.dialog, { backgroundColor: theme.colors.surface, maxHeight }, isPad && styles.dialogPad]}>
          <ScrollView style={styles.messageScroll} alwaysBounceVertical={false}>
            <Text style={[styles.message, { color: theme.colors.text, fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {message}
            </Text>
          </ScrollView>
          <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
          <View>
          <Pressable style={styles.deleteBtn} onPress={confirm}>
            <Text style={[styles.deleteBtnText, { fontSize: theme.fontSize.md }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('common.delete')}
            </Text>
          </Pressable>
          {/* 054：キーで選んでいるときの枠（ボタンの外側に少し離して描く） */}
          {selected && (
            <View
              pointerEvents="none"
              // ボタンの上下に margin 8 があるので、枠はボタンの外側 5pt＝上下 3 に置く
              style={{ position: 'absolute', left: -5, right: -5, top: 3, bottom: 3, borderRadius: 15, borderWidth: 2, borderColor: theme.colors.primary }}
            />
          )}
          </View>
        </View>
      </Animated.View>
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
  // iPad は横幅を広げて ConfirmModal / InfoModal とサイズを揃える
  dialogPad: { width: 440, maxWidth: '90%' },
  // flexGrow:0＝短いときに伸びない／flexShrink:1＝上限に当たったら縮んでスクロールする
  messageScroll: { flexGrow: 0, flexShrink: 1, marginBottom: 16 },
  message: {
    lineHeight: 22,
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
