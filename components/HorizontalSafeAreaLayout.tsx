import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

/**
 * 各画面の中身を左右の safe area の内側に置く `screenLayout`（Stack・Tabs の両方に渡す）。
 * iPhone Duo の閉じた状態・開いた横向きでは右 84pt（カメラとステータスバーの帯）が報告される。
 *
 * ⚠️ JS で受け取った safe area の値で `padding` を付けない＝ネイティブの `SafeAreaView` で避ける。
 * JS の値は画面の大きさが変わってから少し遅れて届くので、開閉のたびにデッキの行や右下の＋ボタンが
 * 一瞬古い余白のまま描かれて動いて見えた（3〜4回に1回）。ネイティブなら同じコマで反映される。
 *
 * - Stack の `(tabs)` は包まない：タブの中身は Tabs の `screenLayout` が包む（標準ヘッダーとタブバーは
 *   自分で避けるので、`(tabs)` ごと包むと二重になる）。Tabs の `screenLayout` は標準ヘッダーの下の中身だけを包む
 * - 自前ヘッダーは中身の中にあるので、背景を端まで伸ばすのは `useLockedHeaderHeights().bleed` のまま
 * - **帯（左右の safe area）はヘッダーと同じ色（`surface`）で上から下まで塗る**：閉じた状態・開いた横向きでは時刻・Wi-Fi が
 *   帯の上部に縦に並び、Wi-Fi はヘッダー（80pt）より下まで来る（開いた横で約 100pt）。帯が本文の色だと、時刻・Wi-Fi が
 *   ヘッダーからはみ出して見えた。帯をヘッダーとつながる白い列にすれば、その中に収まって見える。
 *   塗るのはネイティブの `SafeAreaView` の背景（余白の部分）＝JS の値を使わないので開閉で揺れない。中身は `background` の View で包む
 */
export function horizontalSafeAreaLayout({ route, children }: { route: { name: string }; children: ReactNode }): ReactElement {
  if (route.name === '(tabs)') return <>{children}</>;
  return <HorizontalSafeArea>{children}</HorizontalSafeArea>;
}

function HorizontalSafeArea({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.fill, { backgroundColor: theme.colors.surface }]}>
      <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
