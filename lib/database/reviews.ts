import type { SQLiteDatabase } from 'expo-sqlite';

import type { Review } from '@/types';

/** タグIDをキー、due 枚数を値とするマップを一括取得 */
export async function getDueCountPerTag(
  db: SQLiteDatabase
): Promise<Record<string, number>> {
  const today = todayISO();
  const rows = await db.getAllAsync<{ tagId: string; count: number }>(
    `SELECT ct.tagId, COUNT(*) as count
     FROM card_tags ct
     JOIN cards c ON ct.cardId = c.id
     LEFT JOIN reviews r ON r.cardId = c.id
     WHERE r.cardId IS NULL OR substr(r.nextReviewDate, 1, 10) <= ?
     GROUP BY ct.tagId`,
    [today]
  );
  return Object.fromEntries(rows.map((r) => [r.tagId, r.count]));
}

/** デッキIDをキー、due 枚数を値とするマップを一括取得 */
export async function getDueCountPerDeck(
  db: SQLiteDatabase
): Promise<Record<string, number>> {
  const today = todayISO();
  const rows = await db.getAllAsync<{ deckId: string; count: number }>(
    `SELECT c.deckId, COUNT(*) as count
     FROM cards c
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE (r.cardId IS NULL OR substr(r.nextReviewDate, 1, 10) <= ?)
     GROUP BY c.deckId`,
    [today]
  );
  return Object.fromEntries(rows.map((r) => [r.deckId, r.count]));
}

/** today の ISO 日付文字列（時刻なし）を返す */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** デッキ別: 今日学習したカード数（lastReviewDate が今日） */
export async function getTodayReviewedCountByDeck(
  db: SQLiteDatabase,
  deckId: string
): Promise<number> {
  const today = todayISO();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM reviews r
     JOIN cards c ON r.cardId = c.id
     WHERE c.deckId = ? AND substr(r.lastReviewDate, 1, 10) = ?`,
    [deckId, today]
  );
  return row?.count ?? 0;
}

/** デッキ別: 一度も学習していないカード数 */
export async function getUnlearnedCountByDeck(
  db: SQLiteDatabase,
  deckId: string
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM cards c
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE c.deckId = ? AND r.cardId IS NULL`,
    [deckId]
  );
  return row?.count ?? 0;
}

/** レビュー記録を保存（なければ INSERT、あれば UPDATE） */
export async function saveReview(db: SQLiteDatabase, review: Review): Promise<void> {
  await db.runAsync(
    `INSERT INTO reviews (cardId, easeFactor, interval, repetitions, nextReviewDate, lastReviewDate)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(cardId) DO UPDATE SET
       easeFactor     = excluded.easeFactor,
       interval       = excluded.interval,
       repetitions    = excluded.repetitions,
       nextReviewDate = excluded.nextReviewDate,
       lastReviewDate = excluded.lastReviewDate`,
    [
      review.cardId,
      review.easeFactor,
      review.interval,
      review.repetitions,
      review.nextReviewDate,
      review.lastReviewDate,
    ]
  );
}

/** カードのレビュー記録を取得（未学習なら null） */
export async function getReviewByCardId(
  db: SQLiteDatabase,
  cardId: string
): Promise<Review | null> {
  return db.getFirstAsync<Review>('SELECT * FROM reviews WHERE cardId = ?', [cardId]);
}

/**
 * デッキ単位で今日の復習対象カードIDを取得
 * 対象: nextReviewDate <= today OR レビュー未登録の新規カード
 */
export async function getDueCardIdsByDeckId(
  db: SQLiteDatabase,
  deckId: string
): Promise<string[]> {
  const today = todayISO();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM cards c
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE c.deckId = ?
       AND (r.cardId IS NULL OR substr(r.nextReviewDate, 1, 10) <= ?)
     ORDER BY c.sortOrder ASC`,
    [deckId, today]
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
  const today = todayISO();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM cards c
     JOIN card_tags ct ON c.id = ct.cardId
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE ct.tagId = ?
       AND (r.cardId IS NULL OR substr(r.nextReviewDate, 1, 10) <= ?)
     ORDER BY c.sortOrder ASC`,
    [tagId, today]
  );
  return rows.map((r) => r.id);
}

/** 今日学習したカード数（lastReviewDate が今日のもの） */
export async function getTodayReviewedCount(db: SQLiteDatabase): Promise<number> {
  const today = todayISO();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM reviews WHERE substr(lastReviewDate, 1, 10) = ?`,
    [today]
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
  const today = todayISO();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM cards c
     LEFT JOIN reviews r ON c.id = r.cardId
     WHERE r.cardId IS NULL OR substr(r.nextReviewDate, 1, 10) <= ?`,
    [today]
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

/** デッキ別習熟度（easeFactor 平均 + 学習済み枚数） */
export async function getDeckMasteryList(
  db: SQLiteDatabase
): Promise<{ deckId: string; avgEase: number; learnedCount: number }[]> {
  return db.getAllAsync<{ deckId: string; avgEase: number; learnedCount: number }>(
    `SELECT c.deckId, AVG(r.easeFactor) as avgEase, COUNT(*) as learnedCount
     FROM reviews r
     JOIN cards c ON r.cardId = c.id
     GROUP BY c.deckId`
  );
}

/**
 * 学習ストリーク日数を計算する
 * 今日から過去に遡り、lastReviewDate に学習記録がある日が連続している日数を返す
 */
export async function getStudyStreak(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ date: string }>(
    `SELECT DISTINCT substr(lastReviewDate, 1, 10) as date
     FROM reviews
     ORDER BY date DESC`
  );

  if (rows.length === 0) return 0;

  const dates = rows.map((r) => r.date);
  const today = todayISO();
  let streak = 0;
  const current = new Date(today);

  for (let i = 0; i < dates.length; i++) {
    const expected = current.toISOString().slice(0, 10);
    if (dates[i] === expected) {
      streak++;
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}
