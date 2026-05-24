import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import { useSyncStore } from '@/store/sync';

import { requestDbSwap } from './dbSwap';
import {
  downloadDb,
  getRemoteStatus,
  ICloudPaths,
  isICloudAvailable,
  replaceLocalDb,
  uploadDb,
  type RemoteDbMeta,
} from './icloud';

async function createDbSnapshot(db: SQLiteDatabase): Promise<void> {
  // 既存スナップショットがあると VACUUM INTO はエラーになるので必ず削除
  await FileSystem.deleteAsync(ICloudPaths.LOCAL_SNAPSHOT_PATH, { idempotent: true });
  await FileSystem.deleteAsync(`${ICloudPaths.LOCAL_SNAPSHOT_PATH}-wal`, { idempotent: true });
  await FileSystem.deleteAsync(`${ICloudPaths.LOCAL_SNAPSHOT_PATH}-shm`, { idempotent: true });
  await FileSystem.deleteAsync(`${ICloudPaths.LOCAL_SNAPSHOT_PATH}-journal`, { idempotent: true });

  // VACUUM INTO は SQLite が認識するファイルパス（file:// ではなく素のパス）を要求
  // シングルクォートはエスケープ
  const escaped = ICloudPaths.LOCAL_SNAPSHOT_PATH_PLAIN.replace(/'/g, "''");
  await db.execAsync(`VACUUM INTO '${escaped}';`);
}

/**
 * DB スキーマ互換性の判定に使うバージョン番号。
 * スキーマに後方互換性のない変更を加えたときにインクリメントする。
 * リモートの schemaVersion がローカルより新しい場合はダウンロードを拒否する。
 */
export const SYNC_SCHEMA_VERSION = 1;

export type SyncAction = 'upload' | 'download' | 'auto';

export class ICloudUnavailableError extends Error {
  constructor() {
    super('iCloud unavailable');
    this.name = 'ICloudUnavailableError';
  }
}

export class SchemaVersionMismatchError extends Error {
  constructor(public localVersion: number, public remoteVersion: number) {
    super(`Schema version mismatch: local=${localVersion} remote=${remoteVersion}`);
    this.name = 'SchemaVersionMismatchError';
  }
}

export class NoRemoteBackupError extends Error {
  constructor() {
    super('No remote backup found');
    this.name = 'NoRemoteBackupError';
  }
}

async function getLocalDbMtime(): Promise<number | null> {
  const info = await FileSystem.getInfoAsync(ICloudPaths.LOCAL_DB_PATH);
  if (!info.exists) return null;
  // expo-file-system の modificationTime は秒単位（epoch seconds）
  return Math.floor((info.modificationTime ?? 0) * 1000);
}

/**
 * 同期方向を決定。null は no-op（同期する必要なし）。
 *
 * 判定方針：
 * - lastSyncedAt（この端末で最後に同期した時刻）を基準に「ローカル変更」「リモート変更」を判定する
 * - lastSyncedAt が null（再インストール直後・初回）の場合はリモートがあれば必ず download
 *   （ローカルファイルの mtime はマイグレーション直後で「新しい」ように見えるため、
 *    mtime 比較だけで判定すると空 DB を上書きアップロードしてしまう）
 */
function decideDirection(
  action: SyncAction,
  remote: Awaited<ReturnType<typeof getRemoteStatus>>,
  localMtime: number | null,
  lastSyncedAt: number | null,
): 'upload' | 'download' | null {
  if (action === 'upload') return 'upload';
  if (action === 'download') {
    if (!remote.exists) throw new NoRemoteBackupError();
    return 'download';
  }

  // === auto ===

  // リモートが空：初回バックアップとしてアップロード
  if (!remote.exists) return 'upload';

  // meta 欠落（旧フォーマット等）はローカルを優先してアップロード
  if (!remote.meta) return 'upload';

  // スキーマバージョン互換性チェック
  if (remote.meta.schemaVersion > SYNC_SCHEMA_VERSION) {
    throw new SchemaVersionMismatchError(SYNC_SCHEMA_VERSION, remote.meta.schemaVersion);
  }

  // この端末で同期したことがない（再インストール・初回有効化）→ リモートを取得して復元
  if (lastSyncedAt == null) return 'download';

  // 最後の同期以降の変更を判定
  const localChanged = localMtime != null && localMtime > lastSyncedAt;
  const remoteChanged = remote.meta.updatedAt > lastSyncedAt;

  if (remoteChanged && localChanged) {
    // 両方で変更：LWW（直近のタイムスタンプを採用）
    return (localMtime ?? 0) > remote.meta.updatedAt ? 'upload' : 'download';
  }
  if (remoteChanged) return 'download';
  if (localChanged) return 'upload';
  return null;
}

/**
 * 同期処理本体。同時実行は禁止（status が 'syncing' の間は重複呼び出しを無視）。
 *
 * @param db SQLite ハンドル（WAL チェックポイントに必要）
 * @param action 'upload' | 'download' | 'auto'
 *   - 'auto'：ローカル mtime と remote meta.updatedAt を比較し、新しい方を採用
 *   - 'upload'：強制アップロード
 *   - 'download'：強制ダウンロード（remote が無ければ NoRemoteBackupError）
 */
export async function syncNow(db: SQLiteDatabase, action: SyncAction = 'auto'): Promise<void> {
  const sync = useSyncStore.getState();

  if (sync.status === 'syncing') return;
  if (!sync.hydrated) return;

  sync.clearError();
  // 方向確定前のネットワーク処理（getRemoteStatus 等）の間に
  // 二重タップで syncNow が並列起動するのを防ぐため、await する前に即ロックする。
  sync.setStatus('syncing');

  if (!(await isICloudAvailable())) {
    sync.setError('iCloudが利用できません');
    throw new ICloudUnavailableError();
  }

  try {
    // WAL の差分をメイン DB に統合（VACUUM INTO は読み取り専用だが念のため）
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');

    const remote = await getRemoteStatus();
    const localMtime = await getLocalDbMtime();
    const direction = decideDirection(action, remote, localMtime, sync.lastSyncedAt);

    if (direction === null) {
      // 同期する必要なし（自分が上げた最新版がリモートにあり、ローカルに変更も無い）
      sync.setLastSyncedAt(Date.now());
      sync.setStatus('idle');
      return;
    }

    sync.setStatus('syncing', direction);

    if (direction === 'upload') {
      // VACUUM INTO でトランザクション的に一貫した完全コピーを別ファイルに作成。
      // 直接 codeflash.db を上げると WAL の未統合分が抜け落ちる可能性がある。
      await createDbSnapshot(db);
      const meta: RemoteDbMeta = {
        updatedAt: Date.now(),
        deviceId: sync.deviceId,
        schemaVersion: SYNC_SCHEMA_VERSION,
      };
      await uploadDb(meta);
    } else {
      const downloadedPath = await downloadDb();
      await requestDbSwap(async () => {
        await replaceLocalDb(downloadedPath);
      });
    }

    sync.setLastSyncedAt(Date.now());
    sync.setStatus('idle');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sync.setError(message);
    throw e;
  }
}
