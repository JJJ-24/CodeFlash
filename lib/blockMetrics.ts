import { useWindowDimensions } from 'react-native';

import {
  filterBlockWidth,
  fontSizeForDigits,
  uniformLabelFontSize,
  useMaxFontMultiplier,
  useTheme,
} from '@/lib/theme';
import { useResponsiveSize } from '@/lib/useResponsiveSize';

/** 窓幅いっぱいのとき（iPad の広い窓）の文字の拡大率。**現在は 1.0 ＝拡大しない**
 *  ＝iPad も iPhone と同じ大きさで描く。
 *
 *  経緯：フル幅の iPad はブロックの内側が 162pt あって数字が小さく見えるため 1.4 → 1.2 と
 *  試したが、いずれも「中・小で大きすぎる」となり 1.0 に落ち着いた。大きさの調整は
 *  **`fontSizeForDigits` の基準値**（`lib/theme`）とアプリ/iOS の文字サイズ設定で行う。
 *  ⚠️ ここを 1 以外に戻すときは、**上部フィルターブロックと評価ブロックの両方に同じ倍率が
 *  掛かること**を確認する（片方だけだと同じ3桁でも画面内で大きさが食い違う＝実際に踏んだ）。
 *  仕組みは残してあるので、値を変えるだけで窓幅追従が復活する。 */
const WIDE_TYPE_SCALE = 1.0;

/** 数字1文字のおおよその描画幅（フォントサイズに対する比）。収まり判定に使う。 */
const DIGIT_EM = 0.6;

/**
 * フィルターブロック（数字＋ラベル）の寸法をまとめて返す共通フック。
 *
 * 7画面（ホーム/学習/統計/カード一覧/タグ管理/タグ別カード一覧/アーカイブ）が同じ規則で描くため、
 * 幅・余白・文字サイズ・最小高さの算出をここに集約する（以前は各画面に同じ式が複製されていた）。
 *
 * 規則:
 * - **数字もラベルも「行内で1つの大きさ」**＝数字は最大桁数、ラベルは最長のものに全部を合わせる
 *   （`adjustsFontSizeToFit` は使わない＝そのブロックだけ縮んで大小が混ざる）。
 * - **窓幅に追従**＝余白は 4〜16、文字は 1.0〜1.4 倍。iPhone と iPad の狭い窓では同じ寸法になり、
 *   広げるほど大きくなる。
 * - iOS の文字サイズ（Dynamic Type）は `labelSize` の中で掛ける（数字は絶対サイズのまま）。
 */
export function useBlockMetrics() {
  const theme = useTheme();
  const rs = useResponsiveSize();
  const maxFont = useMaxFontMultiplier();
  const { width, fontScale } = useWindowDimensions();

  const scale = rs(1, WIDE_TYPE_SCALE);
  const padH = rs(4, 16);
  const blockWidth = filterBlockWidth(width);
  const innerWidth = blockWidth - padH * 2;

  return {
    /** ブロック1つの幅（`width` を明示する画面用。flex:1 の画面は指定不要） */
    blockWidth,
    /** 左右のパディング（インラインで当てる。StyleSheet 側は paddingVertical だけ持つ） */
    padH,
    /** 窓幅による拡大率（評価ブロックなど、この関数の外で数字を出す箇所にも掛ける） */
    scale,
    /**
     * 数字のサイズ。⚠️ 桁数は**行内の最大**を渡す（1つだけ小さい字にしない）。
     *
     * ⚠️ **iOS の文字サイズ（Dynamic Type）も掛ける**＝掛けないと「iOS の文字サイズを変えても
     * 数字が変わらない」になる（`allowFontScaling={false}` なので RN 側は一切拡大しない）。
     * 上限は `useMaxFontMultiplier().ui`。伸びすぎは**内側の幅**でクランプして収まりを保証する。
     */
    valueSize: (maxDigits: number) => {
      const raw = fontSizeForDigits(theme, maxDigits, scale * Math.min(fontScale, maxFont.ui));
      return Math.min(raw, innerWidth / (Math.max(maxDigits, 1) * DIGIT_EM));
    },
    /** ラベルのサイズ。⚠️ **行内の全ラベル**を渡す（最長に合わせて1つに決まる） */
    labelSize: (labels: string[]) =>
      uniformLabelFontSize(theme, labels, innerWidth, fontScale, maxFont.ui, scale),
    /** ブロックの最小高さ。数字は**1桁時**で見積もる＝フィルター切替で桁数が変わっても高さがブレない。 */
    minHeightFor: (labelFontSize: number) =>
      32
      + Math.ceil(fontSizeForDigits(theme, 1, scale * Math.min(fontScale, maxFont.ui)) * 1.35)
      + 2
      + Math.ceil(labelFontSize * 1.35),
  };
}
