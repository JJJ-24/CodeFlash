import { useCallback, useRef, useState } from 'react';

export function useListNavigation<T>(items: T[], keyExtractor?: (item: T) => string) {
  // ID ベース追跡（keyExtractor あり）
  const focusedIdRef = useRef<string | null>(null);
  const [focusedId, setFocusedIdState] = useState<string | null>(null);
  // インデックスベース追跡（keyExtractor なし・後方互換）
  const [focusedIndexRaw, setFocusedIndexRaw] = useState<number | null>(null);
  const listRef = useRef<any>(null);

  // keyExtractor あり → ID から index を毎レンダーで導出（並び替え後も正しい位置を返す）
  const focusedIndex = keyExtractor
    ? (focusedId != null
        ? (() => { const i = items.findIndex(item => keyExtractor(item) === focusedId); return i === -1 ? null : i; })()
        : null)
    : focusedIndexRaw;

  const setFocusedIndex = useCallback((idx: number | null) => {
    if (keyExtractor) {
      const id = idx != null && items[idx] ? keyExtractor(items[idx]) : null;
      focusedIdRef.current = id;
      setFocusedIdState(id);
    } else {
      setFocusedIndexRaw(idx);
    }
  }, [keyExtractor, items]);

  const moveFocus = useCallback((dir: 'next' | 'prev') => {
    if (keyExtractor) {
      // ref 経由で stale closure を回避しつつ現在の index を取得
      const currentIdx = focusedIdRef.current
        ? items.findIndex(item => keyExtractor(item) === focusedIdRef.current)
        : null;
      let next: number | null;
      if (dir === 'next') {
        next = currentIdx === null ? 0 : currentIdx === items.length - 1 ? null : currentIdx + 1;
      } else {
        next = currentIdx === null ? items.length - 1 : currentIdx === 0 ? null : currentIdx - 1;
      }
      if (next !== null) {
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index: next as number, viewPosition: 0.5, animated: true });
        }, 50);
      }
      const newId = next != null && items[next] ? keyExtractor(items[next]) : null;
      focusedIdRef.current = newId;
      setFocusedIdState(newId);
    } else {
      // 後方互換: 元の実装
      setFocusedIndexRaw((prev) => {
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
    }
  }, [items, keyExtractor]);

  return { focusedIndex, setFocusedIndex, listRef, moveFocus };
}
