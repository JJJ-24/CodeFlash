import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';

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
 *
 * ---- disarmKey（2026-07-27 追加）----
 * iPad では「最下部で選択モードを切り替えると先頭へアニメーションで飛ぶ」現象があった
 * （カード一覧・タグ管理・タグカード一覧。iPhone では起きない）。実機切り分けの結果：
 *
 * - `scrollsToTop={false}` を直書きすると**一度も起きない**＝原因はこのプロパティで確定
 * - 切替の瞬間だけ false に落として 800ms 後に戻す方式では 2〜3 回に 1 回残った
 *   → **false→true に戻した時点**が誤発火の引き金（切替後に手を止めた回だけ飛ぶ、で説明がつく）
 * - リストの途中/最下部、✕ボタン/S キーのいずれでも差は無し＝コンテンツ高さやキー入力は無関係
 *
 * そこで `disarmKey`（選択モード等）が変わったら **その画面にいるあいだは二度と武装しない**。
 * 次にこの画面がフォーカスされた時だけ 800ms 後に戻す。タイミングの当てずっぽうを排し、
 * 「戻さないから誤発火しない」と言い切れる形にしている。失うのは「選択モードを使った後、
 * 画面を離れて戻るまでのあいだのステータスバータップ」だけ。
 * **落とすのはレンダー中**であることも重要：effect で落とすと 1 フレーム遅れる。
 */
export function useSafeScrollsToTop(disarmKey?: unknown): boolean {
  const [armed, setArmed] = useState(false);
  const keyRef = useRef(disarmKey);

  if (keyRef.current !== disarmKey) {
    keyRef.current = disarmKey;
    // レンダー中の setState（同一コンポーネントへの更新＝React が同期的に再レンダーする）
    if (armed) setArmed(false);
  }

  useFocusEffect(
    // deps は空。disarmKey の変化でここを再実行してはいけない（＝再武装しない）。
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
