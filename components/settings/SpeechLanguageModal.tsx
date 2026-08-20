import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { getSpeechLanguagesFor, speechLanguageLabel, type SpeechScript } from '@/lib/speech';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';

interface Props {
  visible: boolean;
  /** どの文字体系の言語を選ぶか。文言と選択肢の絞り込みが変わる */
  script: SpeechScript;
  value: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

/** 文字体系の表示名（設定画面と共用）。`CONFIGURABLE_SCRIPTS` のぶんだけあればよい。 */
export const SPEECH_SCRIPT_LABEL_KEYS: Partial<Record<SpeechScript, string>> = {
  latin: 'settings.speechScriptLatin',
  han: 'settings.speechScriptHan',
  cyrillic: 'settings.speechScriptCyrillic',
  arabic: 'settings.speechScriptArabic',
  devanagari: 'settings.speechScriptDevanagari',
};

/**
 * 049/050：ある文字体系を何語として読むかを選ぶモーダル。**全文字体系で共用**し、
 * `script` で文言と選択肢だけを切り替える（土台モーダルと同じ流儀）。
 *
 * **選択肢は端末から取る**（`getAvailableVoicesAsync()`）。対応表をアプリ側に持たないので、
 * OS が音声を増やせば自動で増える＝言語追加のメンテがゼロになる。
 * 一覧はその文字体系を使う言語だけに絞る（漢字の設定にフランス語が並んでも意味が無い）。
 */
export function SpeechLanguageModal({ visible, script, value, onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [languages, setLanguages] = useState<string[]>([]);
  const scriptName = t(SPEECH_SCRIPT_LABEL_KEYS[script] ?? 'settings.speechScriptLatin');

  useEffect(() => {
    if (!visible) return;
    // ⚠️ 開くたびに取り直す（文字体系が違えば一覧も別物）。
    setLanguages([]);
    getSpeechLanguagesFor(script).then(setLanguages);
  }, [visible, script]);

  // 表示中だけ Esc を担当する（非表示のあいだ登録を持たない＝034 の住み分け）。
  useKeyCommands([{ input: KeyCommand.keyInputEscape, handler: onClose }], visible);

  // 端末に音声が1つも無い場合でも現在値は選べるようにしておく。
  const rows = languages.length > 0 ? languages : [value];

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
              {/* タイトルは文字体系の名前そのもの（タップした行と同じ語にする） */}
              {scriptName}
            </Text>
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: 4 }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {script === 'han'
                ? t('settings.speechScriptHanHint')
                : t('settings.speechScriptLangHint', { name: scriptName })}
            </Text>
          </View>
          <ScrollView>
            {rows.map((code) => (
              <Pressable
                key={code}
                onPress={() => { onSelect(code); onClose(); }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingHorizontal: 16, paddingVertical: 12,
                  borderBottomWidth: 1, borderBottomColor: theme.colors.border,
                }}
              >
                <Text
                  style={{ flex: 1, color: theme.colors.text, fontSize: theme.fontSize.md }}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                >
                  {speechLanguageLabel(code)}
                </Text>
                {code === value && (
                  <Ionicons name="checkmark" size={theme.fontSize.lg} color={theme.colors.primary} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
