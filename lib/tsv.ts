import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { EXECUTABLE_LANGUAGES, LANGUAGES } from '@/lib/code-execution/constants';
import { getCardsByDeckId, updateCard } from '@/lib/database/cards';
import { generateId } from '@/lib/database/utils';
import { createTag, getTagRowsByDeckId } from '@/lib/database/tags';
import { TAG_PRESET_COLORS } from '@/lib/theme';
import type { Block, Deck } from '@/types';

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
}

function unescape(s: string): string {
  // U+2028 / U+2029 はスプレッドシート由来の不可視改行で iOS の nested <Text> 描画を壊すため \n に正規化
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/[\u2028\u2029]/g, '\n');
}

// RFC 4180 対応 TSV パーサー（Numbers等のクォート付き複数行セルを処理）
function parseTsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  // BOM を除去
  const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const cols: string[] = [];

    while (i < n) {
      if (text[i] === '"') {
        // クォート付きフィールド: 実際の改行・タブを含む可能性あり
        i++;
        let field = '';
        while (i < n) {
          if (text[i] === '"') {
            if (i + 1 < n && text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            field += text[i++];
          }
        }
        cols.push(field.trim());
        if (i < n && text[i] === '\t') { i++; }
        else { if (i < n && text[i] === '\r') i++; if (i < n && text[i] === '\n') i++; break; }
      } else {
        // 非クォートフィールド: アプリ独自の \n \t \\ エスケープを処理
        let field = '';
        while (i < n && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i++];
        }
        cols.push(unescape(field.trim()));
        if (i < n && text[i] === '\t') { i++; }
        else { if (i < n && text[i] === '\r') i++; if (i < n && text[i] === '\n') i++; break; }
      }
    }

    if (cols.some((c) => c !== '')) rows.push(cols);
  }

  return rows;
}

/**
 * コードブロックを囲むフェンスを決める。CommonMark と同じ規則で「中身に現れる最長の
 * バッククォート連続より1つ長い」フェンスを使い、本文に ``` を含むコード（マークダウンの
 * 説明カードなど）でも閉じ位置を誤らないようにする。最短は ```。
 */
function fenceFor(content: string): string {
  const runs = content.match(/`+/g);
  const longest = runs ? runs.reduce((m, r) => Math.max(m, r.length), 0) : 0;
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * ブロック配列を TSV の1フィールド分のテキストにする。
 * コードブロックはマークダウンのフェンス（```言語）で囲み、インポート時に
 * テキストブロックと区別して復元できるようにする（textToBlocks と対称）。
 * 画像は本文を持たないため `[image]` のままで、往復しても画像は戻らない。
 */
function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'code') {
        const fence = fenceFor(b.content);
        return `${fence}${b.language}\n${b.content}\n${fence}`;
      }
      if (b.type === 'text') return b.content;
      return '[image]';
    })
    .join('\n');
}

// 開始フェンス（```言語）と終了フェンス（```）。言語名は英数と +#_-（c++ / objective-c 等）を許す
const FENCE_OPEN_RE = /^(`{3,})[ \t]*([A-Za-z0-9+#_.-]*)[ \t]*$/;
const FENCE_CLOSE_RE = /^(`{3,})[ \t]*$/;

// 手書き TSV でよく使われる略記を正規の言語 ID へ寄せる（LANGUAGES に無いものは 'text'）
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  'c++': 'cpp',
  cc: 'cpp',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  htm: 'html',
  plain: 'text',
  '': 'text',
};

function normalizeLanguage(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const aliased = LANGUAGE_ALIASES[lower] ?? lower;
  return LANGUAGES.includes(aliased) ? aliased : 'text';
}

/**
 * TSV の1フィールドをブロック配列に戻す（blocksToText と対称）。
 * ```言語 …  ``` のフェンスをコードブロック、それ以外をテキストブロックにする。
 * フェンスを含まない従来の TSV は全体がテキストブロック1個になる（後方互換）。
 * 閉じフェンスが見つからない開始フェンスは、ただの本文として扱う（壊れた入力で
 * 残り全部がコードに飲み込まれるのを防ぐ）。
 *
 * 既知の非対称: 本文にフェンスを書いた「テキストブロック」は、往復するとその部分が
 * コードブロックに変換される（マークダウンと同じ解釈になる）。書き手の意図としては
 * それが自然なので許容する。厳密に保存したい場合は JSON エクスポートを使う。
 */
function textToBlocks(text: string): Block[] {
  // U+2028 / U+2029 はスプレッドシート由来の不可視改行。クォート付きセル経由でも混入する
  const normalized = text.replace(/[\u2028\u2029]/g, '\n');
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const blocks: Block[] = [];
  let buf: string[] = [];

  const flushText = () => {
    // ブロック境界に生じる前後の空行だけ落とす（インデントは保つため trim は使わない）
    const content = buf.join('\n').replace(/^\n+|\n+$/g, '');
    if (content) blocks.push({ type: 'text', content });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN_RE.exec(lines[i]);
    if (!open) {
      buf.push(lines[i]);
      continue;
    }
    // 開始フェンスと同じ長さ以上の閉じフェンスを探す
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const c = FENCE_CLOSE_RE.exec(lines[j]);
      if (c && c[1].length >= open[1].length) { close = j; break; }
    }
    if (close === -1) {
      buf.push(lines[i]);
      continue;
    }
    flushText();
    const language = normalizeLanguage(open[2]);
    blocks.push({
      type: 'code',
      language,
      content: lines.slice(i + 1, close).join('\n'),
      executable: EXECUTABLE_LANGUAGES.includes(language),
    });
    i = close;
  }
  flushText();
  return blocks;
}

function parseTagNames(raw: string): string[] {
  if (!raw.trim()) return [];
  const delimiter = raw.includes(',') ? ',' : ' ';
  return raw.split(delimiter).map((s) => s.trim()).filter(Boolean);
}

function assignTagColor(name: string): string {
  const sum = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return TAG_PRESET_COLORS[sum % TAG_PRESET_COLORS.length];
}

async function resolveOrCreateTag(
  db: SQLiteDatabase,
  name: string,
  cache: Map<string, string>
): Promise<string> {
  if (cache.has(name)) return cache.get(name)!;
  const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM tags WHERE name = ?', [name]);
  if (existing) {
    cache.set(name, existing.id);
    return existing.id;
  }
  const tag = await createTag(db, { name, color: assignTagColor(name) });
  cache.set(name, tag.id);
  return tag.id;
}

/**
 * TSV に載せられない内容（エクスポートで失われるもの）の内訳。
 * TSV は `id/front/back/memo/tags` の5列＝カードの本文テキストしか運べないため、
 * デッキ設定の初期化SQL・HTML土台、ブロック固有の初期化、画像は落ちる。
 * 完全な保存は JSON バックアップ（lib/export.ts）の役目。
 */
export type TsvExportLoss = {
  deckSqlInit: boolean;
  deckHtmlInit: boolean;
  blockSqlInit: number;
  blockHtmlInit: number;
  images: number;
};

/** エクスポート前の検査。該当が無ければ警告を出さずそのまま書き出す（通常デッキで操作を増やさない） */
export async function inspectTsvExport(db: SQLiteDatabase, deck: Deck): Promise<TsvExportLoss> {
  const cards = await getCardsByDeckId(db, deck.id);
  let blockSqlInit = 0;
  let blockHtmlInit = 0;
  let images = 0;
  for (const card of cards) {
    for (const b of [...card.frontContent, ...card.backContent, ...card.memoContent]) {
      if (b.type === 'image') images++;
      else if (b.type === 'code') {
        if (b.sqlInit?.trim()) blockSqlInit++;
        if (b.htmlInit?.trim()) blockHtmlInit++;
      }
    }
  }
  return {
    deckSqlInit: !!deck.sqlInit?.trim(),
    deckHtmlInit: !!deck.htmlInit?.trim(),
    blockSqlInit,
    blockHtmlInit,
    images,
  };
}

export function hasTsvExportLoss(loss: TsvExportLoss): boolean {
  return loss.deckSqlInit || loss.deckHtmlInit || loss.blockSqlInit > 0 || loss.blockHtmlInit > 0 || loss.images > 0;
}

export async function exportDeckToTsv(db: SQLiteDatabase, deckId: string, deckName: string): Promise<void> {
  const [cards, tagRows] = await Promise.all([
    getCardsByDeckId(db, deckId),
    getTagRowsByDeckId(db, deckId),
  ]);

  const tagMap = new Map<string, string[]>();
  for (const row of tagRows) {
    const arr = tagMap.get(row.cardId) ?? [];
    arr.push(row.name);
    tagMap.set(row.cardId, arr);
  }

  const lines = ['id\tfront\tback\tmemo\ttags'];
  for (const card of cards) {
    const front = escape(blocksToText(card.frontContent));
    const back = escape(blocksToText(card.backContent));
    const memo = escape(blocksToText(card.memoContent));
    const tags = (tagMap.get(card.id) ?? []).join(',');
    lines.push(`${card.id}\t${front}\t${back}\t${memo}\t${tags}`);
  }
  const tsv = lines.join('\n');
  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const filename = `${deckName.replace(/[/\\:*?"<>|]/g, '_')}_${timestamp}.tsv`;
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, tsv, { encoding: 'utf8' });
  await Sharing.shareAsync(uri, { mimeType: 'text/tab-separated-values', dialogTitle: filename });
}

export async function pickTsvFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled || result.assets.length === 0) return null;
  return result.assets[0].uri;
}

/**
 * インポートするTSVの取り込み方法を判定する。
 * - id列がない / id列はあるがDBに実在するidが1件もない → 'standard'（通常のデッキ選択フロー）
 * - 実在idが単一デッキに属する → 'overwrite'（そのデッキへ自動上書き）
 * - 実在idが複数デッキにまたがる → 'multiDeck'（デッキ選択へ誘導）
 */
export type TsvImportInspection =
  | { kind: 'standard' }
  | { kind: 'overwrite'; deckId: string; deckName: string }
  | { kind: 'multiDeck' };

export async function inspectTsvImport(db: SQLiteDatabase, fileUri: string): Promise<TsvImportInspection> {
  const raw = await FileSystem.readAsStringAsync(fileUri, { encoding: 'utf8' });
  const rows = parseTsvRows(raw);
  if (rows.length === 0) return { kind: 'standard' };

  // ヘッダー1列目が id でなければ id 列なし扱い
  if ((rows[0][0]?.toLowerCase() ?? '') !== 'id') return { kind: 'standard' };

  // データ行から非空のidを収集
  const ids = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const id = rows[i][0]?.trim();
    if (id) ids.add(id);
  }
  if (ids.size === 0) return { kind: 'standard' };

  // DBに実在するidの所属デッキを取得
  const idList = Array.from(ids);
  const deckMap = new Map<string, string>(); // deckId -> deckName
  for (let i = 0; i < idList.length; i += BULK_CHUNK) {
    const chunk = idList.slice(i, i + BULK_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const found = await db.getAllAsync<{ deckId: string; name: string }>(
      `SELECT DISTINCT c.deckId AS deckId, d.name AS name
       FROM cards c JOIN decks d ON c.deckId = d.id
       WHERE c.id IN (${placeholders})`,
      chunk
    );
    for (const f of found) deckMap.set(f.deckId, f.name);
  }

  if (deckMap.size === 0) return { kind: 'standard' };
  if (deckMap.size === 1) {
    const [deckId, deckName] = Array.from(deckMap.entries())[0];
    return { kind: 'overwrite', deckId, deckName };
  }
  return { kind: 'multiDeck' };
}

// バルクインポート用の中間データ型
type ParsedCard = {
  id: string;
  front: string;
  back: string;
  memo: string;
  tagsRaw: string;
  isUpdate: boolean;
};

const BULK_CHUNK = 500;

export async function importTsv(db: SQLiteDatabase, fileUri: string, deckId: string): Promise<{ created: number; updated: number }> {
  const raw = await FileSystem.readAsStringAsync(fileUri, { encoding: 'utf8' });
  // RFC 4180 対応パーサーで行列に分解（Numbers等のクォート付き複数行セルを処理）
  const rows = parseTsvRows(raw);

  // ヘッダー行の検出と列構成の判定
  // ID列あり: cols[0]=id, cols[1]=front, cols[2]=back, cols[3]=memo, cols[4]=tags
  // ID列なし: cols[0]=front, cols[1]=back, cols[2]=tags
  let start = 0;
  let hasIdColumn = false;
  const tagsColWithId = 4;
  const tagsColNoId = 2;

  if (rows.length > 0) {
    const firstCol = rows[0][0]?.toLowerCase() ?? '';
    if (firstCol === 'id') {
      hasIdColumn = true;
      start = 1;
    } else if (firstCol === 'front') {
      start = 1;
    }
  }

  // ID列ありの場合のみ既存カードマップを構築
  const existingCardIds = new Set<string>();
  if (hasIdColumn) {
    const existingCards = await getCardsByDeckId(db, deckId);
    for (const card of existingCards) existingCardIds.add(card.id);
  }

  // --- フェーズ1: 全行をJSでパース（DB呼び出しゼロ） ---
  // フェンス（```言語）はコードブロックへ、それ以外はテキストブロックへ復元する。
  // フェンスを含まない従来の TSV は全体がテキストブロック1個になる（後方互換）。
  const toBlocks = textToBlocks;

  const parsedCards: ParsedCard[] = [];
  for (let i = start; i < rows.length; i++) {
    // parseTsvRows が unescape・trim 済みなので追加処理不要
    const cols = rows[i];
    if (hasIdColumn) {
      const front = cols[1] ?? '';
      if (!front) continue;
      const existingId = cols[0] ?? '';
      parsedCards.push({
        id: (existingId && existingCardIds.has(existingId)) ? existingId : generateId(),
        front,
        back: cols[2] ?? '',
        memo: cols[3] ?? '',
        tagsRaw: cols[tagsColWithId] ?? '',
        isUpdate: !!(existingId && existingCardIds.has(existingId)),
      });
    } else {
      const front = cols[0] ?? '';
      if (!front) continue;
      parsedCards.push({
        id: generateId(),
        front,
        back: cols[1] ?? '',
        memo: '',
        tagsRaw: cols[tagsColNoId] ?? '',
        isUpdate: false,
      });
    }
  }

  // --- フェーズ2: タグ名を事前解決（createTag は外側で済ませる） ---
  const tagCache = new Map<string, string>();
  const allTagNames = new Set<string>();
  for (const card of parsedCards) {
    for (const name of parseTagNames(card.tagsRaw)) allTagNames.add(name);
  }
  for (const name of allTagNames) {
    await resolveOrCreateTag(db, name, tagCache);
  }

  // --- フェーズ3: 現在の最大 sortOrder を1回だけ取得 ---
  const orderRow = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX(sortOrder) as maxOrder FROM cards WHERE deckId = ?', [deckId]
  );
  let nextSortOrder = (orderRow?.maxOrder ?? 0) + 1;

  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;

  // --- フェーズ4: 全INSERT/UPDATEを1トランザクション + Multi-row INSERT ---
  await db.withTransactionAsync(async () => {
    const creates = parsedCards.filter((c) => !c.isUpdate);
    const updates = parsedCards.filter((c) => c.isUpdate);

    // 新規カード: Multi-row INSERT で BULK_CHUNK 件ずつまとめて挿入
    for (let i = 0; i < creates.length; i += BULK_CHUNK) {
      const chunk = creates.slice(i, i + BULK_CHUNK);
      const cardPlaceholders = chunk.map(() => '(?,?,?,?,?)').join(',');
      const cardParams: (string | number)[] = [];
      const contentPlaceholders = chunk.map(() => '(?,?,?,?)').join(',');
      const contentParams: string[] = [];

      for (const card of chunk) {
        cardParams.push(card.id, deckId, nextSortOrder++, now, now);
        contentParams.push(
          card.id,
          JSON.stringify(toBlocks(card.front)),
          JSON.stringify(toBlocks(card.back)),
          card.memo ? JSON.stringify(toBlocks(card.memo)) : '[]',
        );
      }

      await db.runAsync(
        `INSERT INTO cards (id,deckId,sortOrder,createdAt,updatedAt) VALUES ${cardPlaceholders}`,
        cardParams
      );
      await db.runAsync(
        `INSERT INTO card_contents (cardId,frontContent,backContent,memoContent) VALUES ${contentPlaceholders}`,
        contentParams
      );
      created += chunk.length;
    }

    // 更新カード: 件数が少ない想定なので個別UPDATE
    for (const card of updates) {
      await updateCard(db, card.id, {
        frontContent: toBlocks(card.front),
        backContent: toBlocks(card.back),
        memoContent: toBlocks(card.memo),
      });
      updated++;
    }

    // card_tags: Multi-row INSERT で一括挿入
    const cardTagPairs: { cardId: string; tagId: string }[] = [];
    for (const card of parsedCards) {
      for (const name of parseTagNames(card.tagsRaw)) {
        const tagId = tagCache.get(name);
        if (tagId) cardTagPairs.push({ cardId: card.id, tagId });
      }
    }
    for (let i = 0; i < cardTagPairs.length; i += BULK_CHUNK) {
      const chunk = cardTagPairs.slice(i, i + BULK_CHUNK);
      const placeholders = chunk.map(() => '(?,?)').join(',');
      const params = chunk.flatMap((p) => [p.cardId, p.tagId]);
      await db.runAsync(
        `INSERT OR IGNORE INTO card_tags (cardId,tagId) VALUES ${placeholders}`,
        params
      );
    }

    // デッキ件数を最後に1回だけ更新
    await db.runAsync(
      'UPDATE decks SET cardCount=(SELECT COUNT(*) FROM cards WHERE deckId=?),updatedAt=? WHERE id=?',
      [deckId, now, deckId]
    );
  });

  return { created, updated };
}
