import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

import { settingsStyles as styles } from './styles';

interface SegmentedCardProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** 渡すとラベル右に ⓘ を表示し、タップでカード内に説明を展開する。 */
  info?: string;
}

/** ラベル＋セグメント切替を1枚のカードにまとめた設定行（テーマ・文字サイズ等で使用）。 */
export function SegmentedCard<T extends string>({ label, options, value, onChange, info }: SegmentedCardProps<T>) {
  const theme = useTheme();
  const [showInfo, setShowInfo] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{label}</Text>
        {info && (
          <Pressable onPress={() => setShowInfo((v) => !v)} hitSlop={8}>
            <Ionicons
              name={showInfo ? 'information-circle' : 'information-circle-outline'}
              size={Math.max(theme.fontSize.lg, 20)}
              color={theme.colors.textTertiary}
            />
          </Pressable>
        )}
      </View>
      <View style={[styles.segmented, { backgroundColor: theme.colors.background }]}>
        {options.map(({ value: optValue, label: optLabel }) => {
          const active = value === optValue;
          return (
            <Pressable
              key={optValue}
              style={[styles.segment, active && { backgroundColor: theme.colors.surface }]}
              onPress={() => onChange(optValue)}
            >
              <Text style={[
                styles.segmentText,
                { color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: theme.fontSize.md },
                active && styles.segmentTextActive,
              ]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
                {optLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {info && showInfo && (
        <View style={[styles.syncInfoBox, { backgroundColor: theme.colors.background }]}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20 }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
            {info}
          </Text>
        </View>
      )}
    </View>
  );
}
