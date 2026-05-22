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
export async function saveReview(db: SQLiteDatabase, review: Review, responseTimeMs?: number): Promise<void> {
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
  // 同日内の再評価は最後の1回のみを残す（FSRS の「同日 = やり直し」哲学と一貫）
  const localToday = localDateStr(new Date(review.lastReviewDate));
  await db.runAsync(
    `DELETE FROM grade_logs WHERE cardId = ? AND date(reviewedAt, 'localtime') = ?`,
    [review.cardId, localToday]
  );
  await db.runAsync(
    `INSERT INTO grade_logs (cardId, grade, reviewedAt, responseTimeMs) VALUES (?, ?, ?, ?)`,
    [review.cardId, review.lastGrade, review.lastReviewDate, responseTimeMs ?? null]
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

/** 苦手カード（fsrsLapses 多い順・easeFactor 低い順） */
export async function getWeakCards(
  db: SQLiteDatabase,
  limit = 10
): Promise<{ cardId: string; deckId: string; deckName: string; frontContent: string; fsrsLapses: number; easeFactor: number }[]> {
  return db.getAllAsync<{ cardId: string; deckId: string; deckName: string; frontContent: string; fsrsLapses: number; easeFactor: number }>(
    `SELECT c.id as cardId, c.deckId, d.name as deckName,
            cc.frontContent, COALESCE(r.fsrsLapses, 0) as fsrsLapses, r.easeFactor
     FROM cards c
     JOIN card_contents cc ON c.id = cc.cardId
     JOIN decks d ON c.deckId = d.id
     JOIN reviews r ON c.id = r.cardId
     WHERE r.fsrsLapses > 0
     ORDER BY r.fsrsLapses DESC, r.easeFactor ASC
     LIMIT ?`,
    [limit]
  );
}

/** 月別学習枚数（review_logs ベース） */
export async function getMonthlyReviewCounts(
  db: SQLiteDatabase
): Promise<{ month: string; count: number }[]> {
  return db.getAllAsync<{ month: string; count: number }>(
    `SELECT substr(reviewedDate, 1, 7) as month, COUNT(*) as count
     FROM review_logs
     GROUP BY month
     ORDER BY month ASC`
  );
}

export async function getGradeLogTotals(
  db: SQLiteDatabase,
  since?: string
): Promise<{ again: number; hard: number; good: number; easy: number }> {
  const where = since ? 'WHERE reviewedAt >= ?' : '';
  const params = since ? [since] : [];
  const row = await db.getFirstAsync<{ again: number; hard: number; good: number; easy: number }>(
    `SELECT
       SUM(CASE WHEN grade = 0 THEN 1 ELSE 0 END) as again,
       SUM(CASE WHEN grade = 1 THEN 1 ELSE 0 END) as hard,
       SUM(CASE WHEN grade = 2 THEN 1 ELSE 0 END) as good,
       SUM(CASE WHEN grade = 3 THEN 1 ELSE 0 END) as easy
     FROM grade_logs ${where}`,
    params
  );
  return { again: row?.again ?? 0, hard: row?.hard ?? 0, good: row?.good ?? 0, easy: row?.easy ?? 0 };
}

/** カード別グレード集計（評価回数・グレード別平均回答時間） */
export interface CardGradeStats {
  again: number; hard: number; good: number; easy: number;
  avgTimeAgain: number | null; avgTimeHard: number | null;
  avgTimeGood: number | null; avgTimeEasy: number | null;
  avgTime: number | null;
}

export async function getCardGradeStats(
  db: SQLiteDatabase,
  cardId: string
): Promise<CardGradeStats> {
  const row = await db.getFirstAsync<CardGradeStats>(
    `SELECT
       SUM(CASE WHEN grade = 0 THEN 1 ELSE 0 END) as again,
       SUM(CASE WHEN grade = 1 THEN 1 ELSE 0 END) as hard,
       SUM(CASE WHEN grade = 2 THEN 1 ELSE 0 END) as good,
       SUM(CASE WHEN grade = 3 THEN 1 ELSE 0 END) as easy,
       AVG(CASE WHEN grade = 0 AND responseTimeMs IS NOT NULL THEN responseTimeMs END) as avgTimeAgain,
       AVG(CASE WHEN grade = 1 AND responseTimeMs IS NOT NULL THEN responseTimeMs END) as avgTimeHard,
       AVG(CASE WHEN grade = 2 AND responseTimeMs IS NOT NULL THEN responseTimeMs END) as avgTimeGood,
       AVG(CASE WHEN grade = 3 AND responseTimeMs IS NOT NULL THEN responseTimeMs END) as avgTimeEasy,
       AVG(CASE WHEN responseTimeMs IS NOT NULL THEN responseTimeMs END) as avgTime
     FROM grade_logs WHERE cardId = ?`,
    [cardId]
  );
  return row ?? { again: 0, hard: 0, good: 0, easy: 0, avgTimeAgain: null, avgTimeHard: null, avgTimeGood: null, avgTimeEasy: null, avgTime: null };
}

/** カードの次回学習日（reviews テーブル）。未学習なら null */
export async function getCardNextReviewDate(
  db: SQLiteDatabase,
  cardId: string
): Promise<string | null> {
  const row = await db.getFirstAsync<{ nextReviewDate: string }>(
    `SELECT nextReviewDate FROM reviews WHERE cardId = ?`,
    [cardId]
  );
  return row?.nextReviewDate ?? null;
}

/** カードの評価履歴（散布図用・古い順） */
export async function getCardGradeHistory(
  db: SQLiteDatabase,
  cardId: string
): Promise<{ grade: number; reviewedAt: string }[]> {
  return db.getAllAsync<{ grade: number; reviewedAt: string }>(
    `SELECT grade, reviewedAt FROM grade_logs WHERE cardId = ? ORDER BY id ASC`,
    [cardId]
  );
}

/** 4 グレードすべての平均回答時間（ミリ秒）を一括取得。データなしのグレードは null */
export async function getGradeAvgResponseTimes(
  db: SQLiteDatabase,
  since?: string
): Promise<{ again: number | null; hard: number | null; good: number | null; easy: number | null }> {
  const where = since ? 'WHERE reviewedAt >= ?' : '';
  const params = since ? [since] : [];
  const row = await db.getFirstAsync<{ again: number | null; hard: number | null; good: number | null; easy: number | null }>(
    `SELECT
       AVG(CASE WHEN grade = 0 AND responseTimeMs IS NOT NULL THEN responseTimeMs END) as again,
       AVG(CASE WHEN grade = 1 AND responseTimeMs IS NOT NULL THEN responseTimeMs END) as hard,
       AVG(CASE WHEN grade = 2 AND responseTimeMs IS NOT NULL THEN responseTimeMs END) as good,
       AVG(CASE WHEN grade = 3 AND responseTimeMs IS NOT NULL THEN responseTimeMs END) as easy
     FROM grade_logs ${where}`,
    params
  );
  return { again: row?.again ?? null, hard: row?.hard ?? null, good: row?.good ?? null, easy: row?.easy ?? null };
}

export type GradeRankingSortBy = 'count' | 'time';

export async function getTopCardsByGrade(
  db: SQLiteDatabase,
  grade: 0 | 1 | 2 | 3,
  limit = 10,
  sortBy: GradeRankingSortBy = 'count',
  since?: string
): Promise<{ cardId: string; deckId: string; deckName: string; frontContent: string; gradeCount: number; avgResponseTimeMs: number | null }[]> {
  // count モード：評価回数の多い順。同数のときは grade 0/1 は時間 DESC（遅い順）、grade 2/3 は時間 ASC（早い順）。
  // time モード：平均回答時間の遅い順（全グレード共通）。同時間のときは評価回数の多い順。NULL は常に末尾。
  let orderBy: string;
  if (sortBy === 'time') {
    orderBy = `AVG(gl.responseTimeMs) IS NULL, AVG(gl.responseTimeMs) DESC, gradeCount DESC`;
  } else {
    const responseTimeOrder = grade <= 1 ? 'DESC' : 'ASC';
    orderBy = `gradeCount DESC, AVG(gl.responseTimeMs) IS NULL, AVG(gl.responseTimeMs) ${responseTimeOrder}`;
  }
  const sinceCond = since ? 'AND gl.reviewedAt >= ?' : '';
  const params: (string | number)[] = since ? [grade, since, limit] : [grade, limit];
  return db.getAllAsync(
    `SELECT c.id AS cardId, c.deckId, d.name AS deckName, cc.frontContent,
            COUNT(gl.id) AS gradeCount,
            AVG(gl.responseTimeMs) AS avgResponseTimeMs
     FROM grade_logs gl
     JOIN cards c ON gl.cardId = c.id
     JOIN card_contents cc ON c.id = cc.cardId
     JOIN decks d ON c.deckId = d.id
     WHERE gl.grade = ? ${sinceCond}
     GROUP BY c.id
     ORDER BY ${orderBy}
     LIMIT ?`,
    params
  );
}

export async function getCardCorrectRates(
  db: SQLiteDatabase,
  limit = 10
): Promise<{ cardId: string; deckId: string; deckName: string; frontContent: string; correctRate: number; recentCorrectRate: number; totalReviews: number }[]> {
  return db.getAllAsync(
    `SELECT
       c.id AS cardId,
       c.deckId,
       d.name AS deckName,
       cc.frontContent,
       COUNT(gl.id) AS totalReviews,
       ROUND(100.0 * SUM(CASE WHEN gl.grade >= 2 THEN 1 ELSE 0 END) / COUNT(gl.id)) AS correctRate,
       (
         SELECT ROUND(100.0 * SUM(CASE WHEN g2.grade >= 2 THEN 1 ELSE 0 END) / COUNT(g2.id))
         FROM (SELECT grade, id FROM grade_logs WHERE cardId = c.id ORDER BY id DESC LIMIT 10) g2
       ) AS recentCorrectRate
     FROM grade_logs gl
     JOIN cards c ON gl.cardId = c.id
     JOIN card_contents cc ON c.id = cc.cardId
     JOIN decks d ON c.deckId = d.id
     GROUP BY c.id
     HAVING COUNT(gl.id) >= 3
     ORDER BY correctRate ASC, totalReviews DESC
     LIMIT ?`,
    [limit]
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
