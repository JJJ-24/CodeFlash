/**
 * iPad のマルチウィンドウ（Split View / Stage Manager）では、隣のアプリが出した
 * キーボードの通知も自アプリに届く（iOS の isEventFromThisApp = false）。
 * 自アプリのキーボードにだけ反応したいリスナーは、これで他アプリ由来のイベントを弾く。
 * Android・iPhone では isEventFromThisApp が false になることはなく、常に素通しになる。
 */
export function isRemoteKeyboardEvent(e: { isEventFromThisApp?: boolean } | null | undefined): boolean {
  return e?.isEventFromThisApp === false;
}
