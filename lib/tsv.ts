import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getCardsByDeckId, createCard, updateCard } from '@/lib/database/cards';
import { createTag, addTagToCard, getTagRowsByDeckId } from '@/lib/database/tags';
import type { Block, TextBlock } from '@/types';

const PRESET_COLORS = [
  '#E53935', '#F4511E', '#F6BF26', '#33B679',
  '#0B8043', '#039BE5', '#3F51B5', '#7986CB',
  '#8E24AA', '#616161', '#795548', '#D81B60',
];

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
}

function unescape(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
}

function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text' || b.type === 'code') return b.content;
      return '[image]';
    })
    .join('\n');
}

function parseTagNames(raw: string): string[] {
  if (!raw.trim()) return [];
  const delimiter = raw.includes(',') ? ',' : ' ';
  return raw.split(delimiter).map((s) => s.trim()).filter(Boolean);
}

function assignTagColor(name: string): string {
  const sum = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return PRESET_COLORS[sum % PRESET_COLORS.length];
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

export async function importTsv(db: SQLiteDatabase, fileUri: string, deckId: string): Promise<{ created: number; updated: number }> {
  const raw = await FileSystem.readAsStringAsync(fileUri, { encoding: 'utf8' });
  const lines = raw.split('\n').filter((l) => l.trim() !== '');

  // ヘッダー行の検出と列構成の判定
  let start = 0;
  let hasIdColumn = false;
  // ID列あり: cols[0]=id, cols[1]=front, cols[2]=back, cols[3]=memo, cols[4]=tags
  // ID列なし: cols[0]=front, cols[1]=back, cols[2]=tags
  const tagsColWithId = 4;
  const tagsColNoId = 2;

  if (lines.length > 0) {
    const first = lines[0].toLowerCase();
    if (first.startsWith('id\t')) {
      hasIdColumn = true;
      start = 1;
    } else if (first.startsWith('front')) {
      start = 1;
    }
  }

  // ID列ありの場合のみ既存カードマップを構築
  const existingCardIds = new Set<string>();
  if (hasIdColumn) {
    const existingCards = await getCardsByDeckId(db, deckId);
    for (const card of existingCards) {
      existingCardIds.add(card.id);
    }
  }

  const tagCache = new Map<string, string>();

  const toBlocks = (text: string): TextBlock[] =>
    text ? [{ type: 'text', content: text }] : [];

  let created = 0;
  let updated = 0;
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split('\t');

    if (hasIdColumn) {
      const id = cols[0]?.trim() ?? '';
      const front = unescape(cols[1] ?? '').trim();
      const back = unescape(cols[2] ?? '').trim();
      const memo = unescape(cols[3] ?? '').trim();
      const tagsRaw = cols[tagsColWithId] ?? '';
      if (!front) continue;

      let cardId: string;
      if (id && existingCardIds.has(id)) {
        await updateCard(db, id, {
          frontContent: toBlocks(front),
          backContent: toBlocks(back),
          memoContent: toBlocks(memo),
        });
        cardId = id;
        updated++;
      } else {
        const card = await createCard(db, { deckId, frontContent: toBlocks(front), backContent: toBlocks(back), memoContent: toBlocks(memo) });
        cardId = card.id;
        created++;
      }
      for (const name of parseTagNames(tagsRaw)) {
        const tagId = await resolveOrCreateTag(db, name, tagCache);
        await addTagToCard(db, cardId, tagId);
      }
    } else {
      // ID列なし（Anki・手作りTSV）: 常に新規作成
      const front = unescape(cols[0] ?? '').trim();
      const back = unescape(cols[1] ?? '').trim();
      const tagsRaw = cols[tagsColNoId] ?? '';
      if (!front) continue;

      const card = await createCard(db, { deckId, frontContent: toBlocks(front), backContent: toBlocks(back), memoContent: [] });
      created++;
      for (const name of parseTagNames(tagsRaw)) {
        const tagId = await resolveOrCreateTag(db, name, tagCache);
        await addTagToCard(db, card.id, tagId);
      }
    }
  }
  return { created, updated };
}
