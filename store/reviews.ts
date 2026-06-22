import { create } from 'zustand';

import type { Review } from '@/types';

interface ReviewStoreState {
  /** 現在の学習セッションで対象となるカードID一覧 */
  dueCardIds: string[];
  /** cardId → Review のマップ（学習済みカードのキャッシュ） */
  reviewMap: Record<string, Review>;
  /**
   * 順序を厳守して学習したいカードID列（カード一覧の「表示中で学習」・統計の重点復習）。
   * 大量（数万件）になり得るため URL パラメータではなくここで受け渡す（params に載せると
   * ルート状態のシリアライズに数秒かかる）。セッション側は order='1' のときこれを参照する。
   */
  studyCardIds: string[] | null;
  setStudyCardIds: (ids: string[] | null) => void;
  setDueCardIds: (ids: string[]) => void;
  setReview: (review: Review) => void;
  clearSession: () => void;
}

export const useReviewStore = create<ReviewStoreState>((set) => ({
  dueCardIds: [],
  reviewMap: {},
  studyCardIds: null,
  setStudyCardIds: (ids) => set({ studyCardIds: ids }),
  setDueCardIds: (ids) => set({ dueCardIds: ids }),
  setReview: (review) =>
    set((state) => ({
      reviewMap: { ...state.reviewMap, [review.cardId]: review },
    })),
  clearSession: () => set({ dueCardIds: [], reviewMap: {} }),
}));
