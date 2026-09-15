import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { MAX_FONT_MULTIPLIER, useTheme } from '@/lib/theme';

interface Props {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  /** ⓘ をタップしたとき。省略すると ⓘ を出さない。 */
  onInfo?: () => void;
  infoLabel?: string;
  /** ⓘ を「開いている」表示（塗り）にする。インライン説明を持つ設定画面用。 */
  infoOpen?: boolean;
  /** タイトルの右に並べる要素（Pro バッジ等）。 */
  badge?: ReactNode;
  /**
   * chevron の**左**に並べる操作（表示モードの切替ボタン等・統計「学習履歴」の学習量/目標達成）。
   * 学習タブの「学習一覧」行のボタン群と同じ位置づけ。⚠️ 値や文言は置かない（下の注記）＝
   * アイコンボタンは幅が固定でタイトルが折り返すだけだが、値は押し出されて消える。
   */
  actions?: ReactNode;
  /** **折りたたみ中だけ**タイトルの下に出す要約（例「25分 × 4回・休憩5分」）。 */
  summary?: string;
  /** タイトルの文字スタイル（既定は統計タブの見出し＝lg・700）。 */
  titleStyle?: StyleProp<TextStyle>;
  /** 外枠のスタイル。既定の `marginBottom: 8` を消したいとき（親が `gap` を持つカード等）に使う。 */
  wrapStyle?: StyleProp<ViewStyle>;
  /**
   * タイトルと chevron の**間の余白**もタップで開閉する（既定 false）。
   *
   * ⚠️ **祖先に余白タップの Pressable がある画面では有効にしない**（統計タブ）：あちらは余白の
   * タップをバブリングさせて J/K フォーカスを解除しており、ここで掴むとその解除が効かなくなる。
   * 設定サブ画面（`SettingsDetail`）にはフォーカス解除の Pressable も J/K フォーカスも無く、
   * 余白タップは本当に何も起きない空き地なので、開閉の当たり判定に使ってよい。
   */
  blankTapToggles?: boolean;
}

/**
 * 折りたためるセクションの見出し行（統計タブと設定サブ画面で共用）。
 *
 * ⚠️ **行の外枠は必ずレスポンダを持たない `View` にする**：横の空白をタップしたとき、祖先の
 * 余白タップ Pressable（統計タブの `styles.content` 等）へバブリングさせて J/K フォーカスを
 * 解除するため。ここを `Pressable` に戻すと空白タップが折りたたみを誤爆する。
 * ⓘ は内側の独立した Pressable（タップ領域の分離）。
 *
 * ⚠️ **要約はタイトルの右に置かない**（下の行に出す）：`[見出し][値][>]` を1行に詰めると
 * フォントサイズ「大」で見出しが折り返して値が消える（読み上げ設定で踏んだ・CLAUDE.md 参照）。
 */
export function CollapsibleSectionTitle({
  title, collapsed, onToggle, onInfo, infoLabel, infoOpen, badge, summary, titleStyle, wrapStyle, blankTapToggles, actions,
}: Props) {
  const theme = useTheme();
  return (
    <View style={[styles.wrap, wrapStyle]}>
      <View style={styles.row}>
        <Pressable style={styles.titleTap} onPress={onToggle} hitSlop={{ top: 8, bottom: 8 }} accessibilityRole="button">
          <Text
            style={[
              styles.title,
              { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg },
              titleStyle,
            ]}
            maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.ui}
          >
            {title}
          </Text>
          {badge}
        </Pressable>
        {onInfo && (
          <Pressable onPress={onInfo} hitSlop={8} accessibilityLabel={infoLabel}>
            <Ionicons
              name={infoOpen ? 'information-circle' : 'information-circle-outline'}
              size={Math.max(theme.fontSize.lg, 20)}
              color={theme.colors.textTertiary}
            />
          </Pressable>
        )}
        {blankTapToggles
          ? <Pressable style={{ flex: 1, alignSelf: 'stretch' }} onPress={onToggle} accessibilityRole="button" accessibilityLabel={title} />
          : <View style={{ flex: 1 }} />}
        {actions}
        <Pressable onPress={onToggle} hitSlop={8} accessibilityRole="button">
          <Ionicons
            name={collapsed ? 'chevron-forward' : 'chevron-down'}
            size={Math.max(theme.fontSize.md, 18)}
            color={theme.colors.textTertiary}
          />
        </Pressable>
      </View>
      {collapsed && !!summary && (
        <Text
          style={{ color: theme.colors.textTertiary, fontSize: theme.fontSize.sm, marginTop: 2 }}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER.content}
        >
          {summary}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // flexShrink: actions（切替ボタン）と chevron の幅を先に確保し、余った幅でタイトルを折り返す。
  // 無いとタイトルが行幅を超えたとき右側の要素ごと画面外へ押し出される。
  titleTap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  title: { fontWeight: '700', flexShrink: 1 },
});
