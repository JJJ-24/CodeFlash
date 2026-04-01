import type { SQLiteDatabase } from 'expo-sqlite';

import { deleteImagesInBlocks } from '@/lib/image';
import type { Block, Card } from '@/types';
import { generateId, localDateStr, todayLocalRange } from './utils';
import { addTagToCard, getTagsByCardId } from './tags';

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

export async function getCardsByTagId(db: SQLiteDatabase, tagId: string): Promise<Card[]> {
  const rows = await db.getAllAsync<RawCard>(
    `SELECT c.* FROM cards c
     JOIN card_tags ct ON c.id = ct.cardId
     WHERE ct.tagId = ?
     ORDER BY c.sortOrder ASC`,
    [tagId]
  );
  return rows.map(toCard);
}

export async function searchCards(db: SQLiteDatabase, query: string): Promise<Card[]> {
  const rows = await db.getAllAsync<RawCard>(
    'SELECT * FROM cards WHERE frontContent LIKE ? ORDER BY updatedAt DESC LIMIT 100',
    [`%${query}%`]
  );
  return rows.map(toCard);
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
    'UPDATE decks SET cardCount = (SELECT COUNT(*) FROM cards WHERE deckId = ?), updatedAt = ? WHERE id = ?',
    [data.deckId, now, data.deckId]
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

/** 今日作成したカード数（全デッキ合計） */
export async function getTodayCreatedCount(db: SQLiteDatabase): Promise<number> {
  const { start, end } = todayLocalRange();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM cards WHERE createdAt >= ? AND createdAt < ?`,
    [start, end]
  );
  return row?.count ?? 0;
}

/** 今日作成したカード数（デッキ別マップ） */
export async function getTodayCreatedCountPerDeck(db: SQLiteDatabase): Promise<Record<string, number>> {
  const { start, end } = todayLocalRange();
  const rows = await db.getAllAsync<{ deckId: string; count: number }>(
    `SELECT deckId, COUNT(*) as count FROM cards WHERE createdAt >= ? AND createdAt < ? GROUP BY deckId`,
    [start, end]
  );
  return Object.fromEntries(rows.map(r => [r.deckId, r.count]));
}

/** 今日作成したカード数（タグ別マップ） */
export async function getTodayCreatedCountPerTag(db: SQLiteDatabase): Promise<Record<string, number>> {
  const { start, end } = todayLocalRange();
  const rows = await db.getAllAsync<{ tagId: string; count: number }>(
    `SELECT ct.tagId, COUNT(*) as count
     FROM cards c
     JOIN card_tags ct ON c.id = ct.cardId
     WHERE c.createdAt >= ? AND c.createdAt < ?
     GROUP BY ct.tagId`,
    [start, end]
  );
  return Object.fromEntries(rows.map(r => [r.tagId, r.count]));
}

/** 今日作成したカード数（デッキ単体） */
export async function getTodayCreatedCountByDeck(db: SQLiteDatabase, deckId: string): Promise<number> {
  const { start, end } = todayLocalRange();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM cards WHERE deckId = ? AND createdAt >= ? AND createdAt < ?`,
    [deckId, start, end]
  );
  return row?.count ?? 0;
}

/** 今日作成したカードID一覧（デッキ単体） */
export async function getTodayCreatedCardIdsByDeckId(db: SQLiteDatabase, deckId: string): Promise<string[]> {
  const { start, end } = todayLocalRange();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM cards WHERE deckId = ? AND createdAt >= ? AND createdAt < ? ORDER BY sortOrder ASC`,
    [deckId, start, end]
  );
  return rows.map(r => r.id);
}

/** 今日作成したカードID一覧（タグ横断） */
export async function getTodayCreatedCardIdsByTagId(db: SQLiteDatabase, tagId: string): Promise<string[]> {
  const { start, end } = todayLocalRange();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM cards c
     JOIN card_tags ct ON c.id = ct.cardId
     WHERE ct.tagId = ? AND c.createdAt >= ? AND c.createdAt < ?
     ORDER BY c.sortOrder ASC`,
    [tagId, start, end]
  );
  return rows.map(r => r.id);
}

/** 過去7日間の日別新規カード作成数（ローカル日付ベース） */
export async function getPast7DaysCreatedCount(
  db: SQLiteDatabase
): Promise<{ date: string; count: number }[]> {
  // ローカル7日前の0時〜翌日0時をUTC ISOで範囲指定
  const startLocal = new Date();
  startLocal.setDate(startLocal.getDate() - 6);
  startLocal.setHours(0, 0, 0, 0);
  const endLocal = new Date();
  endLocal.setDate(endLocal.getDate() + 1);
  endLocal.setHours(0, 0, 0, 0);

  const rows = await db.getAllAsync<{ createdAt: string }>(
    `SELECT createdAt FROM cards WHERE createdAt >= ? AND createdAt < ?`,
    [startLocal.toISOString(), endLocal.toISOString()]
  );

  // ローカル日付でグループ化
  const map = new Map<string, number>();
  for (const row of rows) {
    const d = localDateStr(new Date(row.createdAt));
    map.set(d, (map.get(d) ?? 0) + 1);
  }

  return Array.from(map.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function moveCardsToDeck(
  db: SQLiteDatabase,
  cardIds: string[],
  fromDeckId: string,
  toDeckId: string
): Promise<void> {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ maxOrder: number | null }>(
      'SELECT MAX(sortOrder) as maxOrder FROM cards WHERE deckId = ?',
      [toDeckId]
    );
    let nextOrder = (row?.maxOrder ?? 0) + 1;
    for (const cardId of cardIds) {
      await db.runAsync(
        'UPDATE cards SET deckId = ?, sortOrder = ?, updatedAt = ? WHERE id = ?',
        [toDeckId, nextOrder++, now, cardId]
      );
    }
    await db.runAsync(
      'UPDATE decks SET cardCount = (SELECT COUNT(*) FROM cards WHERE deckId = ?), updatedAt = ? WHERE id = ?',
      [fromDeckId, now, fromDeckId]
    );
    await db.runAsync(
      'UPDATE decks SET cardCount = (SELECT COUNT(*) FROM cards WHERE deckId = ?), updatedAt = ? WHERE id = ?',
      [toDeckId, now, toDeckId]
    );
  });
}

export async function duplicateCard(db: SQLiteDatabase, cardId: string): Promise<Card> {
  const original = await getCardById(db, cardId);
  if (!original) throw new Error(`Card not found: ${cardId}`);

  const newCard = await createCard(db, {
    deckId: original.deckId,
    frontContent: original.frontContent,
    backContent: original.backContent,
    memoContent: original.memoContent,
  });

  const tags = await getTagsByCardId(db, cardId);
  for (const tag of tags) {
    await addTagToCard(db, newCard.id, tag.id);
  }

  return newCard;
}

export async function deleteCard(db: SQLiteDatabase, id: string, deckId: string): Promise<void> {
  // 画像ブロックのファイルを削除
  const card = await getCardById(db, id);
  if (card) {
    const allBlocks = [...card.frontContent, ...card.backContent, ...card.memoContent];
    await deleteImagesInBlocks(allBlocks).catch(() => {});
  }
  // foreign_keys pragma が未設定のため明示的に関連レコードを削除
  await db.runAsync('DELETE FROM card_tags WHERE cardId = ?', [id]);
  await db.runAsync('DELETE FROM reviews WHERE cardId = ?', [id]);
  await db.runAsync('DELETE FROM review_logs WHERE cardId = ?', [id]);
  await db.runAsync('DELETE FROM cards WHERE id = ?', [id]);
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE decks SET cardCount = (SELECT COUNT(*) FROM cards WHERE deckId = ?), updatedAt = ? WHERE id = ?',
    [deckId, now, deckId]
  );
}
