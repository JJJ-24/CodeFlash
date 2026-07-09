import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';

/**
 * iOS標準「ステータスバータップで先頭へスクロール」(scrollsToTop) を安全に有効化するフック。
 * 画面のメイン縦リストの scrollsToTop にそのまま渡す（フォーカス外＝false も兼ねる）。
 *
 * 素の `scrollsToTop={isFocused}` だと、iPadOS 26 が push 画面からのポップ遷移終了時
 * （フォーカスの約300ms後）に scrollsToTop の「先頭へアニメーションスクロール」を
 * タップなしで誤発火させ、下へスクロールした状態で戻ると一瞬ちらつく
 * （react-navigation #12843。headerShown:false 構成の既知バグ・上流未解決）。
 * フォーカスから 800ms は false のままにして誤発火ウィンドウを避け、その後 true にする。
 * ステータスバータップは人間の操作なので 800ms の遅延は体感されない。
 */
export function useSafeScrollsToTop(): boolean {
  const [armed, setArmed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const tid = setTimeout(() => setArmed(true), 800);
      return () => {
        clearTimeout(tid);
        setArmed(false);
      };
    }, [])
  );
  return armed;
}
