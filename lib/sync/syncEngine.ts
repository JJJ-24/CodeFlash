import * as FileSystem from "expo-file-system/legacy";
import type { SQLiteDatabase } from "expo-sqlite";

import { getAllDecks } from "@/lib/database/decks";
import { getAllTags } from "@/lib/database/tags";
import { useDeckStore } from "@/store/decks";
import { useSyncStore } from "@/store/sync";
import { useTagStore } from "@/store/tags";

import {
  downloadDb,
  getRemoteStatus,
  ICloudPaths,
  isICloudAvailable,
  uploadDb,
  type RemoteDbMeta,
} from "./icloud";

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

/** フォアグラウンド復帰時の自動同期スロットル（直近同期からこの時間未満ならリモート確認をスキップ）。
 *  高速なアプリ切替で meta DL を連発しない最小限の間引き。手動「今すぐ同期」には影響しない。 */
export const FOREGROUND_SYNC_THROTTLE_MS = 5_000;

export class ICloudUnavailableError extends Error {
  constructor() {
    super("iCloud unavailable");
    this.name = "ICloudUnavailableError";
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

class SyncTimeoutError extends Error {
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
  // 追いついているリモート版の updatedAt（remoteChanged 判定の基準）。
  // null（このフィールド導入前の旧データ）の場合は lastSyncedAt で代替する。
  remoteWatermark: number | null,
): "upload" | "download" | null {
  if (action === "upload") return "upload";
  if (action === "download") {
    if (!remote.exists) throw new NoRemoteBackupError();
    return "download";
  }

  const neverSynced = lastSyncedAt == null;
  const localChanged =
    lastSyncedVersion != null && local.version > lastSyncedVersion;

  // リモートが「存在しない」または「meta が揃っていない」ケース。
  // 【データ安全上の最重要ガード】
  // 既に同期済みの端末（neverSynced=false）でリモートが空／不完全に見えるのは、ほぼ
  // 相手端末のアップロード中の一瞬の窓（uploadDb の clearRemoteDir → db → meta の間）か、
  // iCloud のクロスデバイス伝播の遅延である。ここで古いローカルをアップロードすると、
  // 相手がたった今上げた新しいデータを上書きして破壊してしまう（実際に発生したバグ）。
  // そのため「一度も同期していない端末」だけを初回バックアップとしてアップロードし、
  // 同期済みの端末は何もしない（次回の同期で正しいリモートを観測して解決する）。
  // リモートが恒久的に消えた場合の再バックアップは手動「今すぐ同期」（強制 upload）で行える。
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
    if (remote.meta.updatedAt > (remoteWatermark ?? lastSyncedAt)) return null;
    return localChanged ? "upload" : null;
  }

  // === auto ===
  // この端末で同期したことがない（再インストール・初回有効化）→ リモートを取得して復元
  if (neverSynced) return "download";

  const remoteChanged = remote.meta.updatedAt > (remoteWatermark ?? lastSyncedAt);

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
 * @param opts.silent true のときオーバーレイで全操作をブロックしない（自動トリガー用）。
 *   ただし実際に転送（upload/download）が走る間は direction が立つため、その間だけはブロックされる。
 */
export async function syncNow(
  db: SQLiteDatabase,
  action: SyncAction = "auto",
  opts?: { silent?: boolean },
): Promise<void> {
  const sync = useSyncStore.getState();

  if (sync.status === "syncing") return;
  if (!sync.hydrated) return;

  sync.clearError();
  // ユーザー操作の同期は決定フェーズから全操作ブロック。自動トリガーは転送中のみブロック。
  sync.setBlocking(!opts?.silent);
  // 方向確定前のネットワーク処理（getRemoteStatus 等）の間に
  // 二重タップで syncNow が並列起動するのを防ぐため、await する前に即ロックする。
  sync.setStatus("syncing");

  if (!(await isICloudAvailable())) {
    sync.setError("iCloudが利用できません");
    throw new ICloudUnavailableError();
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
        ? { exists: false, meta: null }
        : await withTimeout(getRemoteStatus(), REMOTE_STATUS_TIMEOUT_MS);
    const localInfo = await getLocalChangeInfo(db);
    const direction = decideDirection(
      action,
      remote,
      localInfo,
      sync.lastSyncedAt,
      sync.lastSyncedVersion,
      sync.lastRemoteUpdatedAt,
    );

    if (direction === null) {
      // 同期する必要なし（リモートの最新版に追いついており、ローカルにも変更が無い）。
      // 有効なリモート版（meta あり）を観測できたときだけ watermark と表示時刻を更新する。
      // 過渡的にリモートが空／不完全に見えた場合（remote.meta なし）や background-upload では
      // 据え置き、次回の同期で正しいリモート版を観測して取得できるようにする。
      if (action !== "background-upload" && remote.meta) {
        sync.setLastRemoteUpdatedAt(remote.meta.updatedAt);
        sync.setLastSyncedAt(Date.now());
        sync.setLastSyncedVersion(localInfo.version);
      }
      sync.setStatus("idle");
      return;
    }

    sync.setStatus("syncing", direction);

    let syncedVersion: number;
    let remoteUpdatedAt: number;
    if (direction === "upload") {
      // VACUUM INTO でトランザクション的に一貫した完全コピーを別ファイルに作成。
      // 直接 codeflash.db を上げると WAL の未統合分が抜け落ちる可能性がある。
      await createDbSnapshot(db);
      const meta: RemoteDbMeta = {
        updatedAt: Date.now(),
        deviceId: sync.deviceId,
        schemaVersion: SYNC_SCHEMA_VERSION,
      };
      await withTimeout(uploadDb(meta), TRANSFER_TIMEOUT_MS);
      // スナップショット時点の version を同期済みとして記録
      syncedVersion = localInfo.version;
      // 自分が書き込んだリモート版の時刻を watermark にする
      remoteUpdatedAt = meta.updatedAt;
    } else {
      const downloadedPath = await withTimeout(
        downloadDb(),
        TRANSFER_TIMEOUT_MS,
      );
      // 上書きでローカルの内容が失われる直前に、現在のローカルを端末へ退避（安全網）
      await backupLocalDbBeforeReplace(db);
      // 接続を開いたまま ATTACH でデータを入れ替える（ツリー再マウントを伴わずクラッシュしない）
      await replaceLocalDataFromDownloadedDb(db, downloadedPath);
      await refreshGlobalCaches(db);
      // 入れ替えでトリガーが version を進めるので、入れ替え後の値を同期済みとして記録
      syncedVersion = (await getLocalChangeInfo(db)).version;
      // 取り込んだリモート版の時刻を watermark にする（強制DLで meta 欠落時のみ now で代替）
      remoteUpdatedAt = remote.meta?.updatedAt ?? Date.now();
    }

    sync.setLastRemoteUpdatedAt(remoteUpdatedAt);
    sync.setLastSyncedAt(Date.now());
    sync.setLastSyncedVersion(syncedVersion);
    sync.setStatus("idle");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sync.setError(message);
    throw e;
  }
}

/**
 * フォアグラウンド復帰／起動時の自動同期トリガー。
 * - iCloud 同期が無効、未 hydrate、同期中、スロットル期間内なら何もしない。
 * - 'auto' なのでリモートが新しければダウンロード、ローカルが新しければアップロードする。
 * - silent: true なのでオーバーレイは実際の転送中のみ表示される（リモート確認だけならチラつかない）。
 * - 自動同期の失敗はユーザー操作ではないので throw せず握りつぶす（store にエラーは反映済み）。
 */
export async function triggerForegroundSync(db: SQLiteDatabase): Promise<void> {
  const s = useSyncStore.getState();
  if (!s.hydrated || !s.enabled || s.status === "syncing") return;
  if (
    s.lastSyncedAt != null &&
    Date.now() - s.lastSyncedAt < FOREGROUND_SYNC_THROTTLE_MS
  )
    return;
  try {
    await syncNow(db, "auto", { silent: true });
  } catch {
    // 自動同期の失敗は無視
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
  try {
    await syncNow(db, "background-upload", { silent: true });
  } catch {
    // 自動同期の失敗は無視
  }
}
