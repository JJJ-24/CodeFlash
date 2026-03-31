import { create } from 'zustand';

import type { Tag } from '@/types';

export type TagWithCount = Tag & { cardCount: number };

interface TagState {
  tags: TagWithCount[];
  setTags: (tags: TagWithCount[]) => void;
  addTag: (tag: TagWithCount) => void;
  updateTag: (tag: TagWithCount) => void;
  removeTag: (id: string) => void;
  reorderTags: (tags: TagWithCount[]) => void;
}

export const useTagStore = create<TagState>((set) => ({
  tags: [],
  setTags: (tags) => set({ tags }),
  addTag: (tag) => set((state) => ({ tags: [...state.tags, tag] })),
  updateTag: (updated) =>
    set((state) => ({
      tags: state.tags.map((t) => (t.id === updated.id ? updated : t)),
    })),
  removeTag: (id) => set((state) => ({ tags: state.tags.filter((t) => t.id !== id) })),
  reorderTags: (tags) => set({ tags }),
}));
