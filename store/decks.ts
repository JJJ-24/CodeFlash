import { create } from 'zustand';

import type { Deck } from '@/types';

interface DeckState {
  decks: Deck[];
  setDecks: (decks: Deck[]) => void;
  addDeck: (deck: Deck) => void;
  updateDeck: (deck: Deck) => void;
  removeDeck: (id: string) => void;
}

export const useDeckStore = create<DeckState>((set) => ({
  decks: [],
  setDecks: (decks) => set({ decks }),
  addDeck: (deck) => set((state) => ({ decks: [deck, ...state.decks] })),
  updateDeck: (updated) =>
    set((state) => ({
      decks: state.decks.map((d) => (d.id === updated.id ? updated : d)),
    })),
  removeDeck: (id) => set((state) => ({ decks: state.decks.filter((d) => d.id !== id) })),
}));
