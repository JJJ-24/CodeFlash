import { StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { useMaxFontMultiplier, useTheme } from '@/lib/theme';

/** 数字1文字のおおよその描画幅（`lib/blockMetrics.ts` と同じ見積もり） */
const DIGIT_EM = 0.6;
const PADDING_H = 10;

/**
 * 一覧行のカード枚数バッジ（丸枠の数字）。ホーム・タグ管理・学習タブで共用する。
 *
 * ⚠️ **文字の拡大を RN に任せない**（`allowFontScaling={false}` ＋ 実サイズを自前で計算）。
 * `maxFontSizeMultiplier` に窓幅追従の上限（`useMaxFontMultiplier`）を渡す書き方だと、
 * iPad で窓をドラッグして広げたときに**丸枠が小さいまま数字だけ大きくなり、数字が全部見えない**
 * （枠の幅は文字の実測から決まるが、実測が1フレーム遅れて古い値のまま使われるため。
 * ゆっくり広げると追いつくので気づきにくい）。フォントサイズを自分で持てば、
 * 枠の幅（`minWidth`）と文字サイズが**同じレンダーで**決まるのでズレようがない。
 *
 * ⚠️ `minWidth` は**下限**なので、見積もりが小さめに外れても枠が中身に合わせて広がるだけ
 * （切れない）。逆に大きめに外すと右側に余白が出るので、`DIGIT_EM` は控えめに見積もる。
 */
export function CountBadge({
  value,
  backgroundColor,
  style,
}: {
  value: string | number;
  backgroundColor: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const maxFont = useMaxFontMultiplier();
  const { fontScale } = useWindowDimensions();

  const text = String(value);
  const fontSize = theme.fontSize.sm * Math.min(fontScale, maxFont.ui);
  const minWidth = Math.max(28, Math.ceil(text.length * fontSize * DIGIT_EM) + PADDING_H * 2);

  return (
    <View style={[styles.badge, { backgroundColor, minWidth }, style]}>
      <Text allowFontScaling={false} style={[styles.text, { fontSize }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 12,
    paddingHorizontal: PADDING_H,
    paddingVertical: 3,
    alignItems: 'center',
  },
  text: { fontWeight: '700', color: '#FFF' },
});
