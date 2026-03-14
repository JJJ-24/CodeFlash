import { create } from 'zustand';

import type { Card } from '@/types';

interface CardState {
  cards: Card[];
  setCards: (cards: Card[]) => void;
  addCard: (card: Card) => void;
  updateCard: (card: Card) => void;
  removeCard: (id: string) => void;
}

export const useCardStore = create<CardState>((set) => ({
  cards: [],
  setCards: (cards) => set({ cards }),
  addCard: (card) => set((state) => ({ cards: [...state.cards, card] })),
  updateCard: (updated) =>
    set((state) => ({
      cards: state.cards.map((c) => (c.id === updated.id ? updated : c)),
    })),
  removeCard: (id) => set((state) => ({ cards: state.cards.filter((c) => c.id !== id) })),
}));
