import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { TextInput } from 'react-native';

/** コードブロックの記号ペア挿入ロジックを管理するフック */
export function useInsertPair(
  content: string,
  onContentChange: (text: string) => void,
  codeInputRef: RefObject<TextInput | null>,
) {
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const insertTimeRef = useRef(0);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(undefined);

  const insertPair = useCallback((open: string, close: string) => {
    const { start, end } = selectionRef.current;
    const selected = content.slice(start, end);
    const newContent = content.slice(0, start) + open + selected + close + content.slice(end);
    const newCursor = start + open.length + selected.length;
    selectionRef.current = { start: newCursor, end: newCursor };
    insertTimeRef.current = Date.now();
    onContentChange(newContent);
    setSelection({ start: newCursor, end: newCursor });
    requestAnimationFrame(() => {
      codeInputRef.current?.focus();
      setSelection(undefined);
    });
  }, [content, onContentChange, codeInputRef]);

  const handleSelectionChange = useCallback(
    ({ nativeEvent }: { nativeEvent: { selection: { start: number; end: number } } }) => {
      if (Date.now() - insertTimeRef.current < 200) return;
      selectionRef.current = nativeEvent.selection;
    },
    [],
  );

  /** 編集開始時にカーソル位置を手動で初期化する（programmatic focus では onSelectionChange が発火しないため） */
  const initCursorPosition = useCallback((pos: number) => {
    selectionRef.current = { start: pos, end: pos };
  }, []);

  /** タップによる編集開始時にカーソル位置を設定し、iOS の自動スクロールを制御する */
  const setSelectionToPos = useCallback((pos: number) => {
    selectionRef.current = { start: pos, end: pos };
    setSelection({ start: pos, end: pos });
    setTimeout(() => setSelection(undefined), 200);
  }, []);

  return { insertPair, selection, handleSelectionChange, initCursorPosition, setSelectionToPos };
}
