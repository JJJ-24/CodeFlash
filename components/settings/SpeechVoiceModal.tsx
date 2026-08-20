import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import {
  getVoicesForLanguage,
  previewVoice,
  speechLanguageLabel,
  stopSpeech,
  voiceSampleText,
  type SpeechVoice,
} from '@/lib/speech';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import { useSettingsStore } from '@/store/settings';

interface Props {
  visible: boolean;
  /** どの言語の声を選ぶか（BCP-47） */
  language: string;
  /** 選択中の identifier。未選択（＝端末の既定に任せる）なら null */
  value: string | null;
  onSelect: (identifier: string | null) => void;
  onClose: () => void;
}

/**
 * 050 Phase 3：ある言語を読む**声**を選ぶモーダル。
 *
 * iOS 設定（アクセシビリティ → 読み上げコンテンツ → 声）で英語に選べる声は**1つだけ**で、
 * しかもそれを変えるとアプリの読み上げも巻き添えになる。ここで選べばアプリ内だけで決まる。
 *
 * ⚠️ 一覧の先頭に**「自動」**を置く（言語と違い、声は**選択を取り消せる必要がある**）。
 * ⚠️ 選ぶのは `identifier` で**端末固有**。別端末では存在しないことがあるので、
 * 読み上げ側は `filterKnownVoices` で実在するものだけを使う。
 */
export function SpeechVoiceModal({ visible, language, value, onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  // 試聴は**読み上げ本体と同じ速度**で鳴らす（実際の聞こえ方で判断できるように）。
  const speechRate = useSettingsStore((s) => s.speechRate);

  useEffect(() => {
    if (!visible) return;
    setVoices([]);
    getVoicesForLanguage(language).then(setVoices);
  }, [visible, language]);

  // ⚠️ 閉じたら必ず止める（閉じたのに喋り続けるのを防ぐ）。アンマウント時も同じ。
  useEffect(() => {
    if (visible) return;
    stopSpeech();
  }, [visible]);
  useEffect(() => stopSpeech, []);

  /** その声で短いサンプルを鳴らす。`voice` 未指定＝端末の既定（「自動」行）。 */
  const preview = (voice?: SpeechVoice) => {
    previewVoice({
      // サンプル文が無い言語では名前を読む。「自動」行には名前が無いので先頭の声の名前で代用する。
      text: voiceSampleText(language, voice?.name ?? voices[0]?.name ?? language),
      language,
      voice: voice?.identifier,
      rate: speechRate,
    });
  };

  /** 行の**左端**に出す試聴ボタン。声を比べるときは連打するので、名前の長さで位置が動かない
   *  固定列にする（右端は選択状態＝チェックの場所として分ける）。
   *  ⚠️ 行の Pressable の内側に置く＝内側が先にタッチを取るので
   *  「試聴＝▶／選択＝行タップ」が両立する（ⓘ と同じ流儀）。 */
  const previewButton = (voice?: SpeechVoice) => (
    <Pressable
      onPress={() => preview(voice)}
      hitSlop={8}
      accessibilityLabel={t('settings.speechVoicePreview')}
    >
      <Ionicons name="play-circle-outline" size={Math.max(theme.fontSize.xl, 24)} color={theme.colors.primary} />
    </Pressable>
  );

  // 表示中だけ Esc を担当する（非表示のあいだ登録を持たない＝034 の住み分け）。
  useKeyCommands([{ input: KeyCommand.keyInputEscape, handler: onClose }], visible);

  const rowStyle = {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }}
        onPress={onClose}
      >
        <Pressable
          style={{ backgroundColor: theme.colors.surface, borderRadius: 12, maxHeight: '75%', overflow: 'hidden' }}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Text
              style={{ color: theme.colors.text, fontSize: theme.fontSize.lg, fontWeight: '700' }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t('settings.speechVoice')}
            </Text>
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: 4 }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t('settings.speechVoiceHint', { name: speechLanguageLabel(language, t) })}
            </Text>
          </View>
          <ScrollView>
            {/* 「自動」＝端末の既定に任せる（選択の取り消し） */}
            <Pressable onPress={() => { onSelect(null); onClose(); }} style={rowStyle}>
              {previewButton()}
              <Text
                style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t('settings.speechVoiceAuto')}
              </Text>
              <View style={{ width: theme.fontSize.lg, alignItems: 'center' }}>
                {value === null && (
                  <Ionicons name="checkmark" size={theme.fontSize.lg} color={theme.colors.primary} />
                )}
              </View>
            </Pressable>
            {voices.map((v) => (
              <Pressable
                key={v.identifier}
                onPress={() => { onSelect(v.identifier); onClose(); }}
                style={rowStyle}
              >
                {previewButton(v)}
                <Text
                  style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {v.name}
                </Text>
                {/* 強化版・プレミアム版はダウンロードが要るぶん音質が高い＝区別できるようにする */}
                {v.quality === 'Enhanced' && (
                  <Text
                    style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.label}
                  >
                    {t('settings.speechVoiceEnhanced')}
                  </Text>
                )}
                {/* チェックの有無で右端がずれないよう幅を固定する */}
                <View style={{ width: theme.fontSize.lg, alignItems: 'center' }}>
                  {v.identifier === value && (
                    <Ionicons name="checkmark" size={theme.fontSize.lg} color={theme.colors.primary} />
                  )}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
