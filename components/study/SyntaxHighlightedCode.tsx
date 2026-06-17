import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';

import { tokenize, type TokenType } from '@/lib/syntax-highlight';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

// Material Design 系の鮮やかパレット。彩度の高いカードテーマ背景上でも
// 「フィルター越し」感が出ないよう、VSCode Dark+ より各色を強めに振っている。
// number は黄色系にして comment（緑）と意味的に区別。
const TOKEN_COLORS: Record<TokenType, string> = {
  keyword:     '#4FC3F7',  // 鮮やかな空色（より青い）
  string:      '#FFB74D',  // 鮮やかな琥珀（salmon → vivid amber）
  comment:     '#7CB342',  // やや明るい緑（控えめだが鮮やか）
  number:      '#FFCA28',  // 鮮やかな黄色（comment と判別しやすく）
  type:        '#26C6DA',  // 鮮やかなシアン
  punctuation: '#FFFFFF',
  plain:       '#FFFFFF',
};

interface Props {
  code: string;
  language: string;
  /**
   * true\uff08\u30c7\u30d5\u30a9\u30eb\u30c8\uff09: \u9577\u3044\u884c\u3092\u6298\u308a\u8fd4\u3059\u3002
   * false: \u6298\u308a\u8fd4\u3055\u305a\u4e00\u884c\u306b\u4f38\u3070\u3059\uff08\u6a2a\u30b9\u30af\u30ed\u30fc\u30eb\u53ef\u80fd\u306a ScrollView \u5185\u3067\u4f7f\u3046\u60f3\u5b9a\uff09\u3002
   */
  wrap?: boolean;
}

export function SyntaxHighlightedCode({ code, language, wrap = true }: Props) {
  const theme = useTheme();
  const tokens = useMemo(() => tokenize(code.replace(/[\u2028\u2029]/g, '\n'), language), [code, language]);

  return (
    <Text style={[styles.base, wrap && styles.wrap, { fontSize: theme.fontSize.lg, lineHeight: theme.fontSize.lg * 1.5 }]} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
      {tokens.map((token, idx) => (
        <Text key={idx} style={{ color: TOKEN_COLORS[token.type] }} maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}>
          {token.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: 'monospace',
    lineHeight: 22,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  wrap: {
    flexWrap: 'wrap',
  },
});
