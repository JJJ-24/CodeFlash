import type { SQLiteDatabase } from 'expo-sqlite';

import type { Deck } from '@/types';
import { generateId } from './utils';

export async function getAllDecks(db: SQLiteDatabase): Promise<Deck[]> {
  return db.getAllAsync<Deck>('SELECT * FROM decks ORDER BY sortOrder ASC');
}

export async function getDeckById(db: SQLiteDatabase, id: string): Promise<Deck | null> {
  return db.getFirstAsync<Deck>('SELECT * FROM decks WHERE id = ?', [id]);
}

export async function createDeck(
  db: SQLiteDatabase,
  data: Pick<Deck, 'name' | 'description' | 'language'>
): Promise<Deck> {
  const now = new Date().toISOString();
  const id = generateId();
  const row = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX(sortOrder) as maxOrder FROM decks');
  const sortOrder = (row?.maxOrder ?? 0) + 1;
  await db.runAsync(
    'INSERT INTO decks (id, name, description, language, cardCount, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
    [id, data.name, data.description, data.language, sortOrder, now, now]
  );
  return { id, cardCount: 0, sortOrder, createdAt: now, updatedAt: now, ...data };
}

export async function updateDeck(
  db: SQLiteDatabase,
  id: string,
  data: Pick<Deck, 'name' | 'description' | 'language'>
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE decks SET name = ?, description = ?, language = ?, updatedAt = ? WHERE id = ?',
    [data.name, data.description, data.language, now, id]
  );
}

export async function updateDeckSortOrders(db: SQLiteDatabase, orderedIds: string[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync('UPDATE decks SET sortOrder = ? WHERE id = ?', [i, orderedIds[i]]);
    }
  });
}

export async function deleteDeck(db: SQLiteDatabase, id: string): Promise<void> {
  // foreign_keys pragma が未設定のため明示的に関連レコードを削除
  await db.runAsync(
    'DELETE FROM reviews WHERE cardId IN (SELECT id FROM cards WHERE deckId = ?)',
    [id]
  );
  await db.runAsync(
    'DELETE FROM card_tags WHERE cardId IN (SELECT id FROM cards WHERE deckId = ?)',
    [id]
  );
  await db.runAsync(
    'DELETE FROM card_contents WHERE cardId IN (SELECT id FROM cards WHERE deckId = ?)',
    [id]
  );
  await db.runAsync('DELETE FROM cards WHERE deckId = ?', [id]);
  await db.runAsync('DELETE FROM decks WHERE id = ?', [id]);
}
