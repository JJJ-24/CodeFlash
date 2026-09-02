import { useCallback } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

const IS_PAD = (Platform as any).isPad;

/**
 * 窓幅に応じて「iPhone 寸法 ⇄ iPad 寸法」を補間する共通フック。
 *
 * これが要る理由：`Platform.isPad` は**端末**の判定であって**窓幅**の判定ではない。
 * iPad の Split View / Stage Manager では窓を iPhone 並みまで狭められるのに、
 * `isPad ? 32 : 8` のような書き方だと余白は 32 のまま残る。ボタン列は幅が固定なので
 * 隣のタイトル（`flex: 1`）だけが潰れ、1文字ずつ縦に折り返して読めなくなる
 * （ホームの並べ替え行はボタンだけで 322pt を占め、窓 400pt ではタイトルに 46pt しか残らなかった）。
 *
 * 境界の決め方：
 * - `COMPACT_W`（440）= iPhone 16 Pro Max の幅。これ以下は iPhone とまったく同じ寸法。
 * - `WIDE_W`（744）= iPad mini 縦フルの幅。これ以上は従来の iPad 寸法。
 * → **iPhone は完全に不変／iPad も全機種フルスクリーン（縦横とも）は完全に不変**で、
 *   窓を狭めたときだけ縮む。1/2 スプリットで中間値、1/3 まで狭めれば iPhone 寸法になる。
 *
 * ブレークポイントで切り替える案は不採用：Stage Manager のハンドルをドラッグしている最中に
 * 閾値でボタンがカクッと跳ねる。線形補間なら追従して縮む。
 *
 * ⚠️ iPhone は `IS_PAD` ゲートで一切通さない（0 固定）。幅だけで判定すると横向きや
 * 将来の大型端末で iPad 寸法に化けうるため、「iPhone は不変」を構造で保証する。
 */
const COMPACT_W = 440;
const WIDE_W = 744;

/** 0（iPhone 寸法）〜 1（iPad 寸法）の連続値。 */
export function usePadScale(): number {
  const { width } = useWindowDimensions();
  if (!IS_PAD) return 0;
  return Math.min(1, Math.max(0, (width - COMPACT_W) / (WIDE_W - COMPACT_W)));
}

/**
 * `rs(compact, wide)` で寸法を1つ得る関数を返す。
 * 従来の `(Platform as any).isPad ? 32 : 8` は `rs(8, 32)` に置き換える。
 *
 * ⚠️ 丸めない。丸めると両端で元の値と一致しなくなる（フォントサイズのように
 * `theme.fontSize.lg`＝21.6 のような小数を渡す呼び出しがあり、iPad フルスクリーンでも
 * 22 に化けて「全機種フルスクリーンは不変」が崩れる）。RN は小数の寸法を扱えるので、
 * 途中の値が小数になること自体は問題にならない。
 */
export function useResponsiveSize(): (compact: number, wide: number) => number {
  const scale = usePadScale();
  return useCallback((compact: number, wide: number) => compact + (wide - compact) * scale, [scale]);
}
