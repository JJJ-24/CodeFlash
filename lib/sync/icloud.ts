import * as FileSystem from 'expo-file-system/legacy';
import {
  createDirAsync,
  defaultICloudContainerPath,
  downloadFileAsync,
  isExistAsync,
  isICloudAvailableAsync,
  readDirAsync,
  unlinkAsync,
  uploadFileAsync,
} from '@oleg_svetlichnyi/expo-icloud-storage';
import { requireNativeModule } from 'expo-modules-core';

// 「配置で完了とみなす」アップロード（setUbiquitous で iCloud コンテナに配置できたら完了。
// 実バイト転送は OS が裏で完遂する）。これにより大量データのバックグラウンドアップロードが
// iOS の実行時間制限内に収まる。ネイティブの uploadFileStagedAsync（patch で追加）を直接呼ぶ。
interface IcloudNativeModule {
  uploadFileStagedAsync?: (destinationPath: string, filePath: string) => Promise<string>;
}
let nativeIcloud: IcloudNativeModule | null | undefined;
function getNativeIcloud(): IcloudNativeModule | null {
  if (nativeIcloud !== undefined) return nativeIcloud;
  try {
    nativeIcloud = requireNativeModule<IcloudNativeModule>('ExpoIcloudStorage');
  } catch {
    nativeIcloud = null;
  }
  return nativeIcloud;
}

/**
 * ファイルを1つ「配置で完了とみなす」方式でアップロードする。
 * setUbiquitous で iCloud コンテナに配置できたら即完了とみなす（実バイト転送は OS が裏で完遂する）。
 * これにより大量データでも iOS のバックグラウンド実行時間制限内に確実にステージできる。
 *
 * 転送完了まで待っても相手端末への到達は早まらない（遅延の主因は Apple の端末間伝播であり、
 * アプリからは短縮できないことを実機で確認済み）。そのため待たずに配置で完了とする。
 * ネイティブに uploadFileStagedAsync（patch 追加分）が無い旧バイナリは uploadFileAsync にフォールバック。
 */
async function uploadFileStaged(destinationPath: string, filePath: string): Promise<void> {
  const native = getNativeIcloud();
  if (native && typeof native.uploadFileStagedAsync === 'function') {
    await native.uploadFileStagedAsync(destinationPath, filePath);
    return;
  }
  await uploadFileAsync({ destinationPath, filePath });
}

const REMOTE_DIR = 'Database';
const REMOTE_DB_FILENAME = 'codeflash.db';
const REMOTE_META_FILENAME = 'codeflash.meta.json';
const REMOTE_DB_RELATIVE_PATH = `${REMOTE_DIR}/${REMOTE_DB_FILENAME}`;
const REMOTE_META_RELATIVE_PATH = `${REMOTE_DIR}/${REMOTE_META_FILENAME}`;

// 画像はファイル名が一意かつ内容不変（追加と削除のみ）なので、DB の Database/ とは別フォルダに
// 追加のみ（add-only）で同期する。Database/ のようにアップロード前に一掃しない。
const REMOTE_IMAGES_DIR = 'Images';

const LOCAL_DB_PATH = `${FileSystem.documentDirectory}SQLite/codeflash.db`;
const LOCAL_DB_PATH_PLAIN = LOCAL_DB_PATH.replace(/^file:\/\//, '');
const LOCAL_SNAPSHOT_PATH = `${FileSystem.documentDirectory}SQLite/codeflash.sync-snapshot.db`;
const LOCAL_SNAPSHOT_PATH_PLAIN = LOCAL_SNAPSHOT_PATH.replace(/^file:\/\//, '');
const LOCAL_DOWNLOAD_DIR = `${FileSystem.documentDirectory}SQLite/icloud-download`;
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
 * Database ディレクトリ内の全ファイルを削除する（best-effort）。
 * ライブラリは既存ファイルを上書きできないため、アップロード前に消しておく必要がある。
 * ついでに過去の競合コピー（"codeflash 2.db" 等）の残骸も一掃して自己修復する。
 * 個々の unlink 失敗は無視する（次回アップロード前の掃除で再試行される）。
 */
async function clearRemoteDir(): Promise<void> {
  if (!defaultICloudContainerPath) return;
  let paths: string[] = [];
  try {
    paths = await readDirAsync(REMOTE_DIR, { isFullPath: true });
  } catch {
    return;
  }
  for (const p of paths) {
    try {
      await unlinkAsync(p);
    } catch {
      // 無視
    }
  }
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
    // ライブラリは上書き不可のため、アップロード前に既存ファイル（＋競合コピーの残骸）を一掃する。
    await clearRemoteDir();

    // DB → meta の順でアップロードする。meta が「コミット標識」であり、
    // getRemoteStatus は meta が揃って初めて有効なリモートとして扱うため、
    // 途中で失敗しても不整合（DB だけ／meta だけ）を検出できる。
    await uploadFileStaged(REMOTE_DB_RELATIVE_PATH, LOCAL_SNAPSHOT_PATH);
    await FileSystem.writeAsStringAsync(LOCAL_META_UPLOAD_TMP_PATH, JSON.stringify(meta));
    await uploadFileStaged(REMOTE_META_RELATIVE_PATH, LOCAL_META_UPLOAD_TMP_PATH);
    await FileSystem.deleteAsync(LOCAL_META_UPLOAD_TMP_PATH, { idempotent: true });
  } finally {
    await cleanupSnapshot();
  }
}

/**
 * iCloud から DB をダウンロードし、ローカルダウンロードディレクトリに保存。
 * 戻り値はダウンロード済み DB ファイルへのフルパス。これを ATTACH してデータを入れ替える。
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

async function ensureRemoteImagesDir(): Promise<void> {
  const exists = await isExistAsync(REMOTE_IMAGES_DIR, true);
  if (!exists) {
    await createDirAsync(REMOTE_IMAGES_DIR);
  }
}

/** iCloud 上のパス／ファイル名を実ファイル名に正規化する。
 *  未ダウンロードのファイルは `.<name>.icloud` プレースホルダ名で現れるため、
 *  先頭のディレクトリと `.icloud` 修飾を剥がして実ファイル名を取り出す。 */
function normalizeRemoteFilename(pathOrName: string): string {
  let name = pathOrName.split('/').pop() ?? pathOrName;
  if (name.startsWith('.') && name.endsWith('.icloud')) {
    name = name.slice(1, -'.icloud'.length);
  }
  return name;
}

/** リモート Images/ フォルダにある画像ファイル名の一覧を返す（実体・プレースホルダ両方を実名に正規化）。 */
export async function listRemoteImageFilenames(): Promise<string[]> {
  if (!defaultICloudContainerPath) return [];
  const exists = await isExistAsync(REMOTE_IMAGES_DIR, true);
  if (!exists) return [];
  let paths: string[] = [];
  try {
    paths = await readDirAsync(REMOTE_IMAGES_DIR, { isFullPath: true });
  } catch {
    return [];
  }
  return paths.map(normalizeRemoteFilename).filter((n) => n.length > 0);
}

/** ローカル画像 1 件を iCloud の Images/ にアップロードする（add-only。同名は再アップしない前提）。 */
export async function uploadImageFile(localFilePath: string, filename: string): Promise<void> {
  if (!defaultICloudContainerPath) {
    throw new Error('iCloud is not available');
  }
  await ensureRemoteImagesDir();
  await uploadFileStaged(`${REMOTE_IMAGES_DIR}/${filename}`, localFilePath);
}

/** iCloud の Images/ から画像 1 件を destinationDir にダウンロードし、ローカルパスを返す。 */
export async function downloadImageFile(filename: string, destinationDir: string): Promise<string> {
  if (!defaultICloudContainerPath) {
    throw new Error('iCloud is not available');
  }
  const remoteFullPath = `${defaultICloudContainerPath}/Documents/${REMOTE_IMAGES_DIR}/${filename}`;
  return downloadFileAsync(remoteFullPath, destinationDir);
}

/** iCloud の Images/ から画像 1 件を削除する。 */
export async function deleteRemoteImageFile(filename: string): Promise<void> {
  if (!defaultICloudContainerPath) return;
  const remoteFullPath = `${defaultICloudContainerPath}/Documents/${REMOTE_IMAGES_DIR}/${filename}`;
  await unlinkAsync(remoteFullPath);
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
