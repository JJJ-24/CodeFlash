import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { getLatinSpeechLanguages, getNonLatinSpeechLanguages, speechLanguageLabel } from '@/lib/speech';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';

interface Props {
  visible: boolean;
  /** どちらの区間の言語を選ぶか。文言と選択肢の絞り込みが変わる */
  kind: 'latin' | 'nonLatin';
  value: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

/**
 * 049：区間を何語として読むかを選ぶモーダル。**ラテン文字/非ラテン文字で共用**し、
 * `kind` で文言と選択肢だけを切り替える（土台モーダルと同じ流儀）。
 *
 * **選択肢は端末から取る**（`getAvailableVoicesAsync()`）。対応表をアプリ側に持たないので、
 * OS が音声を増やせば自動で増える＝言語追加のメンテがゼロになる。
 * 一覧は用途に合う側だけに絞る（ラテン文字の区間に韓国語を割り当てても意味が無いため）。
 */
export function SpeechLanguageModal({ visible, kind, value, onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [languages, setLanguages] = useState<string[]>([]);
  const titleKey = kind === 'latin' ? 'settings.speechLatinLang' : 'settings.speechNonLatinLang';
  const hintKey = kind === 'latin' ? 'settings.speechLatinLangHint' : 'settings.speechNonLatinLangHint';

  useEffect(() => {
    if (!visible) return;
    // ⚠️ 開くたびに取り直す（kind が違えば一覧も別物）。
    setLanguages([]);
    const load = kind === 'latin' ? getLatinSpeechLanguages : getNonLatinSpeechLanguages;
    load().then(setLanguages);
  }, [visible, kind]);

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
              {t(titleKey)}
            </Text>
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: 4 }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t(hintKey)}
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
