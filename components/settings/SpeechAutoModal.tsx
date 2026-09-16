import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { SPEECH_AUTO_MODES, type SpeechAutoMode } from '@/lib/speech';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';

interface Props {
  visible: boolean;
  /** 選択中の面。`null` は「アプリ設定に従う」（`allowInherit` のときだけ起こりうる） */
  value: SpeechAutoMode | null;
  onSelect: (mode: SpeechAutoMode | null) => void;
  onClose: () => void;
  /** 052 Phase 3：先頭に「アプリ設定に従う」行を出す（デッキ単位の上書きを**解除する手段**）。
   *  ⚠️ アプリ設定側では出さない＝戻す先が無い。 */
  allowInherit?: boolean;
  /** 「アプリ設定に従う」を選んだときに実際に効く面（行の右に薄く出す） */
  inheritValue?: SpeechAutoMode;
}

/** 面の表示名（設定画面の行・デッキ編集の要約と共用）。 */
export const SPEECH_AUTO_LABEL_KEYS: Record<SpeechAutoMode, string> = {
  off: 'settings.speechAutoOff',
  front: 'settings.speechAutoFront',
  back: 'settings.speechAutoBack',
  both: 'settings.speechAutoBoth',
};

/**
 * 052：自動読み上げの面（オフ／表面／裏面／両面）を選ぶモーダル。`SpeechLanguageModal` と同型で、
 * 学習設定（アプリ全体）とデッキ編集（上書き・`allowInherit`）の両方から使う。
 *
 * 4択なので `SegmentedCard`（3択固定）には収まらず、言語の行と同じ「行タップ → 一覧」にした。
 * 中央ダイアログの規約どおり `animationType="none"`＋JS フェード（iOS は VC のトランジション中に
 * タッチを配送しないため、`fade` のままだと開いた直後の操作が空振りする）。
 */
export function SpeechAutoModal({ visible, value, onSelect, onClose, allowInherit, inheritValue }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [visible, fade]);

  // 表示中だけ Esc を担当する（非表示のあいだ登録を持たない＝034 の住み分け）。
  useKeyCommands([{ input: KeyCommand.keyInputEscape, handler: onClose }], visible);

  const rowStyle = {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', opacity: fade }}
      >
        {/* 背景（タップで閉じる）は一覧の祖先にせず兄弟として背面に敷く（CLAUDE.md の「余白タップの配置ルール」） */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
        <View
          style={{ backgroundColor: theme.colors.surface, borderRadius: 12, maxHeight: '75%', overflow: 'hidden', marginHorizontal: 24 }}
        >
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Text
              style={{ color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '700' }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t('settings.speechAuto')}
            </Text>
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: 4 }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t('settings.speechAutoHint')}
            </Text>
          </View>
          <ScrollView>
            {/* デッキ側だけに出す「上書きしない」行。⚠️ これが無いとデッキの上書きを解除できない。 */}
            {allowInherit && (
              <Pressable onPress={() => { onSelect(null); onClose(); }} style={rowStyle}>
                <Text
                  style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t('deck.speechInherit')}
                </Text>
                {/* 実際にどの面が読まれるかを添える＝「従う」だけだと結果が分からない */}
                {inheritValue && (
                  <Text
                    style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {t(SPEECH_AUTO_LABEL_KEYS[inheritValue])}
                  </Text>
                )}
                {value === null && (
                  <Ionicons name="checkmark" size={theme.fontSize.lg} color={theme.colors.primary} />
                )}
              </Pressable>
            )}
            {SPEECH_AUTO_MODES.map((mode) => (
              <Pressable key={mode} onPress={() => { onSelect(mode); onClose(); }} style={rowStyle}>
                <Text
                  style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {t(SPEECH_AUTO_LABEL_KEYS[mode])}
                </Text>
                {mode === value && (
                  <Ionicons name="checkmark" size={theme.fontSize.lg} color={theme.colors.primary} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}
