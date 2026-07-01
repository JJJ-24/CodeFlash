import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
