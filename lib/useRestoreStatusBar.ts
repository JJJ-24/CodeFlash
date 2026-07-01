import { useFocusEffect } from 'expo-router';
import { setStatusBarHidden } from 'expo-status-bar';
import { useCallback, useRef } from 'react';

/**
 * 画面がフォーカスされたら iOS ステータスバー（日時/バッテリー/Wi-Fi）を確実に再表示する。
 *
 * コード実行 WebView（WKWebView）はネイティブクリーンアップ時に iOS のステータスバー表示状態を
 * 上書きして隠すことがある。これは非同期に遅れて起きるため、フォーカス直後に一度呼ぶだけでは
 * クリーンアップに負けて隠れたままになる。そこで 0 / 200 / 550ms の多段タイマーで打ち勝つ。
 *
 * ホーム画面（8b447b8）と同じ手法を、Stack にプッシュされる画面（カード一覧・タグ管理・
 * タグカード一覧・検索）や下タブでも使えるよう共通化したもの。
 *
 * 学習セッションはフルスクリーン時に意図的にステータスバーを隠すため、このフックは使わない。
 */
export function useRestoreStatusBar() {
  const focusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setStatusBarHidden(false, 'none');
      const t1 = setTimeout(() => { if (focusedRef.current) setStatusBarHidden(false, 'none'); }, 200);
      const t2 = setTimeout(() => { if (focusedRef.current) setStatusBarHidden(false, 'none'); }, 550);
      return () => {
        focusedRef.current = false;
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }, []),
  );
}
