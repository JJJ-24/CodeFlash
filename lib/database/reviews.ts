import type { SQLiteDatabase } from 'expo-sqlite';

import type { Review } from '@/types';

/** today の ISO 日付文字列（時刻なし）を返す */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
       AND (r.cardId IS NULL OR substr(r.nextReviewDate, 1, 10) <= ?)`,
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
       AND (r.cardId IS NULL OR substr(r.nextReviewDate, 1, 10) <= ?)`,
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
