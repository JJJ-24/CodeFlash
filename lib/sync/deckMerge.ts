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
  /**
   * 以下は「このデッキをマージすると現在のデータがどう変わるか」の件数（現データとの差分）。
   * 日時（最終学習・最終編集）は端末をまたいで比べられる絶対値だが、「戻す価値があるか」は
   * 読み取れない。とくに**並べ替えとタグは日時をまったく動かさない**ので、時刻だけでは
   * 存在しない差分に見えてしまう。マージ規則（deckMerge のヘッダ参照）と同じ条件で数える。
   *
   * ⚠️ 数え方は「現データに**無い/古い**もの」だけ＝マージで実際に増える・上書きされる件数。
   * 逆向き（現データにしか無いもの）は相手端末の作業なので数えない。
   * ⚠️ 各項目は重複しない：現データに存在しないカードは diffNewCards にだけ数え、
   * 比較系（学習/履歴/本文/タグ/並び順）は**両方に存在するカード**に限る。
   */
  /** バックアップにしか無いカード枚数（マージで追加される） */
  diffNewCards: number;
  /** 本文がバックアップの方が新しいカード枚数（マージで上書きされる） */
  diffNewerContents: number;
  /** 学習記録がバックアップの方が新しいカード枚数（reviews の LWW で置き換わる） */
  diffNewerReviews: number;
  /** 現データに無い学習履歴の行数（review_logs の union で増える＝ヒートマップ等が戻る） */
  diffNewLogs: number;
  /** 現データに無いタグ紐付けの件数（card_tags の union で増える） */
  diffNewTags: number;
  /** デッキ自身（名前・アイコン・土台・読み上げ等）がバックアップの方が新しいか（0/1） */
  diffDeckSettings: number;
  /**
   * 並び順が違うカード枚数（`sortOrder` の**値**ではなく**順位**の違い＝`countOrderDiffs`）。
   * 既定のマージでは戻らない（cards は `updatedAt` の LWW で、並べ替えは `updatedAt` を
   * 動かさないため上書き条件を満たさない）ので、確認ダイアログの「並び順も戻す」で戻す。
   */
  diffOrder: number;
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

/**
 * デッキごとに「並び順が違うカードの枚数」を数える（要 ATTACH 済み）。
 *
 * ⚠️ **`sortOrder` の値の一致を見てはいけない**：カードの削除・移動で値には歯抜けができ
 * （`createCard` は MAX+1・`moveCardsToDeck` は +offset）、ドラッグのたびに
 * `updateCardSortOrders` が **0..N-1 へ振り直す**。そのため「1枚を隣へ動かしただけ」でも
 * 歯抜けより後ろの全行の**値**が変わり、実測で 56 枚のデッキが「28 枚違う」と出た。
 * 見たいのは値ではなく**並び**なので、`ROW_NUMBER()` で両方の順位を出して比べる。
 * ⚠️ 順位は**両方に存在する同じデッキのカード**の中で計算する＝片側にしか無いカードで
 * 順位がずれて全体が違って見えるのを防ぐ（増減は diffNewCards が担当）。
 * ⚠️ 同順（`sortOrder` の重複は旧データで起こりうる）は `id` で決着させて安定させる。
 */
async function countOrderDiffs(db: SQLiteDatabase): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ deckId: string; n: number }>(
    `WITH shared AS (
       SELECT bc.deckId AS deckId, bc.id AS id, bc.sortOrder AS bso, mc.sortOrder AS mso
       FROM backupdb.cards bc
       JOIN main.cards mc ON mc.id = bc.id AND mc.deckId = bc.deckId
     ),
     ranked AS (
       SELECT deckId, id,
         ROW_NUMBER() OVER (PARTITION BY deckId ORDER BY bso, id) AS brank,
         ROW_NUMBER() OVER (PARTITION BY deckId ORDER BY mso, id) AS mrank
       FROM shared
     )
     SELECT deckId, COUNT(*) AS n FROM ranked WHERE brank <> mrank GROUP BY deckId;`,
  );
  return new Map(rows.map((r) => [r.deckId, r.n]));
}

/** バックアップDB（パス）を ATTACH して中のデッキ一覧（id/名前/枚数/最終学習日＋現データとの差分件数）を返す。 */
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
    const hasSortOrder = deckCols.includes("sortOrder");
    const orderBy = hasSortOrder
      ? "d.sortOrder ASC"
      : "d.name COLLATE NOCASE ASC";
    // 差分の計算も古いバックアップのスキーマ差異に耐えさせる（無い列/テーブルは 0 を返す）。
    const backupCardCols = await tableColumns(db, "backupdb", "cards");
    const canDiffOrder = backupCardCols.includes("sortOrder");
    const hasReviewLogs = await backupHasTable(db, "review_logs");
    // 差分の対象は「両方に存在するカード」に限る（バックアップにしか無いカードは
    // diffNewCards に一本化＝項目が重複しない）。main.cards への JOIN が現データ側の存在確認。
    const bothCardsFrom = "FROM backupdb.cards bc JOIN main.cards mc ON mc.id = bc.id";
    /** 子テーブル（学習・履歴・タグ）を「両方に存在するカード」へ絞る JOIN 句。 */
    const joinBothCards = (childCardId: string) =>
      `JOIN backupdb.cards bc ON bc.id = ${childCardId}
       JOIN main.cards mc ON mc.id = ${childCardId}`;
    const diffLogsSel = hasReviewLogs
      ? `(SELECT COUNT(*) FROM backupdb.review_logs bl
            ${joinBothCards("bl.cardId")}
            WHERE bc.deckId = d.id
              AND NOT EXISTS (SELECT 1 FROM main.review_logs ml
                                WHERE ml.cardId = bl.cardId AND ml.reviewedDate = bl.reviewedDate))`
      : "0";
    const rows = await db.getAllAsync<BackupDeckInfo>(
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
         ${colorSel} AS colorHex,
         -- === 現データとの差分（マージで実際に増える・上書きされる件数）===
         (SELECT COUNT(*) FROM backupdb.cards bc WHERE bc.deckId = d.id
            AND NOT EXISTS (SELECT 1 FROM main.cards mc WHERE mc.id = bc.id)) AS diffNewCards,
         (SELECT COUNT(*) ${bothCardsFrom}
            WHERE bc.deckId = d.id AND bc.updatedAt > mc.updatedAt) AS diffNewerContents,
         -- COALESCE('') で「現データにカードはあるが未学習（reviews 行が無い）」も差分に数える。
         (SELECT COUNT(*) FROM backupdb.reviews br
            ${joinBothCards("br.cardId")}
            WHERE bc.deckId = d.id
              AND br.lastReviewDate >
                  COALESCE((SELECT mr.lastReviewDate FROM main.reviews mr
                              WHERE mr.cardId = br.cardId), '')) AS diffNewerReviews,
         ${diffLogsSel} AS diffNewLogs,
         (SELECT COUNT(*) FROM backupdb.card_tags bt
            ${joinBothCards("bt.cardId")}
            WHERE bc.deckId = d.id
              AND NOT EXISTS (SELECT 1 FROM main.card_tags mt
                                WHERE mt.cardId = bt.cardId AND mt.tagId = bt.tagId)) AS diffNewTags,
         -- デッキ自身が現データに無い（相手端末で削除された）ときも COALESCE('') で 1 になる。
         (CASE WHEN d.updatedAt >
                    COALESCE((SELECT md.updatedAt FROM main.decks md WHERE md.id = d.id), '')
               THEN 1 ELSE 0 END) AS diffDeckSettings,
         0 AS diffOrder
       FROM backupdb.decks d
       ORDER BY ${orderBy};`,
    );
    const orderDiffs = canDiffOrder ? await countOrderDiffs(db) : new Map<string, number>();
    return rows.map((r) => ({ ...r, diffOrder: orderDiffs.get(r.id) ?? 0 }));
  } finally {
    await db.execAsync("DETACH DATABASE backupdb;");
  }
}

/** 片方向ぶんの差分件数（`inspectBackupReplace` が両方向で返す）。 */
export interface BackupDiffCounts {
  /** 相手側に無いデッキ */
  decks: number;
  /** 相手側に無いカード */
  cards: number;
  /** 両方にあるカードのうち、本文（`cards.updatedAt`）がこちらの方が新しいもの */
  contents: number;
  /** 両方にあるカードのうち、学習記録がこちらの方が新しいもの */
  reviews: number;
  /** 相手側に無い学習履歴（`review_logs`）の行 */
  logs: number;
  /** 相手側に無いタグ紐付け（`card_tags`） */
  tags: number;
}

/** 「すべて置き換え」で何が戻り、何が失われるか。 */
export interface BackupReplaceDiff {
  /** 置き換えで**戻る**もの（バックアップにあって現データに無い／新しい） */
  restore: BackupDiffCounts;
  /** 置き換えで**失う**もの（現データにあってバックアップに無い／新しい） */
  lose: BackupDiffCounts;
}

/** 片方向（from にあって to に無い／新しい）の件数を1クエリで数える。 */
async function countOneWay(
  db: SQLiteDatabase,
  from: "main" | "backupdb",
  to: "main" | "backupdb",
  hasReviewLogs: boolean,
): Promise<BackupDiffCounts> {
  const logsSel = hasReviewLogs
    ? `(SELECT COUNT(*) FROM ${from}.review_logs fl
          JOIN ${from}.cards f ON f.id = fl.cardId
          JOIN ${to}.cards tc ON tc.id = fl.cardId
          WHERE NOT EXISTS (SELECT 1 FROM ${to}.review_logs tl
                              WHERE tl.cardId = fl.cardId AND tl.reviewedDate = fl.reviewedDate))`
    : "0";
  const row = await db.getFirstAsync<BackupDiffCounts>(
    `SELECT
       (SELECT COUNT(*) FROM ${from}.decks f
          WHERE NOT EXISTS (SELECT 1 FROM ${to}.decks t WHERE t.id = f.id)) AS decks,
       (SELECT COUNT(*) FROM ${from}.cards f
          WHERE NOT EXISTS (SELECT 1 FROM ${to}.cards t WHERE t.id = f.id)) AS cards,
       (SELECT COUNT(*) FROM ${from}.cards f JOIN ${to}.cards t ON t.id = f.id
          WHERE f.updatedAt > t.updatedAt) AS contents,
       (SELECT COUNT(*) FROM ${from}.reviews fr
          JOIN ${from}.cards f ON f.id = fr.cardId
          JOIN ${to}.cards tc ON tc.id = fr.cardId
          WHERE fr.lastReviewDate >
                COALESCE((SELECT tr.lastReviewDate FROM ${to}.reviews tr
                            WHERE tr.cardId = fr.cardId), '')) AS reviews,
       ${logsSel} AS logs,
       (SELECT COUNT(*) FROM ${from}.card_tags ft
          JOIN ${from}.cards f ON f.id = ft.cardId
          JOIN ${to}.cards tc ON tc.id = ft.cardId
          WHERE NOT EXISTS (SELECT 1 FROM ${to}.card_tags tt
                              WHERE tt.cardId = ft.cardId AND tt.tagId = ft.tagId)) AS tags;`,
  );
  return row ?? { decks: 0, cards: 0, contents: 0, reviews: 0, logs: 0, tags: 0 };
}

/**
 * 「すべて置き換え」（`restoreFromLocalBackup`）の確認用に、バックアップと現データの
 * 差分を**両方向**で数える。
 *
 * ⚠️ **片方向では足りない**：置き換えは破壊的なので、判断に要るのは「戻るもの」より
 * **「失うもの」**（バックアップ以降にこの端末でやった作業）。デッキ別マージの画面が
 * 出しているのは戻る側だけなので、こちらは両方向を出す。
 * ⚠️ 比較系（本文・学習）は**両方に存在するカード**に限る＝片側にしか無いカードは
 * `cards` に一本化して項目を重複させない（`listDecksInBackup` と同じ規約）。
 */
export async function inspectBackupReplace(
  db: SQLiteDatabase,
  backupPath: string,
): Promise<BackupReplaceDiff> {
  const escaped = backupPath.replace(/^file:\/\//, "").replace(/'/g, "''");
  await db.execAsync(`ATTACH DATABASE '${escaped}' AS backupdb;`);
  try {
    // 古いバックアップに review_logs が無いことがある（`listDecksInBackup` と同じ扱い）。
    const hasReviewLogs = await backupHasTable(db, "review_logs");
    return {
      restore: await countOneWay(db, "backupdb", "main", hasReviewLogs),
      lose: await countOneWay(db, "main", "backupdb", hasReviewLogs),
    };
  } finally {
    await db.execAsync("DETACH DATABASE backupdb;");
  }
}

/**
 * バックアップから1デッキを現在のデータへ行単位マージする。
 * ATTACH＋テーブルコピー（replaceLocalDataFromDownloadedDb と同じ実績パターン）を
 * 単一接続の withTransactionAsync 内で行う。終了時に必ず DETACH する。
 *
 * @param opts.restoreOrder カードの並び順もバックアップのものへ戻す（既定 false）。
 *   ⚠️ **これだけは加算マージではない**（相手端末の並べ替えを上書きしうる）ので、
 *   呼び出し側で専用のボタンを押させること。既定の LWW では並び順は戻らない
 *   ＝並べ替えは `updatedAt` を動かさないため上書き条件（backup > main）を満たさない。
 */
export async function mergeDeckFromBackup(
  db: SQLiteDatabase,
  backupPath: string,
  deckId: string,
  opts?: { restoreOrder?: boolean },
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

      // 9. 並び順（任意・既定オフ）。ここまでの LWW では戻らないので明示的に入れ替える。
      //    ⚠️ 並び順は「リスト全体の性質」なので行ごとの LWW に馴染まない（両端末で
      //    並べ替えていると番号が重複・欠落してどちらの意図でもない順序になる）。
      //    そのため**バックアップの並びを丸ごと採用**し、バックアップに無いカード
      //    （相手端末が追加したぶん）は相対順序を保ったまま後ろへ送る。
      //    バックアップの sortOrder は 0 始まりなので、+MAX+1 すれば必ず後ろに出る。
      if (opts?.restoreOrder && (await sharedColumns(db, "cards")).includes("sortOrder")) {
        await db.execAsync(
          `UPDATE main.cards SET sortOrder =
             (SELECT bc.sortOrder FROM backupdb.cards bc WHERE bc.id = main.cards.id)
           WHERE deckId = '${did}'
             AND EXISTS (SELECT 1 FROM backupdb.cards bc WHERE bc.id = main.cards.id);`,
        );
        await db.execAsync(
          `UPDATE main.cards SET sortOrder = sortOrder +
             (SELECT COALESCE(MAX(bc2.sortOrder), 0) + 1 FROM backupdb.cards bc2 WHERE bc2.deckId = '${did}')
           WHERE deckId = '${did}'
             AND NOT EXISTS (SELECT 1 FROM backupdb.cards bc WHERE bc.id = main.cards.id);`,
        );
      }

      // 10. cardCount を再計算（マージで増減し得るため）。
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
