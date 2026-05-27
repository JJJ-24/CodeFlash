import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

interface BackgroundTaskNative {
  beginTask(): number;
  endTask(id: number): void;
}

// 遅延ロード：iOS 以外やモジュール未リンク環境（Expo Go 等）で import 時にクラッシュしないよう、
// requireNativeModule の呼び出しは最初の利用時まで遅らせる。
let cached: BackgroundTaskNative | null | undefined;
function getNativeModule(): BackgroundTaskNative | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios') {
    cached = null;
    return cached;
  }
  try {
    cached = requireNativeModule<BackgroundTaskNative>('CodeflashBackgroundTask');
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * iOS のバックグラウンドタスクアサーション（`UIApplication.beginBackgroundTask`）を要求する。
 * アプリがバックグラウンドへ移行した後も最大 ~30 秒の実行時間を確保し、大量データの
 * スナップショット作成＋iCloud コンテナへの配置を凍結前に完了させるために使う。
 * @returns 終了時に {@link endBackgroundTask} へ渡すタスク ID。利用不可の環境では null。
 */
export function beginBackgroundTask(): number | null {
  const m = getNativeModule();
  if (!m) return null;
  try {
    return m.beginTask();
  } catch {
    return null;
  }
}

/** {@link beginBackgroundTask} で取得したタスクを終了する（null/失敗時は何もしない）。 */
export function endBackgroundTask(id: number | null): void {
  if (id == null) return;
  const m = getNativeModule();
  if (!m) return;
  try {
    m.endTask(id);
  } catch {
    // ignore
  }
}
