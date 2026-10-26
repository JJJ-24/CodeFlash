import type { KeyboardEvent } from 'react-native';

/**
 * iPad のマルチウィンドウ（Split View / Stage Manager）では、隣のアプリが出した
 * キーボードの通知も自アプリに届く（iOS の isEventFromThisApp = false）。
 * 自アプリのキーボードにだけ反応したいリスナーは、これで他アプリ由来のイベントを弾く。
 * Android・iPhone では isEventFromThisApp が false になることはなく、常に素通しになる。
 */
export function isRemoteKeyboardEvent(e: KeyboardEvent | null | undefined): boolean {
  // RN 0.88 の型では isEventFromThisApp を持つのは iOS の通知だけ（Android の通知には無い）
  return e != null && 'isEventFromThisApp' in e && e.isEventFromThisApp === false;
}
