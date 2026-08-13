import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { constants as KeyCommand } from 'react-native-key-command';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyCommands } from '@/lib/useKeyCommands';
import { isRemoteKeyboardEvent } from '@/lib/keyboardEvent';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

interface Props {
  visible: boolean;
  /** 現在の初期化SQL（null/空可）。入力は即時に親へ反映する */
  value: string;
  onChangeText: (value: string) => void;
  onClose: () => void;
  /** タイトル/ヒント/プレースホルダ。省略時は SQL 用。HTML/CSS 共通土台など他用途で再利用するとき指定する */
  title?: string;
  hint?: string;
  placeholder?: string;
  /** 指定するとタイトルが編集可能になる（044・土台の名前をここで付ける）。
   *  リスト側に名前入力を置くとリストにもキーボード追従が要るため、名前は編集面で扱う。 */
  onTitleChange?: (value: string) => void;
  /** 名前が空のときに出す既定表示（「土台1」など）。`onTitleChange` 指定時のみ意味を持つ */
  titlePlaceholder?: string;
  /** 入力欄の下に差し込む追加UI（043 の HTML 画像ライブラリ）。テキスト以外の付随データを
   *  同じ面で扱うための拡張点。SQL 用途では未指定＝従来どおりテキスト欄だけになる。 */
  footer?: React.ReactNode;
}

/**
 * デッキ共通の初期化（SQL / HTML 土台など）を編集するボトムシートモーダル。
 * 名前・説明欄と同じく入力は即時に親 state へ反映し（ライブ）、確定はデッキ編集画面の保存で行う。
 * モーダルは項目を広く編集するための拡大入力面という位置づけ。文言は props で差し替え可能。
 */
export function SqlInitModal({ visible, value, onChangeText, onClose, title, hint, placeholder, onTitleChange, titlePlaceholder, footer }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: winHeight } = useWindowDimensions();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    if (!value.trim()) return;
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }, [value]);
  // iPad ではモーダルが画面下端まで覆い切らず、背後のデッキ画面の保存ボタンが下にのぞくことがある
  // （キーボードバー絡みの表示問題・別途調査中）。完全に覆う対処が難しいため、シートを保存ボタン
  // 領域の分だけ持ち上げて、ボタンが上部欠けせず丸ごと見えるようにする（デッキ画面の bottomBar 高さに合わせる）。
  const liftForSaveButton = Math.max(insets.bottom, 16) + 76;

  // ソフトキーボード（大きいiOSキーボード）が出ているときだけシートを持ち上げて入力欄が隠れないようにする。
  // KeyboardAvoidingView は最小化キーボードバー（外部キーボード接続時の「あ」/マイク・約55pt）も拾って
  // 開く前後で位置が跳ねるため使わず、閾値（150pt）で「大きいキーボードのときだけ」自前で持ち上げる。
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const onChange = (e: { endCoordinates?: { height?: number }; isEventFromThisApp?: boolean }) => {
      if (isRemoteKeyboardEvent(e)) return;
      const h = e.endCoordinates?.height ?? 0;
      setKbHeight(h > 150 ? h : 0);
    };
    const onHide = (e: { isEventFromThisApp?: boolean }) => {
      if (isRemoteKeyboardEvent(e)) return;
      setKbHeight(0);
    };
    const subShow = Keyboard.addListener('keyboardWillChangeFrame', onChange);
    const subHide = Keyboard.addListener('keyboardWillHide', onHide);
    return () => { subShow.remove(); subHide.remove(); };
  }, []);

  // 持ち上げ量：ソフトキーボード時はキーボード上端まで、それ以外は保存ボタンのすぐ上に固定。
  const sheetLift = kbHeight > 0 ? kbHeight + 8 : liftForSaveButton;
  // 持ち上げた分シートが画面上端を超えないよう高さ上限を設ける（入力欄が縮んでも全体は見える）。
  // 上部に閉じる用のタップ領域（暗幕）を広めに残す。ソフトキーボード時はシートが上がり上端の隙間が
  // 狭くなりタップしづらいので、予約分を大きめ（96pt）にして上の余白を確保する。
  const topTapGap = 96;
  const sheetMaxHeight = winHeight - sheetLift - insets.top - topTapGap;

  // シートを閉じる際にキーボードを確実に閉じる。autoFocus の入力欄を開いたまま
  // 背景タップ・完了ボタン・親 unmount で閉じると、キーボード非表示通知が届かず
  // グローバル状態が固着して他画面が無限スクロールになるのを防ぐ。
  useEffect(() => {
    if (!visible) Keyboard.dismiss();
  }, [visible]);
  useEffect(() => () => Keyboard.dismiss(), []);

  // 全面テキストエディタのため、編集中も発火する Esc で「閉じる（確定＝ライブ値を保持）」だけを受ける。
  // 非表示中は親画面の Esc に委ねるため visible でガードする。
  useKeyCommands([
    { input: KeyCommand.keyInputEscape, handler: () => { if (visible) onClose(); } },
  ]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* KeyboardAvoidingView は使わない：最小化キーボードバーの高さを behavior="padding" が
          開く前後で違う量だけ拾い、シート位置が跳ねる（開くと上がりすぎ→タップで適正）。
          代わりにシートを marginBottom で固定量だけ持ち上げ、保存ボタンのすぐ上に安定配置する。 */}
      <View style={styles.overlay}>
        <Pressable style={styles.closeArea} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface, maxHeight: sheetMaxHeight }]}>
            <View style={styles.header}>
              {onTitleChange ? (
                <TextInput
                  style={[styles.title, styles.titleInput, { color: theme.colors.text, fontSize: theme.fontSize.lg, borderColor: theme.colors.inputBorder }]}
                  value={title ?? ''}
                  onChangeText={onTitleChange}
                  placeholder={titlePlaceholder}
                  placeholderTextColor={theme.colors.textTertiary}
                  returnKeyType="done"
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                />
              ) : (
                <Text
                  style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {title ?? t('deck.sqlInitLabel')}
                </Text>
              )}
              <View style={styles.headerRight}>
                {!!value.trim() && (
                  <Pressable onPress={handleCopy} hitSlop={8} style={styles.copyBtn}>
                    <Ionicons name={copied ? 'checkmark-sharp' : 'copy-outline'} size={22} color={theme.colors.textSecondary} />
                  </Pressable>
                )}
                <Pressable onPress={onClose} hitSlop={8} style={styles.doneBtn}>
                  <Ionicons name="checkmark-sharp" size={26} color={theme.colors.primary} />
                </Pressable>
              </View>
            </View>
            <Text
              style={[styles.hint, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {hint ?? t('deck.sqlInitHint')}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.background, borderColor: theme.colors.inputBorder, color: theme.colors.text, fontSize: theme.fontSize.md }]}
              placeholder={placeholder ?? t('deck.sqlInitPlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              value={value}
              onChangeText={onChangeText}
              multiline
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textAlignVertical="top"
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            />
            {footer}
        </View>
        {/* 持ち上げた分の隙間を**シートと同じ色で塗る**（marginBottom の代わり）。透明のままだと
            親のデッキ編集画面の保存/削除ボタンが暗幕越しに透けて「押せそう」に見えるため。
            キーボード表示中は sheetLift がキーボード高さになるが、その領域はキーボードが覆うので
            塗っても見えない（閉じると保存ボタンをちょうど隠す高さに戻る）。 */}
        <View style={{ height: sheetLift, backgroundColor: theme.colors.surface }} />
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
  closeArea: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
    height: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  title: { fontWeight: '700' },
  // 名前編集時（044）：見出しの見た目を保ちつつ入力欄と分かる程度の枠だけ足す
  titleInput: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 8 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  copyBtn: {
    paddingHorizontal: 4,
  },
  doneBtn: {
    paddingHorizontal: 4,
  },
  hint: { marginBottom: 12, lineHeight: 20 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
});
