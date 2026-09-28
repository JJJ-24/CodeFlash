import { getDefaultHeaderHeight } from '@react-navigation/elements';
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Platform } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * iPadOS 26 のウィンドウ表示（ステージマネージャ／ウィンドウ表示のアプリ）で、左上の
 * 赤黄青のウィンドウ操作ボタンを避けるために safe area の上端へ**足す**量。
 *
 * ⚠️ iOS はこのボタンのぶんを safe area に**含めない**（実機 iPad Pro 13" で実測：
 * フルスクリーン・最大化＝top 32／ウィンドウ表示＝top 10。ボタンの下端はウィンドウ上端から約 43pt）。
 * そのまま `10 + 50` で自前ヘッダーを組むと、左端の戻る/閉じるボタンがウィンドウ操作ボタンに重なる。
 * 当初は 22（10 + 22 = 32＝フルスクリーンと同じ値）だったが、戻る/閉じるボタンを押したつもりで
 * 赤黄青のボタンに触れて拡大されることがあったため 30 に広げた（ヘッダー行の中央が 65pt）。
 *
 * ⚠️ 底上げ（`max(top, 32)`）ではなく足し算にする：ウィンドウを画面の最上部へ寄せると
 * ウィンドウ内にステータスバーが出て top が 32 になり、ボタンもステータスバーの下へ同じだけ
 * 押し下げられる（iPadOS 27 で実測）。底上げだと 32 のままで重なる。
 */
const WINDOW_CONTROLS_EXTRA = 30;

/**
 * safe area の上端に、iPad のウィンドウ表示ならウィンドウ操作ボタンのぶんを足した値を返す。
 *
 * ウィンドウ表示の判定は「iPadOS 26 以上 **かつ** ウィンドウが画面より小さい」。
 * - 最大化したウィンドウは画面と同じ大きさでステータスバーも出る（top 32）＝ボタンはステータスバー側にあり補正不要
 * - 上端だけで判定しない：フルスクリーンでステータスバーを隠す（学習の全画面・WKWebView の後始末）と top が 0 になるうえ、
 *   最上部へ寄せたウィンドウは top が最大化と同じ 32 になる
 * - 大きさだけで判定しない：iPadOS 18 以前の Split View は画面より小さいがボタンが無い（26 で Split View は廃止）
 */
export function useWindowControlsTopInset() {
  return useWindowControls().top;
}

/** `useWindowControlsTopInset` の中身。`windowed` は `useLockedTopInset` が縮めてよいかの判定に使う。 */
function useWindowControls(): { top: number; windowed: boolean } {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  if (!(Platform as any).isPad) return { top: insets.top, windowed: false };
  const screen = Dimensions.get('screen');
  const smallerThanScreen = frame.width < screen.width - 1 || frame.height < screen.height - 1;
  const windowed = smallerThanScreen && parseInt(String(Platform.Version), 10) >= 26;
  const result = windowed ? insets.top + WINDOW_CONTROLS_EXTRA : insets.top;
  return { top: result, windowed };
}

/**
 * ウィンドウ表示で上端が下がったとき、ヘッダーを縮めるまでの待ち時間。
 * `useRestoreStatusBar` の多段復元（最後が 550ms）より長くして、WKWebView の後始末で
 * ステータスバーが一瞬隠れただけの落ち込みでは縮めない（戻ってきたらタイマーごと取り消す）。
 */
const WINDOWED_SHRINK_DELAY_MS = 800;

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
 *
 * **例外：iPad のウィンドウ表示では縮む**（`WINDOWED_SHRINK_DELAY_MS` 待ってから）。
 * ウィンドウを画面の最上部へ寄せるとステータスバーが出て上端が伸び、離すと消えて縮む。
 * 縮まないままだと、先に開いていた画面（ホーム）だけ高いまま残り、後から開いた画面
 * （カード一覧など）はその時点の値で作られるので、画面ごとにヘッダーの高さが食い違う。
 * ウィンドウ表示ではステータスバーが消えれば赤黄青のボタンも上へ戻るので、縮めた位置でも重ならない。
 */
export function useLockedTopInset() {
  const { top: rawTop, windowed } = useWindowControls();
  const [top, setTop] = useState(rawTop);
  useEffect(() => {
    if (rawTop > top) {
      setTop(rawTop);
      return;
    }
    if (rawTop < top && windowed) {
      const timer = setTimeout(() => setTop(rawTop), WINDOWED_SHRINK_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [rawTop, top, windowed]);
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
