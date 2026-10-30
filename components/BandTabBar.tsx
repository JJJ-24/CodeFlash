import { BottomTabBar, type BottomTabBarProps } from 'expo-router/js-tabs';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** 帯の中のボタン1つの大きさ（Safari の閉じた状態のボタンと同じ約 48pt） */
const BUTTON_SIZE = 48;
/** カプセルの下端と画面の下端のあいだ（Safari の＋・タブ一覧のカプセルと同じ約 32pt） */
const BOTTOM_GAP = 32;
const ICON_SIZE = 24;

/**
 * タブバー（`Tabs` の `tabBar`）。iPhone Duo の閉じた状態と開いた横向きでは、右の帯（safe area の外）の中に
 * タブのボタンを縦に並べ、それ以外は標準のタブバーをそのまま出す。
 *
 * 閉じた状態（466×678pt）は右に 84pt の帯が報告され、本文はその手前で止まる＝帯の下半分が空いて見えていた。
 * Safari は同じ状態で、下のツールバーのボタンを帯の中へ移している（上＝戻る・ブックマーク、下＝＋・タブ一覧のカプセル）。
 * それに合わせ、タブの4つを1つのカプセルにまとめて帯の下寄せに置く（時刻・Wi-Fi は帯の上部＝y 約 75〜150pt なので重ならない）。
 * 本文の幅は 382pt のまま、下のタブバーのぶん縦が広がる。
 *
 * - 判定は「iPad ではない・左右どちらかに safe area がある」。開いた横向き（951×669pt）も右 84pt が報告される
 *   （ステータスバーは上の行の右端にあり、帯の下は空いている）ので同じく帯に置く。
 *   ⚠️ 閉じた状態だけにしない：閉じる ⇄ 開いた横向きの開閉のたびにタブバーが切り替わり、JS の判定が1〜2コマ遅れるぶん
 *   中身の高さが後から約 50pt 変わって＋ボタンやデッキの行がはっきり動いた（アニメーションを付けても目立った）。
 *   両方とも帯なら開閉でタブバーが切り替わらず、中身の大きさはネイティブが同じコマで決める。
 *   切り替えが残るのは開いた縦向き（上 82pt・左右 0＝下のタブバー）との回転・開閉だけ。
 * - アイコンだけ（帯で使える幅は約 60pt＝ラベルは言語によって入らない。Safari も帯のボタンはアイコンだけ）。
 *   今のタブはアイコンの色と丸い背景で示す。読み上げ機能向けのラベルは標準のタブバーと同じ形で付ける。
 * - 下のタブバーとの切り替え（開いた縦向きとの回転・開閉）は、safe area が新しい画面の大きさより約 0.07 秒遅れて
 *   JS に届くので、その時点で中身の高さが約 50pt 変わり、右下の＋ボタンが一度だけ移る（一瞬なので目立たない）。
 *   ⚠️ `LayoutAnimation` で滑らかにしない（2026-10-30 に外した）：`configureNext` はタブバーだけでなく**その描画の
 *   レイアウトの変化すべて**にかかるので、帯が出て本文が 84pt 狭くなるのに合わせて、並べ替えボタンなど右寄せの部品まで
 *   0.22 秒かけて滑っていた（閉じたときに目立ち、開くときは iOS の演出に紛れていた）。外すと一瞬で切り替わり動いて見えない。
 *   ⚠️ 中身の大きさを変えない形（下のタブバーも重ねて、そのぶんの余白を常にネイティブで空ける）は試して不採用：
 *   動きは止まるが、帯のときも下に約 50pt の空きが残り、＋ボタンが高い位置に浮いて、一覧がその手前で切れた。
 */
export function renderTabBar(props: BottomTabBarProps): ReactNode {
  return <AdaptiveTabBar {...props} />;
}

function AdaptiveTabBar(props: BottomTabBarProps) {
  const { left, right } = props.insets;
  const side = (Platform as any).isPad ? null : right > 0 ? 'right' : left > 0 ? 'left' : null;
  if (!side) return <BottomTabBar {...props} />;
  return <BandTabBar {...props} side={side} bandWidth={side === 'right' ? right : left} />;
}

function BandTabBar({ state, descriptors, emitter, navigateToTab, insets, side, bandWidth }: BottomTabBarProps & { side: 'left' | 'right'; bandWidth: number }) {
  const theme = useTheme();
  const { routes } = state;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.band, { width: bandWidth, [side]: 0, paddingBottom: Math.max(insets.bottom, BOTTOM_GAP) }]}
    >
      <View role="tablist" style={[styles.capsule, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        {routes.map((route, index) => {
          const focused = index === state.index;
          const { options } = descriptors[route.key];
          const color = focused ? theme.colors.primary : theme.colors.textTertiary;
          const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;
          const onPress = () => {
            const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigateToTab(route.key);
          };
          const onLongPress = () => emitter.emit({ type: 'tabLongPress', target: route.key });
          return (
            <Pressable
              key={route.key}
              role="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label}, tab, ${index + 1} of ${routes.length}`}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({ pressed }) => [
                styles.button,
                focused && { backgroundColor: theme.colors.primary + '20' },
                pressed && { opacity: 0.6 },
              ]}
            >
              {options.tabBarIcon?.({ focused, color, size: ICON_SIZE })}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  // 画面の上に重ねる（本文は帯の手前で止まっているので何も隠さない）。帯の外のタッチは下へ通す
  band: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-end' },
  capsule: {
    width: BUTTON_SIZE + 8,
    padding: 4,
    gap: 4,
    borderRadius: (BUTTON_SIZE + 8) / 2,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  button: { width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: BUTTON_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
});
