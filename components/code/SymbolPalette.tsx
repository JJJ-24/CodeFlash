import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MAX_FONT_MULTIPLIER } from '@/lib/theme';
import type { AppTheme } from '@/lib/theme';

export const SYMBOL_PAIRS = [
  { open: '(', close: ')', label: '( )' },
  { open: '{', close: '}', label: '{ }' },
  { open: '[', close: ']', label: '[ ]' },
  { open: '"', close: '"', label: '" "' },
  { open: "'", close: "'", label: "' '" },
  { open: '`', close: '`', label: '` `' },
  { open: '<', close: '>', label: '< >' },
  { open: ':', close: '', label: ':' },
  { open: ';', close: '', label: ';' },
];

interface Props {
  visible: boolean;
  onInsertPair: (open: string, close: string) => void;
  /** FlipCard との競合防止用（学習画面のみ必要） */
  suppress?: () => void;
  theme: AppTheme;
}

export function SymbolPalette({ visible, onInsertPair, suppress, theme }: Props) {
  if (!visible) return null;

  return (
    <View
      style={[styles.palette, { borderTopColor: theme.dark ? '#3A3A3A' : '#444' }]}
      onTouchStart={suppress}
    >
      {SYMBOL_PAIRS.map(({ open, close, label }) => (
        <Pressable
          key={label}
          style={[
            styles.paletteBtn,
            {
              backgroundColor: theme.dark ? '#2D2D2D' : '#1E1E1E',
              borderColor: theme.dark ? '#555' : '#444',
            },
          ]}
          onPress={() => onInsertPair(open, close)}
        >
          <Text style={[styles.paletteBtnText, { fontSize: theme.fontSize.sm }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  palette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopWidth: 1,
  },
  paletteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  paletteBtnText: {
    color: '#9CDCFE',
    fontFamily: 'monospace',
  },
});
