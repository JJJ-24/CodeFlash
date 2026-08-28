import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

// マークアップ文字列の {{token}} を Ionicons に対応づける
const ICON_TOKENS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  menu: 'reorder-three-outline',
  lock: 'lock-closed',
  // 未ロック（＝並べ替えできる状態）。一覧ヘッダーのロックボタンが解除時に出すアイコンと同じ。
  unlock: 'lock-open-outline',
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
  // 検索の学習日チップの日送り（◀ ▶）。説明文でも画面と同じ矢印を出すため。
  prev: 'chevron-back',
  next: 'chevron-forward',
  timer: 'timer-outline',
  // 選択モードの下部バーのボタン（カード一覧）。実物と同じアイコンを使う。
  selectAll: 'checkmark-circle-outline',
  copy: 'copy-outline',
  move: 'arrow-forward-circle-outline',
  archive: 'archive-outline',
  unarchive: 'arrow-undo-outline',
  trash: 'trash-outline',
  pencil: 'pencil-sharp',
  analytics: 'analytics-sharp',
  podium: 'podium-outline',
  piechart: 'pie-chart-outline',
};

// {{heatscale}} 用：ヒートマップ（草グラフ）と同じ4段階の緑
const HEAT_COLORS = ['#C8E6C9', '#A5D6A7', '#4CAF50', '#2E7D32'];

// 破壊的な操作のアイコンだけ実物のボタンと同じ赤（theme.colors.danger）で描く。
// 他は一律 primary＝説明文の中で「押すと消える操作」だけが色で立つ。
const DANGER_ICON_TOKENS = new Set(['trash']);

// 1行内の {{token}} を Ionicons / 凡例に置換しつつテキストと混在表示する
function renderInline(text: string, iconColor: string, iconSize: number, keyBase: string, emptyColor: string, dangerColor: string): React.ReactNode {
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
      const color = m && DANGER_ICON_TOKENS.has(m[1]) ? dangerColor : iconColor;
      return <Ionicons key={`${keyBase}-${i}`} name={name} size={iconSize} color={color} />;
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
   *   > ...              → 小さめの行（注意行と同じ字送り・色。`>` の後の字下げでインデント）
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

        // 小さめの行 `> xxx`（見出し＋項目の構造は保ったまま、注意行と同じ小ささ・グレーで出す）。
        // 補助的な説明を数行のかたまりで添えるときに、md の見出し/項目で書くと縦に伸びるため。
        // `>` の後の字下げの有無だけでインデントを決める（記法をこれ以上増やさない）。
        if (line.startsWith('>')) {
          const body = line.slice(1);
          return (
            <Text
              key={idx}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              style={{
                color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20,
                marginTop: 2, paddingLeft: /^\s/.test(body) ? 14 : 0,
              }}
            >
              {renderInline(body.trim(), theme.colors.primary, theme.fontSize.sm, `d${idx}`, theme.colors.border, theme.colors.danger)}
            </Text>
          );
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

        // 注意行 ※（テキストはグレーのまま、インラインアイコンは項目行と同じ扱い
        //   ＝既定は青・DANGER_ICON_TOKENS だけ赤）
        if (line.startsWith('※')) {
          return (
            <Text
              key={idx}
              maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
              style={{ color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, lineHeight: 20, marginTop: 2 }}
            >
              {renderInline(line, theme.colors.primary, theme.fontSize.sm, `n${idx}`, theme.colors.border, theme.colors.danger)}
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
              {renderInline(line.trim(), theme.colors.primary, theme.fontSize.md, `i${idx}`, theme.colors.border, theme.colors.danger)}
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
            {renderInline(line, theme.colors.primary, theme.fontSize.sm, `f${idx}`, theme.colors.border, theme.colors.danger)}
          </Text>
        );
      })}
    </View>
  );
}
