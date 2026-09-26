import { useMemo } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { FONT_SCALE, useThemeStore } from '@/store/theme';
import { useSettingsStore } from '@/store/settings';
import { useProStore } from '@/store/pro';
import { CARD_THEMES, FREE_CARD_THEMES, type CardThemePalette, type CardThemeName } from '@/lib/theme/cardThemes';
import { useResponsiveSize } from '@/lib/useResponsiveSize';

const isPad = (Platform as any).isPad;

/**
 * デバイス種別ごとの maxFontSizeMultiplier 定数。
 * - ui:      ヘッダー・ボタン・一般テキスト（幅が限られる箇所）
 * - content: リスト項目名・統計数字等（縦スクロールで高さが伸びるため大きめ許容）
 * - label:   凡例ラベル等（幅制約があるため iPhone では ui と同値）
 */
export const MAX_FONT_MULTIPLIER = {
  ui:      isPad ? 1.8 : 1.3,
  label:   isPad ? 2.3 : 1.4,
  content: isPad ? 2.5 : 1.5,
} as const;

/**
 * 窓幅に追従する `MAX_FONT_MULTIPLIER`。
 *
 * 上の定数は `isPad`＝**端末**で倍率を決めているため、iPad の Split View / Stage Manager で
 * 窓を iPhone 並みまで狭めても上限は 1.8/2.3/2.5 のまま残る。iOS の文字サイズを上げている端末では
 * その上限まで実際に拡大されるので、狭い窓では数字やラベルが行を圧迫する
 * （一覧行のカード数バッジが典型）。このフックは `useResponsiveSize` と同じ境界で
 * **iPhone 側の上限 ⇄ iPad 側の上限**を補間する＝iPhone は完全に不変・iPad も全機種
 * フルスクリーンは完全に不変で、狭めたときだけ上限が下がる。
 *
 * ⚠️ iOS の文字サイズが標準（倍率 1.0）のときは上限に当たらないので**見た目は変わらない**。
 *   標準設定でも縮めたいなら実サイズ（`theme.fontSize.*`）側を `rs()` で補間する別の話になる。
 * ⚠️ 定数版もそのまま残してある（`StyleSheet` の外・コンポーネント外からも参照されるため）。
 *   幅で潰れる行のテキストから順に、このフックへ移していけばよい。
 */
export function useMaxFontMultiplier(): { ui: number; label: number; content: number } {
  const rs = useResponsiveSize();
  return useMemo(() => ({
    ui:      rs(1.3, 1.8),
    label:   rs(1.4, 2.3),
    content: rs(1.5, 2.5),
  }), [rs]);
}

export interface AppColors {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  inputBorder: string;
  buttonBorder: string;
  primary: string;
  primaryText: string;
  primaryLight: string;
  danger: string;
  icon: string;
  iconSubtle: string;
  /** スイッチ（`components/AppSwitch.tsx`）のオフのトラック色。⚠️ 未指定だと iOS 既定
   *  （ライト ≈ #E9E9EA）になり、白いカードの上でオフがほとんど見えない。 */
  switchTrackOff: string;
  progressBg: string;
  codeBackground: string;
  memoBackground: string;
}

export interface AppFontSize {
  xs: number;    // 12 — バーチャートラベル等の極小テキスト
  sm: number;    // 14 — サブラベル・説明文
  md: number;    // 16 — 本文・デッキ名等
  lg: number;    // 18 — セクションタイトル・モーダルタイトル
  xl: number;    // 20 — 大見出し
  xxl: number;   // 22 — 統計数値
  xxxl: number;  // 28 — フィルターブロック大数値
}

const BASE_FONT_SIZE: AppFontSize = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, xxl: 22, xxxl: 28 };

export interface AppTheme {
  dark: boolean;
  colors: AppColors;
  fontScale: number;
  fontSize: AppFontSize;
  /** 学習画面のカードテーマ（028-2）。学習画面以外では参照しない */
  cardTheme: CardThemePalette;
  /** カードテーマで色付けする前の素の画面背景。カードテーマの色付けを無視したい
   *  箇所（学習画面の背景＝カードを浮き立たせたい等）で使う。 */
  baseBackground: string;
  /** カードテーマの色付けを無視した素のカード面色（無彩色）。ダーク＋非デフォルトテーマでは
   *  colors.surface を濃い黒に振り替えるため、学習画面など現状維持したい箇所はこちらを使う。 */
  baseSurface: string;
}

export const lightTheme: Omit<AppTheme, 'fontScale' | 'fontSize' | 'cardTheme' | 'baseBackground' | 'baseSurface'> = {
  dark: false,
  colors: {
    background: '#F5F5F5',
    surface: '#FFFFFF',
    text: '#212121',
    textSecondary: '#757575',
    textTertiary: '#9E9E9E',
    border: '#F0F0F0',
    inputBorder: '#E0E0E0',
    buttonBorder: '#D8D8D8',
    primary: '#1976D2',
    primaryText: '#FFFFFF',
    primaryLight: '#E3F2FD',
    danger: '#E53935',
    icon: '#666666',
    iconSubtle: '#BDBDBD',
    switchTrackOff: '#BDBDBD',
    progressBg: '#E0E0E0',
    codeBackground: '#2A2A2A',
    memoBackground: '#EFEFEF',
  },
};

export const darkTheme: Omit<AppTheme, 'fontScale' | 'fontSize' | 'cardTheme' | 'baseBackground' | 'baseSurface'> = {
  dark: true,
  colors: {
    background: '#121212',
    surface: '#1E1E1E',
    text: '#E0E0E0',
    textSecondary: '#AAAAAA',
    textTertiary: '#757575',
    border: '#2C2C2C',
    inputBorder: '#3A3A3A',
    buttonBorder: '#2C2C2C',
    primary: '#1976D2',
    primaryText: '#FFFFFF',
    primaryLight: 'rgba(25, 118, 210, 0.15)',
    danger: '#E53935',
    icon: '#9E9E9E',
    iconSubtle: '#555555',
    switchTrackOff: '#3A3A3C',
    progressBg: '#333333',
    codeBackground: '#2A2A2A',
    memoBackground: '#383838',
  },
};

/**
 * コード関係のコピーボタンが「コピーできた」あいだ（約1秒）の見た目（出力欄・ソース欄・コード入力欄・
 * SQL 初期化/HTML 土台の欄・全画面プレビューのログ）＝**不透明の濃い緑の箱＋白いチェック**。
 * 押す前は控えめなグレーのまま＝押した瞬間だけ目立たせる。
 * ⚠️ 半透明の緑の下地＋緑のチェックは分かりにくかった。不透明にするなら下地とチェックの色は分ける
 *   （同じ緑だとチェックが消える）。下地は明るい緑 #3FB950 ではなく一段濃い #238636＝白との差を取る。
 */
export const COPY_DONE_COLOR = '#FFFFFF';
export const COPY_DONE_BG = '#238636';

export const FILTER_COLORS = {
  learned: '#4CAF50',
  due: '#F57C00',
} as const;

/** 統計「学習履歴」（草グラフ）の色。`ActivityHeatmap` と `InfoContent` の `{{heatscale}}` が共用する。 */
export const HEATMAP_COLORS = {
  /** 学習量の4段階（薄→濃）。3段目は FILTER_COLORS.learned と同じ緑 */
  scale: ['#C8E6C9', '#A5D6A7', '#4CAF50', '#2E7D32'],
  /** 目標達成（046 Phase 7）＝学習タブの旗・「学習の記録」の達成日数と同じ緑 */
  goalReached: '#43A047',
  /** 学習したが目標に届かなかった日＝学習量の最も薄い段と同じ（「薄い＝足りない」の読みを揃える） */
  goalMissed: '#C8E6C9',
} as const;

// テキストハイライトの背景色（3色）。カードテーマ（paper/sky/rose…）の上に乗るため半透明にして
// 下地に色を混ぜ、全テーマで「マーカーでなぞった」見た目を保つ。文字色は変えない（描画側で Text の
// color を指定せず親から継承させる）。ライトは文字が濃いのでアルファ高め、ダークは明るい文字を潰さ
// ないようアルファ低め。キー: y=黄（デフォルト・==…==）/ g=緑（==g|…==）/ p=ピンク（==p|…==）。
export type HighlightColorKey = 'y' | 'g' | 'p';
export const HIGHLIGHT_COLORS: Record<'light' | 'dark', Record<HighlightColorKey, string>> = {
  light: {
    y: 'rgba(255, 196, 0, 0.45)',
    g: 'rgba(76, 200, 120, 0.42)',
    p: 'rgba(244, 143, 177, 0.48)',
  },
  dark: {
    y: 'rgba(255, 196, 0, 0.28)',
    g: 'rgba(76, 200, 120, 0.30)',
    p: 'rgba(244, 143, 177, 0.32)',
  },
} as const;

// タグ・デッキ共通のカラーパレット（唯一の定義元）。
// タグ作成/編集画面・TSVインポート時のタグ色割り当て・デッキカラーがすべてこれを参照する。
export const TAG_PRESET_COLORS = [
  '#E53935', '#fd9023', '#F6BF26', '#33B679',
  '#0B8043', '#039BE5', '#0e4cdd', '#7986CB',
  '#8E24AA', '#828080', '#795548', '#F48FB1',
] as const;

// デッキのカラーテーマ（028-1）。タグと同じパレットを採用。
export const DECK_PRESET_COLORS = TAG_PRESET_COLORS;

// アプリのプライマリーカラー。デッキ・タグの色ピッカー先頭＆新規作成時の既定色。
// light/dark とも同値（lightTheme/darkTheme の primary と一致）。
export const PRIMARY_COLOR = '#1976D2';

/** hex 色を factor 倍（0–1）に暗くする（各 RGB チャンネルを乗算）。primary 由来の濃色を作る用途。 */
export function darkenHex(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  const ch = (i: number) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * factor)));
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(ch(0))}${to2(ch(2))}${to2(ch(4))}`;
}

/**
 * コードブロックのフォーカス/選択・編集中・実行中のヘッダー色。いずれも対応するボーダー色
 * （フォーカス=primary / 編集=grade hard / 実行=grade good）を 60% に暗くした濃色で統一する。
 * ボーダー色より暗いのでヘッダー上のボタンの形が浮き上がり、3状態が同じ濃さの一対として揃う。
 * 各ベース色由来なので将来ベース色を変えても連動する。
 */
// 注: 暖色（オレンジ）は同じ係数でも知覚的に明るく見えるため、編集だけ係数を 0.4 に下げて
// 青(≈0.06)とほぼ同じ落ち着いた知覚輝度（≈0.055）に揃える（ダークモードでも浮かない）。青/緑は 0.6。
export const CODE_FOCUS_HEADER = darkenHex(PRIMARY_COLOR, 0.6); // ≈ #0F477E（青）
export const CODE_EDITING_HEADER = darkenHex('#FB8C00', 0.4); // ≈ #643800（アンバー・grade hard 由来）
export const CODE_RUNNING_HEADER = darkenHex('#43A047', 0.6); // ≈ #28602B（緑・grade good 由来）

// ライトモード用のヘッダー色（028-2 のカードテーマ対策）。ダーク（上の定数）は枠線がはっきり
// 見えるため現状維持。ライトはカードテーマ（スカイ=濃紺・ペーパー/セピア=茶系のコード背景）に
// 同系ヘッダーが埋もれて state（フォーカス/編集/実行）が目立たない問題があるため、state 色（青/
// アンバー/緑）を保ちつつ現状より明るくして明度で浮かせる。ヘッダー上のアイコンは theme.colors の
// グレー系（暗色前提）なので、可読性を保てる範囲＝中間調まで上げず暗色寄りに留める。要実機微調整。
export const CODE_FOCUS_HEADER_LIGHT = darkenHex(PRIMARY_COLOR, 0.85); // ≈ #1564B3（明るい青）
export const CODE_EDITING_HEADER_LIGHT = darkenHex('#FB8C00', 0.6); // ≈ #975400（明るいアンバー）
export const CODE_RUNNING_HEADER_LIGHT = darkenHex('#43A047', 0.85); // ≈ #39883C（明るい緑）

// フォーカス/編集/実行ヘッダー色を light/dark でまとめて引くルックアップ。各ブロック（コード/テキスト/
// 画像・学習/エディタ）が theme.dark で分岐して使う。dark は従来定数、light は上の明るめ版。
export const CODE_STATE_HEADERS = {
  light: { focus: CODE_FOCUS_HEADER_LIGHT, editing: CODE_EDITING_HEADER_LIGHT, running: CODE_RUNNING_HEADER_LIGHT },
  dark: { focus: CODE_FOCUS_HEADER, editing: CODE_EDITING_HEADER, running: CODE_RUNNING_HEADER },
} as const;

export const GRADE_COLORS = {
  again: '#E53935',
  hard:  '#FB8C00',
  good:  '#43A047',
  easy:  '#1976D2',
} as const;

export const SHADOW = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  subtle: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
} as const;

/** 数値の桁数に応じて統計ブロックの数字フォントサイズを返す（桁が増えるほど小さい）。
 *  基準は 1〜2桁 28 / 3桁 26 / 4桁 22 / 5桁以上 18 で、アプリ内フォントサイズ設定
 *  （small/medium/large＝`fontScale` 0.85/1.0/1.2）を掛けるだけ。
 *
 *  ⚠️ **上限・下限でクランプしない**（かつて `Math.min(28, Math.max(24, …))` のように挟んでいた）＝
 *  クランプすると小と大がほぼ同じ値に潰れ、**アプリの文字サイズ設定を変えても数字がほとんど変わらない**。
 *  収まりは呼び出し側（`useBlockMetrics.valueSize`）が**ブロックの内側の幅**でクランプして保証する。
 *
 *  ⚠️ **呼び出し側は `isPad ? 1 : 桁数` のような出し分けをしない**＝全機種・全窓幅で実際の桁数を渡す。
 *  かつて iPad だけ常に 1（＝最大サイズ）を渡していたが、Split View / Stage Manager で窓を狭めると
 *  ブロックだけ縮んで字が残り3桁が「1…」に切れた。逆に狭窓だけ幅で補間すると、同じ3桁でも
 *  上部フィルターブロックと評価ブロックで大きさが食い違う。桁数だけで決めるのが唯一揃う。
 *  ⚠️ **桁数は行内の全ブロックの `Math.max` で取る**（1つだけ小さい字になるのを防ぐ）。
 *
 *  各段は「内側の幅 71.8pt（窓375pt・左右余白4のとき）に収まること」を上限に決めてある
 *  （数字1文字の描画幅はおおよそフォントサイズ × 0.6）。 */
export function fontSizeForDigits(theme: AppTheme, digits: number, scale = 1): number {
  const base = digits >= 5 ? 18 : digits >= 4 ? 20 : digits >= 3 ? 22 : 24;
  return Math.round(base * theme.fontScale) * scale;
}

/** 東アジアの全角文字（かな・漢字・ハングル・全角記号）か。幅の見積もりを 1em にする対象。 */
const WIDE_CHAR = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** 文字列の描画幅を em で見積もる（全角＝1em／それ以外＝0.55em）。 */
function estimateEm(s: string): number {
  let em = 0;
  for (const ch of s) em += WIDE_CHAR.test(ch) ? 1 : 0.55;
  return em;
}

/**
 * フィルターブロックのラベル（数字の下の小さい文字）を**行内で1つの大きさに揃える**ためのサイズ。
 *
 * 素直に `adjustsFontSizeToFit` を付けると**そのブロックだけ**縮み、`Todo` は 14pt のまま
 * `Tarjetas` だけ 13pt、のように行内で大小が混ざる。数字は `fontSizeForDigits` の1つの値を
 * 全ブロックへ配って揃えているので、ラベルも同じ流儀にする（最長のラベルに全部を合わせる）。
 *
 * ⚠️ 呼び出し側は `allowFontScaling={false}` を付け、`adjustsFontSizeToFit` は外すこと。
 *   RN に拡大させると幅の見積もりが崩れて揃わなくなるので、**iOS の文字サイズ倍率は
 *   `fontScale` を受け取ってこちらで掛ける**（`allowFontScaling` に任せたときと同じ結果を、
 *   行内で1つの値にして出す）。⚠️ **この引数を省いて固定サイズにしないこと**＝iPad で
 *   最大 1.8 倍まで伸びていたラベルが xs 固定に落ち「急に小さくなった」になる（実際に踏んだ）。
 * ⚠️ `innerWidth` は**ブロック幅 − 左右パディング**を渡す。
 */
export function uniformLabelFontSize(
  theme: AppTheme,
  labels: string[],
  innerWidth: number,
  /** iOS の文字サイズ倍率（`useWindowDimensions().fontScale`） */
  fontScale: number,
  /** その倍率の上限（`useMaxFontMultiplier().ui`） */
  maxMultiplier: number,
  /** 窓幅による拡大（`rs(1, 1.4)`） */
  scale = 1,
): number {
  const maxEm = Math.max(...labels.map(estimateEm), 1);
  const base = theme.fontSize.xs * scale * Math.min(fontScale, maxMultiplier);
  return Math.min(base, innerWidth / maxEm);
}

/** フィルターブロック（4列）の1ブロック幅。コンテナ余白16・行 marginHorizontal:-2・
 *  各ブロック margin:2・gap:4 の構成から算出する（flex:1 で並べている画面も実幅は同じ）。 */
export function filterBlockWidth(windowWidth: number): number {
  return (windowWidth - 56) / 4;
}

/** モード切替ボタンの非選択枠やバッジの未達成丸枠など「テーマに追従させたい薄枠」の色を返す。
 *  カードテーマ選択時はテーマの枠線色（例: graphite=#9DA8BC）を使い、default（無彩色テーマ・
 *  枠線が surface と同色で埋もれる）のときだけ従来の buttonBorder を使う。
 *  グラファイト等のテーマ背景に buttonBorder(#D8D8D8) が溶け込んで見えにくい問題への対策。 */
export function themedFrameBorder(theme: AppTheme): string {
  return theme.cardTheme.background === theme.baseSurface ? theme.colors.buttonBorder : theme.cardTheme.border;
}

/** 学習タイマーの円（リング）色。カードテーマの色味に追従させる。
 *  - default（無彩色＝codeBackground がグレーで背景に埋もれる）: primary（青）
 *  - カードテーマ選択・ライト: テーマ濃色 codeBackground（明るいカード面で映える）
 *  - カードテーマ選択・ダーク: codeBackground は暗いカード面に埋もれるため、テーマ枠線色を
 *    明るく持ち上げた色（darkenHex は factor>1 で明色化）でリングを目立たせる。 */
export function themedAccentColor(theme: AppTheme): string {
  if (theme.cardTheme.background === theme.baseSurface) return theme.colors.primary;
  return theme.dark ? darkenHex(theme.cardTheme.border, 1.6) : theme.cardTheme.codeBackground;
}

export function useTheme(): AppTheme {
  const systemScheme = useColorScheme();
  const preference = useThemeStore((s) => s.preference);
  const fontSizePreference = useThemeStore((s) => s.fontSizePreference);
  const cardThemePreference = useSettingsStore((s) => s.cardThemePreference);
  const isPro = useProStore((s) => s.isPro);

  const base = preference === 'light' ? lightTheme : preference === 'dark' ? darkTheme : (systemScheme === 'dark' ? darkTheme : lightTheme);
  const scale = FONT_SCALE[fontSizePreference];
  // Pro 失効時は無料配色（default / paper）以外を選んでいたら default にフォールバック
  // （ユーザーの選好値は保持し、再 Pro 時に自動復元）。無料配色はそのまま有効。
  const effectiveCardTheme: CardThemeName =
    isPro || FREE_CARD_THEMES.includes(cardThemePreference) ? cardThemePreference : 'default';
  const cardPalette = CARD_THEMES[base.dark ? 'dark' : 'light'][effectiveCardTheme];
  // カードテーマ選択時、画面背景（カード間の隙間）をテーマ色でほんのり色付けする。
  // ヘッダー・タブバー・各カード面はすべて colors.surface を使うため無彩色のまま保たれ、
  // 「白いカード／カラーの隙間」になる。default のときは従来の無彩色背景を維持する
  // （default の cardPalette.background は surface と同色のため、隙間が消えてしまうのを防ぐ）。
  // **戻り値は必ずメモ化する**（毎回リテラルを返さない）。`useTheme()` はほぼ全コンポーネントが
  // 呼ぶため、参照が毎回変わると `useMemo(..., [theme])` と書いてある箇所がすべて空振りし、
  // スタイルオブジェクトが作り直され、それを props に渡している `React.memo` のコンポーネントの
  // memo も外れる。実害が出た例：学習画面のマークダウンは `style={markdownStyles}` が毎回
  // 別物になるため `Markdown`（React.memo）が毎レンダー再描画され、ライブラリが AST の key を
  // 振り直す＝subtree ごと再マウントされて、コードフェンスの横スクロール位置が失われていた
  // （タイマー作動中は毎秒発生）。入力（配色・文字サイズ・カードテーマ）はすべて安定した
  // 参照かプリミティブなので、それだけを依存に取れば値は変わらないまま参照が固定される。
  return useMemo(() => {
    const colors =
      effectiveCardTheme === 'default'
        ? base.colors
        : base.dark
          // ダーク＋非デフォルト：隙間（background）をテーマ色にし、カード面（surface）は
          // 素の濃い黒（デフォルトの background）に振り替えて、テーマ色の隙間にカードを沈ませる。
          ? { ...base.colors, background: cardPalette.background, surface: base.colors.background }
          // ライト：従来どおり隙間だけテーマ色付け（カードは白のまま）
          : { ...base.colors, background: cardPalette.background };
    return {
      ...base,
      colors,
      fontScale: scale,
      fontSize: {
        xs:  Math.round(BASE_FONT_SIZE.xs  * scale),
        sm:  Math.round(BASE_FONT_SIZE.sm  * scale),
        md:  Math.round(BASE_FONT_SIZE.md  * scale),
        lg:  Math.round(BASE_FONT_SIZE.lg  * scale),
        xl:   Math.round(BASE_FONT_SIZE.xl   * scale),
        xxl:  Math.round(BASE_FONT_SIZE.xxl  * scale),
        xxxl: Math.round(BASE_FONT_SIZE.xxxl * scale),
      },
      cardTheme: cardPalette,
      baseBackground: base.colors.background,
      baseSurface: base.colors.surface,
    };
  }, [base, scale, effectiveCardTheme, cardPalette]);
}
