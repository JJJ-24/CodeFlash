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
  View,
} from 'react-native';

import { useKeyCommands } from '@/lib/useKeyCommands';
import { useSheetKeyboardLift } from '@/lib/useSheetKeyboardLift';
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
  // ⚠️ かつて「入力欄の下に差し込む追加UI」の `footer` prop があり、043 の画像ライブラリを
  // ここへ差していたが 2026-08-13 に撤去した。この面は**土台1件のテキスト編集に専念させる**。
  // 理由は2つ：①画像ライブラリはデッキ単位のデータで、粒度の合う置き場所は土台一覧のほう
  // ②iPhone でキーボードを出したまま一覧を展開すると、シート（約345pt）を食い尽くして
  // 入力欄が1行に潰れる（狭い画面でキーボードと一覧は同居できない）。**戻さないこと。**
}

/**
 * デッキ共通の初期化（SQL / HTML 土台など）を編集するボトムシートモーダル。
 * 名前・説明欄と同じく入力は即時に親 state へ反映し（ライブ）、確定はデッキ編集画面の保存で行う。
 * モーダルは項目を広く編集するための拡大入力面という位置づけ。文言は props で差し替え可能。
 */
export function SqlInitModal({ visible, value, onChangeText, onClose, title, hint, placeholder, onTitleChange, titlePlaceholder }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    if (!value.trim()) return;
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }, [value]);
  // 位置と高さは共通フックへ（`DeckStagesModal` と同じ規則。経緯・注意点はフック側のコメント参照）。
  const { sheetLift, sheetMaxHeight } = useSheetKeyboardLift();

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
      {/* 位置決めは `useSheetKeyboardLift`（KeyboardAvoidingView を使わない理由もそちらに記載）。
          持ち上げた分は下端の spacer View で埋める＝背後の保存ボタンを透けさせない。 */}
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
