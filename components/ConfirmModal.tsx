import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';

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
  /**
   * 053 Phase 4：J/K（↑/↓）で選択肢のボタンを選び、Return で実行できるようにする（使う側が指定したときだけ）。
   * **開いた時点ではどのボタンにもフォーカスが無い**＝Return 単独では何も起きず、選ぶ操作が必ず1回挟まる
   * （「削除系の確認は Return を割り当てない」の狙い＝連打でうっかり実行しない、を保ったまま削除系も実行できる）。
   * ⚠️ **Esc はここでは持たない**＝閉じるのは従来どおり呼び出し側（`SettingsDetail` の `onBack` 等）。
   *   ここでも登録すると両方のハンドラが発火する（`useKeyCommands` は登録ごとに listener を張る）。
   * ⚠️ 呼び出し側は表示中、背後の J/K・Return を止めること（`SettingsDetail` の `blockNav`）。
   * 既定は off＝アプリ全体の確認ダイアログは画面ごとに Return の扱いが違うので、一度に変えない（docs/053）。
   * ⚠️ `actions` は **state に持った配列をそのまま渡す**（毎レンダー作り直すと、差し替わったと見なして
   *   フォーカスが毎回外れる）。
   */
  keyboard?: boolean;
}

export function ConfirmModal({ visible, title, message, actions, onClose, keyboard }: Props) {
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
  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [visible, fade]);

  // ---- 053：キーボードで選ぶ（keyboard 指定時のみ）----
  // 開いたとき・中身が差し替わったとき（「バックアップを選ぶ → 確認」のように連続するダイアログ）は
  // 必ずフォーカスなしに戻す＝前のダイアログで選んだ位置のまま Return で次を実行しない。
  const [focused, setFocused] = useState<number | null>(null);
  useEffect(() => { setFocused(null); }, [visible, actions]);
  const move = (dir: 1 | -1) => {
    const n = actions.length;
    if (n === 0) return;
    setFocused((p) => (p === null ? (dir > 0 ? 0 : n - 1) : (p + dir + n) % n));
  };
  useKeyCommands([
    { input: 'j', handler: () => move(1) },
    { input: 'k', handler: () => move(-1) },
    { input: KeyCommand.keyInputDownArrow, handler: () => move(1) },
    { input: KeyCommand.keyInputUpArrow, handler: () => move(-1) },
    { input: KeyCommand.keyInputEnter, handler: () => { if (focused !== null) actions[focused]?.onPress(); } },
  ], !!keyboard && visible);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, { opacity: fade }]}>
        {/* ⚠️ **背景（タップで閉じる）を ScrollView の祖先にしない**＝兄弟として背面に敷く。
            Fabric の `_shouldDisableScrollInteraction` は「スクロールビューの祖先に JS レスポンダ
            （Pressable 等）がいる」と `touchesShouldCancelInContentView` を NO にするので、
            押せる要素の無い本文から始めたドラッグでスクロールが始まらない（開いた直後に数回
            空振りする症状。CLAUDE.md の「余白タップの配置ルール」と同じ罠）。
            ダイアログ自身も素の View にする＝レスポンダを持たないので、その上のタップは
            背面の背景まで届かず「閉じない」も成立する（兄弟なのでバブリングしない）。 */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
        <View style={[styles.dialog, { backgroundColor: theme.colors.surface, maxHeight }, isPad && styles.dialogPad]}>
          {!!title && (
            <Text
              style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {title}
            </Text>
          )}
          <ScrollView style={styles.messageScroll} alwaysBounceVertical={false}>
            <Text
              style={[styles.message, { color: title ? theme.colors.textSecondary : theme.colors.text, fontSize: theme.fontSize.md }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {message}
            </Text>
          </ScrollView>
          <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
          {actions.map((action, i) => (
            <View key={i}>
            <Pressable
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
            {/* 053：キーで選んでいるボタンの枠（ボタンの外側に少し離して描く＝塗りのボタンでも見える） */}
            {focused === i && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute', left: -5, right: -5, bottom: -5,
                  top: (i === 0 ? 8 : 18) - 5,
                  borderRadius: 15, borderWidth: 2, borderColor: theme.colors.primary,
                }}
              />
            )}
            </View>
          ))}
          <View style={{ height: 20 }} />
        </View>
      </Animated.View>
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
  // flexGrow:0＝短いときに伸びない／flexShrink:1＝上限に当たったら縮んでスクロールする
  messageScroll: { flexGrow: 0, flexShrink: 1, marginBottom: 16 },
  message: { lineHeight: 22 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: -24 },
  actionBtn: { paddingVertical: 14, alignItems: 'center', borderRadius: 12 },
  actionBtnText: { color: '#FFF', fontWeight: '700' },
});
