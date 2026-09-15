import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { monthLabel, weekdayLabels } from '@/lib/dateLabels';
import { localDateStr } from '@/lib/database/utils';
import { HEATMAP_COLORS, useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

const CELL_SIZE = 11;
const CELL_GAP = 2;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const DAY_LABEL_WIDTH = 20;
const LEGEND_SWATCH = 10;

/** 学習量：その年の最大枚数に対する割合で4段階。 */
function getCellColor(count: number, maxCount: number, borderColor: string): string {
  if (count === 0 || maxCount === 0) return borderColor;
  const ratio = count / maxCount;
  if (ratio <= 0.25) return HEATMAP_COLORS.scale[0];
  if (ratio <= 0.50) return HEATMAP_COLORS.scale[1];
  if (ratio <= 0.75) return HEATMAP_COLORS.scale[2];
  return HEATMAP_COLORS.scale[3];
}

/**
 * 目標達成（046 Phase 7）：**3状態**＝達成／学習したが未達成／学習なし。
 * 2色（達成／それ以外）にしないのは、「休んだ日」と「足りなかった日」を分けて読めるようにするため
 * （棒グラフでは「線の下の棒」として見えている情報）。判定は**現在の目標枚数**（Phase 5 と同じ A案）。
 * `count` は review_logs の日別 COUNT＝PK (cardId, reviewedDate) なので「その日に学習した実カード枚数」
 * ＝目標の判定（getTodayReviewedCount）や「学習の記録」の達成日数と同じ定義。
 */
function getGoalCellColor(count: number, goal: number, borderColor: string): string {
  if (count === 0) return borderColor;
  return count >= goal ? HEATMAP_COLORS.goalReached : HEATMAP_COLORS.goalMissed;
}

interface Props {
  data: { date: string; count: number }[];
  weeks?: number;
  /**
   * 1日の目標枚数。渡すと「目標達成」表示（達成／未達成／学習なしの3状態＋下に凡例）になり、
   * 省略すると従来どおりの学習量表示。目標 OFF のときは呼び出し側が渡さない＝046 以前と同じ見た目。
   */
  goal?: number;
}

export default function ActivityHeatmap({ data, weeks = 52, goal }: Props) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);

  const { today, columns, monthLabels, dayLabels, maxCount } = useMemo(() => {
    const countMap = new Map<string, number>(data.map((d) => [d.date, d.count]));
    const now = new Date();
    const todayDow = now.getDay();
    const endDate = new Date(now);
    endDate.setDate(now.getDate() + (7 - todayDow) % 7);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - weeks * 7 + 1);

    const cols: { date: string; count: number }[][] = [];
    const labels: { colIndex: number; label: string }[] = [];
    const cursor = new Date(startDate);

    for (let w = 0; w < weeks; w++) {
      const col: { date: string; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = localDateStr(cursor);
        col.push({ date: dateStr, count: countMap.get(dateStr) ?? 0 });
        if (cursor.getDate() === 1) {
          labels.push({ colIndex: w, label: monthLabel(i18n.language, cursor.getMonth()) });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(col);
    }

    const max = Math.max(0, ...cols.flat().map((c) => c.count));
    // 行は月曜始まり（列の先頭が月曜になるよう startDate を取っている）。
    // `weekdayLabels` は日曜始まりの配列なので、月〜日の順に引き直す。
    const narrow = weekdayLabels(i18n.language, 'narrow');
    return {
      today: localDateStr(now),
      columns: cols,
      monthLabels: labels,
      maxCount: max,
      dayLabels: [1, 2, 3, 4, 5, 6, 0].map((d) => narrow[d]),
    };
  }, [data, weeks, i18n.language]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 0);
  }, [weeks]);

  const monthRowHeight = Math.ceil(theme.fontSize.xs * 2.08);

  return (
    <View>
      <View style={styles.heatmapWrapper}>
        {/* 曜日ラベル（スクロール固定） */}
        <View>
          <View style={{ height: monthRowHeight }} />
          <View style={[styles.dayLabelCol, { width: DAY_LABEL_WIDTH }]}>
            {dayLabels.map((label, i) => (
              <View key={i} style={{ height: CELL_STEP, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
                <Text
                  style={[styles.dayLabel, { color: theme.colors.textTertiary, fontSize: 13 }]}
                  maxFontSizeMultiplier={1}
                >
                  {i % 2 === 0 ? label : ''}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* 月ラベル + セルグリッド（横スクロール） */}
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          // ステータスバータップ（scrollsToTop）の候補から外す。既定 true のままだと統計画面の
          // メイン ScrollView と候補が重複し、「先頭へ戻る」が iOS に無効化されるため。
          scrollsToTop={false}
          contentContainerStyle={{ paddingBottom: 4, paddingRight: 12 }}
        >
          <View>
            <View style={[styles.monthRow, { height: monthRowHeight }]}>
              {monthLabels.map(({ colIndex, label }) => (
                <Text
                  key={colIndex}
                  style={[
                    styles.monthLabel,
                    { color: theme.colors.textTertiary, fontSize: theme.fontSize.xs, left: colIndex * CELL_STEP },
                  ]}
                  maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                >
                  {label}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {columns.map((col, colIdx) => (
                <View key={colIdx} style={styles.col}>
                  {col.map(({ date, count }, rowIdx) => (
                    <View
                      key={rowIdx}
                      style={[
                        styles.cell,
                        {
                          backgroundColor: goal != null
                            ? getGoalCellColor(count, goal, theme.colors.border)
                            : getCellColor(count, maxCount, theme.colors.border),
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          marginBottom: CELL_GAP,
                          marginRight: colIdx < weeks - 1 ? CELL_GAP : 0,
                          opacity: date > today ? 0 : 1,
                        },
                      ]}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
      {/* 目標達成の凡例。棒グラフの目標ライン（046 Phase 6）と同じく**グリッドの下**に置く＝
          表示を切り替えてもグリッドは動かず、色の意味を ⓘ を開かずに読める。「目標 N枚/日」を
          添えるのは、判定基準が**現在の**目標枚数であることをその場で示すため。 */}
      {goal != null && (
        <View style={styles.legend}>
          <View style={[styles.legendSwatch, { backgroundColor: HEATMAP_COLORS.goalReached }]} />
          <Text style={[{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('stats.heatmapGoalReached')}
          </Text>
          <View style={[styles.legendSwatch, { backgroundColor: HEATMAP_COLORS.goalMissed, marginLeft: 10 }]} />
          <Text style={[{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('stats.heatmapGoalMissed')}
          </Text>
          <Text style={[{ color: theme.colors.textTertiary, fontSize: theme.fontSize.xs, marginLeft: 12 }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('stats.goalLineLegend', { count: goal })}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heatmapWrapper: { flexDirection: 'row' },
  monthRow: { flexDirection: 'row', position: 'relative' },
  monthLabel: { position: 'absolute', fontWeight: '500' },
  grid: { flexDirection: 'row' },
  dayLabelCol: { justifyContent: 'flex-start' },
  dayLabel: { textAlign: 'center' },
  col: { flexDirection: 'column' },
  cell: { borderRadius: 2 },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 6, flexWrap: 'wrap' },
  legendSwatch: { width: LEGEND_SWATCH, height: LEGEND_SWATCH, borderRadius: 2, marginRight: 4 },
});
