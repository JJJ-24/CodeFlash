import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

const isPad = (Platform as any).isPad;

type Row = { label?: string; sample?: string; note?: string };
type Section = { title: string; rows: Row[] };

/**
 * 翻訳文字列（`editor.mdHelpBody`）を節・行に分解する。行頭の記号で種別を決める：
 * - `@@` … 節見出し
 * - タブ … 記法サンプル（等幅表示。連続する行は1つの塊にまとめる）
 * - `//` … 補足（本文と同じ書体）
 * - それ以外 … 項目名
 *
 * サンプル自体が `#` `-` `>` などで始まるため、**サンプル側をタブで示す**方式にしている
 * （記号を見出しマーカーにすると `## 見出し2` のようなサンプルと衝突する）。
 */
function parseHelp(body: string): Section[] {
  const sections: Section[] = [];
  let section: Section | null = null;
  for (const raw of body.split('\n')) {
    if (raw === '') continue;
    if (raw.startsWith('@@')) {
      section = { title: raw.slice(2), rows: [] };
      sections.push(section);
      continue;
    }
    if (!section) {
      section = { title: '', rows: [] };
      sections.push(section);
    }
    if (raw.startsWith('\t')) {
      const line = raw.slice(1);
      const last = section.rows[section.rows.length - 1];
      // 直前の行がサンプル付きなら同じ塊に足す（複数行のコードブロックやテーブル用）
      if (last && last.sample !== undefined) last.sample += '\n' + line;
      else if (last && last.label !== undefined && last.sample === undefined) last.sample = line;
      else section.rows.push({ sample: line });
      continue;
    }
    if (raw.startsWith('//')) {
      section.rows.push({ note: raw.slice(2) });
      continue;
    }
    section.rows.push({ label: raw });
  }
  return sections;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * テキストブロックで使えるマークダウン記法の early reference。
 *
 * キーコマンドは登録しない（タップで閉じる）。表示中にモーダル側で Esc を登録すると、
 * 閉じるときに親画面の常時 Esc まで巻き添えで解除されるため（`ShortcutsModal` のコメント参照）。
 */
export function MarkdownHelpModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const sections = useMemo(() => parseHelp(t('editor.mdHelpBody')), [t]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* 背景タップで閉じる Pressable は **ScrollView の祖先にしない**（兄弟として敷く）。
          祖先に置くと、押せる要素の無い場所から始めたドラッグでスクロールが始まらない
          （Fabric の _shouldDisableScrollInteraction。CLAUDE.md / ShortcutsModal と同じ構造）。 */}
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.dialog, { backgroundColor: theme.colors.surface }, isPad && styles.dialogPad]}>
          <Text
            style={[styles.title, { color: theme.colors.text, fontSize: theme.fontSize.md }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {t('editor.mdHelpTitle')}
          </Text>
          <ScrollView style={styles.body} showsVerticalScrollIndicator>
            {sections.map((section, si) => (
              <View key={si} style={si > 0 ? styles.sectionGap : undefined}>
                {!!section.title && (
                  <Text
                    style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                    maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                  >
                    {section.title}
                  </Text>
                )}
                {section.rows.map((row, ri) => (
                  <View key={ri} style={[styles.row, { borderBottomColor: theme.colors.border }]}>
                    {row.note !== undefined ? (
                      <Text
                        style={[styles.note, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]}
                        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                      >
                        {row.note}
                      </Text>
                    ) : (
                      <>
                        {!!row.label && (
                          <Text
                            style={[styles.label, { color: theme.colors.text, fontSize: theme.fontSize.sm }]}
                            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                          >
                            {row.label}
                          </Text>
                        )}
                        {!!row.sample && (
                          <Text
                            style={[styles.sample, {
                              color: theme.colors.text,
                              backgroundColor: theme.dark ? '#2A2A2A' : '#F0F0F0',
                              fontSize: theme.fontSize.sm,
                            }]}
                            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
                          >
                            {row.sample}
                          </Text>
                        )}
                      </>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
          <View style={[styles.separator, { backgroundColor: theme.colors.border }]} />
          <Pressable style={styles.okBtn} onPress={onClose}>
            <Text
              style={[styles.okBtnText, { color: theme.colors.primary, fontSize: theme.fontSize.md }]}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              OK
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  dialog: {
    width: 300, maxHeight: '80%', borderRadius: 16, paddingTop: 20, paddingHorizontal: 20, paddingBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8,
  },
  dialogPad: { width: 460, maxWidth: '90%' },
  title: { fontWeight: '700', marginBottom: 8 },
  // flexShrink がないと ScrollView が中身の高さのまま伸び、dialog の maxHeight で切られるだけで
  // スクロールできなくなる（RN の flexShrink 既定は 0）。
  body: { flexShrink: 1, marginBottom: 8 },
  sectionGap: { marginTop: 14 },
  sectionTitle: { fontWeight: '700', marginBottom: 4 },
  row: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { marginBottom: 3 },
  sample: { fontFamily: 'monospace', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 4, lineHeight: 20 },
  note: { lineHeight: 19 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: -20 },
  okBtn: { paddingVertical: 14, alignItems: 'center' },
  okBtnText: { fontWeight: '600' },
});
