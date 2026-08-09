import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { DECK_STAGE_KEYS, type DeckStageKind } from '@/lib/deckStageLabels';
import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import type { DeckStage } from '@/types';

interface Props {
  /** デッキが持つ土台の一覧。0件なら選ぶ対象が無いので呼び出し側で描画しない */
  stages: DeckStage[];
  /** いま実際に積まれている土台の id。**「使わない」および解決できない参照は `null`** */
  activeStageId: string | null;
  /** 何の土台か（044: HTML/CSS 土台 ／ 045: SQL 初期化）。文言だけが変わる */
  kind: DeckStageKind;
  /** 「使わない」＝この土台を積まない（`noDeckHtmlInit`/`noDeckSqlInit` を true に） */
  onPickNone: () => void;
  /** 特定の土台を選ぶ */
  onPickStage: (stageId: string) => void;
  /** 既定（＝先頭の土台）に戻す。土台1つのトグルを ON にしたときに使う。
   *  **選択 id もクリアする**のが呼び出し側の責務（死んだ参照を残さないため） */
  onPickDefault: () => void;
}

/**
 * 044/045: コードブロックが「どのデッキ土台を積むか」を選ぶ UI。
 * **HTML/CSS 土台と SQL 初期化で共用**する（違うのは `kind` で切り替わる文言だけ）。
 *
 * - **土台が1つのデッキでは ON/OFF トグル**（044/045 以前と見た目・操作が変わらない）
 * - **2つ以上あるときだけ**「使わない＋各土台」の横並びチップになる
 *
 * トグルの `value` は `!noDeckHtmlInit` ではなく **`activeStageId !== null`（解決結果）** を見る。
 * 土台2つ→片方を削除、の後に残る「死んだ参照」のブロックは実態が土台なしなので、ここで ON と
 * 表示すると「ONなのにプレビューが出ない」食い違いになる（044 Phase 3 で実際に踏んだ）。
 */
export function DeckStagePicker({ stages, activeStageId, kind, onPickNone, onPickStage, onPickDefault }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const keys = DECK_STAGE_KEYS[kind];
  const multiple = stages.length > 1;

  return (
    <View style={[styles.section, { borderTopColor: theme.colors.border }]}>
      <View style={styles.header}>
        <Ionicons name={activeStageId ? 'layers' : 'layers-outline'} size={theme.fontSize.sm} color="#C9C9C9" />
        <Text
          style={{ color: '#C9C9C9', fontSize: theme.fontSize.sm, fontWeight: '600', flex: 1 }}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
        >
          {t(multiple ? keys.pickerLabel : keys.toggleLabel)}
        </Text>
        {!multiple && (
          <Switch
            value={activeStageId !== null}
            // ON に戻すときは宙に浮いた選択 id も消す（＝未指定＝先頭の土台に復帰）。
            // これが無いと、トグルを操作しても死んだ参照が残って土台が積まれない。
            onValueChange={(v) => (v ? onPickDefault() : onPickNone())}
            trackColor={{ true: '#1976D2' }}
            thumbColor="#FFF"
            style={styles.switch}
          />
        )}
      </View>

      {multiple && (
        <View style={styles.chips}>
          {/* 「使わない」＝土台を積まない。土台を選ぶと同時に false へ戻す */}
          <Pressable
            onPress={onPickNone}
            style={[
              styles.chip,
              {
                borderColor: activeStageId === null ? '#1976D2' : '#3A3A3A',
                backgroundColor: activeStageId === null ? '#1976D233' : 'transparent',
              },
            ]}
          >
            <Text
              style={{ color: activeStageId === null ? '#7FB3E8' : '#9CA3AF', fontSize: theme.fontSize.xs }}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            >
              {t('editor.deckStageNone')}
            </Text>
          </Pressable>
          {stages.map((stage, i) => {
            const selected = activeStageId === stage.id;
            return (
              <Pressable
                key={stage.id}
                onPress={() => onPickStage(stage.id)}
                style={[
                  styles.chip,
                  {
                    borderColor: selected ? '#1976D2' : '#3A3A3A',
                    backgroundColor: selected ? '#1976D233' : 'transparent',
                  },
                ]}
              >
                <Text
                  style={{ color: selected ? '#7FB3E8' : '#9CA3AF', fontSize: theme.fontSize.xs }}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {stage.name.trim() || t(keys.defaultName, { n: i + 1 })}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text
        style={{ color: '#9CA3AF', fontSize: theme.fontSize.xs, lineHeight: 16 }}
        maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
      >
        {t(multiple ? keys.pickerHint : keys.toggleHint)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // CodeBlockItem の initSqlSection / initSqlHeader と同じ寸法（並べたときに段差が出ないように）
  section: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, maxWidth: 160 },
  switch: { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }], alignSelf: 'center' },
});
