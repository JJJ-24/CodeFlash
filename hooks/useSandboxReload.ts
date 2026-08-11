import { useCallback, useRef, useState } from 'react';

/**
 * 直前のリロードからこれ以内に来た再リロードは無視する。`onload` で自動 submit する
 * カードが無限リロードにならないようにするだけで、人のタップはこの間隔に掛からない。
 */
const RELOAD_MIN_INTERVAL_MS = 500;

/** サンドボックス文書自身を指す URL か（`action=""` / `action="#"` の送信先がこれになる）。 */
function isSandboxDocument(url: string): boolean {
  return url.split('#')[0].split('?')[0] === 'about:blank';
}

/** `onShouldStartLoadWithRequest` が受け取るイベントのうち、ここで使う分だけ。 */
interface NavigationRequest {
  url: string;
  navigationType: string;
}

/**
 * この遷移を「サンドボックス文書自身へのリロード」とみなすか（＝キャンセルして作り直す対象か）。
 *
 * 判定は **`navigationType` が先**。URL だけで見ると `<iframe>`（src 無し）の about:blank 読み込みや
 * 初回ロードまで拾ってリロードが暴走する。`href="#sec"` のページ内アンカーは `click` なので
 * ここで false になり、従来どおりスクロールする。
 */
export function isSandboxReloadNavigation(req: NavigationRequest): boolean {
  const type = req.navigationType;
  if (type !== 'formsubmit' && type !== 'formresubmit' && type !== 'reload') return false;
  return isSandboxDocument(req.url);
}

/**
 * `action=""` / `action="#"` のフォーム送信を「リロード」として扱うためのフック。
 *
 * ブラウザではこの送信は**同じ URL への再取得＝リロード**になり、入力欄が空のページが
 * 描き直される。ところがこのプレビューは `loadHTMLString` で流し込んだ HTML を
 * `about:blank` に載せているだけなので、素通しすると about:blank へ遷移して
 * **中身の無い真っ白なページ**になり戻ってこない（再取得できる元が無いため）。
 *
 * そこで「サンドボックス文書自身への送信」だけをキャンセルし、代わりに WebView を作り直す。
 * 同じ HTML が最初から描き直される＝**ブラウザのリロードと同じ見え方**になる。
 *
 * - 対象の判定は `isSandboxReloadNavigation`（上）。**URL だけで判定してはいけない**理由もそちら
 * - 暴走防止に連続リロードは `RELOAD_MIN_INTERVAL_MS` で間引く
 * - **外部 URL への送信・リンクは素通しする**（ブラウザ同様に遷移させる＝2026-08-11 の方針。
 *   遷移を止めるガードは一度実装して差し戻した経緯があるので再実装しないこと）
 * - キャンセルしてもエラー画面は出ない（`RNCWebViewImpl` が `NSURLErrorCancelled` と
 *   `WebKitErrorDomain` 101/102 を無視するため）
 *
 * 使い方：WebView の `key` に `reloadNonce` を混ぜ、`onShouldStartLoadWithRequest` を渡す。
 */
export function useSandboxReload() {
  const [reloadNonce, setReloadNonce] = useState(0);
  const lastReloadAtRef = useRef(0);

  const onShouldStartLoadWithRequest = useCallback((req: NavigationRequest) => {
    if (!isSandboxReloadNavigation(req)) return true;
    const now = Date.now();
    if (now - lastReloadAtRef.current >= RELOAD_MIN_INTERVAL_MS) {
      lastReloadAtRef.current = now;
      setReloadNonce((n) => n + 1);
    }
    return false;
  }, []);

  return { reloadNonce, onShouldStartLoadWithRequest };
}
