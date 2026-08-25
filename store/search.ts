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
  /** 学習日フィルター（ローカル YYYY-MM-DD）。未指定は null。 */
  studiedDate: string | null;
  setSearch: (s: { query: string; deckIds: string[]; tagIds: string[]; studiedDate: string | null }) => void;
}

export const useSearchSessionStore = create<SearchSessionState>((set) => ({
  query: '',
  deckIds: [],
  tagIds: [],
  studiedDate: null,
  setSearch: ({ query, deckIds, tagIds, studiedDate }) => set({ query, deckIds, tagIds, studiedDate }),
}));
