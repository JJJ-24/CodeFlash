import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { localDateStr } from '@/lib/database/utils';
import { FILTER_COLORS, useTheme } from '@/lib/theme';

const WEEKS = 26;
const CELL_SIZE = 11;
const CELL_GAP = 2;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const DAY_LABEL_WIDTH = 20;

function getCellColor(count: number, borderColor: string): string {
  if (count === 0) return borderColor;
  if (count <= 3) return '#A5D6A7';
  if (count <= 9) return FILTER_COLORS.learned;
  return '#2E7D32';
}

interface Props {
  data: { date: string; count: number }[];
  weeks?: number;
}

export default function ActivityHeatmap({ data, weeks = WEEKS }: Props) {
  const theme = useTheme();
  const { i18n } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);

  const { today, columns, monthLabels, dayLabels } = useMemo(() => {
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
          labels.push({ colIndex: w, label: cursor.toLocaleDateString(i18n.language, { month: 'short' }) });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(col);
    }

    const isJa = i18n.language.startsWith('ja');
    return {
      today: localDateStr(now),
      columns: cols,
      monthLabels: labels,
      dayLabels: isJa
        ? ['月', '火', '水', '木', '金', '土', '日']
        : ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    };
  }, [data, weeks, i18n.language]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 0);
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 4 }}
    >
      <View>
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

        <View style={styles.grid}>
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
