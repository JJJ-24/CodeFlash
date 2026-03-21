import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

export type ExportData = {
  version: 1;
  exportedAt: string;
  decks: Record<string, unknown>[];
  cards: Record<string, unknown>[];
  tags: Record<string, unknown>[];
  card_tags: { cardId: string; tagId: string }[];
  reviews: Record<string, unknown>[];
};

export async function exportDatabase(db: SQLiteDatabase): Promise<void> {
  const decks = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM decks ORDER BY sortOrder ASC');
  const cards = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM cards ORDER BY sortOrder ASC');
  const tags = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM tags ORDER BY sortOrder ASC');
  const card_tags = await db.getAllAsync<{ cardId: string; tagId: string }>('SELECT * FROM card_tags');
  const reviews = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM reviews');

  const data: ExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    decks,
    cards,
    tags,
    card_tags,
    reviews,
  };

  const json = JSON.stringify(data, null, 2);
  const fileUri = FileSystem.cacheDirectory + 'codeflash-backup.json';
  await FileSystem.writeAsStringAsync(fileUri, json, { encoding: 'utf8' });
  await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'CodeFlash バックアップ' });
}
