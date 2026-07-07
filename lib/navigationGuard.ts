import { router } from 'expo-router';

/**
 * 素早いダブルタップで同じ画面が2枚 push される問題のグローバル対策。
 *
 * expo-router の `useRouter()` は imperative-api のシングルトン `router` をそのまま返すため、
 * ここで `router.push` を一度ラップするだけで全 call site（ボタンタップ・キーボードショートカット）に効く。
 * 「同一 href への push が窓時間内に連続したら2回目以降を無視」する方式なので、
 * 別画面への素早い連続操作は妨げない（ダブルタップは必ず同一 href になる）。
 *
 * `navigate`（タブ切替で使用）は既存ルートがあれば再利用され重複 push が起きないため対象外。
 * `replace` も同画面の置換で実害がないため対象外。
 */

const DOUBLE_PUSH_WINDOW_MS = 500;

export function installNavigationGuard() {
  if ((router.push as any).__doublePushGuarded) return; // Fast Refresh での二重ラップ防止
  const origPush = router.push.bind(router);
  let lastKey = '';
  let lastAt = 0;
  const guardedPush: typeof router.push = (href, options) => {
    // 同一 call site のダブルタップなら key は完全一致する（object 形式でもキー順が同じ）。
    const key = typeof href === 'string' ? href : JSON.stringify(href);
    const now = Date.now();
    if (key === lastKey && now - lastAt < DOUBLE_PUSH_WINDOW_MS) return;
    lastKey = key;
    lastAt = now;
    origPush(href, options);
  };
  (guardedPush as any).__doublePushGuarded = true;
  router.push = guardedPush;
}
