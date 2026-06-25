// 033 Phase 2: テキストブロックの選択範囲にマークダウン記法を挿入するユーティリティ。
// ツールバーボタン・キーボードショートカットの両方から呼ばれる純粋関数。

export interface Sel {
  start: number;
  end: number;
}

export interface ApplyResult {
  /** 記法挿入後の本文全体 */
  text: string;
  /** 挿入後に設定すべき選択範囲（カーソル位置）。記法の内側を指す。 */
  selection: Sel;
}

/**
 * 囲みタイプの記法（`**…**` / `*…*` / `` `…` `` / `~~…~~` / `==…==`）を適用する。
 * - 選択あり: 選択文字を `left…right` で囲み、囲んだ中身を選択状態のまま維持する。
 * - 選択なし: カーソル位置に `left``right` を挿入し、カーソルを両者の間（内側）に置く。
 *
 * 純粋関数。選択の start/end が逆順でも正規化する。
 */
export function wrapSelection(text: string, sel: Sel, left: string, right: string): ApplyResult {
  const start = Math.max(0, Math.min(sel.start, sel.end));
  const end = Math.min(text.length, Math.max(sel.start, sel.end));
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  const newText = before + left + selected + right + after;

  if (selected.length === 0) {
    // 未選択: カーソルを left と right の間に置く
    const caret = start + left.length;
    return { text: newText, selection: { start: caret, end: caret } };
  }
  // 選択あり: 囲んだ中身を選択したまま維持（記法の内側）
  const selStart = start + left.length;
  const selEnd = selStart + selected.length;
  return { text: newText, selection: { start: selStart, end: selEnd } };
}
