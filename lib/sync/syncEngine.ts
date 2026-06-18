import * as FileSystem from "expo-file-system/legacy";
import type { SQLiteDatabase } from "expo-sqlite";

import { getAllDecks } from "@/lib/database/decks";
import { getAllTags } from "@/lib/database/tags";
import {
  cleanupOrphanImages,
  ensureImageDir,
  getReferencedImageFilenames,
  IMAGE_DIR,
} from "@/lib/image";
import {
  beginBackgroundTask,
  endBackgroundTask,
} from "@/modules/background-task";
import { useDeckStore } from "@/store/decks";
import { useSyncStore, type SyncErrorCode } from "@/store/sync";
import { useTagStore } from "@/store/tags";

import {
  deleteRemoteDb,
  deleteRemoteImageFile,
  downloadDb,
  downloadImageFile,
  getRemoteStatus,
  ICloudPaths,
  isICloudAvailable,
  listRemoteImageFilenames,
  uploadDb,
  uploadImageFile,
  type RemoteDbMeta,
} from "./icloud";
import { getNetworkSnapshot, isOnline } from "./network";

// ダウンロード DB から入れ替えるテーブル（親→子の順。FK は未設定だが論理順を維持）
const SYNC_TABLES = [
  "decks",
  "tags",
  "cards",
  "card_contents",
  "card_tags",
  "reviews",
  "review_logs",
  "grade_logs",
] as const;

/**
 * リモート版の識別子（端末をまたいで一意）。`${deviceId}:${updatedAt}`。
 * リモート変更検知はこの識別子の一致/不一致で行う（時刻の大小比較は端末間の時計ズレに弱い）。
 */
function remoteMetaId(meta: RemoteDbMeta): string {
  return `${meta.deviceId}:${meta.updatedAt}`;
}

/**
 * リモートに「この端末がまだ取り込んでいない版」があるかを判定する。
 * 識別子（deviceId:updatedAt）の一致で見るため、端末間の時計ズレに左右されない。
 * これにより、相手端末の時計が進んでいて updatedAt が小さく見える更新でも取りこぼさない
 * （旧来の `updatedAt > watermark` 比較では、後から伝播してきた相手の更新を「古い」と
 * 誤判定して永久に取り込まず、2端末が各自の変更を抱えたまま固着するバグがあった）。
 * lastRemoteId が未保存（このフィールド導入前の旧データ）のときのみ、旧来のタイムスタンプ比較にフォールバックする。
 */
function isRemoteNew(
  meta: RemoteDbMeta,
  lastRemoteId: string | null,
  remoteWatermark: number | null,
  lastSyncedAt: number | null,
): boolean {
  if (lastRemoteId != null) return remoteMetaId(meta) !== lastRemoteId;
  return meta.updatedAt > (remoteWatermark ?? lastSyncedAt ?? 0);
}

async function tableColumns(
  db: SQLiteDatabase,
  schema: string,
  table: string,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA ${schema}.table_info(${table});`,
  );
  return rows.map((r) => r.name);
}

/**
 * ダウンロードした DB の内容で、開いている接続のデータを丸ごと入れ替える。
 * 旧方式（ファイル差し替え＋SQLiteProvider 再マウント）はナビゲーションツリー全体の
 * unmount を伴い、新アーキ(Fabric)の unmountChildComponentView アサーションで
 * クラッシュした。ATTACH＋テーブルコピーなら接続を閉じずに済むのでクラッシュしない。
 * カラムは main と remote の積集合のみコピーするためスキーマ差異にも耐える。
 */
async function replaceLocalDataFromDownloadedDb(
  db: SQLiteDatabase,
  downloadedPath: string,
): Promise<void> {
  const plain = downloadedPath.replace(/^file:\/\//, "");
  const escaped = plain.replace(/'/g, "''");
  // ATTACH は接続ローカルなので、同一接続で動く withTransactionAsync を使う
  // （withExclusiveTransactionAsync は別接続で実行され ATTACH が見えず "unknown database remotedb" になる）。
  await db.execAsync(`ATTACH DATABASE '${escaped}' AS remotedb;`);
  try {
    await db.withTransactionAsync(async () => {
      // 子から削除
      for (let i = SYNC_TABLES.length - 1; i >= 0; i--) {
        await db.execAsync(`DELETE FROM main.${SYNC_TABLES[i]};`);
      }
      // 親から挿入（main/remote 共通カラムのみ）
      for (const t of SYNC_TABLES) {
        const mainCols = await tableColumns(db, "main", t);
        const remoteCols = new Set(await tableColumns(db, "remotedb", t));
        const shared = mainCols.filter((c) => remoteCols.has(c));
        if (shared.length === 0) continue;
        const colList = shared.map((c) => `"${c}"`).join(",");
        await db.execAsync(
          `INSERT INTO main.${t} (${colList}) SELECT ${colList} FROM remotedb.${t};`,
        );
      }
    });
  } finally {
    await db.execAsync("DETACH DATABASE remotedb;");
  }
}

/** ダウンロード復元後、グローバルなインメモリキャッシュ（デッキ・タグ）を DB から再読込する。 */
async function refreshGlobalCaches(db: SQLiteDatabase): Promise<void> {
  const [decks, tags] = await Promise.all([getAllDecks(db), getAllTags(db)]);
  useDeckStore.getState().setDecks(decks);
  useTagStore.getState().setTags(tags);
}

/** 画像 1 枚あたりの転送タイムアウト（iCloud 転送が固まったら 1 枚を諦めて次へ）。 */
const IMAGE_TRANSFER_TIMEOUT_MS = 30_000;

/**
 * 【アップロード方向】ローカル DB が参照する画像のうちリモートに無いものを追加アップロードする。
 * 画像はファイル名が一意・内容不変なので add-only（同名は再アップしない・上書きしない）。
 * meta（コミット標識）を書く前に呼び、ここで失敗したら meta を書かずに中断することで、
 * 相手端末が「参照先の画像が無い DB」を取り込むのを防ぐ。
 */
async function uploadReferencedImages(db: SQLiteDatabase): Promise<void> {
  const referenced = await getReferencedImageFilenames(db);
  if (referenced.size === 0) return;
  const remote = new Set(await listRemoteImageFilenames());
  for (const filename of referenced) {
    if (remote.has(filename)) continue;
    const localPath = `${IMAGE_DIR}${filename}`;
    const info = await FileSystem.getInfoAsync(localPath);
    if (!info.exists) continue; // ローカルに実体が無い参照はスキップ（通常起きない）
    await withTimeout(uploadImageFile(localPath, filename), IMAGE_TRANSFER_TIMEOUT_MS);
  }
}

/**
 * 【アップロード方向・meta コミット後】最新 DB（今アップロードした版）が参照しない
 * リモート Images/ の画像を削除する。whole-file LWW では meta が指す最新 DB が唯一の正なので、
 * それが参照しない画像は将来どの端末でも不要になる前提。容量を最新状態に追従させる。
 * 必ず meta 書き込み成功後に呼ぶ（途中失敗時に現行リモート DB が参照中の画像を消さないため）。
 * best-effort：1 枚の削除失敗で同期本体は止めない（次回アップロード後に再試行される）。
 */
async function pruneRemoteImages(db: SQLiteDatabase): Promise<void> {
  const referenced = await getReferencedImageFilenames(db);
  let remote: string[];
  try {
    remote = await listRemoteImageFilenames();
  } catch {
    return;
  }
  for (const filename of remote) {
    if (referenced.has(filename)) continue;
    try {
      await withTimeout(deleteRemoteImageFile(filename), IMAGE_TRANSFER_TIMEOUT_MS);
    } catch {
      // 1 枚の削除失敗で他を止めない（best-effort）
    }
  }
}

/**
 * 【ダウンロード方向】入れ替え後の DB が参照する画像のうちローカルに無いものを取得する。
 * 画像取得の失敗は best-effort（壊れた画像表示になるだけで DB は安全、次回同期で回復する）。
 */
async function downloadReferencedImages(db: SQLiteDatabase): Promise<void> {
  const referenced = await getReferencedImageFilenames(db);
  if (referenced.size === 0) return;
  await ensureImageDir();
  const localFiles = new Set(await FileSystem.readDirectoryAsync(IMAGE_DIR));
  const remote = new Set(await listRemoteImageFilenames());
  for (const filename of referenced) {
    if (localFiles.has(filename)) continue;
    if (!remote.has(filename)) continue; // リモートにも無ければ取得しようがない
    try {
      await withTimeout(downloadImageFile(filename, IMAGE_DIR), IMAGE_TRANSFER_TIMEOUT_MS);
    } catch {
      // 1 枚の失敗で他の画像取得を止めない（best-effort）
    }
  }
}

/** 端末ローカルに残す自動バックアップの世代数（古いものから自動削除する）。 */
const MAX_LOCAL_BACKUPS = 3;
const LOCAL_BACKUP_DIR = `${FileSystem.documentDirectory}SQLite/sync-backups`;
const BACKUP_PREFIX = "codeflash.backup.";

/**
 * 【データ安全の安全網】ダウンロードでローカルデータを上書きする直前に、
 * 現在のローカル DB を端末ローカルへ世代付きでバックアップする。
 *
 * データが実際に失われるのは「ダウンロードしてローカルを置き換える瞬間」なので、
 * その直前に退避しておけば、後勝ち(LWW)で負けた側の内容も後から復元できる。
 * - 保存先は端末ローカル（iCloud 容量・通信量を消費しない）。
 * - VACUUM INTO で圧縮した DB ファイルのみ（画像は含まない）。通常は数百KB〜数MB。
 * - 直近 MAX_LOCAL_BACKUPS 世代だけ残し、古いものは削除するので容量は上限で頭打ち。
 * - best-effort：バックアップに失敗しても同期本体は止めない。
 */
async function backupLocalDbBeforeReplace(db: SQLiteDatabase): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(LOCAL_BACKUP_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(LOCAL_BACKUP_DIR, {
        intermediates: true,
      });
    }
    // epoch ミリ秒は13桁固定（〜西暦2286年）のため、ファイル名の文字列ソート＝時系列順になる
    const target = `${LOCAL_BACKUP_DIR}/${BACKUP_PREFIX}${Date.now()}.db`;
    const targetPlain = target.replace(/^file:\/\//, "").replace(/'/g, "''");
    await db.execAsync(`VACUUM INTO '${targetPlain}';`);

    // ローテーション：新しい順に MAX_LOCAL_BACKUPS 個だけ残す
    const files = (await FileSystem.readDirectoryAsync(LOCAL_BACKUP_DIR))
      .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(".db"))
      .sort();
    const excess = files.slice(0, Math.max(0, files.length - MAX_LOCAL_BACKUPS));
    for (const f of excess) {
      await FileSystem.deleteAsync(`${LOCAL_BACKUP_DIR}/${f}`, {
        idempotent: true,
      });
    }
  } catch {
    // 安全網のバックアップ失敗で同期そのものを止めない
  }
}

export interface LocalBackup {
  /** ファイル名（codeflash.backup.<epoch ms>.db） */
  name: string;
  /** file:// 付きのフルパス */
  path: string;
  /** 作成時刻（epoch ミリ秒） */
  timestamp: number;
}

/** 端末ローカルの自動バックアップを新しい順に列挙する。 */
export async function listLocalBackups(): Promise<LocalBackup[]> {
  const info = await FileSystem.getInfoAsync(LOCAL_BACKUP_DIR);
  if (!info.exists) return [];
  const files = await FileSystem.readDirectoryAsync(LOCAL_BACKUP_DIR);
  return files
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(".db"))
    .map((f) => {
      const ts = Number(f.slice(BACKUP_PREFIX.length, -".db".length));
      return {
        name: f,
        path: `${LOCAL_BACKUP_DIR}/${f}`,
        timestamp: Number.isFinite(ts) ? ts : 0,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * 自動バックアップからローカルデータを復元する（ダウンロード時と同じ ATTACH 入れ替え）。
 * 復元は DELETE+INSERT でトリガーが localVersion を進め localChangedAt=now になるため、
 * 次回の同期では LWW でこの復元データが「最新のローカル変更」として扱われ、自然にアップロードされる。
 * （呼び出し側で続けて syncNow(auto) すれば即座にリモートへ反映できる）
 */
export async function restoreFromLocalBackup(
  db: SQLiteDatabase,
  backupPath: string,
): Promise<void> {
  await replaceLocalDataFromDownloadedDb(db, backupPath);
  await refreshGlobalCaches(db);
}

async function createDbSnapshot(db: SQLiteDatabase): Promise<void> {
  // 既存スナップショットがあると VACUUM INTO はエラーになるので必ず削除
  await FileSystem.deleteAsync(ICloudPaths.LOCAL_SNAPSHOT_PATH, {
    idempotent: true,
  });
  await FileSystem.deleteAsync(`${ICloudPaths.LOCAL_SNAPSHOT_PATH}-wal`, {
    idempotent: true,
  });
  await FileSystem.deleteAsync(`${ICloudPaths.LOCAL_SNAPSHOT_PATH}-shm`, {
    idempotent: true,
  });
  await FileSystem.deleteAsync(`${ICloudPaths.LOCAL_SNAPSHOT_PATH}-journal`, {
    idempotent: true,
  });

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

export type SyncAction = "upload" | "download" | "auto" | "background-upload";

/**
 * syncNow の実行結果。フォアグラウンド自動同期が「変更なし(noop)」だったかを呼び出し側が知り、
 * 相手端末アップロード直後の iCloud 反映ラグ（新版がまだ見えない）に備えて追いチェック（settle）を
 * 予約するために使う。
 * - uploaded / downloaded: 実際に転送した
 * - noop: 同期不要だった（リモートに新版が見当たらない＝ただし伝播ラグの可能性あり）
 * - aborted: ダウンロード中にローカル編集があり中止（次回 LWW で解決）
 * - skipped: 多重起動ガード等で実行自体しなかった
 */
export type SyncOutcome =
  | "uploaded"
  | "downloaded"
  | "noop"
  | "aborted"
  | "skipped";

/** フォアグラウンド復帰時の自動同期スロットル（直近同期からこの時間未満ならリモート確認をスキップ）。
 *  高速なアプリ切替で meta DL を連発しない最小限の間引き。手動「今すぐ同期」には影響しない。 */
export const FOREGROUND_SYNC_THROTTLE_MS = 5_000;

/** 前面復帰時、未接続に見えてもオフライン案内を出す前に待って再確認する時間。
 *  WiFi 接続処理（iPad はハンドシェイクに数秒かかる）の途中で前面復帰したときに
 *  「オフラインです」と誤表示するのを防ぐ。本当に未接続ならこの時間後も未接続のまま。 */
const OFFLINE_NOTICE_RECHECK_MS = 3_000;

/** 指定ミリ秒だけ待つ。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ICloudUnavailableError extends Error {
  constructor() {
    super("iCloud unavailable");
    this.name = "ICloudUnavailableError";
  }
}

/** 端末がオフライン（インターネット未接続）で同期できないことを表す。 */
export class OfflineError extends Error {
  constructor() {
    super("Offline");
    this.name = "OfflineError";
  }
}

export class SchemaVersionMismatchError extends Error {
  constructor(
    public localVersion: number,
    public remoteVersion: number,
  ) {
    super(
      `Schema version mismatch: local=${localVersion} remote=${remoteVersion}`,
    );
    this.name = "SchemaVersionMismatchError";
  }
}

export class NoRemoteBackupError extends Error {
  constructor() {
    super("No remote backup found");
    this.name = "NoRemoteBackupError";
  }
}

/** iCloud の容量不足で書き込みに失敗したことを表す。ネイティブ層のエラー文言から推定する。 */
export class StorageFullError extends Error {
  constructor() {
    super("iCloud storage full");
    this.name = "StorageFullError";
  }
}

/** ネイティブ層の転送エラー文言から「iCloud 容量不足」を推定する（ライブラリは専用の型を投げないため）。 */
function isStorageFullMessage(message: string): boolean {
  return /quota|out of space|no space|insufficient|disk full|storage.*full|full.*storage|640/i.test(
    message,
  );
}

/** 投げられたエラーを UI 翻訳用のエラーコードに正規化する。 */
export function toSyncErrorCode(e: unknown): SyncErrorCode {
  if (e instanceof ICloudUnavailableError) return "unavailable";
  if (e instanceof OfflineError) return "offline";
  if (e instanceof SchemaVersionMismatchError) return "schemaMismatch";
  if (e instanceof NoRemoteBackupError) return "noRemoteBackup";
  if (e instanceof StorageFullError) return "storageFull";
  if (e instanceof SyncTimeoutError) return "timeout";
  if (e instanceof Error && isStorageFullMessage(e.message)) return "storageFull";
  return "unknown";
}

interface LocalChangeInfo {
  version: number;
  changedAt: number;
}

/**
 * ローカルのユーザーデータ変更状況を取得（sync_state テーブル）。
 * version はユーザーデータの INSERT/UPDATE/DELETE で進むカウンタ（トリガー管理）。
 * ファイル mtime と違い起動やチェックポイントでは進まないため、変更検知の唯一の正となる。
 */
async function getLocalChangeInfo(
  db: SQLiteDatabase,
): Promise<LocalChangeInfo> {
  const row = await db.getFirstAsync<{
    localVersion: number;
    localChangedAt: number;
  }>("SELECT localVersion, localChangedAt FROM sync_state WHERE id = 1");
  return {
    version: row?.localVersion ?? 0,
    changedAt: row?.localChangedAt ?? 0,
  };
}

/**
 * ローカルにユーザーデータ（デッキ or カード）が1件でもあるか。
 * 再インストール直後など「ローカルが空」の端末が、iCloud の反映ラグでリモートも空に見えたときに
 * 空データをアップロードしてリモート（＝他端末の正しいデータ）を破壊するのを防ぐためのガードに使う。
 */
async function hasLocalUserData(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT (SELECT COUNT(*) FROM decks) + (SELECT COUNT(*) FROM cards) AS n",
  );
  return (row?.n ?? 0) > 0;
}

export class SyncTimeoutError extends Error {
  constructor() {
    super("Sync timed out");
    this.name = "SyncTimeoutError";
  }
}

/** iCloud の転送が無応答のまま固まる（ライブラリにタイムアウトが無い）のを防ぐ。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SyncTimeoutError()), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** アップロード/ダウンロードのタイムアウト（iCloud 転送が固まったら中断してオーバーレイを解放） */
const TRANSFER_TIMEOUT_MS = 90_000;
/** 自動同期(silent)時の転送タイムアウト。手動より短くして、iCloud の反映待ち（端末間伝播ラグ）で
 *  実体がまだ降りてこないときに早めに諦め、次回トリガーで再試行できるようにする。
 *  silent 転送は UI をブロックしないので、この間ユーザー操作は止まらない。 */
const SILENT_TRANSFER_TIMEOUT_MS = 30_000;
/** リモート状態取得のタイムアウト（meta の iCloud 実体化待ちで固まるのを防ぐ） */
const REMOTE_STATUS_TIMEOUT_MS = 30_000;

/**
 * 同期方向を決定。null は no-op（同期する必要なし）。
 *
 * 判定方針：
 * - ローカル変更は sync_state.localVersion で判定（lastSyncedVersion からの差分）。
 *   ファイル mtime は起動やチェックポイントでも進むため使わない。
 * - リモート変更は remote.meta.updatedAt が lastSyncedAt より新しいかで判定。
 * - lastSyncedAt が null（再インストール直後・初回）はリモートがあれば必ず download。
 * - 両方変更（コンフリクト）は LWW：local.changedAt と remote.meta.updatedAt の新しい方。
 */
function decideDirection(
  action: SyncAction,
  remote: Awaited<ReturnType<typeof getRemoteStatus>>,
  local: LocalChangeInfo,
  lastSyncedAt: number | null,
  lastSyncedVersion: number | null,
  // 追いついているリモート版の updatedAt（lastRemoteId 未保存の旧データ移行時のフォールバック用）。
  remoteWatermark: number | null,
  // 追いついているリモート版の識別子（remoteChanged 判定の主基準。時計ズレに強い）。
  lastRemoteId: string | null,
): "upload" | "download" | null {
  if (action === "upload") return "upload";
  if (action === "download") {
    if (!remote.exists) throw new NoRemoteBackupError();
    return "download";
  }

  const neverSynced = lastSyncedAt == null;
  const localChanged =
    lastSyncedVersion != null && local.version > lastSyncedVersion;

  // リモートに有効な版（一意名 DB ファイル）が1つも見当たらないケース。
  // 【データ安全上の最重要ガード】
  // 既に同期済みの端末（neverSynced=false）でリモートが空に見えるのは、ほぼ iCloud の
  // クロスデバイス伝播の遅延か、旧形式データからの移行途中（新形式の版がまだ無い）である。
  // ここで古いローカルをアップロードすると、相手がたった今上げた新しいデータを
  // 上書きして破壊しうる（実際に発生したバグ）。そのため「一度も同期していない端末」だけを
  // 初回バックアップとしてアップロードし、同期済みの端末は何もしない（次回の同期で正しい
  // リモートを観測して解決する）。リモートが恒久的に消えた／旧形式のみの場合の再 publish は
  // 手動「強制アップロード」で行える（その際 pruneOldDbFiles が旧形式・残骸も掃除する）。
  if (!remote.exists || !remote.meta) {
    return neverSynced ? "upload" : null;
  }

  // ここから remote.exists && remote.meta が保証される。
  // スキーマバージョン互換性チェック（ローカルより新しいリモートは扱えない）。
  if (remote.meta.schemaVersion > SYNC_SCHEMA_VERSION) {
    throw new SchemaVersionMismatchError(
      SYNC_SCHEMA_VERSION,
      remote.meta.schemaVersion,
    );
  }

  // === background-upload ===
  // バックグラウンド移行時のアップロード専用。ダウンロード（ツリー入れ替え）は決して起こさない。
  if (action === "background-upload") {
    if (neverSynced) return null; // 未復元状態ではリモートを上書きしない
    // リモートにも変更がある場合は上書き競合になるため、ここではアップせず
    // 次回フォアグラウンドの auto（LWW）に委ねる。
    if (isRemoteNew(remote.meta, lastRemoteId, remoteWatermark, lastSyncedAt))
      return null;
    return localChanged ? "upload" : null;
  }

  // === auto ===
  // この端末で同期したことがない（再インストール・初回有効化）→ リモートを取得して復元
  if (neverSynced) return "download";

  const remoteChanged = isRemoteNew(
    remote.meta,
    lastRemoteId,
    remoteWatermark,
    lastSyncedAt,
  );

  if (remoteChanged && localChanged) {
    // 両方で変更：LWW（直近のタイムスタンプを採用）
    return local.changedAt > remote.meta.updatedAt ? "upload" : "download";
  }
  if (remoteChanged) return "download";
  if (localChanged) return "upload";
  return null;
}

/**
 * 同期処理本体。同時実行は禁止（status が 'syncing' の間は重複呼び出しを無視）。
 *
 * @param db SQLite ハンドル（WAL チェックポイントに必要）
 * @param action 'upload' | 'download' | 'auto' | 'background-upload'
 *   - 'auto'：ローカル変更（sync_state.localVersion）と remote meta.updatedAt を比較し、新しい方を採用
 *   - 'upload'：強制アップロード
 *   - 'download'：強制ダウンロード（remote が無ければ NoRemoteBackupError）
 *   - 'background-upload'：ローカル変更があればアップロードのみ（ダウンロードしない）
 * @param opts.silent true のとき自動トリガー用の控えめ動作にする：転送中はオーバーレイで
 *   全操作をブロックしない（iCloud の反映待ちで転送が長引いても UI を止めない）。ダウンロードは
 *   実際にローカルを書き換える一瞬だけブロックする。タイムアウトはエラー表示せず次回再試行する。
 */
export async function syncNow(
  db: SQLiteDatabase,
  action: SyncAction = "auto",
  opts?: { silent?: boolean },
): Promise<SyncOutcome> {
  const sync = useSyncStore.getState();

  if (sync.status === "syncing") return "skipped";
  if (!sync.hydrated) return "skipped";

  sync.clearError();
  // ユーザー操作の同期は決定フェーズから全操作ブロック。自動トリガーは転送中のみブロック。
  sync.setBlocking(!opts?.silent);
  // 方向確定前のネットワーク処理（getRemoteStatus 等）の間に
  // 二重タップで syncNow が並列起動するのを防ぐため、await する前に即ロックする。
  sync.setStatus("syncing");

  if (!(await isICloudAvailable())) {
    sync.setError("unavailable");
    throw new ICloudUnavailableError();
  }

  // オフラインなら同期に突入しない。iCloud アカウントが有効でもネットワークが無いと、
  // リモート一覧（.icloud プレースホルダ名）は取れるのに実体ダウンロードが数十秒ハングして
  // タイムアウトするだけ＝無駄にオーバーレイで全操作をブロックしてしまう。ここで早期に弾く。
  // 自動トリガー（silent）は呼び出し前に既に弾いているので、ここに来るのは主に手動同期。
  if (!(await isOnline())) {
    sync.setError("offline");
    throw new OfflineError();
  }

  try {
    // WAL を可能な範囲でメイン DB に統合（best-effort）。
    // VACUUM INTO は未統合の WAL も含めた現時点の内容を写すため、これは必須ではない。
    // TRUNCATE は WAL の排他アクセスを要求し、別接続や読み取りカーソルが残っていると
    // SQLITE_LOCKED（"database table is locked"）になる。PASSIVE は競合してもエラーにならず、
    // 念のため失敗も握りつぶして同期を継続する。
    try {
      await db.execAsync("PRAGMA wal_checkpoint(PASSIVE);");
    } catch {
      // checkpoint の失敗は無視（VACUUM INTO の結果が正となる）
    }

    // 強制アップロードはリモート状態を参照しないので getRemoteStatus を呼ばない
    // （内部の meta ダウンロードが iCloud 実体化待ちで固まり得るため、ハングの起点を回避）。
    // それ以外はタイムアウト付きでリモート状態を取得する。
    const remote =
      action === "upload"
        ? { exists: false, meta: null, dbFilename: null }
        : await withTimeout(getRemoteStatus(), REMOTE_STATUS_TIMEOUT_MS);
    const localInfo = await getLocalChangeInfo(db);
    const direction = decideDirection(
      action,
      remote,
      localInfo,
      sync.lastSyncedAt,
      sync.lastSyncedVersion,
      sync.lastRemoteUpdatedAt,
      sync.lastRemoteId,
    );
    // 前回ダウンロード（リモートを受け入れた時点）以降に、この端末で編集・学習して
    // localVersion が進んでいるか。これが true のまま再びダウンロードが走ると、自端末の作業が
    // 別端末の版で上書きされる＝競合。アップロードでも進む lastSyncedVersion ではなく、
    // ダウンロードでのみ進む lastDownloadedVersion を基準にするのが要点
    // （「アップロード後に別端末版で上書きされた」ケースを取りこぼさないため）。
    const localChangedSinceDownload =
      sync.lastDownloadedVersion != null &&
      localInfo.version > sync.lastDownloadedVersion;

    if (direction === null) {
      // 同期する必要なし（リモートの最新版に追いついており、ローカルにも変更が無い）。
      // 有効なリモート版（meta あり）を観測できたときだけ watermark と表示時刻を更新する。
      // 過渡的にリモートが空／不完全に見えた場合（remote.meta なし）や background-upload では
      // 据え置き、次回の同期で正しいリモート版を観測して取得できるようにする。
      if (action !== "background-upload" && remote.meta) {
        sync.setLastRemoteUpdatedAt(remote.meta.updatedAt);
        sync.setLastRemoteId(remoteMetaId(remote.meta));
        sync.setLastSyncedAt(Date.now());
        sync.setLastSyncedVersion(localInfo.version);
        // ダウンロード基準が未設定の端末でも次回以降の競合検知が働くよう、
        // リモートに追いついている（no-op）この時点を基準として初期化する。
        if (sync.lastDownloadedVersion == null) {
          sync.setLastDownloadedVersion(localInfo.version);
        }
      }
      sync.setStatus("idle");
      return "noop";
    }

    // 【空データ上書き防止ガード】
    // 自動／バックグラウンドのアップロードでは、ローカルが空（デッキもカードも無い）のときは上げない。
    // 再インストール直後の端末はローカルが空＝neverSynced で、iCloud の反映ラグでリモートも空に
    // 見えると decideDirection が "upload" を返す。そのまま空をアップすると掃除で他端末の正しい
    // データまで消してしまう（実際に発生）。空アップロードは「壊す」ことはあっても「役立つ」ことが
    // 無いので、自動経路では一切行わない（リモートが降りてくるのを待つ／次回再試行する）。
    // 明示的な強制アップロード（action==='upload'）はユーザー意思なので対象外。
    if (
      direction === "upload" &&
      action !== "upload" &&
      !(await hasLocalUserData(db))
    ) {
      sync.setStatus("idle");
      return "skipped";
    }

    // 手動同期は転送中も全画面ブロック（blocking=true で既にオーバーレイ表示中）。方向もここで
    // セットしてオーバーレイのテキストを「アップロード中／ダウンロード中」にする。
    // 自動同期(silent)は転送中はブロックしない（direction を立てない＝オーバーレイを出さない）。
    // ダウンロードは実際にローカルを書き換える直前にだけ direction を立てて短時間だけブロックする。
    // これにより、iCloud の反映待ちで転送が長引いても UI は止まらない。
    if (!opts?.silent) sync.setStatus("syncing", direction);

    const transferTimeout = opts?.silent
      ? SILENT_TRANSFER_TIMEOUT_MS
      : TRANSFER_TIMEOUT_MS;

    let syncedVersion: number;
    let remoteUpdatedAt: number;
    let remoteId: string;
    let outcome: SyncOutcome;
    if (direction === "upload") {
      // VACUUM INTO でトランザクション的に一貫した完全コピーを別ファイルに作成。
      // 直接 codeflash.db を上げると WAL の未統合分が抜け落ちる可能性がある。
      await createDbSnapshot(db);
      // 参照画像を先に追加アップロード（meta より前）。失敗すれば throw して meta を書かない。
      await uploadReferencedImages(db);
      // 版の時刻には「アップロードした時刻」ではなく「データを最後に変更した時刻」
      // (sync_state.localChangedAt) を基準に使う。こうすると LWW のタイブレーク
      // （decideDirection の local.changedAt vs remote.meta.updatedAt）が
      // 「学習した時刻どうしの比較」になり、オフライン同時編集→再接続時に
      // 「最後に学習した端末が勝つ」（どちらが先に接続したかに依存しない）直感的な後勝ちになる。
      //
      // ただし端末時計の誤設定に備えて、版の時刻を次式で正規化する：
      //   updatedAt = max( min(changedAt, now), min(base, now) + 1 )
      // - 未来クロック: min(changedAt, now) で現在時刻にクランプ。時計を正しく戻した後に
      //   アップロードすれば、過去の書き込みに残った未来値が現在時刻へ矯正されて伝播する。
      // - 過去クロック: max(..., base+1) で「直前に取り込んだリモート版より必ず1つ新しい」値に
      //   底上げする。これで過去日付で学習しても自分の更新が LWW で勝ち、巻き戻らない。
      //   (base = lastRemoteUpdatedAt = この端末が最後に追いついたリモート版の時刻)
      // - base 自体が未来に汚染されている場合（過去の未来クロックで上げた版に追いついた等）に
      //   そのまま base+1 すると未来版を再生産してしまうため、base も now でクランプする。
      //   これにより、時計を正した後の（強制）アップロードは必ず now 以下の正常な時刻になる。
      // changedAt=0（変更が無いまま強制アップロード）のときは now を基準にする。
      const nowMs = Date.now();
      const base = sync.lastRemoteUpdatedAt ?? 0;
      const rawChangedAt = localInfo.changedAt || nowMs;
      const effectiveUpdatedAt = Math.max(
        Math.min(rawChangedAt, nowMs),
        Math.min(base, nowMs) + 1,
      );
      const meta: RemoteDbMeta = {
        updatedAt: effectiveUpdatedAt,
        deviceId: sync.deviceId,
        schemaVersion: SYNC_SCHEMA_VERSION,
      };
      // 強制アップロード（action==='upload'）は「ローカルを唯一の正とする」宣言なので、
      // 自分以外の全リモート版を一掃する（未来日付で勝ち続ける版があっても確実に解消できる）。
      await withTimeout(
        uploadDb(meta, { wipeOthers: action === "upload" }),
        transferTimeout,
      );
      // meta コミット後、最新 DB が参照しなくなったリモート画像を掃除（best-effort）。
      try {
        await pruneRemoteImages(db);
      } catch {
        // 掃除の失敗で同期全体を失敗させない
      }
      // スナップショット時点の version を同期済みとして記録
      syncedVersion = localInfo.version;
      // 自分が書き込んだリモート版を「追いついている版」として記録（時刻＋識別子）
      remoteUpdatedAt = meta.updatedAt;
      remoteId = remoteMetaId(meta);
      outcome = "uploaded";
      // 一度もダウンロード基準が無い端末（アップロードのみ運用）でも競合検知が働くよう、
      // 初回だけ現在の同期版を基準として初期化する（以後はダウンロード時のみ更新）。
      if (sync.lastDownloadedVersion == null) {
        sync.setLastDownloadedVersion(syncedVersion);
      }
    } else {
      // getRemoteStatus が選んだ最新版ファイル名を取得（exists=true なら必ず付随する）。
      const dbFilename = remote.dbFilename;
      if (!dbFilename) throw new NoRemoteBackupError();
      const downloadedPath = await withTimeout(
        downloadDb(dbFilename),
        transferTimeout,
      );
      // 自動同期では転送中にブロックしなかったため、ダウンロード中にユーザーがローカルを
      // 編集した可能性がある。その場合は上書きせず中断し、編集を守る
      // （次回同期で localChanged=true となり LWW で解決される）。
      if (opts?.silent) {
        const after = await getLocalChangeInfo(db);
        if (after.version !== localInfo.version) {
          sync.setStatus("idle");
          return "aborted";
        }
        // ここからローカルを書き換える＝この瞬間だけ短時間ブロックする。
        sync.setStatus("syncing", "download");
      }
      // 上書きでローカルの内容が失われる直前に、現在のローカルを端末へ退避（安全網）
      await backupLocalDbBeforeReplace(db);
      // 接続を開いたまま ATTACH でデータを入れ替える（ツリー再マウントを伴わずクラッシュしない）
      await replaceLocalDataFromDownloadedDb(db, downloadedPath);
      await refreshGlobalCaches(db);
      // ローカルデータが入れ替わったことを画面に通知（集計をローカル state に持つ学習タブ等が、
      // フォーカス中でもこれを購読して再読込し、ダウンロード完了直後に内容を反映する）。
      sync.bumpDataRevision();
      // 新しい DB が参照する画像を取得し、参照されなくなったローカル画像を掃除する。
      // どちらも best-effort（DB は入れ替え済み＝データは安全。画像不足は次回同期で回復）。
      try {
        await downloadReferencedImages(db);
        // 保持中の自動バックアップが参照する画像は温存する（029 案B：マージ復元の素材を残す）。
        await cleanupOrphanImages(db, (await listLocalBackups()).map((b) => b.path));
      } catch {
        // 画像処理の失敗で同期全体をエラーにしない
      }
      // 入れ替えでトリガーが version を進めるので、入れ替え後の値を同期済みとして記録
      syncedVersion = (await getLocalChangeInfo(db)).version;
      // 取り込んだリモート版を「追いついている版」として記録（強制DLで meta 欠落時のみ now/合成IDで代替）
      remoteUpdatedAt = remote.meta?.updatedAt ?? Date.now();
      remoteId = remote.meta
        ? remoteMetaId(remote.meta)
        : `unknown:${remoteUpdatedAt}`;
      outcome = "downloaded";
      // 自動同期で、前回ダウンロード以降にこの端末で編集・学習した状態（＝競合）のまま
      // 別端末の新しいデータで上書きされたときだけ、置き換わったことと「データ復元」で戻せる
      // ことを案内する。手動の強制ダウンロード（action==='download'）はユーザー自身の意思なので
      // 出さない。復元素材は直前の backupLocalDbBeforeReplace で必ず作成済み。
      if (action === "auto" && localChangedSinceDownload) {
        useSyncStore.getState().showConflictModal();
      }
      // リモートを受け入れた基準点を更新（次回の競合判定の起点）。アップロードでは進めない。
      sync.setLastDownloadedVersion(syncedVersion);
    }

    sync.setLastRemoteUpdatedAt(remoteUpdatedAt);
    sync.setLastRemoteId(remoteId);
    sync.setLastSyncedAt(Date.now());
    // 実際にデータを転送したときだけ「最終同期」を更新する（no-op 照合では更新しない）。
    sync.setLastDataSyncedAt(Date.now());
    sync.setLastSyncedVersion(syncedVersion);
    sync.setStatus("idle");
    return outcome;
  } catch (e) {
    const code = toSyncErrorCode(e);
    // 自動同期(silent)のタイムアウトは、オンライン確認済みなのに転送が固まる＝iCloud の
    // 反映待ち（端末間の伝播ラグ）であることが多く、通信障害ではない。「通信環境を確認して」
    // という誤解を招くエラー表示にせず、idle に戻して次回トリガーで静かに再試行する
    // （バナーも設定画面の赤字も出さない。errorCode は冒頭の clearError で空のまま）。
    if (opts?.silent && code === "timeout") {
      sync.setStatus("idle");
    } else {
      sync.setError(code);
    }
    throw e;
  }
}

/**
 * 手動同期（ユーザー操作）で「少し待てば直る一過性エラー」が起きたときに自動で数回だけ再試行する。
 * 前面復帰／同期トグル直後は iCloud デーモンが未準備で転送が即失敗（unknown）したり、
 * 反映待ちでタイムアウト（timeout）することがある。手動操作はこれまで1回失敗で諦めていたため、
 * 「同期オン直後に強制アップロードを押すと失敗」する症状が出ていた。短い間隔で待って再試行する。
 * 確定的エラー（容量不足・スキーマ不一致・iCloud 無効・オフライン）は即座に投げて再試行しない。
 */
const MANUAL_RETRY_CODES = new Set<SyncErrorCode>(["unknown", "timeout"]);
const MANUAL_RETRY_DELAYS_MS = [1_200, 3_000];

export async function syncNowManual(
  db: SQLiteDatabase,
  action: SyncAction = "auto",
): Promise<SyncOutcome> {
  const maxAttempts = MANUAL_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await syncNow(db, action);
    } catch (e) {
      const code = toSyncErrorCode(e);
      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt || !MANUAL_RETRY_CODES.has(code)) throw e;
      await delay(MANUAL_RETRY_DELAYS_MS[attempt]);
    }
  }
  // ループは必ず return か throw で抜けるが、型を満たすためのフォールバック。
  throw new SyncTimeoutError();
}

/**
 * リモートのバックアップを完全に削除し、この端末を「未同期」状態に戻す。
 * 時計の誤設定などでリモートが壊れた版に固着した場合の最終手段。
 * 削除後に同期が有効なら syncNow('upload') で現在のローカルを唯一の正として再 publish する
 * （リモートが空＝未同期状態のため、強制アップロードで確実に作り直せる）。
 */
export async function resetRemote(db: SQLiteDatabase): Promise<void> {
  if (!(await isICloudAvailable())) throw new ICloudUnavailableError();
  if (!(await isOnline())) throw new OfflineError();
  await deleteRemoteDb();
  // 進捗ウォーターマークを消去（次回同期でローカルを再 publish させる）。
  useSyncStore.getState().resetSyncState();
  // 同期が有効なら、今のローカルでリモートを作り直す。
  if (useSyncStore.getState().enabled) {
    await syncNowManual(db, "upload");
  }
}

/**
 * silent 自動同期がタイムアウト（iCloud の反映待ちで実体がまだ降りてこない）したときの
 * 自動再試行スケジュール。端末間の伝播は数十秒〜数分かかるため、間隔を空けて数回だけ再試行する。
 * これが無いと、再接続直後の1回が反映前に当たって失敗したきり、次の前面復帰／接続切替まで
 * 同期されない（手動「今すぐ同期」を押すまで反映されない）。
 */
const SYNC_RETRY_DELAYS_MS = [15_000, 30_000, 60_000];
let syncRetryTimer: ReturnType<typeof setTimeout> | null = null;
let syncRetryAttempt = 0;

/**
 * 自動同期で「すぐにエラー表示せず、まず再試行に回す」エラーコード。
 * - timeout: iCloud の端末間反映待ち（実体がまだ降りてこない）。
 * - unknown: 前面復帰直後にネットワーク／iCloud デーモンが未準備で、ダウンロード等が
 *   即座にネイティブエラーで失敗する一過性のもの（コントロールセンターを開閉して
 *   ネットワークを起こすと次の同期が成功する、という症状の正体）。
 * いずれも少し待って再試行すれば自然に解消することが多いため、最初の失敗ではバナーを出さない。
 * 容量不足・スキーマ不一致・iCloud 無効など解消の見込みが無い確定的エラーはここに含めない
 * （それらは即バナーで知らせる）。
 */
const RETRYABLE_AUTO_CODES = new Set<SyncErrorCode>(["timeout", "unknown"]);

/** 自動再試行の予約を解除（同期成功時・no-op 時に呼ぶ）。 */
function clearSyncRetry(): void {
  syncRetryAttempt = 0;
  if (syncRetryTimer) {
    clearTimeout(syncRetryTimer);
    syncRetryTimer = null;
  }
}

/**
 * 反映待ち／一過性エラー後の自動再試行を予約する。
 * 再試行を尽くしても解消しなかった場合のみ、最後のエラーをバナーで知らせる
 * （ただし timeout＝iCloud 反映待ちは障害ではないので、尽きても出さず次トリガーに委ねる）。
 * これにより「前面復帰直後の一過性失敗」ではバナーを出さず、本当に直らないときだけ通知できる。
 */
function scheduleSyncRetry(db: SQLiteDatabase, lastCode: SyncErrorCode): void {
  if (syncRetryAttempt >= SYNC_RETRY_DELAYS_MS.length) {
    syncRetryAttempt = 0; // 上限到達
    if (lastCode !== "timeout") {
      // 再試行を尽くしても解消しない実エラー → ここで初めて通知する。
      useSyncStore.getState().showNotice("error", lastCode);
    }
    return;
  }
  const ms = SYNC_RETRY_DELAYS_MS[syncRetryAttempt];
  syncRetryAttempt++;
  if (syncRetryTimer) clearTimeout(syncRetryTimer);
  // setTimeout はアプリが背面化すると iOS が JS を停止するため事実上「前面のときだけ」発火する。
  // 背面化中の同期は背面トリガーが担うので、これで問題ない。
  syncRetryTimer = setTimeout(() => {
    syncRetryTimer = null;
    triggerForegroundSync(db, { showOfflineNotice: false });
  }, ms);
}

/**
 * 「変更なし(noop)」で終わった自動同期のあとに、相手端末アップロードの iCloud 反映ラグに備えて
 * 数回だけ再確認する「追いチェック(settle)」のスケジュール。
 *
 * 症状：A が更新→背面化でアップロード直後に B を前面復帰すると、A の新版がまだ B の iCloud に
 * 伝播しておらず getRemoteStatus が見つけられない→ noop（最終同期時刻だけ更新・内容は未更新）。
 * noop はエラーではないので従来は再試行されず、次に手動で背面→前面するまで取り込まれなかった。
 * iCloud のクロスデバイス伝播自体はアプリから短縮できない（Apple 依存）ため、少し間を置いて
 * 数回だけ再確認し、伝播し次第ダウンロードする。setTimeout は前面のときだけ発火するので、
 * ユーザーがアプリを開いている間だけ静かにポーリングする（背面化で自動的に止まる）。
 * 1回目は FOREGROUND_SYNC_THROTTLE_MS(5s) より後にする（noop で lastSyncedAt=now になるため）。
 */
const SYNC_SETTLE_DELAYS_MS = [8_000, 20_000, 45_000];
let syncSettleTimer: ReturnType<typeof setTimeout> | null = null;
let syncSettleAttempt = 0;

/** 追いチェックの予約を解除（実際に同期できたとき＝upload/download 完了時に呼ぶ）。 */
function clearSyncSettle(): void {
  syncSettleAttempt = 0;
  if (syncSettleTimer) {
    clearTimeout(syncSettleTimer);
    syncSettleTimer = null;
  }
}

/** noop 後の追いチェックを予約する（上限到達で打ち切り、以後は通常トリガーに委ねる）。 */
function scheduleSyncSettle(db: SQLiteDatabase): void {
  if (syncSettleAttempt >= SYNC_SETTLE_DELAYS_MS.length) {
    syncSettleAttempt = 0; // 上限到達。次の前面復帰／接続復帰トリガーで再び満額の追いチェックを行う
    return;
  }
  const ms = SYNC_SETTLE_DELAYS_MS[syncSettleAttempt];
  syncSettleAttempt++;
  if (syncSettleTimer) clearTimeout(syncSettleTimer);
  syncSettleTimer = setTimeout(() => {
    syncSettleTimer = null;
    triggerForegroundSync(db, { showOfflineNotice: false });
  }, ms);
}

/** triggerForegroundSync が実行中かどうか。オフライン判定や再確認待ちの間に
 *  AppState 'active' 復帰などで再入すると、各実行が並行して案内バナーを連続表示してしまう
 *  （`syncNow` の status ガードは転送中しか効かず、判定フェーズは無防備だった）。
 *  この間は後続呼び出しを丸ごと弾く。 */
let foregroundSyncRunning = false;

/** 直近にオフライン案内バナーを出した時刻。短時間に何度も出さないための間引き用。 */
let lastOfflineNoticeAt = 0;
/** オフライン案内バナーの最小再表示間隔（この間隔内では再表示しない）。
 *  これは「接続すれば同期される」旨のお知らせなので頻繁に出す必要はない。前面復帰のたびに
 *  出ると煩わしいため、一度出したら当分（6時間）は出さない。アプリ再起動で 0 にリセットされる。 */
const OFFLINE_NOTICE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * フォアグラウンド復帰／起動時の自動同期トリガー（同時実行ガード付きの公開エントリ）。
 * - iCloud 同期が無効、未 hydrate、同期中、スロットル期間内なら何もしない。
 * - 'auto' なのでリモートが新しければダウンロード、ローカルが新しければアップロードする。
 * - silent: true なので転送中はオーバーレイを出さない（ダウンロードの入れ替え時だけ一瞬ブロック）。
 * - 自動同期の失敗はユーザー操作ではないので throw せず握りつぶす。設定画面以外でも気付けるよう、
 *   タイムアウト以外のエラーは通知バナーで知らせる。タイムアウト（＝iCloud 反映待ち）は出さず、
 *   代わりに少し後に自動再試行する（伝播が済めば自然に成功する）。
 */
export async function triggerForegroundSync(
  db: SQLiteDatabase,
  opts?: { showOfflineNotice?: boolean },
): Promise<void> {
  // 実行中（再確認待ちや転送を含む）の再入は丸ごと弾く（バナー連続表示・重複同期を防ぐ）。
  if (foregroundSyncRunning) return;
  foregroundSyncRunning = true;
  try {
    await runForegroundSync(db, opts);
  } finally {
    foregroundSyncRunning = false;
  }
}

async function runForegroundSync(
  db: SQLiteDatabase,
  opts?: { showOfflineNotice?: boolean },
): Promise<void> {
  const s = useSyncStore.getState();
  if (!s.hydrated || !s.enabled || s.status === "syncing") return;
  if (
    s.lastSyncedAt != null &&
    Date.now() - s.lastSyncedAt < FOREGROUND_SYNC_THROTTLE_MS
  )
    return;
  // オフライン案内バナーを出すかどうか。起動／前面復帰のときは出す（true）が、
  // 接続復帰リスナー経由のときは出さない（false）。WiFi 接続直後は到達性が未確定で
  // 一瞬 offline と判定されることがあり、ここで出すと「接続したのにオフライン表示」になるため。
  const showOffline = opts?.showOfflineNotice ?? true;
  // オフライン時は自動同期しない（起動毎に「ダウンロード中…」で全操作をブロックしたまま
  // タイムアウトする無駄を防ぐ）。
  let net = await getNetworkSnapshot();
  // インターフェース未接続のまま前面復帰した場合、「本当にオフライン」なのか
  // 「WiFi 接続処理の最中（iPad はハンドシェイクに数秒かかる）」なのか、その瞬間だけでは
  // 区別できない。すぐ案内を出すと、コントロールセンターで WiFi を ON にし、アイコンが
  // 出る前に閉じて前面復帰したときに「オフラインです」と誤表示してしまう。少し待って
  // 再確認することで、接続処理中だったケースを取り除く（接続が確定すれば下の online 分岐で
  // 同期へ進み、復帰リスナーも同期を拾う）。
  if (!net.online && showOffline && !net.connected) {
    await delay(OFFLINE_NOTICE_RECHECK_MS);
    net = await getNetworkSnapshot();
  }
  if (!net.online) {
    // ここまで来てなお「ネットワーク自体が未接続(connected=false)」のときだけ案内する。
    // 「接続済みだが到達性が未確定(connected=true, online=false)」は過渡状態なので出さない
    // （到達性が確定した時点で復帰リスナーが同期する）。
    // 未接続のときも、未同期のローカル変更がある（または一度も同期していない）ときだけ案内する。
    if (
      showOffline &&
      !net.connected &&
      Date.now() - lastOfflineNoticeAt > OFFLINE_NOTICE_MIN_INTERVAL_MS
    ) {
      try {
        const local = await getLocalChangeInfo(db);
        const pending =
          s.lastSyncedVersion == null || local.version > s.lastSyncedVersion;
        if (pending) {
          lastOfflineNoticeAt = Date.now();
          s.showNotice("info", "offlinePending");
        }
      } catch {
        // 案内表示の判定に失敗しても同期スキップ自体は続行する
      }
    }
    return;
  }
  try {
    const outcome = await syncNow(db, "auto", { silent: true });
    // 成功（または同期不要の no-op）→ 反映待ちの再試行予約があれば解除する。
    clearSyncRetry();
    if (outcome === "downloaded" || outcome === "uploaded") {
      // 実際に同期できた → 追いチェックは不要。
      clearSyncSettle();
    } else if (outcome === "noop") {
      // 変更が見当たらなかった。ただし相手端末のアップロード直後は iCloud の端末間伝播ラグで
      // まだ新版が見えないことがある（最終同期時刻だけ更新され内容は据え置きの症状）。
      // 少し間を置いて数回だけ再確認し、伝播し次第取り込む。
      scheduleSyncSettle(db);
    }
  } catch (e) {
    // 自動同期の失敗はユーザー操作ではないので throw しない。
    const code = toSyncErrorCode(e);
    if (code === "offline") {
      // 接続確定前の過渡状態で出ることがある。バナーは出さず、接続復帰リスナー／次トリガーに委ねる
      // （「接続したのにオフライン表示」を防ぐ）。
    } else if (RETRYABLE_AUTO_CODES.has(code)) {
      // iCloud の反映待ち（timeout）や、前面復帰直後にネットワーク／iCloud デーモンが未準備で
      // 転送が即失敗する一過性エラー（unknown）。すぐにバナーを出さず少し後に自動再試行する。
      // 再試行を尽くしても解消しないときだけ scheduleSyncRetry が初めてバナーを出す。
      scheduleSyncRetry(db, code);
    } else {
      // 解消の見込みが無い確定的なエラー（容量不足・スキーマ不一致・iCloud 無効）は、
      // 設定画面を開いていなくても気付けるよう即バナーで知らせる。
      useSyncStore.getState().showNotice("error", code);
    }
  }
}

/**
 * バックグラウンド移行時の自動アップロードトリガー。
 * ローカルに変更があるときだけアップロードする（ダウンロード＝dbSwap は起こさない）。
 * スロットルは不要（アップ後 lastSyncedAt が更新され、変更が無ければ no-op になるため）。
 */
export async function triggerBackgroundUpload(
  db: SQLiteDatabase,
): Promise<void> {
  const s = useSyncStore.getState();
  if (!s.hydrated || !s.enabled || s.status === "syncing") return;
  // オフライン時はアップロードしようがないのでスキップ（バックグラウンド猶予も無駄にしない）。
  if (!(await isOnline())) return;
  // iOS のバックグラウンド実行猶予（~30秒）を要求してから走らせる。これが無いと、
  // 大量データ（スナップショット作成＋iCloud 配置に時間がかかる）の場合に
  // OS がアプリを凍結してアップロードが一切ステージされない（次のフォアグラウンドまで反映されない）。
  const bgTaskId = beginBackgroundTask();
  try {
    await syncNow(db, "background-upload", { silent: true });
  } catch {
    // 自動同期の失敗は無視
  } finally {
    endBackgroundTask(bgTaskId);
  }
}
