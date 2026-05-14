import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import { GRADE_COLORS, MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';
import { getCardGradeHistory, getCardGradeStats } from '@/lib/database/reviews';
import { localDateStr } from '@/lib/database/utils';
import type { CardGradeStats } from '@/lib/database/reviews';

interface Props {
  cardId: string | null;
  onClose: () => void;
}

const GRADE_LABELS = ['grade.again', 'grade.hard', 'grade.good', 'grade.easy'] as const;
const GRADE_COLOR_LIST = [GRADE_COLORS.again, GRADE_COLORS.hard, GRADE_COLORS.good, GRADE_COLORS.easy];

const PLOT_MARGIN_LEFT = 56;
const PLOT_MARGIN_RIGHT = 16;
const PLOT_MARGIN_TOP = 12;
const PLOT_MARGIN_BOTTOM = 36;
const PLOT_HEIGHT = 160;
const DOT_R = 5;

export function CardStatsSheet({ cardId, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useSQLiteContext();
  const { width: screenWidth } = useWindowDimensions();
  const sheetMaxWidth = Math.min(screenWidth * 0.92, 520);

  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<CardGradeStats | null>(null);
  const [history, setHistory] = useState<{ grade: number; reviewedAt: string }[]>([]);

  useEffect(() => {
    if (!cardId) return;
    setLoading(true);
    Promise.all([getCardGradeStats(db, cardId), getCardGradeHistory(db, cardId)])
      .then(([s, h]) => {
        setStats(s);
        setHistory(h);
      })
      .finally(() => setLoading(false));
  }, [cardId, db]);

  const total = stats ? stats.again + stats.hard + stats.good + stats.easy : 0;

  const avgTimes = stats
    ? [stats.avgTimeAgain, stats.avgTimeHard, stats.avgTimeGood, stats.avgTimeEasy]
    : [null, null, null, null];

  const counts = stats ? [stats.again, stats.hard, stats.good, stats.easy] : [0, 0, 0, 0];

  return (
    <Modal
      visible={cardId !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
        {/* Header（全幅・タイトル中央） */}
        <View style={[styles.header, { borderBottomColor: theme.colors.border, justifyContent: 'center' }]}>
          <Text style={[styles.headerTitle, { color: theme.colors.text, fontSize: theme.fontSize.lg, textAlign: 'center' }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
            {t('card.statsTitle')}
          </Text>
        </View>
        {/* 閉じるボタン（画面右上 absolute） */}
        <Pressable onPress={onClose} hitSlop={8} style={{ position: 'absolute', top: 14, right: 16, padding: 4, zIndex: 1 }}>
          <Ionicons name="close-outline" size={24} color={theme.colors.iconSubtle} />
        </Pressable>
        <View style={{ maxWidth: sheetMaxWidth, width: '100%', alignSelf: 'center' }}>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : total === 0 ? (
          <View style={styles.center}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.md }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
              {t('card.statsNoData')}
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Grade counts */}
            <View style={styles.gradeGrid}>
              {GRADE_LABELS.map((labelKey, i) => (
                <View key={i} style={styles.gradeCell}>
                  <Text style={[styles.gradeCount, { color: GRADE_COLOR_LIST[i], fontSize: theme.fontSize.xl }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {counts[i]}
                  </Text>
                  <Text style={[styles.gradeLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {t(labelKey)}
                  </Text>
                  <Text style={[styles.gradeAvg, { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                    {avgTimes[i] != null ? `${(avgTimes[i]! / 1000).toFixed(1)}${t('common.sec')}` : '—'}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.totalRow}>
              <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                {t('card.statsTotal', { count: total })}
              </Text>
              {stats?.avgTime != null && (
                <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                  {t('card.statsAvgTime', { time: (stats.avgTime / 1000).toFixed(1) })}
                </Text>
              )}
            </View>

            {/* Scatter plot */}
            {history.length >= 2 && (
              <View style={{ marginTop: 32 }}>
                <ScatterPlot history={history} theme={theme} t={t} />
                <View style={styles.reviewDatesRow}>
                  <View style={{ flexDirection: 'row' }}>
                    <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {t('card.statsFirstLabel')}
                    </Text>
                    <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {localDateStr(new Date(history[0].reviewedAt))}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row' }}>
                    <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {t('card.statsLastLabel')}
                    </Text>
                    <Text style={[{ color: theme.colors.textSecondary, fontSize: theme.fontSize.xs }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}>
                      {localDateStr(new Date(history[history.length - 1].reviewedAt))}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
        )}
        </View>
      </View>
    </Modal>
  );
}

function ScatterPlot({ history, theme, t }: { history: { grade: number; reviewedAt: string }[]; theme: ReturnType<typeof useTheme>; t: (key: string) => string }) {
  const n = history.length;
  const plotW = 320 - PLOT_MARGIN_LEFT - PLOT_MARGIN_RIGHT;
  const plotH = PLOT_HEIGHT - PLOT_MARGIN_TOP - PLOT_MARGIN_BOTTOM;

  const xPad = 10;
  const xScale = (i: number) => PLOT_MARGIN_LEFT + xPad + (n <= 1 ? (plotW - xPad * 2) / 2 : (i / (n - 1)) * (plotW - xPad * 2));
  const yScale = (g: number) => PLOT_MARGIN_TOP + plotH - (g / 3) * plotH;

  const yLabels = [
    { g: 0, key: 'grade.again' },
    { g: 1, key: 'grade.hard' },
    { g: 2, key: 'grade.good' },
    { g: 3, key: 'grade.easy' },
  ];

  return (
    <Svg width="100%" height={PLOT_HEIGHT} viewBox={`0 0 320 ${PLOT_HEIGHT}`}>
      {/* Grid lines + Y labels */}
      {yLabels.map(({ g, key }) => {
        const y = yScale(g);
        return (
          <Line
            key={g}
            x1={PLOT_MARGIN_LEFT}
            y1={y}
            x2={320 - PLOT_MARGIN_RIGHT}
            y2={y}
            stroke={theme.colors.border}
            strokeWidth={0.8}
          />
        );
      })}
      {yLabels.map(({ g, key }) => {
        const y = yScale(g);
        return (
          <SvgText
            key={g}
            x={PLOT_MARGIN_LEFT - 4}
            y={y + 4}
            textAnchor="end"
            fontSize={theme.fontSize.sm}
            fill={theme.colors.textSecondary}
          >
            {t(key)}
          </SvgText>
        );
      })}

      {/* Dots */}
      {history.map((h, i) => {
        const isLatest = i === n - 1;
        const cx = xScale(i);
        const cy = yScale(h.grade);
        return (
          <React.Fragment key={i}>
            <Circle
              cx={cx}
              cy={cy}
              r={DOT_R}
              fill={GRADE_COLOR_LIST[h.grade]}
              opacity={0.85}
            />
            {isLatest && (
              <>
                <Circle
                  cx={cx}
                  cy={cy}
                  r={DOT_R + 3}
                  fill="none"
                  stroke={theme.colors.primary}
                  strokeWidth={2}
                />
                <SvgText
                  x={cx}
                  y={cy + DOT_R + 16}
                  textAnchor="middle"
                  fontSize={theme.fontSize.xs}
                  fill={theme.colors.primary}
                  fontWeight="600"
                >
                  {t('card.statsLatest')}
                </SvgText>
              </>
            )}
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontWeight: '700',
  },
  center: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  gradeGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  gradeCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  gradeCount: {
    fontWeight: '700',
  },
  gradeLabel: {
    fontWeight: '600',
  },
  gradeAvg: {},
  totalText: {
    textAlign: 'center',
    marginTop: 8,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
    marginTop: 8,
  },
  sectionTitle: {
    fontWeight: '600',
    marginBottom: 8,
  },
  reviewDatesRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 8,
  },
});
