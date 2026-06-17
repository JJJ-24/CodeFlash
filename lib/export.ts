import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { SETTINGS_ASYNC_STORAGE_KEYS } from './settings-keys';

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
  grade_logs?: { id: number; cardId: string; grade: number; reviewedAt: string; responseTimeMs: number | null }[];
  settings?: Record<string, string>; // AsyncStorage の設定値
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

/** エクスポートファイルの推定サイズ（バイト）を返す */
export async function estimateExportSize(db: SQLiteDatabase, includeImages: boolean): Promise<number> {
  // card_contents のテキストサイズ（最大要因）を SQLite で直接集計
  const [contentRow, countRow] = await Promise.all([
    db.getFirstAsync<{ total: number }>(
      // CAST AS BLOB で UTF-8 の実バイト数を取得（LENGTH(TEXT) は文字数を返すため日本語で過小評価になる）
      `SELECT COALESCE(SUM(LENGTH(CAST(frontContent AS BLOB))+LENGTH(CAST(backContent AS BLOB))+LENGTH(CAST(memoContent AS BLOB))), 0) AS total FROM card_contents`
    ),
    db.getFirstAsync<{ cards: number; decks: number; tags: number; cardTags: number; reviews: number; reviewLogs: number; gradeLogs: number }>(
      `SELECT
         (SELECT COUNT(*) FROM cards)       AS cards,
         (SELECT COUNT(*) FROM decks)       AS decks,
         (SELECT COUNT(*) FROM tags)        AS tags,
         (SELECT COUNT(*) FROM card_tags)   AS cardTags,
         (SELECT COUNT(*) FROM reviews)     AS reviews,
         (SELECT COUNT(*) FROM review_logs) AS reviewLogs,
         (SELECT COUNT(*) FROM grade_logs)  AS gradeLogs`
    ),
  ]);
  // JSON.stringify で " → \" エスケープされる分（コンテンツ文字列は {"type":"text","content":"..."} 形式で " が多い）
  const contentBytes = Math.ceil((contentRow?.total ?? 0) * 1.15);
  const c = countRow ?? { cards: 0, decks: 0, tags: 0, cardTags: 0, reviews: 0, reviewLogs: 0, gradeLogs: 0 };
  // JSON キー名・インデント・タイムスタンプ等の構造オーバーヘッド概算（行数 × 1行あたりのバイト数）
  const metaBytes = c.cards * 250 + c.decks * 350 + c.tags * 120 + c.cardTags * 70 + c.reviews * 300 + c.reviewLogs * 70 + c.gradeLogs * 110;

  if (!includeImages) return contentBytes + metaBytes;

  // 画像ファイルの raw サイズ → base64 換算（× 4/3）
  const cards = await db.getAllAsync<Record<string, unknown>>(
    'SELECT frontContent, backContent, memoContent FROM card_contents'
  );
  const filenames = extractImageFilenames(cards);
  let rawImageBytes = 0;
  for (const filename of filenames) {
    const info = await FileSystem.getInfoAsync(IMAGE_DIR + filename);
    if (info.exists && 'size' in info) rawImageBytes += (info.size as number) ?? 0;
  }
  return contentBytes + metaBytes + Math.ceil(rawImageBytes * 4 / 3);
}

/** @deprecated estimateExportSize を使用してください */
export async function estimateImageExportSize(db: SQLiteDatabase): Promise<number> {
  return estimateExportSize(db, true);
}

export async function exportDatabase(db: SQLiteDatabase, includeImages = false): Promise<void> {
  const decks = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM decks ORDER BY sortOrder ASC');
  const cards = await db.getAllAsync<Record<string, unknown>>(
    `SELECT c.id, c.deckId, c.sortOrder, c.archived, c.createdAt, c.updatedAt,
            COALESCE(cc.frontContent, '[]') AS frontContent,
            COALESCE(cc.backContent,  '[]') AS backContent,
            COALESCE(cc.memoContent,  '[]') AS memoContent
     FROM cards c
     LEFT JOIN card_contents cc ON cc.cardId = c.id
     ORDER BY c.sortOrder ASC`
  );
  const tags = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM tags ORDER BY sortOrder ASC');
  const card_tags = await db.getAllAsync<{ cardId: string; tagId: string }>('SELECT * FROM card_tags');
  const reviews = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM reviews');
  const review_logs = await db.getAllAsync<{ cardId: string; reviewedDate: string }>('SELECT * FROM review_logs');
  const grade_logs = await db.getAllAsync<{ id: number; cardId: string; grade: number; reviewedAt: string; responseTimeMs: number | null }>(
    'SELECT id, cardId, grade, reviewedAt, responseTimeMs FROM grade_logs ORDER BY id ASC'
  );

  const settingEntries = await AsyncStorage.multiGet(SETTINGS_ASYNC_STORAGE_KEYS as unknown as string[]);
  const settings: Record<string, string> = {};
  for (const [k, v] of settingEntries) {
    if (v !== null) settings[k] = v;
  }

  const data: ExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    decks,
    cards,
    tags,
    card_tags,
    reviews,
    review_logs,
    grade_logs,
    settings,
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
