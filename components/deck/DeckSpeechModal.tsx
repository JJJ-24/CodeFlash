import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { constants as KeyCommand } from 'react-native-key-command';

import { SPEECH_SCRIPT_LABEL_KEYS, SpeechLanguageModal } from '@/components/settings/SpeechLanguageModal';
import {
  CONFIGURABLE_SCRIPTS,
  getConfigurableScriptLanguages,
  SCRIPT_DEFAULT_LANGS,
  speechLanguageLabel,
  type ScriptLangs,
  type SpeechScript,
} from '@/lib/speech';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import { useKeyCommands } from '@/lib/useKeyCommands';
import { useSettingsStore } from '@/store/settings';

interface Props {
  visible: boolean;
  /** このデッキの上書き（未設定の文字体系はキーごと無い） */
  langs: ScriptLangs;
  onChange: (langs: ScriptLangs) => void;
  onClose: () => void;
}

/**
 * 050 Phase 2：**このデッキを読み上げるときの言語**を文字体系ごとに上書きする一覧。
 * デッキ新規作成/編集の行と `R` キーから開き、行をタップすると `SpeechLanguageModal` が上に開く
 * 2段構成（`DeckStagesModal` → `SqlInitModal` と同じ形）。
 *
 * 上書きは**設定した文字体系だけ**アプリ設定に重なる（`mergeScriptLangs`）。漢字だけ中国語に
 * したいデッキでラテン文字まで巻き込まれると、英語の技術用語が中国語読みになってしまうため。
 *
 * ⚠️ **Pro ゲートは付けない**（読み上げは無料機能）。HTML/SQL 土台の行とはここが違う。
 * ⚠️ 選択肢に出す文字体系は**設定画面とまったく同じ規則**（`CONFIGURABLE_SCRIPTS` かつ
 * 端末にその文字体系の音声が2つ以上ある）。1つしか無いものは選ばせても結果が変わらない。
 * ⚠️ 2枚目のモーダル（言語ピッカー）は**この Modal の children の中**に置く。兄弟に並べると
 * iOS が2枚目を提示できず、閉じた後に親画面がタップを受け付けなくなる（044 で踏んだ）。
 */
export function DeckSpeechModal({ visible, langs, onChange, onClose }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const appLangs = useSettingsStore((s) => s.speechScriptLangs);
  const [showInfo, setShowInfo] = useState(false);
  /** 言語ピッカーを開いている文字体系（null＝閉じている） */
  const [picking, setPicking] = useState<SpeechScript | null>(null);
  /** 文字体系ごとに端末が持っている音声の言語。null＝未取得 */
  const [scriptOptions, setScriptOptions] = useState<Partial<Record<SpeechScript, string[]>> | null>(null);

  useEffect(() => {
    if (!visible) return;
    getConfigurableScriptLanguages().then(setScriptOptions).catch(() => {});
  }, [visible]);

  // 表示中だけ Esc を担当する。⚠️ 言語ピッカーが上に乗っている間は**そちらが最上位**なので外す
  // （両方が登録すると Esc で2枚とも閉じる）。
  useKeyCommands([{ input: KeyCommand.keyInputEscape, handler: onClose }], visible && picking === null);

  /** 選べる文字体系（未取得のあいだは設定画面と同じく全部出しておく＝取得後に減る） */
  const scripts = CONFIGURABLE_SCRIPTS.filter(
    (s) => scriptOptions === null || (scriptOptions[s]?.length ?? 0) >= 2,
  );

  /** 上書きが無いときに実際に読まれる言語（アプリ設定 → 文字体系の既定）。 */
  const inheritedLang = (script: SpeechScript) => appLangs[script] ?? SCRIPT_DEFAULT_LANGS[script];

  const setLang = (script: SpeechScript, code: string | null) => {
    const next = { ...langs };
    // null＝「アプリ設定に従う」＝**キーごと消す**（空文字を残すと未設定と区別できない）
    if (code === null) delete next[script];
    else next[script] = code;
    onChange(next);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.closeArea} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.header}>
            <View style={styles.titleLine}>
              <Text
                style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.lg }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              >
                {t('deck.speechLangsTitle')}
              </Text>
              <Pressable onPress={() => setShowInfo((v) => !v)} hitSlop={8}>
                <Ionicons
                  name={showInfo ? 'information-circle' : 'information-circle-outline'}
                  size={Math.max(theme.fontSize.lg, 20)}
                  color={theme.colors.textTertiary}
                />
              </Pressable>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.headerBtn}>
              <Ionicons name="checkmark-sharp" size={26} color={theme.colors.primary} />
            </Pressable>
          </View>

          {showInfo && (
            <View style={[styles.infoBox, { backgroundColor: theme.colors.background }]}>
              <Text
                style={[styles.hint, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t('deck.speechLangsHint')}
              </Text>
            </View>
          )}

          <ScrollView>
            {scripts.length === 0 ? (
              <Text
                style={[styles.empty, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
              >
                {t('deck.speechLangsNoOptions')}
              </Text>
            ) : (
              scripts.map((script) => {
                const override = langs[script];
                return (
                  <Pressable
                    key={script}
                    style={[styles.row, { borderColor: theme.colors.border }]}
                    onPress={() => setPicking(script)}
                  >
                    <Text
                      style={[styles.rowTitle, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                    >
                      {t(SPEECH_SCRIPT_LABEL_KEYS[script] ?? 'settings.speechScriptLatin')}
                    </Text>
                    {/* 上書きがあれば言語名（青）、無ければ「アプリ設定」（グレー）＝一覧で差が分かる */}
                    <Text
                      style={{
                        color: override ? theme.colors.primary : theme.colors.textSecondary,
                        fontSize: theme.fontSize.sm,
                        fontWeight: override ? '700' : '400',
                        flexShrink: 1,
                      }}
                      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                    >
                      {override
                        ? speechLanguageLabel(override, t, scriptOptions?.[script] ?? [])
                        : t('deck.speechInheritShort')}
                    </Text>
                    <Ionicons name="chevron-forward" size={theme.fontSize.lg} color={theme.colors.iconSubtle} />
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          {/* ⚠️ 言語ピッカーは**この Modal の中**（兄弟に並べない）。 */}
          <SpeechLanguageModal
            visible={picking !== null}
            script={picking ?? 'latin'}
            value={picking ? langs[picking] ?? null : null}
            allowInherit
            inheritLang={picking ? inheritedLang(picking) : undefined}
            onSelect={(code) => { if (picking) setLang(picking, code); }}
            onClose={() => setPicking(null)}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  closeArea: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
    maxHeight: '75%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  title: { fontWeight: '700', flexShrink: 1 },
  headerBtn: { paddingHorizontal: 4 },
  infoBox: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  hint: { lineHeight: 20 },
  empty: { paddingVertical: 24, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  rowTitle: { flex: 1, fontWeight: '600' },
});

/**
 * デッキ編集/新規作成の行に出す要約。**中身をそのまま出す**（「設定済み」の一語だと
 * 何語で読まれるのか分からず、開くまで確認できない＝043 の行で同じ失敗をしている）。
 *
 * ⚠️ 言語名は地域を省いた短い形にする（`peers` に `[]` を渡す）＝行は幅が限られており、
 * ここで区別が要る場面（同じ言語の地域違い）はピッカーを開けば分かる。
 */
export function deckSpeechSummary(
  langs: ScriptLangs,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const entries = Object.entries(langs).filter(([, lang]) => !!lang) as [SpeechScript, string][];
  if (entries.length === 0) return t('deck.speechLangsNone');
  if (entries.length === 1) {
    const [script, lang] = entries[0];
    return t('deck.speechLangsOne', {
      script: t(SPEECH_SCRIPT_LABEL_KEYS[script] ?? 'settings.speechScriptLatin'),
      language: speechLanguageLabel(lang, t, []),
    });
  }
  return t('deck.speechLangsSet', { count: entries.length });
}
