import type { SQLiteDatabase } from "expo-sqlite";

import { getAllDecks } from "@/lib/database/decks";
import { getAllTags } from "@/lib/database/tags";
import { useDeckStore } from "@/store/decks";
import { useTagStore } from "@/store/tags";

/**
 * 029: 自動バックアップから「特定デッキだけ」を現在のデータに行単位でマージ復元する。
 *
 * オフライン2台が別デッキを学習→whole-file LWW で一方が丸ごと負けて学習が消えたとき、
 * 負けた端末に残る自動バックアップ（backupLocalDbBeforeReplace の世代スナップショット）から
 * 1デッキ分だけを取り出し、何も破壊しない加算的マージで統合する救済措置。
 *
 * マージ規則（行単位・非破壊。削除は一切しない）：
 * - decks       : updatedAt で LWW（新しい方の内容）。無ければ追加。
 * - cards       : updatedAt で LWW。バックアップにしか無いカードは追加。現データのカードは消さない。
 * - card_contents: 対応する cards の LWW 勝者に追従（勝者がバックアップ側のときだけ上書き）。
 * - reviews     : lastReviewDate で LWW（カードごとに新しい学習を残す）。
 * - review_logs : union（INSERT OR IGNORE）＝両方の履歴を合算。
 * - grade_logs  : union（INSERT OR IGNORE、id 保持で重複回避）。
 * - tags        : union（INSERT OR IGNORE、既存定義は維持）。対象デッキのカードに紐づくものだけ。
 * - card_tags   : union（INSERT OR IGNORE）。対象デッキのカード分だけ。
 *
 * スコープを1デッキに絞るので他デッキ（=相手端末で勝った学習）は無傷のまま両立できる。
 */

export interface BackupDeckInfo {
  id: string;
  name: string;
  /** バックアップ内のこのデッキのカード枚数（実カウント） */
  cardCount: number;
  /** このデッキで最後に学習した日時（ISO、未学習は null） */
  lastReviewDate: string | null;
  /** このデッキの最終更新日時（ISO）。デッキ自身・配下カードの編集のうち最も新しい時刻（学習は除く）。 */
  lastUpdatedAt: string | null;
  /** デッキアイコン（028 以前の古いバックアップでは列が無く null） */
  iconName: string | null;
  /** デッキカラー（同上） */
  colorHex: string | null;
}

/** PRAGMA table_info で指定スキーマ・テーブルのカラム名一覧を取得する。 */
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

/** main と backupdb の両方に存在する共通カラム（古いバックアップのスキーマ差異に耐える）。 */
async function sharedColumns(
  db: SQLiteDatabase,
  table: string,
): Promise<string[]> {
  const mainCols = await tableColumns(db, "main", table);
  if (mainCols.length === 0) return [];
  const backupCols = new Set(await tableColumns(db, "backupdb", table));
  return mainCols.filter((c) => backupCols.has(c));
}

/**
 * バックアップ側に対象テーブルが存在するか（PRAGMA が空 = テーブル無し or カラム無し）。
 * バックアップが本機能導入より前の古いスキーマでも安全にスキップできるようにする。
 */
async function backupHasTable(
  db: SQLiteDatabase,
  table: string,
): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA backupdb.table_info(${table});`,
  );
  return rows.length > 0;
}

/**
 * updatedAt（または任意の timestamp 列）で LWW upsert する。
 * バックアップにしか無い行は挿入、両方にある行は backup の方が新しいときだけ上書きする。
 */
async function upsertLWW(
  db: SQLiteDatabase,
  table: string,
  pk: string,
  tsCol: string,
  whereSql: string,
): Promise<void> {
  if (!(await backupHasTable(db, table))) return;
  const cols = await sharedColumns(db, table);
  if (cols.length === 0) return;
  const colList = cols.map((c) => `"${c}"`).join(",");
  const setList = cols
    .filter((c) => c !== pk)
    .map((c) => `"${c}"=excluded."${c}"`)
    .join(",");
  await db.execAsync(
    `INSERT INTO main.${table} (${colList}) SELECT ${colList} FROM backupdb.${table} ${whereSql}
     ON CONFLICT(${pk}) DO UPDATE SET ${setList}
       WHERE excluded."${tsCol}" > "${table}"."${tsCol}";`,
  );
}

/** union（INSERT OR IGNORE）でバックアップの行を加算する（既存行は維持）。 */
async function unionInsert(
  db: SQLiteDatabase,
  table: string,
  whereSql: string,
): Promise<void> {
  if (!(await backupHasTable(db, table))) return;
  const cols = await sharedColumns(db, table);
  if (cols.length === 0) return;
  const colList = cols.map((c) => `"${c}"`).join(",");
  await db.execAsync(
    `INSERT OR IGNORE INTO main.${table} (${colList}) SELECT ${colList} FROM backupdb.${table} ${whereSql};`,
  );
}

/** バックアップDB（パス）を ATTACH して中のデッキ一覧（id/名前/枚数/最終学習日）を返す。 */
export async function listDecksInBackup(
  db: SQLiteDatabase,
  backupPath: string,
): Promise<BackupDeckInfo[]> {
  const escaped = backupPath.replace(/^file:\/\//, "").replace(/'/g, "''");
  await db.execAsync(`ATTACH DATABASE '${escaped}' AS backupdb;`);
  try {
    // iconName / colorHex は 028 で追加された列。古いバックアップには無いため、
    // 列の有無を確認し、無ければ NULL を返して SQL エラーを避ける。
    const deckCols = await tableColumns(db, "backupdb", "decks");
    const iconSel = deckCols.includes("iconName") ? "d.iconName" : "NULL";
    const colorSel = deckCols.includes("colorHex") ? "d.colorHex" : "NULL";
    // デッキ選択画面（カード移動・TSV）と同じ「手動並べ替え順」(sortOrder) に揃える。
    // 古いバックアップに sortOrder 列が無い場合は名前順にフォールバック。
    const orderBy = deckCols.includes("sortOrder")
      ? "d.sortOrder ASC"
      : "d.name COLLATE NOCASE ASC";
    return await db.getAllAsync<BackupDeckInfo>(
      `SELECT d.id AS id, d.name AS name,
         (SELECT COUNT(*) FROM backupdb.cards c WHERE c.deckId = d.id) AS cardCount,
         (SELECT MAX(r.lastReviewDate) FROM backupdb.reviews r
            JOIN backupdb.cards c2 ON c2.id = r.cardId WHERE c2.deckId = d.id) AS lastReviewDate,
         -- 最終更新: デッキ自身・配下カードの編集のうち最も新しい更新時刻（学習は含めない。
         -- それは「最終学習」で別表示するため）。ISO TEXT は辞書順=時系列。MAX(...) は引数に
         -- NULL があると NULL を返すため、カードが無いケースを COALESCE('') で吸収する
         -- （d.updatedAt は常に非 NULL）。
         MAX(
           d.updatedAt,
           COALESCE((SELECT MAX(c3.updatedAt) FROM backupdb.cards c3 WHERE c3.deckId = d.id), '')
         ) AS lastUpdatedAt,
         ${iconSel} AS iconName,
         ${colorSel} AS colorHex
       FROM backupdb.decks d
       ORDER BY ${orderBy};`,
    );
  } finally {
    await db.execAsync("DETACH DATABASE backupdb;");
  }
}

/**
 * バックアップから1デッキを現在のデータへ行単位マージする。
 * ATTACH＋テーブルコピー（replaceLocalDataFromDownloadedDb と同じ実績パターン）を
 * 単一接続の withTransactionAsync 内で行う。終了時に必ず DETACH する。
 */
export async function mergeDeckFromBackup(
  db: SQLiteDatabase,
  backupPath: string,
  deckId: string,
): Promise<void> {
  const escaped = backupPath.replace(/^file:\/\//, "").replace(/'/g, "''");
  // deckId は generateId() による UUID（hex とハイフンのみ）なので直接埋め込み可。
  const did = deckId.replace(/'/g, "''");
  // 対象デッキに属するカード id の集合（バックアップ基準）。各テーブルのスコープに使う。
  const cardScope = `(SELECT id FROM backupdb.cards WHERE deckId = '${did}')`;

  await db.execAsync(`ATTACH DATABASE '${escaped}' AS backupdb;`);
  try {
    await db.withTransactionAsync(async () => {
      // 1. decks（LWW by updatedAt）。無ければ追加、あれば新しい方を採用。
      await upsertLWW(db, "decks", "id", "updatedAt", `WHERE id = '${did}'`);

      // 2. cards（LWW by updatedAt）。バックアップにしか無いカードは追加。
      await upsertLWW(db, "cards", "id", "updatedAt", `WHERE deckId = '${did}'`);

      // 3. card_contents：cards の LWW 勝者に追従。
      //    cards upsert 後、勝者がバックアップ側なら main.cards.updatedAt == backup 値（または新規挿入で一致）、
      //    現データが新しければ main > backup となる。よって backup >= main のとき content をバックアップで上書きする。
      if (await backupHasTable(db, "card_contents")) {
        await db.execAsync(
          `INSERT INTO main.card_contents (cardId, frontContent, backContent, memoContent)
           SELECT bc.cardId, bc.frontContent, bc.backContent, bc.memoContent
           FROM backupdb.card_contents bc
           JOIN backupdb.cards bk ON bk.id = bc.cardId
           JOIN main.cards mc ON mc.id = bc.cardId
           WHERE bk.deckId = '${did}' AND bk.updatedAt >= mc.updatedAt
           ON CONFLICT(cardId) DO UPDATE SET
             frontContent = excluded.frontContent,
             backContent  = excluded.backContent,
             memoContent  = excluded.memoContent;`,
        );
      }

      // 4. reviews（LWW by lastReviewDate）。lastReviewDate は ISO TEXT なので辞書順=時系列。
      await upsertLWW(
        db,
        "reviews",
        "cardId",
        "lastReviewDate",
        `WHERE cardId IN ${cardScope}`,
      );

      // 5. review_logs：union（INSERT OR IGNORE、PK = cardId+reviewedDate）。
      await unionInsert(db, "review_logs", `WHERE cardId IN ${cardScope}`);

      // 6. grade_logs：union（INSERT OR IGNORE、id 保持で再マージ時の重複を回避）。
      await unionInsert(db, "grade_logs", `WHERE cardId IN ${cardScope}`);

      // 7. tags：対象デッキのカードに紐づくものだけ union（既存定義は維持）。
      await unionInsert(
        db,
        "tags",
        `WHERE id IN (SELECT tagId FROM backupdb.card_tags WHERE cardId IN ${cardScope})`,
      );

      // 8. card_tags：union（INSERT OR IGNORE）。
      await unionInsert(db, "card_tags", `WHERE cardId IN ${cardScope}`);

      // 9. cardCount を再計算（マージで増減し得るため）。
      await db.execAsync(
        `UPDATE main.decks SET cardCount = (SELECT COUNT(*) FROM main.cards WHERE deckId = '${did}') WHERE id = '${did}';`,
      );
    });
  } finally {
    await db.execAsync("DETACH DATABASE backupdb;");
  }

  // インメモリキャッシュ（デッキ・タグ）を DB から再読込する。
  const [decks, tags] = await Promise.all([getAllDecks(db), getAllTags(db)]);
  useDeckStore.getState().setDecks(decks);
  useTagStore.getState().setTags(tags);
}
