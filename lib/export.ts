import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

const IMAGE_DIR = FileSystem.documentDirectory + 'images/';

export type ExportData = {
  version: 1;
  exportedAt: string;
  decks: Record<string, unknown>[];
  cards: Record<string, unknown>[];
  tags: Record<string, unknown>[];
  card_tags: { cardId: string; tagId: string }[];
  reviews: Record<string, unknown>[];
  review_logs: { cardId: string; reviewedDate: string }[];
  imageData?: Record<string, string>; // key: ファイル名, value: base64
};

function extractImageFilenames(cards: Record<string, unknown>[]): string[] {
  const filenames = new Set<string>();
  for (const card of cards) {
    for (const field of ['frontContent', 'backContent', 'memoContent']) {
      try {
        const blocks = JSON.parse((card[field] as string) ?? '[]') as { type: string; uri?: string }[];
        for (const block of blocks) {
          if (block.type === 'image' && block.uri?.startsWith('local://images/')) {
            filenames.add(block.uri.slice('local://images/'.length));
          }
        }
      } catch {}
    }
  }
  return Array.from(filenames);
}

/** 画像ファイルの合計サイズ（バイト）を返す。Base64後は約1.33倍になる */
export async function estimateImageExportSize(db: SQLiteDatabase): Promise<number> {
  const cards = await db.getAllAsync<Record<string, unknown>>(
    'SELECT frontContent, backContent, memoContent FROM cards'
  );
  const filenames = extractImageFilenames(cards);
  let total = 0;
  for (const filename of filenames) {
    const info = await FileSystem.getInfoAsync(IMAGE_DIR + filename);
    if (info.exists && 'size' in info) {
      total += (info.size as number) ?? 0;
    }
  }
  return total;
}

export async function exportDatabase(db: SQLiteDatabase, includeImages = false): Promise<void> {
  const decks = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM decks ORDER BY sortOrder ASC');
  const cards = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM cards ORDER BY sortOrder ASC');
  const tags = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM tags ORDER BY sortOrder ASC');
  const card_tags = await db.getAllAsync<{ cardId: string; tagId: string }>('SELECT * FROM card_tags');
  const reviews = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM reviews');
  const review_logs = await db.getAllAsync<{ cardId: string; reviewedDate: string }>('SELECT * FROM review_logs');

  const data: ExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    decks,
    cards,
    tags,
    card_tags,
    reviews,
    review_logs,
  };

  if (includeImages) {
    const filenames = extractImageFilenames(cards);
    const imageData: Record<string, string> = {};
    for (const filename of filenames) {
      const uri = IMAGE_DIR + filename;
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        imageData[filename] = base64;
      }
    }
    data.imageData = imageData;
  }

  const json = JSON.stringify(data, null, 2);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const fileUri = FileSystem.cacheDirectory + `CF_${timestamp}.json`;
  await FileSystem.writeAsStringAsync(fileUri, json, { encoding: 'utf8' });
  await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'CodeFlash バックアップ' });
}
