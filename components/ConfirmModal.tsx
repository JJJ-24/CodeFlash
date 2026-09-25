import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';
import { forgetAfterAlert, restoreAfterAlert, useAlertPresence } from '@/lib/alertFocus';
import { useExclusiveKeyCommands } from '@/lib/useKeyCommands';

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

/**
 * 選択肢が複数の確認ダイアログ。
 * 054：**キーボードで操作できる**＝J/K（iPhone は ↑/↓ も）で選択肢のボタンを選び Return で実行・Esc で閉じる（`onClose`）。
 * - **開いた時点ではどのボタンにもフォーカスが無い**＝Return 単独では何も起きず、選ぶ操作が必ず1回挟まる
 *   （「削除/破棄の確認で Return の連打でうっかり実行しない」を保ったまま、削除系も実行できる）。
 * - **独占登録**（`useExclusiveKeyCommands`）＝表示中は裏の画面のキーが反応しない（画面側の止め忘れがあっても二重にならない）。
 * - 連続するダイアログ（「バックアップを選ぶ → 確認」）は、中身（タイトル・本文・ボタンの文言）が変わったら未選択に戻す。
 */
export function ConfirmModal({ visible, title, message, actions, onClose }: Props) {
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

  // 054：キャンセル（Esc・背景タップ）で閉じたら、開く前にカーソルが入っていた入力欄へ戻す／
  // 選択肢を実行したら戻さない（削除でブロックが消える・破棄/保存で画面が閉じていくため）。
  const cancel = () => { restoreAfterAlert(); onClose(); };
  const run = (action: ModalAction) => { forgetAfterAlert(); action.onPress(); };

  // ---- 054：キーボードで選ぶ ----
  // 開いたとき・中身が差し替わったとき（「バックアップを選ぶ → 確認」のように連続するダイアログ）は
  // 必ずフォーカスなしに戻す＝前のダイアログで選んだ位置のまま Return で次を実行しない。
  // ⚠️ 差し替わりの判定は**中身**（タイトル・本文・ボタンの文言）で行う＝`actions` を毎レンダー作り直す
  //   呼び出し側（学習セッションはタイマーで毎秒再描画される）で、配列の参照で判定すると選択が毎回外れる。
  const [focused, setFocused] = useState<number | null>(null);
  const contentKey = `${title ?? ''}\u0000${message}\u0000${actions.map((a) => a.label).join('\u0000')}`;
  useEffect(() => { setFocused(null); }, [visible, contentKey]);
  const move = (dir: 1 | -1) => {
    const n = actions.length;
    if (n === 0) return;
    setFocused((p) => (p === null ? (dir > 0 ? 0 : n - 1) : (p + dir + n) % n));
  };
  // ⚠️ 矢印は iPhone だけ＝このダイアログはカードエディタ・学習セッションの上にも出るので、iPad で矢印を
  //   登録するとキャッシュが残って編集中のカーソル移動を奪う（CLAUDE.md「iPad の落とし穴」）。iPad は J/K。
  useExclusiveKeyCommands([
    { input: 'j', handler: () => move(1) },
    { input: 'k', handler: () => move(-1) },
    ...(isPad ? [] : [
      { input: KeyCommand.keyInputDownArrow, handler: () => move(1) },
      { input: KeyCommand.keyInputUpArrow, handler: () => move(-1) },
    ]),
    { input: KeyCommand.keyInputEnter, handler: () => { const a = focused !== null ? actions[focused] : undefined; if (a) run(a); } },
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
              onPress={() => run(action)}
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
            {/* 054：キーで選んでいるボタンの枠（ボタンの外側に少し離して描く＝塗りのボタンでも見える） */}
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
