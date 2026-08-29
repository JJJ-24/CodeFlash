import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { getSpeechLanguagesFor, speechLanguageLabel, type SpeechScript } from '@/lib/speech';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';

interface Props {
  visible: boolean;
  /** どの文字体系の言語を選ぶか。文言と選択肢の絞り込みが変わる */
  script: SpeechScript;
  /** 選択中の言語。`null` は「上書きしない」（`allowInherit` のときだけ起こりうる） */
  value: string | null;
  onSelect: (code: string | null) => void;
  onClose: () => void;
  /** 050 Phase 2：先頭に「アプリ設定に従う」行を出す（デッキ単位の上書きを**解除する手段**）。
   *  ⚠️ アプリ設定側では出さない＝必ず何かの言語で読むので「未設定」に戻す意味が無い。 */
  allowInherit?: boolean;
  /** 「アプリ設定に従う」を選んだときに実際に読まれる言語（行の右に薄く出す）。 */
  inheritLang?: string;
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
export function SpeechLanguageModal({ visible, script, value, onSelect, onClose, allowInherit, inheritLang }: Props) {
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

  // 開くフェードは JS でやる（Modal は `animationType="none"`）。iOS は VC のトランジション中に
  // タッチを配送しないので、`fade` のままだと**開いた直後の操作が空振りする**（CLAUDE.md の
  // 中央ダイアログの項）。閉じるときは従来どおり即時。
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [visible, fade]);

  // 表示中だけ Esc を担当する（非表示のあいだ登録を持たない＝034 の住み分け）。
  useKeyCommands([{ input: KeyCommand.keyInputEscape, handler: onClose }], visible);

  // 端末に音声が1つも無い場合でも現在値は選べるようにしておく。
  // ⚠️ 「アプリ設定に従う」を選んでいるとき（value === null）は現在値が無いので空のままにする。
  const rows = languages.length > 0 ? languages : value ? [value] : [];

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
            {/* 050 Phase 2：デッキ側だけに出す「上書きしない」行。声ピッカーの「自動」と同じ役割で、
                ⚠️ **これが無いとデッキの上書きを解除できない**（一度選ぶと元に戻せなくなる）。 */}
            {allowInherit && (
              <Pressable
                onPress={() => { onSelect(null); onClose(); }}
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
                  {t('deck.speechInherit')}
                </Text>
                {/* 実際に何語で読まれるかを添える＝「従う」だけだと結果が分からない */}
                {inheritLang && (
                  <Text
                    style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {speechLanguageLabel(inheritLang, t, rows)}
                  </Text>
                )}
                {value === null && (
                  <Ionicons name="checkmark" size={theme.fontSize.lg} color={theme.colors.primary} />
                )}
              </Pressable>
            )}
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
                  {/* 地域は**同じ言語が2つ以上並ぶときだけ**出す（`rows` を渡して判定させる）。
                      端末に1つしか無い言語で「チェコ語（チェコ）」と書いても区別する相手がいない。 */}
                  {speechLanguageLabel(code, t, rows)}
                </Text>
                {code === value && (
                  <Ionicons name="checkmark" size={theme.fontSize.lg} color={theme.colors.primary} />
                )}
              </Pressable>
            ))}
            {/* 一覧の末尾に「増やし方」を置く。**ヘッダーではなく末尾**なのは、
                ①知りたくなるのは一覧を見て「これだけしかない」と気づいた瞬間で、
                  少ないときほど末尾がすぐ目に入る（多いときは増やす必要がない）
                ②ヘッダーに足すと、文字サイズを大きくしたときに固定の見出し部が伸びて
                  一覧そのものを圧迫する（シートは maxHeight 75% で頭打ちのため）。
                ⚠️ 文言は**言語ピッカーと共用の1キー**（`speechAddVoiceHint`）＝Apple が
                メニュー名を変えたときに直す場所を1つにする。 */}
            <Text
              style={{
                color: theme.colors.textTertiary, fontSize: theme.fontSize.xs, lineHeight: 18,
                paddingHorizontal: 16, paddingVertical: 12,
              }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            >
              {t('settings.speechAddVoiceHint')}
            </Text>
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}
