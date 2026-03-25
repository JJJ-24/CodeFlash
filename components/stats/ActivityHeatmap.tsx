import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FILTER_COLORS, useTheme } from '@/lib/theme';

const WEEKS = 26;
const CELL_SIZE = 11;
const CELL_GAP = 2;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const DAY_LABEL_WIDTH = 20;

const DAY_KEYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

function getCellColor(count: number, borderColor: string): string {
  if (count === 0) return borderColor;
  if (count <= 3) return '#A5D6A7';
  if (count <= 9) return FILTER_COLORS.learned;
  return '#2E7D32';
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface Props {
  data: { date: string; count: number }[];
  weeks?: number;
}

export default function ActivityHeatmap({ data, weeks = WEEKS }: Props) {
  const theme = useTheme();
  const { i18n } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);

  const countMap = new Map<string, number>(data.map((d) => [d.date, d.count]));

  // 今日を週の末尾（日曜）に揃えた起点を計算
  const today = new Date();
  const todayDow = today.getDay(); // 0=Sun, 1=Mon...
  // 日曜基準で今週の日曜を求める
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + (7 - todayDow) % 7 === 0 ? 0 : (7 - todayDow) % 7);
  // weeks週前の月曜を起点にする
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - weeks * 7 + 1);

  // 週ごとの列データを生成（各列 = 1週間 = 月〜日）
  const columns: { date: string; count: number }[][] = [];
  const monthLabels: { colIndex: number; label: string }[] = [];

  let cursor = new Date(startDate);
  for (let w = 0; w < weeks; w++) {
    const col: { date: string; count: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = localDateStr(cursor);
      col.push({ date: dateStr, count: countMap.get(dateStr) ?? 0 });
      // 月の1日なら月ラベルを記録
      if (cursor.getDate() === 1) {
        const label = cursor.toLocaleDateString(i18n.language, { month: 'short' });
        monthLabels.push({ colIndex: w, label });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(col);
  }

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 0);
  }, []);

  const isJa = i18n.language.startsWith('ja');
  const dayLabels = isJa
    ? ['月', '火', '水', '木', '金', '土', '日']
    : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 4 }}
    >
      <View>
        {/* 月ラベル行 */}
        <View style={[styles.monthRow, { marginLeft: DAY_LABEL_WIDTH }]}>
          {monthLabels.map(({ colIndex, label }) => (
            <Text
              key={colIndex}
              style={[
                styles.monthLabel,
                { color: theme.colors.textTertiary, fontSize: theme.fontSize.xs, left: colIndex * CELL_STEP },
              ]}
            >
              {label}
            </Text>
          ))}
        </View>

        {/* グリッド */}
        <View style={styles.grid}>
          {/* 曜日ラベル */}
          <View style={[styles.dayLabelCol, { width: DAY_LABEL_WIDTH }]}>
            {dayLabels.map((label, i) => (
              <Text
                key={i}
                style={[styles.dayLabel, { color: theme.colors.textTertiary, fontSize: 9, height: CELL_STEP }]}
              >
                {i % 2 === 0 ? label : ''}
              </Text>
            ))}
          </View>

          {/* セル */}
          {columns.map((col, colIdx) => (
            <View key={colIdx} style={styles.col}>
              {col.map(({ date, count }, rowIdx) => (
                <View
                  key={rowIdx}
                  style={[
                    styles.cell,
                    {
                      backgroundColor: getCellColor(count, theme.colors.border),
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      marginBottom: CELL_GAP,
                      marginRight: colIdx < weeks - 1 ? CELL_GAP : 0,
                      opacity: date > localDateStr(today) ? 0 : 1,
                    },
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', height: 16, position: 'relative' },
  monthLabel: { position: 'absolute', fontWeight: '500' },
  grid: { flexDirection: 'row' },
  dayLabelCol: { justifyContent: 'flex-start' },
  dayLabel: { textAlign: 'center', lineHeight: CELL_STEP },
  col: { flexDirection: 'column' },
  cell: { borderRadius: 2 },
});
