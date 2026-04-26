import type { SQLiteDatabase } from 'expo-sqlite';

import type { Review } from '@/types';
import { localDateStr, todayISO, todayLocalRange } from './utils';

/** タグIDをキー、due 枚数を値とするマップを一括取得 */
export async function getDueCountPerTag(
  db: SQLiteDatabase
): Promise<Record<string, number>> {
  const { end } = todayLocalRange();
  const rows = await db.getAllAsync<{ tagId: string; count: number }>(
    `SELECT ct.tagId, COUNT(*) as count
     FROM card_tags ct
     JOIN cards c ON ct.cardId = c.id
     LEFT JOIN reviews r ON r.cardId = c.id
     WHERE r.cardId IS NULL OR r.nextReviewDate < ?
     GROUP BY ct.tagId`,
    [end]
  );
  return Object.fromEntries(rows.map((r) => [r.tagId, r.count]));
}

/** デッキIDをキー、今日学習済みカード数を値とするマップを一括取得 */
export async function getTodayReviewedCountPerDeck(
  db: SQLiteDatabase
): Promise<Record<string, number>> {
  const { start, end } = todayLocalRange();
  const rows = await db.getAllAsync<{ deckId: string; count: number }>(
    `SELECT c.deckId, COUNT(*) as count
     FROM reviews r
     JOIN cards c ON r.cardId = c.id
     WHERE r.lastReviewDate >= ? AND r.lastReviewDate < ?
     GROUP BY c.deckId`,
    [start, end]
  );
  return Object.fromEntries(rows.map((r) => [r.deckId, r.count]));
}

/** タグIDをキー、今日学習済みカード数を値とするマップを一括取得 */
export async function getTodayReviewedCountPerTag(
  db: SQLiteDatabase
): Promise<Record<string, number>> {
  const { start, end } = todayLocalRange();
  const rows = await db.getAllAsync<{ tagId: string; count: number }>(
    `SELECT ct.tagId, COUNT(*) as count
     FROM reviews r
     JOIN cards c ON r.cardId = c.id
     JOIN card_tags ct ON c.id = ct.cardId
     WHERE r.lastReviewDate >= ? AND r.lastReviewDate < ?
     GROUP BY ct.tagId`,
    [start, end]
  );
  return Object.fromEntries(rows.map((r) => [r.tagId, r.count]));
}

/** デッキIDをキー、due 枚数を値とするマップを一括取得 */
export async function getDueCountPerDeck(
  db: SQLiteDatabase
): Promise<Record<string, number>> {
  const { end } = todayLocalRange();
  const rows = await db.getAllAsync<{ deckId: string; count: number }>(
    `SELECT c.deckId, COUNT(*) as count
     FROM cards c
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE (r.cardId IS NULL OR r.nextReviewDate < ?)
     GROUP BY c.deckId`,
    [end]
  );
  return Object.fromEntries(rows.map((r) => [r.deckId, r.count]));
}

/** タグIDをキー、紐付くカード総数を値とするマップを一括取得 */
export async function getTotalCardCountPerTag(
  db: SQLiteDatabase
): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ tagId: string; count: number }>(
    `SELECT ct.tagId, COUNT(*) as count
     FROM card_tags ct
     GROUP BY ct.tagId`
  );
  return Object.fromEntries(rows.map((r) => [r.tagId, r.count]));
}

/** デッキ別: 今日の復習対象カード数（未学習 + 復習期限到来） */
export async function getDueCountByDeck(
  db: SQLiteDatabase,
  deckId: string
): Promise<number> {
  const { end } = todayLocalRange();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM cards c
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE c.deckId = ? AND (r.cardId IS NULL OR r.nextReviewDate < ?)`,
    [deckId, end]
  );
  return row?.count ?? 0;
}

/** デッキ別: 今日学習したカード数（lastReviewDate が今日） */
export async function getTodayReviewedCountByDeck(
  db: SQLiteDatabase,
  deckId: string
): Promise<number> {
  const { start, end } = todayLocalRange();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM reviews r
     JOIN cards c ON r.cardId = c.id
     WHERE c.deckId = ? AND r.lastReviewDate >= ? AND r.lastReviewDate < ?`,
    [deckId, start, end]
  );
  return row?.count ?? 0;
}

/** レビュー記録を保存（なければ INSERT、あれば UPDATE） */
export async function saveReview(db: SQLiteDatabase, review: Review): Promise<void> {
  await db.runAsync(
    `INSERT INTO reviews (cardId, easeFactor, interval, repetitions, nextReviewDate, lastReviewDate, lastGrade, stability, difficulty, fsrsState, fsrsReps, fsrsLapses, fsrsScheduledDays)
     VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cardId) DO UPDATE SET
       easeFactor        = excluded.easeFactor,
       nextReviewDate    = excluded.nextReviewDate,
       lastReviewDate    = excluded.lastReviewDate,
       lastGrade         = excluded.lastGrade,
       stability         = excluded.stability,
       difficulty        = excluded.difficulty,
       fsrsState         = excluded.fsrsState,
       fsrsReps          = excluded.fsrsReps,
       fsrsLapses        = excluded.fsrsLapses,
       fsrsScheduledDays = excluded.fsrsScheduledDays`,
    [
      review.cardId,
      review.easeFactor,
      review.nextReviewDate,
      review.lastReviewDate,
      review.lastGrade,
      review.stability,
      review.difficulty,
      review.fsrsState,
      review.fsrsReps,
      review.fsrsLapses,
      review.fsrsScheduledDays,
    ]
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO review_logs (cardId, reviewedDate) VALUES (?, ?)`,
    [review.cardId, localDateStr(new Date(review.lastReviewDate))]
  );
}

/** カードのレビュー記録を取得（未学習なら null） */
export async function getReviewByCardId(
  db: SQLiteDatabase,
  cardId: string
): Promise<Review | null> {
  return db.getFirstAsync<Review>('SELECT * FROM reviews WHERE cardId = ?', [cardId]);
}

/** デッキ別: 全カードのID */
export async function getAllCardIdsByDeckId(
  db: SQLiteDatabase,
  deckId: string
): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM cards c WHERE c.deckId = ? ORDER BY c.sortOrder ASC`,
    [deckId]
  );
  return rows.map((r) => r.id);
}

/** デッキ別: 今日学習済みカードのID */
export async function getTodayReviewedCardIdsByDeckId(
  db: SQLiteDatabase,
  deckId: string
): Promise<string[]> {
  const { start, end } = todayLocalRange();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM cards c
     JOIN reviews r ON c.id = r.cardId
     WHERE c.deckId = ? AND r.lastReviewDate >= ? AND r.lastReviewDate < ?
     ORDER BY c.sortOrder ASC`,
    [deckId, start, end]
  );
  return rows.map((r) => r.id);
}

/**
 * デッキ単位で今日の復習対象カードIDを取得
 * 対象: nextReviewDate < 翌日ローカル0時(UTC) OR レビュー未登録の新規カード
 */
export async function getDueCardIdsByDeckId(
  db: SQLiteDatabase,
  deckId: string
): Promise<string[]> {
  const { end } = todayLocalRange();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM cards c
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE c.deckId = ?
       AND (r.cardId IS NULL OR r.nextReviewDate < ?)
     ORDER BY c.sortOrder ASC`,
    [deckId, end]
  );
  return rows.map((r) => r.id);
}

/**
 * タグ単位で今日の復習対象カードIDを取得（デッキ横断）
 */
export async function getDueCardIdsByTagId(
  db: SQLiteDatabase,
  tagId: string
): Promise<string[]> {
  const { end } = todayLocalRange();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM cards c
     JOIN card_tags ct ON c.id = ct.cardId
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE ct.tagId = ?
       AND (r.cardId IS NULL OR r.nextReviewDate < ?)
     ORDER BY c.sortOrder ASC`,
    [tagId, end]
  );
  return rows.map((r) => r.id);
}

/** タグ別: 全カードのID（デッキ横断） */
export async function getAllCardIdsByTagId(
  db: SQLiteDatabase,
  tagId: string
): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM cards c
     JOIN card_tags ct ON c.id = ct.cardId
     WHERE ct.tagId = ?
     ORDER BY c.sortOrder ASC`,
    [tagId]
  );
  return rows.map((r) => r.id);
}

/** タグ別: 今日学習済みカードのID（デッキ横断） */
export async function getTodayReviewedCardIdsByTagId(
  db: SQLiteDatabase,
  tagId: string
): Promise<string[]> {
  const { start, end } = todayLocalRange();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM cards c
     JOIN card_tags ct ON c.id = ct.cardId
     JOIN reviews r ON c.id = r.cardId
     WHERE ct.tagId = ? AND r.lastReviewDate >= ? AND r.lastReviewDate < ?
     ORDER BY c.sortOrder ASC`,
    [tagId, start, end]
  );
  return rows.map((r) => r.id);
}

/** 今日学習したカード数（lastReviewDate が今日のもの） */
export async function getTodayReviewedCount(db: SQLiteDatabase): Promise<number> {
  const { start, end } = todayLocalRange();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM reviews WHERE lastReviewDate >= ? AND lastReviewDate < ?`,
    [start, end]
  );
  return row?.count ?? 0;
}

/** 今後 7 日分の復習予定件数 { date: 'YYYY-MM-DD', count: number }[] */
export async function getUpcomingSchedule(
  db: SQLiteDatabase
): Promise<{ date: string; count: number }[]> {
  const today = todayISO();
  const end = new Date();
  end.setDate(end.getDate() + 6);
  const endISO = end.toISOString().slice(0, 10);

  const rows = await db.getAllAsync<{ date: string; count: number }>(
    `SELECT substr(nextReviewDate, 1, 10) as date, COUNT(*) as count
     FROM reviews
     WHERE substr(nextReviewDate, 1, 10) BETWEEN ? AND ?
     GROUP BY date
     ORDER BY date ASC`,
    [today, endISO]
  );
  return rows;
}

/** 全体の今日 due カード数（新規 + 復習） */
export async function getTodayDueCount(db: SQLiteDatabase): Promise<number> {
  const { end } = todayLocalRange();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM cards c
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE r.cardId IS NULL OR r.nextReviewDate < ?`,
    [end]
  );
  return row?.count ?? 0;
}

/** 学習済み・未学習カード数 */
export async function getLearnedUnlearnedCount(
  db: SQLiteDatabase
): Promise<{ learned: number; unlearned: number }> {
  const learnedRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM reviews`
  );
  const unlearnedRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM cards WHERE id NOT IN (SELECT cardId FROM reviews)`
  );
  return {
    learned: learnedRow?.count ?? 0,
    unlearned: unlearnedRow?.count ?? 0,
  };
}

/** 全カード：直近評価分布（lastGrade ベース） */
export async function getAllGradeDistribution(
  db: SQLiteDatabase
): Promise<{ again: number; hard: number; normal: number; easy: number; unlearned: number }> {
  const rows = await db.getAllAsync<{ category: string; count: number }>(
    `SELECT
       CASE
         WHEN r.cardId IS NULL THEN 'unlearned'
         WHEN r.lastGrade = 0  THEN 'again'
         WHEN r.lastGrade = 1  THEN 'hard'
         WHEN r.lastGrade = 3  THEN 'easy'
         ELSE 'normal'
       END as category,
       COUNT(*) as count
     FROM cards c
     LEFT JOIN reviews r ON c.id = r.cardId
     GROUP BY category`
  );
  const result = { again: 0, hard: 0, normal: 0, easy: 0, unlearned: 0 };
  for (const row of rows) {
    if (row.category in result) result[row.category as keyof typeof result] = row.count;
  }
  return result;
}

/** デッキ別：カードの直近評価分布（lastGrade ベース） */
export async function getDeckGradeDistribution(
  db: SQLiteDatabase,
  deckId: string
): Promise<{ again: number; hard: number; normal: number; easy: number; unlearned: number }> {
  const rows = await db.getAllAsync<{ category: string; count: number }>(
    `SELECT
       CASE
         WHEN r.cardId IS NULL THEN 'unlearned'
         WHEN r.lastGrade = 0  THEN 'again'
         WHEN r.lastGrade = 1  THEN 'hard'
         WHEN r.lastGrade = 3  THEN 'easy'
         ELSE 'normal'
       END as category,
       COUNT(*) as count
     FROM cards c
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE c.deckId = ?
     GROUP BY category`,
    [deckId]
  );
  const result = { again: 0, hard: 0, normal: 0, easy: 0, unlearned: 0 };
  for (const row of rows) {
    if (row.category in result) result[row.category as keyof typeof result] = row.count;
  }
  return result;
}

/** デッキ別習熟度（easeFactor 平均 + 学習済み枚数 + 新規枚数）、ホーム画面のデッキ順に返す */
export async function getDeckMasteryList(
  db: SQLiteDatabase
): Promise<{ deckId: string; avgEase: number | null; learnedCount: number; newCount: number }[]> {
  return db.getAllAsync<{ deckId: string; avgEase: number | null; learnedCount: number; newCount: number }>(
    `SELECT c.deckId,
            AVG(r.easeFactor) as avgEase,
            COUNT(r.cardId) as learnedCount,
            SUM(CASE WHEN r.cardId IS NULL THEN 1 ELSE 0 END) as newCount
     FROM cards c
     LEFT JOIN reviews r ON r.cardId = c.id
     JOIN decks d ON c.deckId = d.id
     GROUP BY c.deckId
     ORDER BY d.sortOrder ASC`
  );
}

/** 過去7日間の日別学習済みカード数（ローカル日付ベース） */
export async function getPast7DaysReviewedCount(
  db: SQLiteDatabase
): Promise<{ date: string; count: number }[]> {
  const startLocal = new Date();
  startLocal.setDate(startLocal.getDate() - 6);
  const startStr = localDateStr(startLocal);
  const endStr = todayISO();

  // review_logs.reviewedDate はローカル YYYY-MM-DD で保存済み
  const rows = await db.getAllAsync<{ date: string; count: number }>(
    `SELECT reviewedDate AS date, COUNT(*) AS count
     FROM review_logs
     WHERE reviewedDate >= ? AND reviewedDate <= ?
     GROUP BY reviewedDate
     ORDER BY reviewedDate`,
    [startStr, endStr]
  );

  return rows;
}

/** 過去7日間の学習活動（学習あり=1、なし=0） */
export async function getPast7DaysStudyActivity(
  db: SQLiteDatabase
): Promise<{ date: string; count: number }[]> {
  const rows = await getPast7DaysReviewedCount(db);
  return rows.map((r) => ({ date: r.date, count: r.count > 0 ? 1 : 0 }));
}

/** 指定日以降の日別学習枚数（review_logs ベース） */
export async function getDailyReviewCounts(
  db: SQLiteDatabase,
  startDate: string
): Promise<{ date: string; count: number }[]> {
  return db.getAllAsync<{ date: string; count: number }>(
    `SELECT reviewedDate AS date, COUNT(*) AS count
     FROM review_logs
     WHERE reviewedDate >= ?
     GROUP BY reviewedDate
     ORDER BY reviewedDate`,
    [startDate]
  );
}

/**
 * 学習ストリーク日数を計算する
 * 今日から過去に遡り、review_logs に学習記録がある日が連続している日数を返す
 * review_logs.reviewedDate はローカル YYYY-MM-DD で保存されているため変換不要
 */
export async function getStudyStreak(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ reviewedDate: string }>(
    `SELECT DISTINCT reviewedDate FROM review_logs`
  );

  if (rows.length === 0) return 0;

  const localDateSet = new Set(rows.map((r) => r.reviewedDate));

  let streak = 0;
  const current = new Date(); // ローカル現在時刻から逆算

  for (let i = 0; i < 365; i++) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const localDate = `${y}-${m}-${day}`;

    if (localDateSet.has(localDate)) {
      streak++;
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}
