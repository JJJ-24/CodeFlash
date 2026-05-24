import * as FileSystem from 'expo-file-system/legacy';
import {
  createDirAsync,
  defaultICloudContainerPath,
  downloadFileAsync,
  isExistAsync,
  isICloudAvailableAsync,
  unlinkAsync,
  uploadFileAsync,
} from '@oleg_svetlichnyi/expo-icloud-storage';

const REMOTE_DIR = 'Database';
const REMOTE_DB_FILENAME = 'codeflash.db';
const REMOTE_META_FILENAME = 'codeflash.meta.json';
const REMOTE_DB_RELATIVE_PATH = `${REMOTE_DIR}/${REMOTE_DB_FILENAME}`;
const REMOTE_META_RELATIVE_PATH = `${REMOTE_DIR}/${REMOTE_META_FILENAME}`;

const LOCAL_DB_PATH = `${FileSystem.documentDirectory}SQLite/codeflash.db`;
const LOCAL_DB_PATH_PLAIN = LOCAL_DB_PATH.replace(/^file:\/\//, '');
const LOCAL_SNAPSHOT_PATH = `${FileSystem.documentDirectory}SQLite/codeflash.sync-snapshot.db`;
const LOCAL_SNAPSHOT_PATH_PLAIN = LOCAL_SNAPSHOT_PATH.replace(/^file:\/\//, '');
const LOCAL_DOWNLOAD_DIR = `${FileSystem.documentDirectory}SQLite/icloud-download`;
const LOCAL_META_TMP_PATH = `${LOCAL_DOWNLOAD_DIR}/codeflash.meta.json`;
const LOCAL_META_UPLOAD_TMP_PATH = `${FileSystem.documentDirectory}SQLite/codeflash.meta.upload.json`;

export interface RemoteDbMeta {
  updatedAt: number;
  deviceId: string;
  schemaVersion: number;
}

export interface RemoteStatus {
  exists: boolean;
  meta: RemoteDbMeta | null;
}

/** iCloud が現在の端末／ユーザーで利用可能かを判定 */
export async function isICloudAvailable(): Promise<boolean> {
  try {
    const available = await isICloudAvailableAsync();
    return Boolean(available && defaultICloudContainerPath);
  } catch {
    return false;
  }
}

async function ensureRemoteDirectory(): Promise<void> {
  const exists = await isExistAsync(REMOTE_DIR, true);
  if (!exists) {
    await createDirAsync(REMOTE_DIR);
  }
}

async function ensureLocalDownloadDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(LOCAL_DOWNLOAD_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(LOCAL_DOWNLOAD_DIR, { intermediates: true });
  }
}

/** リモートの DB と meta の状態を取得 */
export async function getRemoteStatus(): Promise<RemoteStatus> {
  if (!defaultICloudContainerPath) {
    return { exists: false, meta: null };
  }
  const dbExists = await isExistAsync(REMOTE_DB_RELATIVE_PATH, false);
  if (!dbExists) {
    return { exists: false, meta: null };
  }
  const metaExists = await isExistAsync(REMOTE_META_RELATIVE_PATH, false);
  if (!metaExists) {
    return { exists: true, meta: null };
  }
  try {
    await ensureLocalDownloadDir();
    // ライブラリのキャッシュ不具合への対策: 事前にローカルキャッシュを削除
    await FileSystem.deleteAsync(`${LOCAL_DOWNLOAD_DIR}/${REMOTE_META_FILENAME}`, { idempotent: true });
    const remoteMetaFullPath = `${defaultICloudContainerPath}/Documents/${REMOTE_META_RELATIVE_PATH}`;
    const downloadedPath = await downloadFileAsync(remoteMetaFullPath, LOCAL_DOWNLOAD_DIR);
    const text = await FileSystem.readAsStringAsync(downloadedPath);
    const parsed = JSON.parse(text) as Partial<RemoteDbMeta>;
    if (
      typeof parsed.updatedAt === 'number' &&
      typeof parsed.deviceId === 'string' &&
      typeof parsed.schemaVersion === 'number'
    ) {
      return { exists: true, meta: parsed as RemoteDbMeta };
    }
    return { exists: true, meta: null };
  } catch {
    return { exists: true, meta: null };
  }
}

/** スナップショット用 一時ファイルを完全削除（WAL/SHM 残骸も含めて） */
async function cleanupSnapshot(): Promise<void> {
  await FileSystem.deleteAsync(LOCAL_SNAPSHOT_PATH, { idempotent: true });
  await FileSystem.deleteAsync(`${LOCAL_SNAPSHOT_PATH}-wal`, { idempotent: true });
  await FileSystem.deleteAsync(`${LOCAL_SNAPSHOT_PATH}-shm`, { idempotent: true });
  await FileSystem.deleteAsync(`${LOCAL_SNAPSHOT_PATH}-journal`, { idempotent: true });
}

/**
 * ローカル DB のスナップショットを iCloud にアップロード（meta も一緒に上げる）。
 * 呼び出し側で事前に `VACUUM INTO 'codeflash.sync-snapshot.db'` を実行し、
 * 完全コピーを LOCAL_SNAPSHOT_PATH に作成しておく必要がある。
 *
 * 注意: ライブラリ内部の `setUbiquitous` は destinationURL が既に存在する場合 silent fail する。
 * そのため事前にリモートの既存ファイルを必ず削除する。
 */
export async function uploadDb(meta: RemoteDbMeta): Promise<void> {
  if (!defaultICloudContainerPath) {
    throw new Error('iCloud is not available');
  }
  const snapshotInfo = await FileSystem.getInfoAsync(LOCAL_SNAPSHOT_PATH);
  if (!snapshotInfo.exists) {
    throw new Error('Snapshot file not found. Call VACUUM INTO before uploadDb.');
  }
  await ensureRemoteDirectory();
  try {
    // ライブラリの上書き不具合への対策: 事前にリモートの既存ファイルを削除
    const remoteDbFullPath = `${defaultICloudContainerPath}/Documents/${REMOTE_DB_RELATIVE_PATH}`;
    const remoteMetaFullPath = `${defaultICloudContainerPath}/Documents/${REMOTE_META_RELATIVE_PATH}`;
    if (await isExistAsync(REMOTE_DB_RELATIVE_PATH, false)) {
      await unlinkAsync(remoteDbFullPath);
    }
    if (await isExistAsync(REMOTE_META_RELATIVE_PATH, false)) {
      await unlinkAsync(remoteMetaFullPath);
    }

    await uploadFileAsync({
      destinationPath: REMOTE_DB_RELATIVE_PATH,
      filePath: LOCAL_SNAPSHOT_PATH,
    });
    await FileSystem.writeAsStringAsync(LOCAL_META_UPLOAD_TMP_PATH, JSON.stringify(meta));
    await uploadFileAsync({
      destinationPath: REMOTE_META_RELATIVE_PATH,
      filePath: LOCAL_META_UPLOAD_TMP_PATH,
    });
    await FileSystem.deleteAsync(LOCAL_META_UPLOAD_TMP_PATH, { idempotent: true });
  } finally {
    await cleanupSnapshot();
  }
}

/**
 * iCloud から DB をダウンロードし、ローカルダウンロードディレクトリに保存。
 * 戻り値はダウンロード済み DB ファイルへのフルパス。DB を close してから replaceLocalDb で差し替える。
 *
 * 注意: ライブラリ内部の downloadFileAsync は destinationDir に同名ファイルがあるとコピーせず
 * 古いキャッシュのパスをそのまま返してしまう。そのため事前にキャッシュを削除する。
 */
export async function downloadDb(): Promise<string> {
  if (!defaultICloudContainerPath) {
    throw new Error('iCloud is not available');
  }
  await ensureLocalDownloadDir();
  // ライブラリのキャッシュ不具合への対策: 事前にローカルキャッシュを削除
  await FileSystem.deleteAsync(`${LOCAL_DOWNLOAD_DIR}/${REMOTE_DB_FILENAME}`, { idempotent: true });
  const remoteFullPath = `${defaultICloudContainerPath}/Documents/${REMOTE_DB_RELATIVE_PATH}`;
  const downloadedPath = await downloadFileAsync(remoteFullPath, LOCAL_DOWNLOAD_DIR);
  return downloadedPath;
}

/** ダウンロード済みファイルをローカル DB に差し替える（DB が close されている前提） */
export async function replaceLocalDb(downloadedPath: string): Promise<void> {
  // 古い WAL/SHM は新しい DB と互換性が無いので必ず削除する
  await FileSystem.deleteAsync(`${LOCAL_DB_PATH}-wal`, { idempotent: true });
  await FileSystem.deleteAsync(`${LOCAL_DB_PATH}-shm`, { idempotent: true });

  const localInfo = await FileSystem.getInfoAsync(LOCAL_DB_PATH);
  if (localInfo.exists) {
    await FileSystem.deleteAsync(LOCAL_DB_PATH, { idempotent: true });
  }
  await FileSystem.moveAsync({ from: downloadedPath, to: LOCAL_DB_PATH });
  await FileSystem.deleteAsync(LOCAL_META_TMP_PATH, { idempotent: true });
}

/** リモート DB と meta を削除 */
export async function deleteRemoteDb(): Promise<void> {
  if (!defaultICloudContainerPath) return;
  const remoteDbFullPath = `${defaultICloudContainerPath}/Documents/${REMOTE_DB_RELATIVE_PATH}`;
  const remoteMetaFullPath = `${defaultICloudContainerPath}/Documents/${REMOTE_META_RELATIVE_PATH}`;
  if (await isExistAsync(REMOTE_DB_RELATIVE_PATH, false)) {
    await unlinkAsync(remoteDbFullPath);
  }
  if (await isExistAsync(REMOTE_META_RELATIVE_PATH, false)) {
    await unlinkAsync(remoteMetaFullPath);
  }
}

export const ICloudPaths = {
  LOCAL_DB_PATH,
  LOCAL_DB_PATH_PLAIN,
  LOCAL_SNAPSHOT_PATH,
  LOCAL_SNAPSHOT_PATH_PLAIN,
  LOCAL_DOWNLOAD_DIR,
  REMOTE_DB_RELATIVE_PATH,
  REMOTE_META_RELATIVE_PATH,
} as const;
