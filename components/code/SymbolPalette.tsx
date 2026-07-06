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
          <Text
            style={[styles.paletteBtnText, { fontSize: theme.fontSize.sm }]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // テキストブロックのツールバー（MarkdownPalette）と揃える：1行・等間隔（flex:1）・高さ32。
  // ただし記号キーは枠/背景を残して「押せるキー」感を維持する（Option B）。
  palette: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
  },
  paletteBtn: {
    flex: 1,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
  },
  paletteBtnText: {
    color: '#9CDCFE',
    fontFamily: 'monospace',
  },
});
