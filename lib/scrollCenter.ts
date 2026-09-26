/**
 * J/K でフォーカスした項目を**画面の真ん中**へ送るときのスクロール位置（ScrollView 用）。
 * ホーム・カード一覧の J/K（`useListNavigation` の `viewPosition: 0.5`）と同じ見え方にそろえる＝
 * 端に着いてから1つずつ送る方式だと、次の項目がスクロールするまで見えず、どこへ進むのか分からない。
 *
 * - 先頭・末尾の近くは真ん中まで送れないので、スクロールできる範囲（0〜内容の高さ−表示の高さ）に収める
 * - 項目が表示より高い（展開したまとまりなど）ときは頭をそろえる＝真ん中にすると頭が切れる
 *
 * 動かす必要が無いとき（1pt 未満の差）は null。
 */
export function centeredScrollY(
  item: { y: number; h: number },
  viewportH: number,
  contentH: number,
  currentY: number,
): number | null {
  const maxY = Math.max(0, contentH - viewportH);
  const raw = item.h > viewportH - 16 ? item.y - 8 : item.y + item.h / 2 - viewportH / 2;
  const target = Math.min(maxY, Math.max(0, raw));
  return Math.abs(target - currentY) < 1 ? null : target;
}
