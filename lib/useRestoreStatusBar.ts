import { useFocusEffect } from 'expo-router';
import { setStatusBarHidden, setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useRef } from 'react';
import { AppState, Keyboard } from 'react-native';

import { useTheme } from '@/lib/theme';

/**
 * 画面がフォーカスされている間、iOS ステータスバー（日時/バッテリー/Wi-Fi）を
 * 「表示」かつ「テーマに合った文字色」に確実に保つ。
 *
 * ## 根本原因
 * コード実行 WebView（WKWebView）はネイティブのマウント/クリーンアップ時に、iOS の
 * アプリレベル・ステータスバー状態を破壊する（隠す・文字色を黒へ戻す）。
 * （C++ は Wandbox への fetch 実行で WebView を使わないため症状が出ない＝WebView が原因の裏付け）
 * さらに、一度壊れた基準状態は **キーボード解除・cmd+tab 復帰・画面マウント** のたびに再適用される。
 *
 * ## 対策
 * フォーカス中は次のすべての契機で「表示＋正しい文字色」を無条件に再アサートする：
 *  - フォーカス直後（0/200/550ms の多段タイマー：WebView クリーンアップの遅延に打ち勝つ）
 *  - キーボードの表示/非表示（カーソル解除で消える/黒くなるケース）
 *  - アプリのフォアグラウンド復帰（cmd+tab で戻ったケース）
 *
 * このフックを使う画面はすべて **高さ固定のカスタムヘッダー（useLockedTopInset）** を採用しており、
 * ステータスバーの表示/非表示でヘッダー高さが変わらない。そのため setStatusBarHidden(false) を
 * 無条件に呼んでもヘッダーは動かず「揺れ」は出ない（＝ここで表示状態を条件分岐する必要はない）。
 * かつて標準ヘッダーのモーダルに対しては無条件呼び出しが safe-area 再計算を誘発して揺れたため
 * insets ガードを入れていたが、そのガードは復元漏れ（時計が戻らない）を招くので撤去した。
 *
 * 学習セッションはフルスクリーン時に意図的にステータスバーを隠すため、このフックは使わない
 * （学習画面は自前の <StatusBar hidden> と setStatusBarHidden で管理する）。
 */
export function useRestoreStatusBar() {
  const theme = useTheme();
  const focusedRef = useRef(false);
  // 最新の dark フラグをリスナー（キーボード/AppState）と deps:[] の effect から参照するための ref。
  // ライブなテーマ切替は root の <StatusBar style> が反映するため、この effect は再購読不要。
  const darkRef = useRef(theme.dark);
  darkRef.current = theme.dark;

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;

      const restore = () => {
        if (!focusedRef.current) return;
        setStatusBarStyle(darkRef.current ? 'light' : 'dark', false);
        setStatusBarHidden(false, 'none');
      };

      restore();
      const t1 = setTimeout(restore, 200);
      const t2 = setTimeout(restore, 550);

      // カーソル挿入/解除（キーボード表示/非表示）で壊れた基準状態を打ち消す。
      const kbShow = Keyboard.addListener('keyboardDidShow', restore);
      const kbHide = Keyboard.addListener('keyboardDidHide', restore);
      // cmd+tab で別アプリから戻ったときに再アサート。
      const appSub = AppState.addEventListener('change', (next) => {
        if (next === 'active') restore();
      });

      return () => {
        focusedRef.current = false;
        clearTimeout(t1);
        clearTimeout(t2);
        kbShow.remove();
        kbHide.remove();
        appSub.remove();
      };
    }, []),
  );
}
