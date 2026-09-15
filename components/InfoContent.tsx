import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HEATMAP_COLORS, useTheme, MAX_FONT_MULTIPLIER } from '@/lib/theme';

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
  palette: 'color-palette-outline',
  archive: 'archive-outline',
  unarchive: 'arrow-undo-outline',
  trash: 'trash-outline',
  pencil: 'pencil-sharp',
  analytics: 'analytics-sharp',
  podium: 'podium-outline',
  piechart: 'pie-chart-outline',
  // 統計「学習履歴」の表示モード切替ボタン（学習量／目標達成）。実物と同じアイコン。
  barChart: 'bar-chart-outline',
  flag: 'flag-outline',
};

// 色見本トークン（■ を1つ）。統計「学習履歴」の目標達成表示の3状態＝ {{heatscale}} と同じ描き方で
// 1色ずつ出す。goalNone は空セル（枠色）なので描画側の emptyColor を使う。
const SWATCH_TOKENS: Record<string, string | null> = {
  goalReached: HEATMAP_COLORS.goalReached,
  goalMissed: HEATMAP_COLORS.goalMissed,
  goalNone: null,
};

// {{heatscale}} 用：ヒートマップ（草グラフ）と同じ4段階の緑（定義元は lib/theme の HEATMAP_COLORS）
const HEAT_COLORS = HEATMAP_COLORS.scale;

// 破壊的な操作のアイコンだけ実物のボタンと同じ赤（theme.colors.danger）で描く。
// 他は一律 primary＝説明文の中で「押すと消える操作」だけが色で立つ。
const DANGER_ICON_TOKENS = new Set(['trash']);

// 表の行 `| a | b | c |`。連続する行がまとめて1つの表になり、1行目が見出し行。
// TSV の見出しのように「ファイルに実際に並ぶ列」を見せる用途で、文中に書くと
// 箱の幅の任意の位置で折り返して桁が崩れるため（`dataManagement.importTsvInfo`）。
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const parseTableRow = (line: string) => line.trim().slice(1, -1).split('|').map((c) => c.trim());

/**
 * 説明文中の表。1行目＝見出し（太字・本文色）、以降＝データ行（セカンダリ色）。
 * 見出しの背景は塗らない＝この部品は背景色の違う箱（設定のインライン説明＝background /
 * InfoModal＝surface）の両方で使われるので、塗ると片方で面と同色になって消える。
 * 列は均等幅（`flex: 1`）で、長いセルはセル内で折り返す。
 *
 * ⚠️ 罫線に `colors.border`/`inputBorder` を使わない：ライトの `border`(#F0F0F0) は
 * ⓘ の箱の地(#F5F5F5)とほぼ同色で線が消え、`inputBorder`(#E0E0E0) でもまだ薄い。
 * `iconSubtle`(#BDBDBD / #555555) がライト・ダークとも地に対して確実に見える最小のトーン。
 */
function InfoTable({ rows }: { rows: string[][] }) {
  const theme = useTheme();
  const cols = Math.max(...rows.map((r) => r.length));
  const line = theme.colors.iconSubtle;
  return (
    <View style={{ borderWidth: 1, borderColor: line, borderRadius: 6, overflow: 'hidden', marginTop: 6, marginBottom: 2 }}>
      {rows.map((cells, r) => (
        <View key={r} style={{ flexDirection: 'row', borderTopWidth: r === 0 ? 0 : 1, borderTopColor: line }}>
          {Array.from({ length: cols }, (_, c) => (
            <View key={c} style={{ flex: 1, paddingVertical: 6, paddingHorizontal: 6, borderLeftWidth: c === 0 ? 0 : 1, borderLeftColor: line }}>
              <Text
                maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
                style={{
                  fontFamily: 'monospace',
                  fontSize: theme.fontSize.sm,
                  lineHeight: 20,
                  color: r === 0 ? theme.colors.text : theme.colors.textSecondary,
                  fontWeight: r === 0 ? '700' : '400',
                }}
              >
                {cells[c] ?? ''}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

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
    if (m && m[1] in SWATCH_TOKENS) {
      return <Text key={`${keyBase}-${i}`} style={{ color: SWATCH_TOKENS[m[1]] ?? emptyColor, fontSize: iconSize }}>■</Text>;
    }
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
   *   | a | b |          → 表の行（連続する行で1つの表・1行目が見出し）
   *   その他              → 補足段落（小さめ・セカンダリ色）
   *   {{token}}          → インラインアイコン（ICON_TOKENS 参照）
   *   （空行）            → スペーサー
   */
  text: string;
}

type Block =
  | { kind: 'line'; raw: string; idx: number }
  | { kind: 'table'; rows: string[][]; idx: number };

export function InfoContent({ text }: Props) {
  const theme = useTheme();
  const lines = text.split('\n');

  // 先に「連続する `|` 行」を1つの表へまとめる（行ごとに描くと枠が段組みにならない）。
  const blocks: Block[] = [];
  lines.forEach((raw, idx) => {
    if (TABLE_ROW.test(raw)) {
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === 'table') prev.rows.push(parseTableRow(raw));
      else blocks.push({ kind: 'table', rows: [parseTableRow(raw)], idx });
      return;
    }
    blocks.push({ kind: 'line', raw, idx });
  });

  const renderLine = (raw: string, idx: number) => {
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
  };

  return (
    <View>
      {blocks.map((b) => (b.kind === 'table' ? <InfoTable key={b.idx} rows={b.rows} /> : renderLine(b.raw, b.idx)))}
    </View>
  );
}
