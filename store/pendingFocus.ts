import { create } from 'zustand';

/**
 * 新規作成（デッキ/タグ/カード）を保存して一覧へ戻った直後に、
 * 「作成した項目へフォーカス（＋スクロール）を移す」ための一時的な受け渡し。
 *
 * 新規画面が保存時に setPendingFocus(scope, id) を積み、一覧画面が useFocusEffect で
 * takePendingFocus(scope) を取り出して該当項目にフォーカスする（取り出したら消える＝一度きり）。
 * 保存せず閉じた場合は積まれないので、元のフォーカスがそのまま残る。
 */
type FocusScope = 'deck' | 'tag' | 'card';

interface PendingFocusState {
  ids: Partial<Record<FocusScope, string>>;
  setPendingFocus: (scope: FocusScope, id: string) => void;
  /** 保留 ID を返して消費する（無ければ null）。 */
  takePendingFocus: (scope: FocusScope) => string | null;
}

export const usePendingFocusStore = create<PendingFocusState>((set, get) => ({
  ids: {},
  setPendingFocus: (scope, id) => set((s) => ({ ids: { ...s.ids, [scope]: id } })),
  takePendingFocus: (scope) => {
    const id = get().ids[scope] ?? null;
    if (id != null) set((s) => { const next = { ...s.ids }; delete next[scope]; return { ids: next }; });
    return id;
  },
}));
