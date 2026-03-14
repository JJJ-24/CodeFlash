import { create } from 'zustand';

import type { Review } from '@/types';

interface ReviewStoreState {
  /** 現在の学習セッションで対象となるカードID一覧 */
  dueCardIds: string[];
  /** cardId → Review のマップ（学習済みカードのキャッシュ） */
  reviewMap: Record<string, Review>;
  setDueCardIds: (ids: string[]) => void;
  setReview: (review: Review) => void;
  clearSession: () => void;
}

export const useReviewStore = create<ReviewStoreState>((set) => ({
  dueCardIds: [],
  reviewMap: {},
  setDueCardIds: (ids) => set({ dueCardIds: ids }),
  setReview: (review) =>
    set((state) => ({
      reviewMap: { ...state.reviewMap, [review.cardId]: review },
    })),
  clearSession: () => set({ dueCardIds: [], reviewMap: {} }),
}));
