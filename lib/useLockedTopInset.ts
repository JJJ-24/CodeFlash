import { getDefaultHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Platform } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsiveSize } from '@/lib/useResponsiveSize';

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
 * 画面の大きさが変わった（回転・iPhone Duo の開閉）あと、上端の値に**下方向にも**追従する時間。
 * safe area と画面の大きさは同じレンダーで届くとは限らない（Duo の実測：上端が先・大きさが後のことも、その逆もある）ので、
 * 変わった瞬間だけでなく少しのあいだ追従させる。WKWebView の後始末の落ち込みは画面の大きさが変わらないので、この窓には入らない。
 */
const FRAME_CHANGE_FOLLOW_MS = 1000;

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
 * **例外1：画面の大きさが変わったら保持をやり直す**（`FRAME_CHANGE_FOLLOW_MS` のあいだは下方向にも追従）。
 * iPhone Duo は開いた状態で回転でき（iPhone の向きの固定が効かない）、開閉でも上端が変わる
 * （実測：開いた縦＝82／開いた横・閉じた状態＝0）。保持したままだと、開いた縦で見た 82 を閉じた後も持ち続け、
 * ヘッダーが伸びたまま戻らなかった。
 *
 * **例外2：iPad のウィンドウ表示では縮む**（`WINDOWED_SHRINK_DELAY_MS` 待ってから）。
 * ウィンドウを画面の最上部へ寄せるとステータスバーが出て上端が伸び、離すと消えて縮む。
 * 縮まないままだと、先に開いていた画面（ホーム）だけ高いまま残り、後から開いた画面
 * （カード一覧など）はその時点の値で作られるので、画面ごとにヘッダーの高さが食い違う。
 * ウィンドウ表示ではステータスバーが消えれば赤黄青のボタンも上へ戻るので、縮めた位置でも重ならない。
 */
export function useLockedTopInset() {
  const { top: rawTop, windowed } = useWindowControls();
  const { width, height } = useSafeAreaFrame();
  const [top, setTop] = useState(rawTop);
  // 画面の大きさが変わったら `FRAME_CHANGE_FOLLOW_MS` のあいだ「追従中」にし、その間は上端の値を**このレンダーで**そのまま返す。
  // effect で state を更新してから返すと描き直し1回ぶん遅れ、回転した直後にヘッダーが一瞬前の高さで出た。
  // 大きさの変化はレンダー中に検出する（前回の大きさを state に持つ＝React の「前回のレンダーの情報を保存する」形。ref だと lint に掛かる）。
  const [size, setSize] = useState({ width, height });
  const [following, setFollowing] = useState(false);
  if (size.width !== width || size.height !== height) {
    setSize({ width, height });
    setFollowing(true);
  }
  useEffect(() => {
    if (!following) return;
    // 大きさが続けて変わったら（回転の途中など）張り直す
    const timer = setTimeout(() => setFollowing(false), FRAME_CHANGE_FOLLOW_MS);
    return () => clearTimeout(timer);
  }, [following, width, height]);
  useEffect(() => {
    if (rawTop > top) {
      setTop(rawTop);
      return;
    }
    if (rawTop < top && following) {
      setTop(rawTop);
      return;
    }
    if (rawTop < top && windowed) {
      const timer = setTimeout(() => setTop(rawTop), WINDOWED_SHRINK_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [rawTop, top, windowed, following]);
  // 追従が終わる時点では上の effect で top が rawTop にそろっているので、切り替わりで値は跳ねない
  return following ? rawTop : top;
}

/**
 * 左右の safe area。iPhone Duo の閉じた状態・開いた横向きでは、カメラとステータスバーの帯のぶん
 * **右 84pt** が報告される（閉じた状態はステータスバーが上端ではなく右上へ縦に移る＝上は 0）。
 * 今までの iPhone（縦固定）と iPad では 0 なので、これを使う箇所は Duo 以外では何も変わらない。
 *
 * 避け方の規約（060 Phase 4）：
 * - **本文**は画面の根元で余白を付ける＝Stack の画面は `app/_layout.tsx` の `contentStyle`、
 *   タブの4画面は各画面の根元の View（`(tabs)` には付けない＝標準ヘッダーとタブバーは自分で避けるので二重になる）
 * - **自前ヘッダー**は背景を端まで伸ばし（`useLockedHeaderHeights().bleed`）、中のボタン行だけ内側に置く（`.row`）
 *   ＝帯の下にヘッダーの色が届かず、右上だけ本文の色の切れ目が出るのを防ぐ
 */
export function useHorizontalInsets() {
  const { left, right } = useSafeAreaInsets();
  return useMemo(() => ({ left, right }), [left, right]);
}

/**
 * 自前ヘッダーの左右：外側の View に `bleed`（根元の余白を打ち消して背景を端まで伸ばす）、
 * 中の `position: 'absolute'` の行に `row`（`left: 0, right: 0` の代わり）を当てる。
 */
/** 自前ヘッダーの行の左右の余白（各ヘッダーの `paddingHorizontal: 8` と同じ値） */
const HEADER_ROW_PADDING = 8;

export function useHeaderHorizontal() {
  const { left, right } = useHorizontalInsets();
  const corner = useHeaderCornerInset();
  return useMemo(() => ({
    bleed: { marginLeft: -left, marginRight: -right },
    // 角の余白は行の位置ではなく行の内側の余白として足す：ボタンは余白の内側に並び、
    // 行いっぱいに広げた中央のタイトル（`position: 'absolute', left: 0, right: 0`）は余白を無視して
    // safe area の中央に来る＝標準ヘッダー（タブ）のタイトルと同じ位置。行の位置に足すと、
    // 左だけ角の余白があるとき（Duo の開いた横）にタイトルがその半分だけ右へずれた。
    // ⚠️ `paddingLeft`/`paddingRight` は各ヘッダーの `paddingHorizontal: 8` より優先される（辺ごとの指定が勝つ）ので、
    // ここで 8 を含めて返す（`HEADER_ROW_PADDING`）。
    row: {
      left,
      right,
      paddingLeft: HEADER_ROW_PADDING + (left > 0 ? 0 : corner),
      paddingRight: HEADER_ROW_PADDING + (right > 0 ? 0 : corner),
    },
  }), [left, right, corner]);
}

/**
 * ヘッダーの行が画面の角の丸みに接するときに、左右へ足す余白。
 *
 * 上端の safe area が 0 になるのは iPhone Duo の閉じた状態・開いた横向き（ステータスバーが右上の帯へ移る）で、
 * ヘッダーの行が画面のいちばん上＝角の丸みの中に置かれ、左上の検索・戻るボタンが窮屈に見えた。
 * 今までの iPhone・iPad は上にステータスバーがあり、行は角より下に来るので 0（何も変わらない）。
 * ⚠️ その側に左右の safe area があるとき（Duo の右の帯）は safe area のほうで避けるので足さない。
 * ⚠️ 判定は縮まない上端（`useLockedTopInset`）で行う＝学習の全画面などでステータスバーを隠しても余白は動かない。
 */
export function useHeaderCornerInset(): number {
  const top = useLockedTopInset();
  const rs = useResponsiveSize();
  // 窓の幅で補間する：閉じた状態（幅 466pt）≒ 6pt・開いた横向き（951pt）＝ 24pt（実機の見た目で決めた値。10/27）
  return top === 0 ? rs(4, 24) : 0;
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
 * - `bleed` / `row`: 左右の safe area の扱い（`useHeaderHorizontal`）
 *
 * ⚠️ タブの標準ヘッダー（学習/統計/設定）にも `total` を `headerStyle.height` で渡している（`app/(tabs)/_layout.tsx`）。
 * 標準ヘッダーは別経路の画面サイズで高さを計算するので、渡さないと iPhone Duo を開いた横向きでホーム（32pt）と食い違った。
 *
 * ホームのタブヘッダー合わせ（旧 computeHeaderHeights）と push 画面の自前ヘッダーの両方が
 * このフックを使うことで、全画面のヘッダー高さ・タイトル位置が一致する。
 */
export function useLockedHeaderHeights() {
  const lockedTopInset = useLockedTopInset();
  const frame = useSafeAreaFrame();
  const { bleed, row } = useHeaderHorizontal();
  return useMemo(() => {
    // ⚠️ iPhone の横向きは縦と同じ高さで計算する。`getDefaultHeaderHeight` は iPhone の横向きに
    // 細いバー（32pt）を返すが、このアプリは iPhone を縦に固定しているので、横向きになるのは
    // iPhone Duo を開いたときだけ＝iPad 並みの広い画面で 32pt は窮屈すぎる（060 Phase 4）。
    const layout = !(Platform as any).isPad && frame.width > frame.height
      ? { width: frame.height, height: frame.width }
      : frame;
    const total = getDefaultHeaderHeight(layout, false, lockedTopInset);
    return { total, content: total - lockedTopInset, bleed, row };
  }, [frame, lockedTopInset, bleed, row]);
}
