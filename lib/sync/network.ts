import * as Network from 'expo-network';

export interface NetworkSnapshot {
  /** インターネットに到達できる（接続あり かつ 到達性が false でない）。 */
  online: boolean;
  /**
   * ネットワークインターフェースが接続している（WiFi/セルラー等が up）。到達性は問わない。
   * 「接続済みだが到達性は未確定」（= WiFi 接続直後の過渡状態）を online と区別するために使う。
   */
  connected: boolean;
}

/**
 * 現在のネットワーク状態を取得する。
 *
 * - `connected`: インターフェースが up かどうか（isConnected）。
 * - `online`: 実際にインターネットへ到達できそうか（isConnected かつ isInternetReachable）。
 *
 * `isInternetReachable` が undefined（判定不能）の環境では online を true 扱いにして、
 * オンラインなのに同期を止めてしまう事故を避ける（万一の誤判定は同期側のタイムアウトで保護）。
 */
export async function getNetworkSnapshot(): Promise<NetworkSnapshot> {
  try {
    const state = await Network.getNetworkStateAsync();
    const connected = state.isConnected !== false;
    const online = connected && state.isInternetReachable !== false;
    return { online, connected };
  } catch {
    // 判定そのものに失敗した場合は従来どおりオンライン扱い（同期側のタイムアウトで保護）
    return { online: true, connected: true };
  }
}

/**
 * 端末がインターネットに到達できるか（online）を判定する。
 *
 * iCloud のクロスデバイス同期は `isICloudAvailable()`（アカウント有無）が true でも、
 * ネットワークが無ければ「リモート一覧（.icloud プレースホルダ名）は取れるのに実体ダウンロードは
 * 数十秒ハングしてタイムアウトする」という無駄な処理に突入する。これを事前に弾くために使う。
 */
export async function isOnline(): Promise<boolean> {
  return (await getNetworkSnapshot()).online;
}
