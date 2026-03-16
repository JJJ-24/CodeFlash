import type { SQLiteDatabase } from 'expo-sqlite';

import type { Block, Card } from '@/types';
import { generateId } from './utils';

type RawCard = {
  id: string;
  deckId: string;
  frontContent: string;
  backContent: string;
  memoContent: string;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
};

function parseBlocks(json: string): Block[] {
  try {
    return JSON.parse(json) as Block[];
  } catch {
    return [];
  }
}

function toCard(raw: RawCard): Card {
  return {
    id: raw.id,
    deckId: raw.deckId,
    frontContent: parseBlocks(raw.frontContent),
    backContent: parseBlocks(raw.backContent),
    memoContent: parseBlocks(raw.memoContent),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sortOrder: raw.sortOrder,
  };
}

export async function getCardsByDeckId(db: SQLiteDatabase, deckId: string): Promise<Card[]> {
  const rows = await db.getAllAsync<RawCard>(
    'SELECT * FROM cards WHERE deckId = ? ORDER BY sortOrder ASC',
    [deckId]
  );
  return rows.map(toCard);
}

export async function getCardById(db: SQLiteDatabase, id: string): Promise<Card | null> {
  const row = await db.getFirstAsync<RawCard>('SELECT * FROM cards WHERE id = ?', [id]);
  return row ? toCard(row) : null;
}

export async function createCard(
  db: SQLiteDatabase,
  data: Pick<Card, 'deckId' | 'frontContent' | 'backContent' | 'memoContent'>
): Promise<Card> {
  const now = new Date().toISOString();
  const id = generateId();
  const row = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX(sortOrder) as maxOrder FROM cards WHERE deckId = ?',
    [data.deckId]
  );
  const sortOrder = (row?.maxOrder ?? 0) + 1;
  await db.runAsync(
    'INSERT INTO cards (id, deckId, frontContent, backContent, memoContent, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      data.deckId,
      JSON.stringify(data.frontContent),
      JSON.stringify(data.backContent),
      JSON.stringify(data.memoContent),
      sortOrder,
      now,
      now,
    ]
  );
  await db.runAsync(
    'UPDATE decks SET cardCount = cardCount + 1, updatedAt = ? WHERE id = ?',
    [now, data.deckId]
  );
  return { id, sortOrder, createdAt: now, updatedAt: now, ...data };
}

export async function updateCard(
  db: SQLiteDatabase,
  id: string,
  data: Pick<Card, 'frontContent' | 'backContent' | 'memoContent'>
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE cards SET frontContent = ?, backContent = ?, memoContent = ?, updatedAt = ? WHERE id = ?',
    [
      JSON.stringify(data.frontContent),
      JSON.stringify(data.backContent),
      JSON.stringify(data.memoContent),
      now,
      id,
    ]
  );
}

export async function updateCardSortOrders(db: SQLiteDatabase, orderedIds: string[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync('UPDATE cards SET sortOrder = ? WHERE id = ?', [i, orderedIds[i]]);
    }
  });
}

export async function deleteCard(db: SQLiteDatabase, id: string, deckId: string): Promise<void> {
  // foreign_keys pragma が未設定のため明示的に関連レコードを削除
  await db.runAsync('DELETE FROM card_tags WHERE cardId = ?', [id]);
  await db.runAsync('DELETE FROM reviews WHERE cardId = ?', [id]);
  await db.runAsync('DELETE FROM cards WHERE id = ?', [id]);
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE decks SET cardCount = MAX(cardCount - 1, 0), updatedAt = ? WHERE id = ?',
    [now, deckId]
  );
}
