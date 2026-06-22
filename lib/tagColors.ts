import type { AppTheme } from '@/lib/theme';

/**
 * タグ色の特別値。通常は #RRGGBB を保存するが、以下のセンチネル値のときは
 * テーマに追従して動的に解決する（デッキの DECK_THEME_COLOR と同じ思想）。
 */
/** 設定の配色（テーマ）に追従＝アプリのテーマ色（primary）を使う。 */
export const TAG_THEME_COLOR = '__theme__';
/** ライト=黒 / ダーク=白（text 色に追従）。 */
export const TAG_MONO_COLOR = '__mono__';

/** 保存値（hex or センチネル）から実際に表示する色を解決する。 */
export function resolveTagColor(color: string | null | undefined, theme: AppTheme): string {
  // テーマ追従＝画面背景（カード間の隙間）の色に連動する。
  // 非デフォルトテーマでは colors.background がテーマ色（スカイ=ライトブルー等）に差し替わり、
  // デフォルトでは素の画面背景（ライト=薄グレー / ダーク=黒）になる。タグ管理画面の
  // 「背景・隙間」の色とちょうど一致する。
  if (color === TAG_THEME_COLOR) return theme.colors.background;
  if (color === TAG_MONO_COLOR) return theme.colors.text;
  return color || theme.colors.background;
}

/** 背景色（hex）の明暗から、上に乗せる文字色（黒/白）を返す。 */
export function contrastText(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '#FFFFFF';
  // 簡易輝度（0〜1）。明るい背景は黒文字、暗い背景は白文字。
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#FFFFFF';
}
