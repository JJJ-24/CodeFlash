import { darkenHex, themedFrameBorder, type AppTheme } from '@/lib/theme';

/**
 * マークダウンのテーブル用スタイル（学習画面 `BlocksView` と編集プレビュー `TextBlockItem` で共用）。
 *
 * `react-native-markdown-display` の既定値は「黒固定の外枠＋行の下線」だけで、
 * **見出しの装飾も列の縦線も無い**（`node_modules/react-native-markdown-display/src/lib/styles.js`）。
 * ダークテーマでは枠線（`#000000`）もほぼ見えないため、テーマ連動で上書きする。
 *
 * - **縦線**：セル側に `borderRightWidth` を持たせ、`table` の右枠を 0 にする。こうすると
 *   最後の列の右線がそのまま表の右端になり、線が二重（2px）にならない。下辺も同じ理由で
 *   `table` 側を 0 にし、最終行の `tr` の下線を表の下端として使う
 * - **見出し**：`th` に `fontWeight` を置く。`th` 自体は View なので直接は効かないが、
 *   ライブラリが**祖先スタイルの文字プロパティを子の Text へ継承させる**ため中の文字が太字になる
 *   （`AstRenderer.renderNode` の `inheritedStyles`）
 * - **見出しの背景は半透明の薄い膜**にする。カードテーマ（paper/sky…）ごとに固定色を割り当てると、
 *   同じ配色を使っているメモ欄（`cardTheme.memoBackground` 背景）で見出しが背景と同色になって
 *   消えてしまう。半透明なら下地が何であれ「少し濃い帯」になり、テーマの色味にも自然に馴染む
 * - **枠線はカードテーマの枠線色を基準に、視認できるところまで寄せる**（ライトは暗く、ダークは明るく）。
 *   `cardTheme.border` をそのまま使うと、default ライトの `#F0F0F0` などは白いカード面でほぼ見えない
 *
 * @param variant `'card'` = 学習カード上（カードテーマに追従）／`'plain'` = 編集プレビュー等（アプリ配色）
 */
export function markdownTableStyles(theme: AppTheme, variant: 'card' | 'plain' = 'plain') {
  const baseBorder = variant === 'card' ? themedFrameBorder(theme) : theme.colors.inputBorder;
  // ライトは 0.72 倍で暗く、ダークは 1.7 倍で明るく（darkenHex は factor>1 で明色化）。
  // どちらもテーマの色味（paper=タン、sky=青…）を保ったまま、下地とのコントラストだけ上げる。
  const border = darkenHex(baseBorder, theme.dark ? 1.7 : 0.72);
  const headerBg = theme.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  return {
    table: {
      borderWidth: 1,
      borderRightWidth: 0,   // 最後の列の td/th の右線が表の右端になる
      borderBottomWidth: 0,  // 最終行の tr の下線が表の下端になる
      borderColor: border,
      marginVertical: 6,
    },
    thead: {},
    tbody: {},
    tr: { flexDirection: 'row' as const, borderBottomWidth: 1, borderColor: border },
    th: {
      flex: 1,
      padding: 8,
      borderRightWidth: 1,
      borderColor: border,
      backgroundColor: headerBg,
      fontWeight: '700' as const,
    },
    td: { flex: 1, padding: 8, borderRightWidth: 1, borderColor: border },
  };
}
