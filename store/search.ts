import { create } from 'zustand';

/**
 * カード検索の直前の入力をセッション中だけ保持する（AsyncStorage には永続化しない）。
 * 検索画面を閉じて再度開いたときに、前回のキーワード・デッキ/タグ絞り込みを復元するために使う。
 * アプリを再起動すると初期化される。
 */
interface SearchSessionState {
  query: string;
  deckIds: string[];
  tagIds: string[];
  setSearch: (s: { query: string; deckIds: string[]; tagIds: string[] }) => void;
}

export const useSearchSessionStore = create<SearchSessionState>((set) => ({
  query: '',
  deckIds: [],
  tagIds: [],
  setSearch: ({ query, deckIds, tagIds }) => set({ query, deckIds, tagIds }),
}));
