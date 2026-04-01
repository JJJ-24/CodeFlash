import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getCardsByDeckId, createCard, updateCard } from '@/lib/database/cards';
import type { Block, TextBlock } from '@/types';

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

export async function exportDeckToTsv(db: SQLiteDatabase, deckId: string, deckName: string): Promise<void> {
  const cards = await getCardsByDeckId(db, deckId);
  const lines = ['id\tfront\tback\tmemo'];
  for (const card of cards) {
    const front = escape(blocksToText(card.frontContent));
    const back = escape(blocksToText(card.backContent));
    const memo = escape(blocksToText(card.memoContent));
    lines.push(`${card.id}\t${front}\t${back}\t${memo}`);
  }
  const tsv = lines.join('\n');
  const filename = `${deckName.replace(/[/\\:*?"<>|]/g, '_')}.tsv`;
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
      if (!front) continue;

      if (id && existingCardIds.has(id)) {
        await updateCard(db, id, {
          frontContent: toBlocks(front),
          backContent: toBlocks(back),
          memoContent: toBlocks(memo),
        });
        updated++;
      } else {
        await createCard(db, { deckId, frontContent: toBlocks(front), backContent: toBlocks(back), memoContent: toBlocks(memo) });
        created++;
      }
    } else {
      // ID列なし（Anki・手作りTSV）: 常に新規作成
      const front = unescape(cols[0] ?? '').trim();
      const back = unescape(cols[1] ?? '').trim();
      const memo = unescape(cols[2] ?? '').trim();
      if (!front) continue;

      await createCard(db, { deckId, frontContent: toBlocks(front), backContent: toBlocks(back), memoContent: toBlocks(memo) });
      created++;
    }
  }
  return { created, updated };
}
