import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ExportData } from './export';

export async function importDatabase(db: SQLiteDatabase, fileUri: string, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  const json = await FileSystem.readAsStringAsync(fileUri, { encoding: 'utf8' });
  const data: ExportData = JSON.parse(json);

  if (data.version !== 1) {
    throw new Error('INVALID_VERSION');
  }
  if (
    !Array.isArray(data.decks) ||
    !Array.isArray(data.cards) ||
    !Array.isArray(data.tags) ||
    !Array.isArray(data.card_tags) ||
    !Array.isArray(data.reviews)
  ) {
    throw new Error('INVALID_FORMAT');
  }

  await db.withTransactionAsync(async () => {
    if (mode === 'replace') {
      await db.runAsync('DELETE FROM reviews');
      await db.runAsync('DELETE FROM card_tags');
      await db.runAsync('DELETE FROM cards');
      await db.runAsync('DELETE FROM decks');
      await db.runAsync('DELETE FROM tags');
    }

    for (const deck of data.decks) {
      await db.runAsync(
        'INSERT OR REPLACE INTO decks (id, name, description, language, cardCount, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          deck.id as string,
          deck.name as string,
          (deck.description as string) ?? '',
          (deck.language as string) ?? 'ja',
          (deck.cardCount as number) ?? 0,
          (deck.sortOrder as number) ?? 0,
          deck.createdAt as string,
          deck.updatedAt as string,
        ]
      );
    }

    for (const card of data.cards) {
      await db.runAsync(
        'INSERT OR REPLACE INTO cards (id, deckId, frontContent, backContent, memoContent, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          card.id as string,
          card.deckId as string,
          (card.frontContent as string) ?? '[]',
          (card.backContent as string) ?? '[]',
          (card.memoContent as string) ?? '[]',
          (card.sortOrder as number) ?? 0,
          card.createdAt as string,
          card.updatedAt as string,
        ]
      );
    }

    for (const tag of data.tags) {
      await db.runAsync(
        'INSERT OR REPLACE INTO tags (id, name, color, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?)',
        [
          tag.id as string,
          tag.name as string,
          (tag.color as string) ?? '#888888',
          (tag.sortOrder as number) ?? 0,
          tag.createdAt as string,
        ]
      );
    }

    for (const ct of data.card_tags) {
      await db.runAsync(
        'INSERT OR IGNORE INTO card_tags (cardId, tagId) VALUES (?, ?)',
        [ct.cardId, ct.tagId]
      );
    }

    for (const review of data.reviews) {
      await db.runAsync(
        'INSERT OR REPLACE INTO reviews (cardId, easeFactor, interval, repetitions, nextReviewDate, lastReviewDate, lastGrade) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          review.cardId as string,
          (review.easeFactor as number) ?? 2.5,
          (review.interval as number) ?? 0,
          (review.repetitions as number) ?? 0,
          review.nextReviewDate as string,
          review.lastReviewDate as string,
          (review.lastGrade as number) ?? 2,
        ]
      );
    }
  });
}
