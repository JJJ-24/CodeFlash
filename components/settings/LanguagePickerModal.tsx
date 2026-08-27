import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { SUPPORTED_LANGUAGE_CODES, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/lib/i18n';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';
import type { LanguagePreference } from '@/store/settings';

interface Props {
  visible: boolean;
  value: LanguagePreference;
  onSelect: (v: LanguagePreference) => void;
  onClose: () => void;
  /** 'system' のときに実際に使われる言語（「システム」行の右に薄く出す）。 */
  resolved: SupportedLanguage;
}

/**
 * 047：表示言語を選ぶモーダル。**選択肢は `SUPPORTED_LANGUAGES` から作る**ので、
 * 言語を足してもこのファイルは触らない。
 *
 * セグメント（`SegmentedCard`）にしないのは、言語が増えるたびに区画が増えて破綻するため
 * （他の設定は3択固定で、言語だけが増え続ける）。「システム」を独立した部品ではなく
 * **一覧の先頭行**に置くのは、読み上げの言語（`SpeechLanguageModal` の「アプリ設定に従う」）と
 * 同じ流儀＝1つの設定を2つの部品で表さない。
 *
 * ⚠️ **Esc は表示中だけここが担当する**（読み上げの2モーダルと同じ流儀）。親の
 * `SettingsDetail` にも Esc があるので、**親側で `suspendKeys` を渡して手放してもらう**こと
 * ＝渡さないと `useKeyCommands` が登録ごとにリスナーを張る仕様上、両方のハンドラが発火して
 * 「モーダルを閉じる＋画面ごと戻る」になる。
 */
export function LanguagePickerModal({ visible, value, onSelect, onClose, resolved }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  // 開くフェードは JS でやる（Modal は `animationType="none"`）。iOS は VC のトランジション中に
  // タッチを配送しないので、`fade` のままだと**開いた直後の操作が空振りする**（CLAUDE.md の
  // 中央ダイアログの項）。閉じるときは従来どおり即時。
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [visible, fade]);

  // 表示中だけ Esc を担当する（親は suspendKeys で手放している）。
  useKeyCommands([{ input: KeyCommand.keyInputEscape, handler: onClose }], visible);

  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', opacity: fade }}
      >
        {/* ⚠️ 背景（タップで閉じる）は一覧の**祖先にしない**＝兄弟として背面に敷く。祖先が JS
            レスポンダだと Fabric がスクロールのキャンセルを止め、行の隙間から始めたドラッグが
            滑らない（CLAUDE.md の「余白タップの配置ルール」）。
            ⚠️ 余白は overlay の padding ではなく**シートの marginHorizontal**で作る＝padding だと
            絶対配置の背景がその内側に収まり、外周24ptがタップで閉じなくなりうる。 */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
        <View
          style={{ backgroundColor: theme.colors.surface, borderRadius: 12, maxHeight: '75%', overflow: 'hidden', marginHorizontal: 24 }}
        >
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Text
              style={{ color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '700' }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t('settings.language')}
            </Text>
          </View>
          <ScrollView>
            {/* 「システム」は独立した部品ではなく一覧の先頭行。
                ⚠️ 実際に何語になるかを添える＝「システム」だけだと結果が分からない
                （読み上げの「アプリ設定に従う」行と同じ理由）。 */}
            <Pressable onPress={() => { onSelect('system'); onClose(); }} style={rowStyle}>
              <Text
                style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t('settings.languageSystem')}
              </Text>
              <Text
                style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {SUPPORTED_LANGUAGES[resolved]}
              </Text>
              {value === 'system' && (
                <Ionicons name="checkmark" size={theme.fontSize.lg} color={theme.colors.primary} />
              )}
            </Pressable>
            {SUPPORTED_LANGUAGE_CODES.map((code) => (
              <Pressable key={code} onPress={() => { onSelect(code); onClose(); }} style={rowStyle}>
                <Text
                  style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {/* 言語名は自言語表記（日本語 / English / Español）＝UI 言語によらず同じ。 */}
                  {SUPPORTED_LANGUAGES[code]}
                </Text>
                {value === code && (
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
