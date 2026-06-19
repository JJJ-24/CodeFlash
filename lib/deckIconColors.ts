import type { AppTheme } from '@/lib/theme';

/**
 * デッキカラーの特別値：「設定の配色（カードテーマ）に追従」。
 * 通常の colorHex（#RRGGBB）とは別に、この値のときは
 * アイコン色 = アプリのテーマ色（primary）、丸の背景 = 画面背景色（theme.colors.background）とする2トーン表示にする。
 * 画面背景はカードテーマに応じて default=グレー / スカイ=スカイ色…と変わるため、テーマの見た目に揃う。
 */
export const DECK_THEME_COLOR = '__theme__';

/**
 * デッキの丸アイコンの「アイコン色」と「背景色」を colorHex から解決する。
 * - 通常色: アイコン = colorHex、背景 = colorHex + 20%
 * - DECK_THEME_COLOR: アイコン = primary、背景 = 画面背景色（カードテーマに追従）
 * - null（色なし／✕）: アイコン = text（ライト=黒・ダーク=白）、背景 = 画面背景色
 *   （アイコン選択モーダルの非選択セルと同じ見た目。テーマ追従の primary アクセントと区別する）
 */
export function resolveDeckIconColors(colorHex: string | null, theme: AppTheme): { color: string; bg: string } {
  if (colorHex === DECK_THEME_COLOR) {
    return { color: theme.colors.primary, bg: theme.colors.background };
  }
  if (!colorHex) {
    return { color: theme.colors.text, bg: theme.colors.background };
  }
  return { color: colorHex, bg: colorHex + '20' };
}
