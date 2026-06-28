// 034: 「Esc で最前面の一時表示（カード内インライン展開など、親が状態を持たない UI）を1つ閉じる」
// ための極小スタック。子コンポーネント（例: SegmentedCard の info 展開）が表示中に dismiss を push し、
// 画面側（SettingsDetail 等）の Esc/戻るハンドラが popEscDismiss() でまず最前面を閉じる。
// useKeyCommands を子側に増やさない＝同一キーの多重登録/多重発火を避けるための仕組み。

type Entry = { id: number; dismiss: () => void };

const stack: Entry[] = [];
let nextId = 1;

/** 一時表示の開始時に閉じる処理を登録。戻り値の id を removeEscDismiss に渡す。 */
export function pushEscDismiss(dismiss: () => void): number {
  const id = nextId++;
  stack.push({ id, dismiss });
  return id;
}

/** 登録解除（非表示・アンマウント時）。 */
export function removeEscDismiss(id: number): void {
  const i = stack.findIndex((e) => e.id === id);
  if (i >= 0) stack.splice(i, 1);
}

/** 最前面の一時表示を1つ閉じる。閉じたら true（＝Esc を消費した）。無ければ false。 */
export function popEscDismiss(): boolean {
  const top = stack.pop();
  if (top) { top.dismiss(); return true; }
  return false;
}
