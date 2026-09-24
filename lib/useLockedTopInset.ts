import { getDefaultHeaderHeight } from '@react-navigation/elements';
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Platform } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * iPadOS 26 のウィンドウ表示（ステージマネージャ／ウィンドウ表示のアプリ）で、左上の
 * 赤黄青のウィンドウ操作ボタンを避けるための上端の最小値。
 *
 * ⚠️ iOS はこのボタンのぶんを safe area に**含めない**（実機 iPad Pro 13" で実測：
 * フルスクリーン・最大化＝top 32／ウィンドウ表示＝top 10。ボタンの下端はウィンドウ上端から約 43pt）。
 * そのまま `10 + 50` で自前ヘッダーを組むと、左端の戻る/閉じるボタンがウィンドウ操作ボタンに重なる。
 * 32 はフルスクリーンと同じ値＝ヘッダー行（50）の中央が 57pt でボタンの下端を越える。
 */
const WINDOW_CONTROLS_TOP_INSET = 32;

/**
 * safe area の上端に、iPad のウィンドウ表示ならウィンドウ操作ボタンのぶんを足した値を返す。
 *
 * ウィンドウ表示の判定は「ウィンドウが画面より小さい **かつ** 上端が 20 未満」。
 * - 最大化したウィンドウは画面と同じ大きさでステータスバーも出る（top 32）＝ボタンはステータスバー側にあり補正不要
 * - 上端だけで判定しない：フルスクリーンでステータスバーを隠す（学習の全画面・WKWebView の後始末）と top が 0 になる
 * - 大きさだけで判定しない：iPadOS 18 以前の Split View は画面より小さいがボタンが無く、top はステータスバーの 24
 */
export function useWindowControlsTopInset() {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  if (!(Platform as any).isPad) return insets.top;
  const screen = Dimensions.get('screen');
  const smallerThanScreen = frame.width < screen.width - 1 || frame.height < screen.height - 1;
  const windowed = smallerThanScreen && insets.top < 20;
  return windowed ? Math.max(insets.top, WINDOW_CONTROLS_TOP_INSET) : insets.top;
}

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
  const rawTop = useWindowControlsTopInset();
  const [top, setTop] = useState(rawTop);
  useEffect(() => {
    if (rawTop > top) setTop(rawTop);
  }, [rawTop, top]);
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
