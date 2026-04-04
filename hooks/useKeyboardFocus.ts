import { useCallback, useRef } from 'react';
import { TextInput } from 'react-native';

/**
 * Bluetooth キーボードショートカット用の隠し TextInput を管理するフック。
 * isScreenFocusedRef + keyboardRef + タイマークリーンアップを一元管理する。
 *
 * 使い方:
 *   const { keyboardRef, isScreenFocusedRef, onScreenFocus, onScreenBlur, onInputBlur } = useKeyboardFocus();
 *
 *   useFocusEffect(useCallback(() => {
 *     onScreenFocus();          // フォーカス取得時: refセット + 100ms後にTextInputをフォーカス
 *     return () => onScreenBlur(); // クリーンアップ: refリセット + タイマークリア
 *   }, [onScreenFocus, onScreenBlur]));
 *
 *   <TextInput ref={keyboardRef} onBlur={onInputBlur} ... />
 */
export function useKeyboardFocus() {
  const keyboardRef = useRef<TextInput>(null);
  const isScreenFocusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** useFocusEffect の setup で呼ぶ。delay ms 後に TextInput をフォーカスする */
  const onScreenFocus = useCallback((delay = 100) => {
    isScreenFocusedRef.current = true;
    timerRef.current = setTimeout(() => {
      if (isScreenFocusedRef.current) keyboardRef.current?.focus();
    }, delay);
  }, []);

  /** useFocusEffect の cleanup で呼ぶ。フォーカス状態をリセットしタイマーをキャンセルする */
  const onScreenBlur = useCallback(() => {
    isScreenFocusedRef.current = false;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** TextInput の onBlur に渡す。blur 後 50ms でフォーカスが残っていれば再フォーカスする */
  const onInputBlur = useCallback(() => {
    setTimeout(() => {
      if (isScreenFocusedRef.current) keyboardRef.current?.focus();
    }, 50);
  }, []);

  return { keyboardRef, isScreenFocusedRef, onScreenFocus, onScreenBlur, onInputBlur };
}
