// 033 Phase 2/4: テキストブロックの選択範囲にマークダウン記法を挿入/解除するユーティリティ。
// ツールバーボタン・キーボードショートカットの両方から呼ばれる純粋関数。

export interface Sel {
  start: number;
  end: number;
}

export interface ApplyResult {
  /** 記法適用後の本文全体 */
  text: string;
  /** 適用後に設定すべき選択範囲（カーソル位置）。 */
  selection: Sel;
}

/**
 * 囲みタイプ（`**…**` / `*…*` / `` `…` `` / `~~…~~` / `==…==`）をトグルする。
 * - 選択あり: 選択の外側 or 内側がちょうど `left`/`right` で囲まれていれば**解除**、なければ付与。
 * - 選択なし: カーソルが空ペア（`left``right` の間）にあれば解除、なければ挿入してカーソルを内側へ。
 *   → 空状態で2度押すと「1回目付与・2回目解除」になる。
 *
 * 純粋関数。start/end の逆順・範囲外も正規化する。
 */
export function toggleWrap(text: string, sel: Sel, left: string, right: string): ApplyResult {
  const start = Math.max(0, Math.min(sel.start, sel.end));
  const end = Math.min(text.length, Math.max(sel.start, sel.end));
  const selected = text.slice(start, end);

  if (start !== end) {
    // (a) マーカーが選択の外側にちょうどある → 解除
    const before = text.slice(Math.max(0, start - left.length), start);
    const after = text.slice(end, end + right.length);
    if (start - left.length >= 0 && before === left && after === right) {
      const newText = text.slice(0, start - left.length) + selected + text.slice(end + right.length);
      const ns = start - left.length;
      return { text: newText, selection: { start: ns, end: ns + selected.length } };
    }
    // (b) マーカーが選択の内側に含まれている → 解除
    if (selected.length >= left.length + right.length && selected.startsWith(left) && selected.endsWith(right)) {
      const inner = selected.slice(left.length, selected.length - right.length);
      const newText = text.slice(0, start) + inner + text.slice(end);
      return { text: newText, selection: { start, end: start + inner.length } };
    }
    // それ以外 → 付与（中身を選択したまま維持）
    const newText = text.slice(0, start) + left + selected + right + text.slice(end);
    const ns = start + left.length;
    return { text: newText, selection: { start: ns, end: ns + selected.length } };
  }

  // 無選択: カーソルが空ペアの内側なら解除、それ以外は挿入
  const c = start;
  const beforeC = text.slice(Math.max(0, c - left.length), c);
  const afterC = text.slice(c, c + right.length);
  if (c - left.length >= 0 && beforeC === left && afterC === right) {
    const newText = text.slice(0, c - left.length) + text.slice(c + right.length);
    const caret = c - left.length;
    return { text: newText, selection: { start: caret, end: caret } };
  }
  const newText = text.slice(0, c) + left + right + text.slice(c);
  const caret = c + left.length;
  return { text: newText, selection: { start: caret, end: caret } };
}

/**
 * 行頭タイプの記法（箇条書き `- ` / 引用 `> `）をトグルする。
 * - 選択あり: 選択がまたぐ全行を対象。全行が既に prefix 付きなら一括除去、そうでなければ付与。
 * - 選択なし: カーソル行のみ対象。カーソルは prefix 分だけ左右にずらして維持。
 *
 * 空行は判定対象から除外しつつ、付与時は空行にも prefix を付ける（空行で開始できるように）。
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
    return { text: newText, selection: { start: lineStart, end: lineStart + newSegment.length } };
  }
  const wasPrefixed = lines[0].startsWith(prefix);
  let caret: number;
  if (allPrefixed) {
    caret = wasPrefixed ? Math.max(lineStart, start - prefix.length) : start;
  } else {
    caret = wasPrefixed ? start : start + prefix.length;
  }
  return { text: newText, selection: { start: caret, end: caret } };
}

/**
 * 見出しレベルを循環させる（なし → # → ## → ### → なし）。
 * 対象行の見出しレベルを最初の行で判定し、全対象行を次のレベルに揃える。
 */
export function cycleHeadingLines(text: string, sel: Sel, maxLevel = 3): ApplyResult {
  const start = Math.max(0, Math.min(sel.start, sel.end));
  const end = Math.min(text.length, Math.max(sel.start, sel.end));
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;

  const segment = text.slice(lineStart, lineEnd);
  const lines = segment.split('\n');
  const headingRe = /^(#{1,6}) /;
  const firstMatch = lines[0].match(headingRe);
  const current = firstMatch ? firstMatch[1].length : 0;
  const next = current >= maxLevel ? 0 : current + 1;
  const prefix = next > 0 ? '#'.repeat(next) + ' ' : '';

  const newLines = lines.map((l) => prefix + l.replace(headingRe, ''));
  const newSegment = newLines.join('\n');
  const newText = text.slice(0, lineStart) + newSegment + text.slice(lineEnd);

  if (start !== end) {
    return { text: newText, selection: { start: lineStart, end: lineStart + newSegment.length } };
  }
  const oldPrefixLen = current > 0 ? current + 1 : 0; // '#'*current + ' '
  const caret = Math.max(lineStart, start + (prefix.length - oldPrefixLen));
  return { text: newText, selection: { start: caret, end: caret } };
}

/** ツールバーボタンが表す記法アクション。 */
export type MdAction =
  | { kind: 'wrap'; left: string; right: string }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'heading' };

/** アクション種別に応じて適用関数を振り分ける。 */
export function applyAction(text: string, sel: Sel, action: MdAction): ApplyResult {
  switch (action.kind) {
    case 'wrap':
      return toggleWrap(text, sel, action.left, action.right);
    case 'prefix':
      return togglePrefixLines(text, sel, action.prefix);
    case 'heading':
      return cycleHeadingLines(text, sel);
  }
}
