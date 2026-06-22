import type { SQLiteDatabase } from 'expo-sqlite';

import type { Tag } from '@/types';
import { generateId } from './utils';

/** 全グローバルタグ一覧（使用枚数付き） */
export async function getAllTags(db: SQLiteDatabase): Promise<(Tag & { cardCount: number })[]> {
  return db.getAllAsync<Tag & { cardCount: number }>(
    `SELECT t.*, COUNT(ct.cardId) as cardCount
     FROM tags t
     LEFT JOIN card_tags ct ON t.id = ct.tagId
     GROUP BY t.id
     ORDER BY t.sortOrder ASC`
  );
}

export async function getTagById(db: SQLiteDatabase, id: string): Promise<Tag | null> {
  return db.getFirstAsync<Tag>('SELECT * FROM tags WHERE id = ?', [id]);
}

export async function createTag(
  db: SQLiteDatabase,
  data: Pick<Tag, 'name' | 'color'>
): Promise<Tag> {
  const now = new Date().toISOString();
  const id = generateId();
  const row = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX(sortOrder) as maxOrder FROM tags');
  const sortOrder = (row?.maxOrder ?? 0) + 1;
  await db.runAsync(
    'INSERT INTO tags (id, name, color, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?)',
    [id, data.name, data.color, sortOrder, now]
  );
  return { id, sortOrder, createdAt: now, ...data };
}

export async function updateTag(
  db: SQLiteDatabase,
  id: string,
  data: Pick<Tag, 'name' | 'color'>
): Promise<void> {
  await db.runAsync('UPDATE tags SET name = ?, color = ? WHERE id = ?', [data.name, data.color, id]);
}

export async function updateTagSortOrders(db: SQLiteDatabase, orderedIds: string[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync('UPDATE tags SET sortOrder = ? WHERE id = ?', [i, orderedIds[i]]);
    }
  });
}

export async function deleteTag(db: SQLiteDatabase, id: string): Promise<void> {
  // card_tags は ON DELETE CASCADE で自動削除されるが、明示的に削除
  await db.runAsync('DELETE FROM card_tags WHERE tagId = ?', [id]);
  await db.runAsync('DELETE FROM tags WHERE id = ?', [id]);
}

export async function deleteTagsBulk(db: SQLiteDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM card_tags WHERE tagId IN (${placeholders})`, ids);
    await db.runAsync(`DELETE FROM tags WHERE id IN (${placeholders})`, ids);
  });
}

export async function updateTagsColor(db: SQLiteDatabase, ids: string[], color: string): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE tags SET color = ? WHERE id IN (${placeholders})`, [color, ...ids]);
}

/** カードのタグ一覧を取得 */
export async function getTagsByCardId(db: SQLiteDatabase, cardId: string): Promise<Tag[]> {
  return db.getAllAsync<Tag>(
    `SELECT t.* FROM tags t
     JOIN card_tags ct ON t.id = ct.tagId
     WHERE ct.cardId = ?
     ORDER BY t.name ASC`,
    [cardId]
  );
}

/** カードにタグを付与 */
export async function addTagToCard(
  db: SQLiteDatabase,
  cardId: string,
  tagId: string
): Promise<void> {
  await db.runAsync(
    'INSERT OR IGNORE INTO card_tags (cardId, tagId) VALUES (?, ?)',
    [cardId, tagId]
  );
}

/** カードからタグを削除 */
export async function removeTagFromCard(
  db: SQLiteDatabase,
  cardId: string,
  tagId: string
): Promise<void> {
  await db.runAsync('DELETE FROM card_tags WHERE cardId = ? AND tagId = ?', [cardId, tagId]);
}

/** 複数カードから同じタグを一括で外す */
export async function removeTagFromCards(
  db: SQLiteDatabase,
  tagId: string,
  cardIds: string[]
): Promise<void> {
  if (cardIds.length === 0) return;
  const placeholders = cardIds.map(() => '?').join(',');
  await db.runAsync(
    `DELETE FROM card_tags WHERE tagId = ? AND cardId IN (${placeholders})`,
    [tagId, ...cardIds]
  );
}

/** デッキ内全カードのタグ行を一括取得（エクスポート用） */
export async function getTagRowsByDeckId(
  db: SQLiteDatabase,
  deckId: string
): Promise<{ cardId: string; name: string }[]> {
  return db.getAllAsync<{ cardId: string; name: string }>(
    `SELECT ct.cardId, t.name
     FROM card_tags ct
     JOIN tags t ON ct.tagId = t.id
     JOIN cards c ON ct.cardId = c.id
     WHERE c.deckId = ?
     ORDER BY ct.cardId, t.name ASC`,
    [deckId]
  );
}

/** タグに紐付くカードIDを取得（デッキ横断） */
export async function getCardIdsByTagId(db: SQLiteDatabase, tagId: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ cardId: string }>(
    'SELECT cardId FROM card_tags WHERE tagId = ?',
    [tagId]
  );
  return rows.map((r) => r.cardId);
}
