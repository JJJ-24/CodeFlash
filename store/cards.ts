import { create } from 'zustand';

import type { Card } from '@/types';

interface CardState {
  cards: Card[];
  setCards: (cards: Card[]) => void;
  addCard: (card: Card) => void;
  updateCard: (card: Card) => void;
  removeCard: (id: string) => void;
  reorderCards: (reordered: Card[]) => void;
  // 別画面（カード編集）で複製したカードの ID。カード一覧がフォーカス時に取り込み「NEW」表示する。
  pendingDuplicatedIds: string[];
  markDuplicated: (ids: string[]) => void;
  takeDuplicated: () => string[];
}

export const useCardStore = create<CardState>((set, get) => ({
  cards: [],
  setCards: (cards) => set({ cards }),
  addCard: (card) => set((state) => ({ cards: [...state.cards, card] })),
  updateCard: (updated) =>
    set((state) => ({
      cards: state.cards.map((c) => (c.id === updated.id ? updated : c)),
    })),
  removeCard: (id) => set((state) => ({ cards: state.cards.filter((c) => c.id !== id) })),
  reorderCards: (reordered) =>
    set((state) => ({
      cards: [
        ...state.cards.filter((c) => c.deckId !== reordered[0]?.deckId),
        ...reordered,
      ],
    })),
  pendingDuplicatedIds: [],
  markDuplicated: (ids) =>
    set((state) => ({ pendingDuplicatedIds: [...state.pendingDuplicatedIds, ...ids] })),
  takeDuplicated: () => {
    const ids = get().pendingDuplicatedIds;
    if (ids.length > 0) set({ pendingDuplicatedIds: [] });
    return ids;
  },
}));
