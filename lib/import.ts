import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import { SETTINGS_ASYNC_STORAGE_KEYS } from './settings-keys';
import { hydrateSettings } from '@/store/settings';
import { hydrateTheme } from '@/store/theme';
import type { ExportData } from './export';

const IMAGE_DIR = FileSystem.documentDirectory + 'images/';
const CHUNK = 500;

async function bulkInsert(
  db: SQLiteDatabase,
  baseStmt: string,
  rows: (string | number | null)[][],
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map((row) => `(${row.map(() => '?').join(',')})` ).join(',');
    await db.runAsync(`${baseStmt} ${placeholders}`, chunk.flat());
  }
}

export async function importDatabase(db: SQLiteDatabase, fileUri: string, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  const json = await FileSystem.readAsStringAsync(fileUri, { encoding: 'utf8' });
  const data: ExportData = JSON.parse(json);

  if (data.version !== 1) {
    throw new Error('INVALID_VERSION');
  }
  if (
    !Array.isArray(data.decks) ||
    !Array.isArray(data.cards) ||
    !Array.isArray(data.tags) ||
    !Array.isArray(data.card_tags) ||
    !Array.isArray(data.reviews) ||
    (data.review_logs !== undefined && !Array.isArray(data.review_logs)) ||
    (data.grade_logs !== undefined && !Array.isArray(data.grade_logs))
  ) {
    throw new Error('INVALID_FORMAT');
  }

  await db.withTransactionAsync(async () => {
    if (mode === 'replace') {
      await db.runAsync('DELETE FROM grade_logs');
      await db.runAsync('DELETE FROM review_logs');
      await db.runAsync('DELETE FROM reviews');
      await db.runAsync('DELETE FROM card_tags');
      await db.runAsync('DELETE FROM card_contents');
      await db.runAsync('DELETE FROM cards');
      await db.runAsync('DELETE FROM decks');
      await db.runAsync('DELETE FROM tags');
    }

    await bulkInsert(
      db,
      'INSERT OR REPLACE INTO decks (id,name,description,language,cardCount,sortOrder,iconName,colorHex,archived,createdAt,updatedAt) VALUES',
      data.decks.map((d) => [
        d.id as string,
        d.name as string,
        (d.description as string) ?? '',
        (d.language as string) ?? 'ja',
        (d.cardCount as number) ?? 0,
        (d.sortOrder as number) ?? 0,
        (d.iconName as string | null) ?? null,
        (d.colorHex as string | null) ?? null,
        d.archived ? 1 : 0,
        d.createdAt as string,
        d.updatedAt as string,
      ])
    );

    await bulkInsert(
      db,
      'INSERT OR REPLACE INTO cards (id,deckId,sortOrder,archived,createdAt,updatedAt) VALUES',
      data.cards.map((c) => [
        c.id as string,
        c.deckId as string,
        (c.sortOrder as number) ?? 0,
        c.archived ? 1 : 0,
        c.createdAt as string,
        c.updatedAt as string,
      ])
    );

    await bulkInsert(
      db,
      'INSERT OR REPLACE INTO card_contents (cardId,frontContent,backContent,memoContent) VALUES',
      data.cards.map((c) => [
        c.id as string,
        (c.frontContent as string) ?? '[]',
        (c.backContent as string) ?? '[]',
        (c.memoContent as string) ?? '[]',
      ])
    );

    await bulkInsert(
      db,
      'INSERT OR REPLACE INTO tags (id,name,color,sortOrder,createdAt) VALUES',
      data.tags.map((t) => [
        t.id as string,
        t.name as string,
        (t.color as string) ?? '#888888',
        (t.sortOrder as number) ?? 0,
        t.createdAt as string,
      ])
    );

    await bulkInsert(
      db,
      'INSERT OR IGNORE INTO card_tags (cardId,tagId) VALUES',
      data.card_tags.map((ct) => [ct.cardId, ct.tagId])
    );

    // FSRS カラムを含めて全件インポート（旧エクスポートでは該当フィールドが undefined → null で挿入）
    await bulkInsert(
      db,
      'INSERT OR REPLACE INTO reviews (cardId,easeFactor,interval,repetitions,nextReviewDate,lastReviewDate,lastGrade,stability,difficulty,fsrsState,fsrsReps,fsrsLapses,fsrsScheduledDays) VALUES',
      data.reviews.map((r) => [
        r.cardId as string,
        (r.easeFactor as number) ?? 2.5,
        (r.interval as number) ?? 0,
        (r.repetitions as number) ?? 0,
        r.nextReviewDate as string,
        r.lastReviewDate as string,
        (r.lastGrade as number) ?? 2,
        (r.stability as number | undefined) ?? null,
        (r.difficulty as number | undefined) ?? null,
        (r.fsrsState as number | undefined) ?? null,
        (r.fsrsReps as number | undefined) ?? null,
        (r.fsrsLapses as number | undefined) ?? null,
        (r.fsrsScheduledDays as number | undefined) ?? null,
      ])
    );

    const logStmt = mode === 'replace'
      ? 'INSERT OR REPLACE INTO review_logs (cardId,reviewedDate) VALUES'
      : 'INSERT OR IGNORE INTO review_logs (cardId,reviewedDate) VALUES';
    await bulkInsert(
      db,
      logStmt,
      (data.review_logs ?? []).map((l) => [l.cardId, l.reviewedDate])
    );

    // grade_logs（responseTimeMs 含む）。id を保持してマージ時の重複を回避する
    const gradeStmt = mode === 'replace'
      ? 'INSERT OR REPLACE INTO grade_logs (id,cardId,grade,reviewedAt,responseTimeMs) VALUES'
      : 'INSERT OR IGNORE INTO grade_logs (id,cardId,grade,reviewedAt,responseTimeMs) VALUES';
    await bulkInsert(
      db,
      gradeStmt,
      (data.grade_logs ?? []).map((g) => [g.id, g.cardId, g.grade, g.reviewedAt, g.responseTimeMs ?? null])
    );
  });

  // AsyncStorage の設定値を復元（Pro ステータスは含まれない）
  if (data.settings && typeof data.settings === 'object') {
    const allowed = new Set<string>(SETTINGS_ASYNC_STORAGE_KEYS as unknown as string[]);
    const pairs: [string, string][] = [];
    for (const [k, v] of Object.entries(data.settings)) {
      if (allowed.has(k) && typeof v === 'string') pairs.push([k, v]);
    }
    if (pairs.length > 0) {
      await AsyncStorage.multiSet(pairs);
      // ストアを再 hydrate して UI に即時反映
      await Promise.all([hydrateTheme(), hydrateSettings()]);
    }
  }

  // 画像データが含まれる場合はファイルとして書き出す
  if (data.imageData && Object.keys(data.imageData).length > 0) {
    const dirInfo = await FileSystem.getInfoAsync(IMAGE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
    }
    for (const [filename, base64] of Object.entries(data.imageData)) {
      await FileSystem.writeAsStringAsync(IMAGE_DIR + filename, base64, { encoding: 'base64' });
    }
  }
}
