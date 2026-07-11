import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

// マークアップ文字列の {{token}} を Ionicons に対応づける
const ICON_TOKENS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  menu: 'reorder-three-outline',
  lock: 'lock-closed',
  name: 'text-outline',
  count: 'layers-outline',
  newest: 'arrow-down-outline',
  oldest: 'arrow-up-outline',
  funnel: 'funnel-outline',
  shuffle: 'shuffle-outline',
  albums: 'albums-outline',
  pricetag: 'pricetag-outline',
  search: 'search-outline',
  calendar: 'calendar-outline',
  timer: 'timer-outline',
  pencil: 'pencil-sharp',
  analytics: 'analytics-sharp',
};

// {{heatscale}} 用：ヒートマップ（草グラフ）と同じ4段階の緑
const HEAT_COLORS = ['#C8E6C9', '#A5D6A7', '#4CAF50', '#2E7D32'];

// 1行内の {{token}} を Ionicons / 凡例に置換しつつテキストと混在表示する
function renderInline(text: string, iconColor: string, iconSize: number, keyBase: string, emptyColor: string): React.ReactNode {
  return text.split(/(\{\{\w+\}\})/g).map((part, i) => {
    // ヒートマップ凡例（空セルのグレー + 緑4段階の色付き■を横並び）
    if (part === '{{heatscale}}') {
      const scale = [emptyColor, ...HEAT_COLORS];
      return (
        <Text key={`${keyBase}-${i}`}>
          {scale.map((c, j) => (
            <Text key={j} style={{ color: c, fontSize: iconSize }}>■</Text>
          ))}
        </Text>
      );
    }
    const m = part.match(/^\{\{(\w+)\}\}$/);
    const name = m && ICON_TOKENS[m[1]];
    if (name) {
      return <Ionicons key={`${keyBase}-${i}`} name={name} size={iconSize} color={iconColor} />;
    }
    return part;
  });
}

interface Props {
  /**
   * 説明モーダル用のマークアップ文字列（i18n から渡す）。
   * 行ごとの記法:
   *   [見出し]            → 太字の見出し（操作ラベル / セクション）
   *   ※ ...              → 注意行（小さめ・セカンダリ色）
   *   （先頭インデント）    → 見出し配下の項目（インデント表示）
   *   その他              → 補足段落（小さめ・セカンダリ色）
   *   {{token}}          → インラインアイコン（ICON_TOKENS 参照）
   *   （空行）            → スペーサー
   */
  text: string;
}

export function InfoContent({ text }: Props) {
  const theme = useTheme();
  const lines = text.split('\n');
  return (
    <View>
      {lines.map((raw, idx) => {
        const line = raw.replace(/\s+$/, '');

        // 空行 → スペーサー
        if (line.trim() === '') {
          return <View key={idx} style={{ height: 10 }} />;
        }

        // 大見出し ■ xxx（機能グループの区切り）
        if (line.startsWith('■')) {
          return (
            <Text
              key={idx}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '700', marginTop: idx === 0 ? 0 : 12, marginBottom: 4 }}
            >
              {line}
            </Text>
          );
        }

        // 見出し [xxx]
        const header = line.match(/^\[(.+)\]$/);
        if (header) {
          return (
            <Text
              key={idx}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              style={{ color: theme.colors.text, fontSize: theme.fontSize.md, fontWeight: '700', marginTop: idx === 0 ? 0 : 8, marginBottom: 2 }}
            >
              {line}
            </Text>
          );
        }

        // 注意行 ※（テキストはグレーのまま、インラインアイコンは項目行と同じ青で統一）
        if (line.startsWith('※')) {
          return (
            <Text
              key={idx}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20, marginTop: 2 }}
            >
              {renderInline(line, theme.colors.primary, theme.fontSize.sm, `n${idx}`, theme.colors.border)}
            </Text>
          );
        }

        // インデント行 → 見出し配下の項目
        if (/^\s+/.test(raw)) {
          return (
            <Text
              key={idx}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              style={{ color: theme.colors.text, fontSize: theme.fontSize.md, lineHeight: 24, paddingLeft: 14 }}
            >
              {renderInline(line.trim(), theme.colors.primary, theme.fontSize.md, `i${idx}`, theme.colors.border)}
            </Text>
          );
        }

        // 補足段落
        return (
          <Text
            key={idx}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
            style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20, marginTop: 4 }}
          >
            {renderInline(line, theme.colors.primary, theme.fontSize.sm, `f${idx}`, theme.colors.border)}
          </Text>
        );
      })}
    </View>
  );
}
