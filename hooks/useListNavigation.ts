import { useCallback, useRef, useState } from 'react';

export function useListNavigation<T>(items: T[]) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const listRef = useRef<any>(null);

  const moveFocus = useCallback(
    (dir: 'next' | 'prev') => {
      setFocusedIndex((prev) => {
        let next: number | null;
        if (dir === 'next') {
          next = prev === null ? 0 : prev === items.length - 1 ? null : prev + 1;
        } else {
          next = prev === null ? items.length - 1 : prev === 0 ? null : prev - 1;
        }
        if (next !== null) {
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index: next as number, viewPosition: 0.5, animated: true });
          }, 50);
        }
        return next;
      });
    },
    [items.length],
  );

  return { focusedIndex, setFocusedIndex, listRef, moveFocus };
}
