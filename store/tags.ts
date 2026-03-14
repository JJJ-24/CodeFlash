import { create } from 'zustand';

import type { Tag } from '@/types';

type TagWithCount = Tag & { cardCount: number };

interface TagState {
  tags: TagWithCount[];
  setTags: (tags: TagWithCount[]) => void;
  addTag: (tag: TagWithCount) => void;
  updateTag: (tag: TagWithCount) => void;
  removeTag: (id: string) => void;
}

export const useTagStore = create<TagState>((set) => ({
  tags: [],
  setTags: (tags) => set({ tags }),
  addTag: (tag) =>
    set((state) => ({
      tags: [...state.tags, tag].sort((a, b) => a.name.localeCompare(b.name)),
    })),
  updateTag: (updated) =>
    set((state) => ({
      tags: state.tags
        .map((t) => (t.id === updated.id ? updated : t))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
  removeTag: (id) => set((state) => ({ tags: state.tags.filter((t) => t.id !== id) })),
}));
