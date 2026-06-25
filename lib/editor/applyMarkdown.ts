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

/**
 * 行頭タイプの記法（見出し `# ` / 箇条書き `- ` / 引用 `> `）をトグルする。
 * - 選択あり: 選択がまたぐ全行を対象。全行が既に prefix 付きなら一括除去、そうでなければ付与。
 *   適用後は対象行全体を選択状態にする（連続トグル可）。
 * - 選択なし: カーソル行のみ対象。カーソルは prefix 分だけ左右にずらして維持。
 *
 * 純粋関数。空行は判定対象から除外しつつ、付与時は空行にも prefix を付ける
 * （空行でボタンを押したら見出し等を開始できるように）。
 */
export function togglePrefixLines(text: string, sel: Sel, prefix: string): ApplyResult {
  const start = Math.max(0, Math.min(sel.start, sel.end));
  const end = Math.min(text.length, Math.max(sel.start, sel.end));
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;

  const segment = text.slice(lineStart, lineEnd);
  const lines = segment.split('\n');
  const nonEmpty = lines.filter((l) => l.length > 0);
  const allPrefixed = nonEmpty.length > 0 && nonEmpty.every((l) => l.startsWith(prefix));
  const newLines = lines.map((l) => {
    if (allPrefixed) return l.startsWith(prefix) ? l.slice(prefix.length) : l;
    return l.startsWith(prefix) ? l : prefix + l;
  });
  const newSegment = newLines.join('\n');
  const newText = text.slice(0, lineStart) + newSegment + text.slice(lineEnd);

  if (start !== end) {
    // 選択あり: 対象行全体を選択
    return { text: newText, selection: { start: lineStart, end: lineStart + newSegment.length } };
  }
  // 選択なし: カーソルを prefix 分だけずらして維持
  const wasPrefixed = lines[0].startsWith(prefix);
  let caret: number;
  if (allPrefixed) {
    caret = wasPrefixed ? Math.max(lineStart, start - prefix.length) : start;
  } else {
    caret = wasPrefixed ? start : start + prefix.length;
  }
  return { text: newText, selection: { start: caret, end: caret } };
}

/** ツールバーボタンが表す記法アクション。 */
export type MdAction =
  | { kind: 'wrap'; left: string; right: string }
  | { kind: 'prefix'; prefix: string };

/** アクション種別に応じて wrapSelection / togglePrefixLines を振り分ける。 */
export function applyAction(text: string, sel: Sel, action: MdAction): ApplyResult {
  return action.kind === 'wrap'
    ? wrapSelection(text, sel, action.left, action.right)
    : togglePrefixLines(text, sel, action.prefix);
}
