import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

interface ICloudKVNative {
  isICloudAvailable(): boolean;
  getString(key: string): string | null;
  setString(key: string, value: string): boolean;
  removeKey(key: string): void;
}

// 遅延ロード：iOS 以外やモジュール未リンク環境（Expo Go 等）で import 時にクラッシュしないよう、
// requireNativeModule の呼び出しは最初の利用時まで遅らせる（modules/background-task と同じ流儀）。
let cached: ICloudKVNative | null | undefined;
function getNativeModule(): ICloudKVNative | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios') {
    cached = null;
    return cached;
  }
  try {
    cached = requireNativeModule<ICloudKVNative>('CodeflashICloudKV');
  } catch {
    cached = null;
  }
  return cached;
}

/** ネイティブモジュールがリンクされているか（Expo Go・旧ビルドでは false）。診断用。 */
export function isICloudKVLinked(): boolean {
  return getNativeModule() != null;
}

/** iCloud にサインインしているか（KV が Apple ID と同期されるかの目安）。利用不可環境では false。 */
export function isICloudKVAvailable(): boolean {
  const m = getNativeModule();
  if (!m) return false;
  try {
    return m.isICloudAvailable();
  } catch {
    return false;
  }
}

/** iCloud KV から文字列を読む。未設定・利用不可環境では null。 */
export function getICloudKVString(key: string): string | null {
  const m = getNativeModule();
  if (!m) return null;
  try {
    return m.getString(key);
  } catch {
    return null;
  }
}

/** iCloud KV へ文字列を書く。@returns synchronize が受理されたか（利用不可環境では false）。 */
export function setICloudKVString(key: string, value: string): boolean {
  const m = getNativeModule();
  if (!m) return false;
  try {
    return m.setString(key, value);
  } catch {
    return false;
  }
}

/** iCloud KV からキーを削除する（利用不可環境では何もしない）。 */
export function removeICloudKVKey(key: string): void {
  const m = getNativeModule();
  if (!m) return;
  try {
    m.removeKey(key);
  } catch {
    // ignore
  }
}
