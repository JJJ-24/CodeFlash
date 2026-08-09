import { create } from 'zustand';

/**
 * 新規作成（デッキ/タグ/カード）を保存して一覧へ戻った直後に、
 * 「作成した項目へフォーカス（＋スクロール）を移す」ための一時的な受け渡し。
 *
 * 新規画面が保存時に setPendingFocus(scope, id) を積み、一覧画面が useFocusEffect で
 * takePendingFocus(scope) を取り出して該当項目にフォーカスする（取り出したら消える＝一度きり）。
 * 保存せず閉じた場合は積まれないので、元のフォーカスがそのまま残る。
 *
 * **スクロールするかは用途で分かれる**（`scroll` オプション）：
 * - 新規作成・複製 … `scroll: true`（既定）。作成物は末尾にあり、そこまで運ばないと見えない
 * - 学習を途中でやめて戻った位置 … **`scroll: false`**。一覧のどこにあるか分からず、
 *   遠距離ジャンプは仮想化リストの限界でパラパラ動くため（アーカイブ後の自動スクロールを
 *   不採用にしたのと同じ理由）。自分でスクロールすれば「ここまで学習した」が分かる
 */
type FocusScope = 'deck' | 'tag' | 'card';

/** 保留フォーカス1件。`scroll` はその項目まで一覧をスクロールするか（既定 true）。 */
interface PendingFocus {
  id: string;
  scroll: boolean;
}

interface PendingFocusState {
  entries: Partial<Record<FocusScope, PendingFocus>>;
  setPendingFocus: (scope: FocusScope, id: string, options?: { scroll?: boolean }) => void;
  /** 保留分を返して消費する（無ければ null）。 */
  takePendingFocus: (scope: FocusScope) => PendingFocus | null;
}

export const usePendingFocusStore = create<PendingFocusState>((set, get) => ({
  entries: {},
  setPendingFocus: (scope, id, options) =>
    set((s) => ({ entries: { ...s.entries, [scope]: { id, scroll: options?.scroll ?? true } } })),
  takePendingFocus: (scope) => {
    const entry = get().entries[scope] ?? null;
    if (entry != null) set((s) => { const next = { ...s.entries }; delete next[scope]; return { entries: next }; });
    return entry;
  },
}));
