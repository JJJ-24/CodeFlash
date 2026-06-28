import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { constants as KeyCommand } from 'react-native-key-command';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useKeyCommands } from '@/lib/useKeyCommands';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

interface Props {
  visible: boolean;
  /** 現在の初期化SQL（null/空可）。入力は即時に親へ反映する */
  value: string;
  onChangeText: (value: string) => void;
  onClose: () => void;
}

/**
 * デッキ共通の SQL 初期化を編集するボトムシートモーダル。
 * 名前・説明欄と同じく入力は即時に親 state へ反映し（ライブ）、確定はデッキ編集画面の保存で行う。
 * モーダルは項目を広く編集するための拡大入力面という位置づけ。
 */
export function SqlInitModal({ visible, value, onChangeText, onClose }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();

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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.overlay}>
          <Pressable style={styles.closeArea} onPress={onClose} />
          <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.header}>
              <Text
                style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {t('deck.sqlInitLabel')}
              </Text>
              <Pressable onPress={onClose} hitSlop={8} style={styles.doneBtn}>
                <Ionicons name="checkmark-sharp" size={26} color={theme.colors.primary} />
              </Pressable>
            </View>
            <Text
              style={[styles.hint, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t('deck.sqlInitHint')}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.background, borderColor: theme.colors.inputBorder, color: theme.colors.text, fontSize: theme.fontSize.md }]}
              placeholder={t('deck.sqlInitPlaceholder')}
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
