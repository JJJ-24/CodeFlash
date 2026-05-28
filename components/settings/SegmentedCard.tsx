import { Pressable, Text, View } from 'react-native';

import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

import { settingsStyles as styles } from './styles';

interface SegmentedCardProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

/** ラベル＋セグメント切替を1枚のカードにまとめた設定行（テーマ・文字サイズ等で使用）。 */
export function SegmentedCard<T extends string>({ label, options, value, onChange }: SegmentedCardProps<T>) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{label}</Text>
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
    </View>
  );
}
