import type { SQLiteDatabase } from 'expo-sqlite';

import { legacyInitMirror, normalizeDeckStages, serializeDeckStages } from '@/lib/deckStages';
import { deleteImagesInBlocks, parseDeckImages, serializeDeckImages } from '@/lib/image';
import type { Deck } from '@/types';
import { generateId } from './utils';

// SQLite は archived を 0/1 の数値で、htmlImages / htmlStages / sqlStages を JSON 文字列で返すため型を分けて正規化する
type RawDeck = Omit<Deck, 'archived' | 'htmlImages' | 'htmlStages' | 'sqlStages'> & {
  archived: number;
  htmlImages: string | null;
  htmlStages: string | null;
  sqlStages: string | null;
};

/** DB 行を `Deck` に正規化する。**旧データの吸収（044: htmlInit → htmlStages／045: sqlInit → sqlStages）は
 *  ここに閉じる**ので、画面・コンポーネントは配列だけを見ればよい（旧列フォールバックを各所に散らさない）。 */
function toDeck(raw: RawDeck): Deck {
  return {
    ...raw,
    archived: !!raw.archived,
    htmlImages: parseDeckImages(raw.htmlImages),
    htmlStages: normalizeDeckStages(raw.htmlStages, raw.htmlInit),
    sqlStages: normalizeDeckStages(raw.sqlStages, raw.sqlInit),
  };
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

/** 複数デッキのアーカイブ状態をまとめて更新する（042 アーカイブ一覧の一括解除）。
 *  setCardsArchived と同じ CHUNK + トランザクション方式。 */
export async function setDecksArchived(db: SQLiteDatabase, ids: string[], archived: boolean): Promise<void> {
  if (ids.length === 0) return;
  const CHUNK = 500;
  const now = new Date().toISOString();
  const value = archived ? 1 : 0;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      await db.runAsync(
        `UPDATE decks SET archived = ?, updatedAt = ? WHERE id IN (${placeholders})`,
        [value, now, ...chunk]
      );
    }
  });
}

export async function createDeck(
  db: SQLiteDatabase,
  data: Pick<Deck, 'name' | 'description' | 'language'> &
    Partial<Pick<Deck, 'iconName' | 'colorHex' | 'sqlInit' | 'sqlStages' | 'htmlInit' | 'htmlImages' | 'htmlStages'>>
): Promise<Deck> {
  const now = new Date().toISOString();
  const id = generateId();
  const row = await db.getFirstAsync<{ maxOrder: number | null }>('SELECT MAX(sortOrder) as maxOrder FROM decks');
  const sortOrder = (row?.maxOrder ?? 0) + 1;
  const iconName = data.iconName ?? null;
  const colorHex = data.colorHex ?? null;
  const htmlImages = data.htmlImages ?? [];
  // 044/045: 土台の配列を渡されたらそれが正で、旧列（htmlInit / sqlInit）は先頭土台のミラーになる。
  // 渡されないとき（044/045 以前の呼び出し）は従来どおり旧列をそのまま書く。
  const htmlStages = data.htmlStages;
  const htmlInit = htmlStages !== undefined ? legacyInitMirror(htmlStages) : (data.htmlInit ?? null);
  const sqlStages = data.sqlStages;
  const sqlInit = sqlStages !== undefined ? legacyInitMirror(sqlStages) : (data.sqlInit ?? null);
  await db.runAsync(
    'INSERT INTO decks (id, name, description, language, cardCount, sortOrder, iconName, colorHex, sqlInit, sqlStages, htmlInit, htmlImages, htmlStages, createdAt, updatedAt) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, data.name, data.description, data.language, sortOrder, iconName, colorHex, sqlInit, serializeDeckStages(sqlStages), htmlInit, serializeDeckImages(htmlImages), serializeDeckStages(htmlStages), now, now]
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
    htmlImages,
    // 読み直したときと同じ形にそろえる（配列未指定でも旧列から合成される）
    htmlStages: normalizeDeckStages(serializeDeckStages(htmlStages), htmlInit),
    sqlStages: normalizeDeckStages(serializeDeckStages(sqlStages), sqlInit),
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
    Partial<Pick<Deck, 'iconName' | 'colorHex' | 'sqlInit' | 'sqlStages' | 'htmlInit' | 'htmlImages' | 'htmlStages'>>
): Promise<void> {
  const now = new Date().toISOString();
  // htmlImages / htmlStages / sqlStages は「渡されたときだけ」更新する（他の任意項目と扱いが違う点に注意）。
  // いずれもフォームの入力欄と1対1ではないため、渡さない呼び出し（他画面からの
  // デッキ更新）で無条件に上書きすると、登録済みライブラリ／土台が黙って消える。
  const updatesImages = data.htmlImages !== undefined;
  const updatesStages = data.htmlStages !== undefined;
  const updatesSqlStages = data.sqlStages !== undefined;
  // 044/045: 土台を更新するときは旧列（htmlInit / sqlInit）を先頭土台のミラーで上書きする（旧バージョン互換）。
  // **旧列も「渡されたときだけ」更新する**：無条件に `?? null` で書くと、土台を渡さない呼び出しで
  // ミラーだけが NULL になり、新バージョンでは気づけないまま**旧バージョン／旧エクスポートから土台が
  // 消える**（新バージョンは htmlStages/sqlStages を読むので画面上は正常に見えてしまう）。
  const updatesHtmlInit = updatesStages || data.htmlInit !== undefined;
  const updatesSqlInit = updatesSqlStages || data.sqlInit !== undefined;
  const htmlInit = updatesStages ? legacyInitMirror(data.htmlStages) : (data.htmlInit ?? null);
  const sqlInit = updatesSqlStages ? legacyInitMirror(data.sqlStages) : (data.sqlInit ?? null);
  await db.runAsync(
    `UPDATE decks SET name = ?, description = ?, language = ?, iconName = ?, colorHex = ?${updatesSqlInit ? ', sqlInit = ?' : ''}${updatesHtmlInit ? ', htmlInit = ?' : ''}${updatesImages ? ', htmlImages = ?' : ''}${updatesStages ? ', htmlStages = ?' : ''}${updatesSqlStages ? ', sqlStages = ?' : ''}, updatedAt = ? WHERE id = ?`,
    [
      data.name, data.description, data.language,
      data.iconName ?? null, data.colorHex ?? null,
      ...(updatesSqlInit ? [sqlInit] : []),
      ...(updatesHtmlInit ? [htmlInit] : []),
      ...(updatesImages ? [serializeDeckImages(data.htmlImages)] : []),
      ...(updatesStages ? [serializeDeckStages(data.htmlStages)] : []),
      ...(updatesSqlStages ? [serializeDeckStages(data.sqlStages)] : []),
      now, id,
    ]
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

/** 削除対象デッキが持つ画像ファイルを消す。対象は2系統：
 *  ①配下カードの本文 JSON の image ブロック、②デッキの HTML 画像ライブラリ（043）。
 *  カード削除（deleteCard / deleteCardsBulk）と同じ後始末をデッキ削除にも揃えるためのもの。
 *  失敗しても DB の削除は続行する（画像が残るだけで整合性は壊れない＝孤児掃除が後で回収する）。 */
async function deleteImagesOfDecks(db: SQLiteDatabase, inList: string): Promise<void> {
  const rows = await db.getAllAsync<{ frontContent: string | null; backContent: string | null; memoContent: string | null }>(
    `SELECT frontContent, backContent, memoContent FROM card_contents
     WHERE cardId IN (SELECT id FROM cards WHERE deckId IN (${inList}))`
  );
  const blocks: { type: string; uri?: string }[] = [];
  for (const row of rows) {
    for (const json of [row.frontContent, row.backContent, row.memoContent]) {
      if (!json) continue;
      try {
        blocks.push(...(JSON.parse(json) as { type: string; uri?: string }[]));
      } catch {
        // 壊れた JSON は無視（画像が残るだけ）
      }
    }
  }
  // HTML 画像ライブラリ（043）は image ブロックと同じ形に均して同じ経路で消す
  const deckRows = await db.getAllAsync<{ htmlImages: string | null }>(
    `SELECT htmlImages FROM decks WHERE id IN (${inList})`
  );
  for (const row of deckRows) {
    for (const image of parseDeckImages(row.htmlImages)) blocks.push({ type: 'image', uri: image.uri });
  }
  if (blocks.length > 0) await deleteImagesInBlocks(blocks).catch(() => {});
}

export async function deleteDeck(db: SQLiteDatabase, id: string): Promise<void> {
  await deleteDecksBulk(db, [id]);
}

/** デッキを削除する（配下のカード・本文・タグ紐付け・学習履歴・画像ファイルも消す）。
 *  `foreign_keys` pragma を使っていないため関連行はすべて明示的に消す（CLAUDE.md 参照）。 */
export async function deleteDecksBulk(db: SQLiteDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // id は UUID（hex + ハイフンのみ・generateId）のため直接埋め込み可能。
  const inList = ids.map((id) => `'${id}'`).join(',');
  // 画像は DB 行が消える前に拾う（消した後では本文 JSON を辿れない）
  await deleteImagesOfDecks(db, inList);
  const cardIds = `SELECT id FROM cards WHERE deckId IN (${inList})`;
  // execAsync で1回のブリッジ呼び出しに集約し、withTransactionAsync（非排他）の
  // await 間に他の非同期クエリが割り込むことで発生する SQLITE_BUSY を防ぐ。
  await db.execAsync(`
    BEGIN;
    DELETE FROM grade_logs  WHERE cardId IN (${cardIds});
    DELETE FROM review_logs WHERE cardId IN (${cardIds});
    DELETE FROM reviews     WHERE cardId IN (${cardIds});
    DELETE FROM card_tags   WHERE cardId IN (${cardIds});
    DELETE FROM card_contents WHERE cardId IN (${cardIds});
    DELETE FROM cards  WHERE deckId IN (${inList});
    DELETE FROM decks  WHERE id     IN (${inList});
    COMMIT;
  `);
}
