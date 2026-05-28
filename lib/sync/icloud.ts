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

// 【一意ファイル名方式】アップロードごとに版を `codeflash.v<schema>.<updatedAt>.<deviceId>.db`
// という一意名で書く。同じ固定名を delete→再作成しないため、2端末がオフラインで同時に
// アップロードしても iCloud 衝突コピー（`codeflash 2.db`）が生まれず、読む側は一覧から
// 最新（updatedAt 最大）を選ぶだけで確実に収束する。メタ情報はファイル名に内包する
// （別 meta.json を持たない → db と meta が別々に衝突解決されて中身が食い違う危険も消える）。
const REMOTE_DB_PREFIX = 'codeflash.v';
const REMOTE_DB_SUFFIX = '.db';
/** `codeflash.v<schema>.<updatedAt>.<deviceId>.db` を組み立てる。deviceId はドット・空白を含まない前提。 */
function buildRemoteDbName(meta: RemoteDbMeta): string {
  return `${REMOTE_DB_PREFIX}${meta.schemaVersion}.${meta.updatedAt}.${meta.deviceId}${REMOTE_DB_SUFFIX}`;
}
/** リモート DB ファイル名を解析して meta を取り出す。形式不一致は null。 */
function parseRemoteDbName(filename: string): RemoteDbMeta | null {
  const m = /^codeflash\.v(\d+)\.(\d+)\.(.+)\.db$/.exec(filename);
  if (!m) return null;
  return { schemaVersion: Number(m[1]), updatedAt: Number(m[2]), deviceId: m[3] };
}

// 画像はファイル名が一意かつ内容不変（追加と削除のみ）なので、DB の Database/ とは別フォルダに
// 追加のみ（add-only）で同期する。
const REMOTE_IMAGES_DIR = 'Images';

const LOCAL_DB_PATH = `${FileSystem.documentDirectory}SQLite/codeflash.db`;
const LOCAL_DB_PATH_PLAIN = LOCAL_DB_PATH.replace(/^file:\/\//, '');
const LOCAL_SNAPSHOT_PATH = `${FileSystem.documentDirectory}SQLite/codeflash.sync-snapshot.db`;
const LOCAL_SNAPSHOT_PATH_PLAIN = LOCAL_SNAPSHOT_PATH.replace(/^file:\/\//, '');
const LOCAL_DOWNLOAD_DIR = `${FileSystem.documentDirectory}SQLite/icloud-download`;

export interface RemoteDbMeta {
  updatedAt: number;
  deviceId: string;
  schemaVersion: number;
}

export interface RemoteStatus {
  exists: boolean;
  meta: RemoteDbMeta | null;
  /** 採用した最新版 DB のリモートファイル名（download に渡す）。meta があるときのみ非 null。 */
  dbFilename: string | null;
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

/**
 * リモートの最新 DB 版を取得する。
 * Database/ 内の `codeflash.v<schema>.<updatedAt>.<deviceId>.db` を全て列挙し、
 * updatedAt が最大のものを「最新版」として返す（whole-file LWW）。メタ情報はファイル名から復元する。
 * meta を別ファイルとして読まないため、iCloud のクロスデバイス遅延中も一覧さえ取れれば判定できる。
 */
export async function getRemoteStatus(): Promise<RemoteStatus> {
  if (!defaultICloudContainerPath) {
    return { exists: false, meta: null, dbFilename: null };
  }
  let names: string[];
  try {
    const paths = await readDirAsync(REMOTE_DIR, { isFullPath: false });
    names = paths.map(normalizeRemoteFilename);
  } catch {
    // ディレクトリ未作成（初回）など → リモート無し扱い
    return { exists: false, meta: null, dbFilename: null };
  }

  let best: { filename: string; meta: RemoteDbMeta } | null = null;
  for (const name of names) {
    const meta = parseRemoteDbName(name);
    if (!meta || !Number.isFinite(meta.updatedAt)) continue;
    if (!best || meta.updatedAt > best.meta.updatedAt) {
      best = { filename: name, meta };
    }
  }

  if (!best) {
    // 一意名の版が1つも無い（旧形式 codeflash.db だけ等）→ 取り込み対象なし。
    // 同期済み端末は上書きしない安全ガード（decideDirection）に委ね、初回端末が新形式で publish する。
    return { exists: false, meta: null, dbFilename: null };
  }
  return { exists: true, meta: best.meta, dbFilename: best.filename };
}

/** スナップショット用 一時ファイルを完全削除（WAL/SHM 残骸も含めて） */
async function cleanupSnapshot(): Promise<void> {
  await FileSystem.deleteAsync(LOCAL_SNAPSHOT_PATH, { idempotent: true });
  await FileSystem.deleteAsync(`${LOCAL_SNAPSHOT_PATH}-wal`, { idempotent: true });
  await FileSystem.deleteAsync(`${LOCAL_SNAPSHOT_PATH}-shm`, { idempotent: true });
  await FileSystem.deleteAsync(`${LOCAL_SNAPSHOT_PATH}-journal`, { idempotent: true });
}

/**
 * 自分が今アップロードした版より古い DB 版ファイル（および旧形式・衝突コピーの残骸）を削除する（best-effort）。
 * updatedAt が自分以上の版（＝他端末が並行して上げた、より新しい／同等の版）は消さない。
 * これで容量を最新に追従させつつ、並行アップロードで相手の新しい版を誤って消す事故を防ぐ。
 * 個々の unlink 失敗は無視する（次回アップロード後の掃除で再試行される）。
 */
async function pruneOldDbFiles(keepUpdatedAt: number): Promise<void> {
  if (!defaultICloudContainerPath) return;
  let paths: string[] = [];
  try {
    paths = await readDirAsync(REMOTE_DIR, { isFullPath: true });
  } catch {
    return;
  }
  for (const p of paths) {
    const name = normalizeRemoteFilename(p);
    const meta = parseRemoteDbName(name);
    // 一意名でない残骸（旧 codeflash.db / codeflash.meta.json / codeflash 2.db / meta.json 等）は掃除対象。
    // 一意名の版は updatedAt が自分より新しい/同じものだけ残す。
    if (meta && meta.updatedAt >= keepUpdatedAt) continue;
    try {
      await unlinkAsync(p);
    } catch {
      // 無視（best-effort）
    }
  }
}

/**
 * ローカル DB のスナップショットを iCloud に一意名でアップロードする。
 * 呼び出し側で事前に `VACUUM INTO 'codeflash.sync-snapshot.db'` を実行し、
 * 完全コピーを LOCAL_SNAPSHOT_PATH に作成しておく必要がある。
 *
 * 一意名（`codeflash.v<schema>.<updatedAt>.<deviceId>.db`）なので既存ファイルを上書きしない
 * ＝ライブラリの「上書き silent fail」も衝突コピー（codeflash 2.db）も発生しない。
 * 配置完了したファイルそのものが「コミット標識」（別 meta.json を持たない）。
 * アップロード成功後に古い版を掃除する（meta コミット後に呼ぶ pruneRemoteImages と同じ思想）。
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
    await uploadFileStaged(`${REMOTE_DIR}/${buildRemoteDbName(meta)}`, LOCAL_SNAPSHOT_PATH);
  } finally {
    await cleanupSnapshot();
  }
  // 配置成功後に古い版・残骸を掃除（best-effort。自分以上の新しい並行版は残す）。
  try {
    await pruneOldDbFiles(meta.updatedAt);
  } catch {
    // 掃除失敗で同期本体は止めない
  }
}

/**
 * iCloud から指定された版の DB ファイルをダウンロードし、ローカルパスを返す。これを ATTACH して入れ替える。
 * @param dbFilename getRemoteStatus が返した最新版のファイル名（`codeflash.v....db`）。
 *
 * 注意: ライブラリ内部の downloadFileAsync は destinationDir に同名ファイルがあるとコピーせず
 * 古いキャッシュのパスをそのまま返してしまう。そのため事前にキャッシュを削除する。
 */
export async function downloadDb(dbFilename: string): Promise<string> {
  if (!defaultICloudContainerPath) {
    throw new Error('iCloud is not available');
  }
  await ensureLocalDownloadDir();
  // ライブラリのキャッシュ不具合への対策: 事前にローカルキャッシュを削除
  await FileSystem.deleteAsync(`${LOCAL_DOWNLOAD_DIR}/${dbFilename}`, { idempotent: true });
  const remoteFullPath = `${defaultICloudContainerPath}/Documents/${REMOTE_DIR}/${dbFilename}`;
  const downloadedPath = await downloadFileAsync(remoteFullPath, LOCAL_DOWNLOAD_DIR);
  return downloadedPath;
}

/** リモート Database/ 内の全 DB 版（旧形式・残骸含む）を削除する。 */
export async function deleteRemoteDb(): Promise<void> {
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
      // 無視（best-effort）
    }
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
} as const;
