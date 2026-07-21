import type { SQLiteDatabase } from 'expo-sqlite';

import type { Deck } from '@/types';
import { generateId } from './utils';

// SQLite は archived を 0/1 の数値で返すため boolean へ正規化する
type RawDeck = Omit<Deck, 'archived'> & { archived: number };

function toDeck(raw: RawDeck): Deck {
  return { ...raw, archived: !!raw.archived };
}

export async function getAllDecks(db: SQLiteDatabase): Promise<Deck[]> {
  const rows = await db.getAllAsync<RawDeck>('SELECT * FROM decks ORDER BY sortOrder ASC');
  return rows.map(toDeck);
}

export async function getDeckById(db: SQLiteDatabase, id: string): Promise<Deck | null> {
  const row = await db.getFirstAsync<RawDeck>('SELECT * FROM decks WHERE id = ?', [id]);
  return row ? toDeck(row) : null;
}

/** デッキのアーカイブ状態を更新する */
export async function setDeckArchived(db: SQLiteDatabase, id: string, archived: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync('UPDATE decks SET archived = ?, updatedAt = ? WHERE id = ?', [archived ? 1 : 0, now, id]);
}

export async function createDeck(
  db: SQLiteDatabase,
  data: Pick<Deck, 'name' | 'description' | 'language'> &
    Partial<Pick<Deck, 'iconName' | 'colorHex' | 'sqlInit' | 'htmlInit'>>
): Promise<Deck> {
  const now = new Date().toISOString();
  const id = generateId();
  const row = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX(sortOrder) as maxOrder FROM decks');
  const sortOrder = (row?.maxOrder ?? 0) + 1;
  const iconName = data.iconName ?? null;
  const colorHex = data.colorHex ?? null;
  const sqlInit = data.sqlInit ?? null;
  const htmlInit = data.htmlInit ?? null;
  await db.runAsync(
    'INSERT INTO decks (id, name, description, language, cardCount, sortOrder, iconName, colorHex, sqlInit, htmlInit, createdAt, updatedAt) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)',
    [id, data.name, data.description, data.language, sortOrder, iconName, colorHex, sqlInit, htmlInit, now, now]
  );
  return {
    id,
    cardCount: 0,
    sortOrder,
    createdAt: now,
    updatedAt: now,
    iconName,
    colorHex,
    sqlInit,
    htmlInit,
    archived: false,
    name: data.name,
    description: data.description,
    language: data.language,
  };
}

export async function updateDeck(
  db: SQLiteDatabase,
  id: string,
  data: Pick<Deck, 'name' | 'description' | 'language'> &
    Partial<Pick<Deck, 'iconName' | 'colorHex' | 'sqlInit' | 'htmlInit'>>
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE decks SET name = ?, description = ?, language = ?, iconName = ?, colorHex = ?, sqlInit = ?, htmlInit = ?, updatedAt = ? WHERE id = ?',
    [data.name, data.description, data.language, data.iconName ?? null, data.colorHex ?? null, data.sqlInit ?? null, data.htmlInit ?? null, now, id]
  );
}

export async function updateDeckSortOrders(db: SQLiteDatabase, orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  // 単一 execAsync で BEGIN..COMMIT をまとめる（withTransactionAsync の await 間に
  // 他クエリが割り込むとトランザクションが入れ子になり落ちるため）。
  const sql =
    'BEGIN;\n' +
    orderedIds.map((id, i) => `UPDATE decks SET sortOrder = ${i} WHERE id = '${id.replace(/'/g, "''")}';`).join('\n') +
    '\nCOMMIT;';
  await db.execAsync(sql);
}

export async function deleteDeck(db: SQLiteDatabase, id: string): Promise<void> {
  // id は UUID（hex + ハイフンのみ）のため直接埋め込み可能。
  // execAsync で1回のブリッジ呼び出しに集約し、withTransactionAsync（非排他）の
  // await 間に他の非同期クエリが割り込むことで発生する SQLITE_BUSY を防ぐ。
  await db.execAsync(`
    BEGIN;
    DELETE FROM review_logs WHERE cardId IN (SELECT id FROM cards WHERE deckId = '${id}');
    DELETE FROM reviews     WHERE cardId IN (SELECT id FROM cards WHERE deckId = '${id}');
    DELETE FROM card_tags   WHERE cardId IN (SELECT id FROM cards WHERE deckId = '${id}');
    DELETE FROM card_contents WHERE cardId IN (SELECT id FROM cards WHERE deckId = '${id}');
    DELETE FROM cards  WHERE deckId = '${id}';
    DELETE FROM decks  WHERE id     = '${id}';
    COMMIT;
  `);
}
