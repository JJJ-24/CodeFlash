import { getDefaultHeaderHeight } from '@react-navigation/elements';
import { useEffect, useMemo, useState } from 'react';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * カスタムヘッダーの高さ計算に使う「上端 safe area（ステータスバー）」を返す。
 *
 * 単純な `useRef(insets.top)` だと、遷移アニメーション中など insets.top が未解決
 * （0 や過小値）のタイミングでマウントすると、その過小値を恒久的に掴んでしまい
 * ヘッダーが縮んだままになる（iPad で顕著）。
 *
 * 逆に `insets.top` をそのまま使う（reactive）と、WKWebView のネイティブクリーンアップや
 * ステータスバー非表示で insets.top が一時的に 0 へ落ちるたびにヘッダーが縮む＝ちらつく。
 *
 * このフックは「これまで観測した最大の insets.top」を保持し、**縮まない・上方向にだけ自己修復する**。
 * - マウント時に過小値を掴んでも、正しい値が来たら伸びる（タブヘッダーと高さが揃う）
 * - 学習セッションのフルスクリーン等でステータスバーを隠して insets.top=0 になっても縮まない
 *   （＝従来 `useRef` でロックしていた「ヘッダー高さを変えない」意図もそのまま満たす）
 */
export function useLockedTopInset() {
  const insets = useSafeAreaInsets();
  const [top, setTop] = useState(insets.top);
  useEffect(() => {
    if (insets.top > top) setTop(insets.top);
  }, [insets.top, top]);
  return top;
}

/**
 * カスタムヘッダーの高さを React Navigation の標準ヘッダーと同じ算出で返す共通フック。
 *
 * `lockedTopInset + 44` の直書きは Dynamic Island 搭載 iPhone でズレる：
 * `getDefaultHeaderHeight` は inset > 50 のとき「ステータスバー高 = inset − 5.33」の
 * 補正を行うため、標準ヘッダー（タブ）とホームは inset+38.67、直書き画面は inset+44 と
 * 約5.3pt 高くなっていた（iPad も標準はコンテンツ行 50 で直書き 44 と 6pt ズレ）。
 *
 * - `total`: ヘッダー全体の高さ（ステータスバー込み）。外側 View の height に使う
 * - `content`: コンテンツ行の高さ（total − inset）。下端寄せの内側行の height に使う
 *
 * ホームのタブヘッダー合わせ（旧 computeHeaderHeights）と push 画面の自前ヘッダーの両方が
 * このフックを使うことで、全画面のヘッダー高さ・タイトル位置が一致する。
 */
export function useLockedHeaderHeights() {
  const lockedTopInset = useLockedTopInset();
  const frame = useSafeAreaFrame();
  return useMemo(() => {
    const total = getDefaultHeaderHeight(frame, false, lockedTopInset);
    return { total, content: total - lockedTopInset };
  }, [frame, lockedTopInset]);
}
