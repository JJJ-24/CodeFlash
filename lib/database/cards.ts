import type { SQLiteDatabase } from 'expo-sqlite';

import { deleteImagesInBlocks } from '@/lib/image';
import type { Block, Card } from '@/types';
import { activeCardCond, generateId, localDateStr, todayLocalRange } from './utils';
import { addTagToCard, getTagsByCardId } from './tags';

type RawCard = {
  id: string;
  deckId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  frontContent: string;
  backContent: string;
  memoContent: string;
  archived: number;
};

// cards + card_contents を JOIN して取得する共通 SELECT 句
const CARD_SELECT = `
  SELECT c.id, c.deckId, c.sortOrder, c.createdAt, c.updatedAt, c.archived,
         COALESCE(cc.frontContent, '[]') AS frontContent,
         COALESCE(cc.backContent,  '[]') AS backContent,
         COALESCE(cc.memoContent,  '[]') AS memoContent
  FROM cards c
  LEFT JOIN card_contents cc ON cc.cardId = c.id
`;

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
    archived: !!raw.archived,
  };
}

export async function getCardsByTagId(db: SQLiteDatabase, tagId: string): Promise<Card[]> {
  const rows = await db.getAllAsync<RawCard>(
    `${CARD_SELECT}
     JOIN card_tags ct ON c.id = ct.cardId
     WHERE ct.tagId = ?
     ORDER BY c.sortOrder ASC`,
    [tagId]
  );
  return rows.map(toCard);
}

export type SearchField = 'all' | 'front' | 'back' | 'memo';

// 検索結果の取得上限。これに達したら UI では「N件以上」と表示する。
export const SEARCH_RESULT_LIMIT = 100;

function hiraganaToKatakana(str: string): string {
  return str.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

function katakanaToHiragana(str: string): string {
  return str.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function kanaVariantPatterns(query: string): string[] {
  const variants = new Set([query, hiraganaToKatakana(query), katakanaToHiragana(query)]);
  return Array.from(variants).map((v) => `%${v}%`);
}

function kanaLikeClause(col: string, patterns: string[]): { clause: string; params: string[] } {
  return {
    clause: `(${patterns.map(() => `${col} LIKE ?`).join(' OR ')})`,
    params: patterns,
  };
}

// 1キーワード分の検索条件を作る（ひらがな/カタカナ差を吸収）。
// field が 'all' のときは front/back/memo のいずれかに含まれれば一致。
// CARD_SELECT に LEFT JOIN card_contents cc が含まれるため cc.* で参照可能。
function buildFieldClause(field: SearchField, term: string): { clause: string; params: string[] } {
  const patterns = kanaVariantPatterns(term);
  switch (field) {
    case 'front': return kanaLikeClause('cc.frontContent', patterns);
    case 'back': return kanaLikeClause('cc.backContent', patterns);
    case 'memo': return kanaLikeClause('cc.memoContent', patterns);
    default: {
      const f = kanaLikeClause('cc.frontContent', patterns);
      const b = kanaLikeClause('cc.backContent', patterns);
      const m = kanaLikeClause('cc.memoContent', patterns);
      return { clause: `(${f.clause} OR ${b.clause} OR ${m.clause})`, params: [...f.params, ...b.params, ...m.params] };
    }
  }
}

export async function searchCards(
  db: SQLiteDatabase,
  query: string,
  field: SearchField = 'all',
  deckIds?: string[],
  tagIds?: string[],
): Promise<Card[]> {
  // クエリを空白（半角/全角スペース）で区切って複数キーワードの AND 検索にする。
  // 各キーワードが（選択フィールド内に）すべて含まれるカードだけがヒットする。
  // カンマはコード中に頻出するため区切りにしない（カンマを含む文字列をそのまま検索できるように）。
  const terms = query.split(/\s+/).map((t) => t.trim()).filter((t) => t !== '');
  const searchTerms = terms.length > 0 ? terms : [query];
  const termClauses = searchTerms.map((term) => buildFieldClause(field, term));
  const fieldClause = termClauses.map((c) => c.clause).join(' AND ');
  const fieldParams = termClauses.flatMap((c) => c.params);

  const extraConditions: string[] = [];
  const extraParams: string[] = [];
  if (deckIds && deckIds.length > 0) {
    extraConditions.push(`c.deckId IN (${deckIds.map(() => '?').join(',')})`);
    extraParams.push(...deckIds);
  }
  if (tagIds && tagIds.length > 0) {
    extraConditions.push(`c.id IN (SELECT cardId FROM card_tags WHERE tagId IN (${tagIds.map(() => '?').join(',')}))`);
    extraParams.push(...tagIds);
  }

  const whereClause = extraConditions.length > 0
    ? `(${fieldClause}) AND ${extraConditions.join(' AND ')}`
    : fieldClause;

  const rows = await db.getAllAsync<RawCard>(
    `${CARD_SELECT} WHERE ${whereClause} ORDER BY c.updatedAt DESC LIMIT ${SEARCH_RESULT_LIMIT}`,
    [...fieldParams, ...extraParams]
  );
  return rows.map(toCard);
}

export async function getCardsByDeckId(db: SQLiteDatabase, deckId: string): Promise<Card[]> {
  const rows = await db.getAllAsync<RawCard>(
    `${CARD_SELECT} WHERE c.deckId = ? ORDER BY c.sortOrder ASC`,
    [deckId]
  );
  return rows.map(toCard);
}

export async function getCardById(db: SQLiteDatabase, id: string): Promise<Card | null> {
  const row = await db.getFirstAsync<RawCard>(
    `${CARD_SELECT} WHERE c.id = ?`,
    [id]
  );
  return row ? toCard(row) : null;
}

export async function getCardsByIds(db: SQLiteDatabase, ids: string[]): Promise<Card[]> {
  if (ids.length === 0) return [];
  const CHUNK = 500;
  const allRows: RawCard[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.getAllAsync<RawCard>(
      `${CARD_SELECT} WHERE c.id IN (${placeholders})`,
      chunk
    );
    allRows.push(...rows);
  }
  const map = new Map(allRows.map(r => [r.id, toCard(r)]));
  return ids.map(id => map.get(id)).filter((c): c is Card => c !== undefined);
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
  const frontJson = JSON.stringify(data.frontContent);
  const backJson  = JSON.stringify(data.backContent);
  const memoJson  = JSON.stringify(data.memoContent);
  await db.runAsync(
    'INSERT INTO cards (id, deckId, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
    [id, data.deckId, sortOrder, now, now]
  );
  await db.runAsync(
    'INSERT INTO card_contents (cardId, frontContent, backContent, memoContent) VALUES (?, ?, ?, ?)',
    [id, frontJson, backJson, memoJson]
  );
  await db.runAsync(
    'UPDATE decks SET cardCount = (SELECT COUNT(*) FROM cards WHERE deckId = ?), updatedAt = ? WHERE id = ?',
    [data.deckId, now, data.deckId]
  );
  return { id, sortOrder, createdAt: now, updatedAt: now, archived: false, ...data };
}

/** カードのアーカイブ状態を更新する */
export async function setCardArchived(db: SQLiteDatabase, id: string, archived: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync('UPDATE cards SET archived = ?, updatedAt = ? WHERE id = ?', [archived ? 1 : 0, now, id]);
}

/** 複数カードのアーカイブ状態を一括更新する（選択モードからの一括操作用） */
export async function setCardsArchived(db: SQLiteDatabase, cardIds: string[], archived: boolean): Promise<void> {
  if (cardIds.length === 0) return;
  const CHUNK = 500;
  const now = new Date().toISOString();
  const value = archived ? 1 : 0;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < cardIds.length; i += CHUNK) {
      const chunk = cardIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      await db.runAsync(
        `UPDATE cards SET archived = ?, updatedAt = ? WHERE id IN (${placeholders})`,
        [value, now, ...chunk]
      );
    }
  });
}

export async function updateCard(
  db: SQLiteDatabase,
  id: string,
  data: Pick<Card, 'frontContent' | 'backContent' | 'memoContent'>
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    'UPDATE card_contents SET frontContent = ?, backContent = ?, memoContent = ? WHERE cardId = ?',
    [
      JSON.stringify(data.frontContent),
      JSON.stringify(data.backContent),
      JSON.stringify(data.memoContent),
      id,
    ]
  );
  await db.runAsync('UPDATE cards SET updatedAt = ? WHERE id = ?', [now, id]);
}

export async function updateCardSortOrders(db: SQLiteDatabase, orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  // 単一 execAsync で BEGIN..COMMIT をまとめて実行する。withTransactionAsync は
  // await 間に他クエリ（連続ドラッグの次の並べ替え等）が割り込み、トランザクションが
  // 入れ子になって "cannot start a transaction within a transaction" で落ちるため。
  const sql =
    'BEGIN;\n' +
    orderedIds.map((id, i) => `UPDATE cards SET sortOrder = ${i} WHERE id = '${id.replace(/'/g, "''")}';`).join('\n') +
    '\nCOMMIT;';
  await db.execAsync(sql);
}

/** 今日作成したカード数（全デッキ合計） */
export async function getTodayCreatedCount(db: SQLiteDatabase): Promise<number> {
  const { start, end } = todayLocalRange();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM cards WHERE createdAt >= ? AND createdAt < ? AND ${activeCardCond('')}`,
    [start, end]
  );
  return row?.count ?? 0;
}

/** 今日作成したカード数（デッキ別マップ） */
export async function getTodayCreatedCountPerDeck(db: SQLiteDatabase): Promise<Record<string, number>> {
  const { start, end } = todayLocalRange();
  const rows = await db.getAllAsync<{ deckId: string; count: number }>(
    `SELECT deckId, COUNT(*) as count FROM cards WHERE createdAt >= ? AND createdAt < ? AND ${activeCardCond('')} GROUP BY deckId`,
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
     WHERE c.createdAt >= ? AND c.createdAt < ? AND ${activeCardCond('c')}
     GROUP BY ct.tagId`,
    [start, end]
  );
  return Object.fromEntries(rows.map(r => [r.tagId, r.count]));
}

/** 今日作成したカード数（デッキ単体） */
export async function getTodayCreatedCountByDeck(db: SQLiteDatabase, deckId: string): Promise<number> {
  const { start, end } = todayLocalRange();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM cards WHERE deckId = ? AND createdAt >= ? AND createdAt < ? AND ${activeCardCond('')}`,
    [deckId, start, end]
  );
  return row?.count ?? 0;
}

/** 今日作成したカードID一覧（デッキ単体） */
export async function getTodayCreatedCardIdsByDeckId(db: SQLiteDatabase, deckId: string): Promise<string[]> {
  const { start, end } = todayLocalRange();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM cards WHERE deckId = ? AND createdAt >= ? AND createdAt < ? AND ${activeCardCond('')} ORDER BY sortOrder ASC`,
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
     WHERE ct.tagId = ? AND c.createdAt >= ? AND c.createdAt < ? AND ${activeCardCond('c')}
     ORDER BY c.sortOrder ASC`,
    [tagId, start, end]
  );
  return rows.map(r => r.id);
}

/** 未学習カード数（デッキ別マップ） */
export async function getUnlearnedCountPerDeck(db: SQLiteDatabase): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ deckId: string; count: number }>(
    `SELECT c.deckId, COUNT(*) as count FROM cards c
     WHERE c.id NOT IN (SELECT cardId FROM reviews) AND ${activeCardCond('c')}
     GROUP BY c.deckId`
  );
  return Object.fromEntries(rows.map(r => [r.deckId, r.count]));
}

/** 未学習カード数（タグ別マップ） */
export async function getUnlearnedCountPerTag(db: SQLiteDatabase): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ tagId: string; count: number }>(
    `SELECT ct.tagId, COUNT(*) as count
     FROM cards c
     JOIN card_tags ct ON c.id = ct.cardId
     WHERE c.id NOT IN (SELECT cardId FROM reviews) AND ${activeCardCond('c')}
     GROUP BY ct.tagId`
  );
  return Object.fromEntries(rows.map(r => [r.tagId, r.count]));
}

/** 未学習カード数（デッキ単体） */
export async function getUnlearnedCountByDeck(db: SQLiteDatabase, deckId: string): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM cards WHERE deckId = ? AND id NOT IN (SELECT cardId FROM reviews) AND ${activeCardCond('')}`,
    [deckId]
  );
  return row?.count ?? 0;
}

/** 未学習カードID一覧（デッキ単体） */
export async function getUnlearnedCardIdsByDeckId(db: SQLiteDatabase, deckId: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM cards WHERE deckId = ? AND id NOT IN (SELECT cardId FROM reviews) AND ${activeCardCond('')} ORDER BY sortOrder ASC`,
    [deckId]
  );
  return rows.map(r => r.id);
}

/** 未学習カードID一覧（タグ横断） */
export async function getUnlearnedCardIdsByTagId(db: SQLiteDatabase, tagId: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT c.id FROM cards c
     JOIN card_tags ct ON c.id = ct.cardId
     WHERE ct.tagId = ? AND c.id NOT IN (SELECT cardId FROM reviews) AND ${activeCardCond('c')}
     ORDER BY c.sortOrder ASC`,
    [tagId]
  );
  return rows.map(r => r.id);
}

/** 過去7日間の日別新規カード作成数（ローカル日付ベース） */
export async function getPast7DaysCreatedCount(
  db: SQLiteDatabase
): Promise<{ date: string; count: number }[]> {
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
  if (cardIds.length === 0) return;
  const CHUNK = 500;
  const now = new Date().toISOString();

  // 移動先の末尾 sortOrder を取得（1 bridge call）
  const row = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX(sortOrder) as maxOrder FROM cards WHERE deckId = ?',
    [toDeckId]
  );
  const offset = (row?.maxOrder ?? 0) + 1;

  // BEGIN〜COMMIT を一括 execAsync（1 bridge call）でネイティブ側に渡す。
  // 埋め込み値: UUID（hex+ハイフンのみ）・ISOタイムスタンプ（数字/区切り文字のみ）は SQL インジェクション不可。
  const parts: string[] = ['BEGIN;'];
  for (let i = 0; i < cardIds.length; i += CHUNK) {
    const chunk = cardIds.slice(i, i + CHUNK);
    const idList = chunk.map((id) => `'${id}'`).join(',');
    parts.push(
      `UPDATE cards SET deckId='${toDeckId}',updatedAt='${now}',sortOrder=sortOrder+${offset} WHERE id IN (${idList});`
    );
  }
  parts.push(
    `UPDATE decks SET cardCount=(SELECT COUNT(*) FROM cards WHERE deckId='${fromDeckId}'),updatedAt='${now}' WHERE id='${fromDeckId}';`
  );
  parts.push(
    `UPDATE decks SET cardCount=(SELECT COUNT(*) FROM cards WHERE deckId='${toDeckId}'),updatedAt='${now}' WHERE id='${toDeckId}';`
  );
  parts.push('COMMIT;');

  await db.execAsync(parts.join('\n'));
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
  const card = await getCardById(db, id);
  if (card) {
    const allBlocks = [...card.frontContent, ...card.backContent, ...card.memoContent];
    await deleteImagesInBlocks(allBlocks).catch(() => {});
  }
  await db.runAsync('DELETE FROM card_contents WHERE cardId = ?', [id]);
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

export async function deleteCardsBulk(
  db: SQLiteDatabase,
  cardIds: string[],
  deckId: string
): Promise<void> {
  if (cardIds.length === 0) return;
  const cards = await getCardsByIds(db, cardIds);
  await Promise.all(
    cards.map((card) => {
      const blocks = [...card.frontContent, ...card.backContent, ...card.memoContent];
      return deleteImagesInBlocks(blocks).catch(() => {});
    })
  );
  const CHUNK = 500;
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < cardIds.length; i += CHUNK) {
      const chunk = cardIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      await db.runAsync(`DELETE FROM card_contents WHERE cardId IN (${placeholders})`, chunk);
      await db.runAsync(`DELETE FROM card_tags WHERE cardId IN (${placeholders})`, chunk);
      await db.runAsync(`DELETE FROM reviews WHERE cardId IN (${placeholders})`, chunk);
      await db.runAsync(`DELETE FROM review_logs WHERE cardId IN (${placeholders})`, chunk);
      await db.runAsync(`DELETE FROM cards WHERE id IN (${placeholders})`, chunk);
    }
    await db.runAsync(
      'UPDATE decks SET cardCount = (SELECT COUNT(*) FROM cards WHERE deckId = ?), updatedAt = ? WHERE id = ?',
      [deckId, now, deckId]
    );
  });
}
