import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { DeckImage } from '@/types';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

/** 画像ブロックの表示サイズ（最大幅 px プリセット）。実際の表示幅は min(この値, 利用可能幅) で
 *  クランプする。iPhone は幅が狭く大きい値が全部「全幅」に潰れて差が出ないため、端末ごとに px を
 *  分ける（iPhone は 3 段階が全部 端末幅未満で差が出るよう小さめ、iPad は大きめだが全幅にはしない）。
 *  数値は端末で見ながら微調整する想定。既定は 'M'。 */
export type ImageSizeKey = 'S' | 'M' | 'L';
const IMAGE_SIZE_MAX_WIDTH_PHONE: Record<ImageSizeKey, number> = { S: 150, M: 240, L: 330 };
const IMAGE_SIZE_MAX_WIDTH_IPAD: Record<ImageSizeKey, number> = { S: 280, M: 420, L: 560 };
export const DEFAULT_IMAGE_SIZE: ImageSizeKey = 'M';
export const imageMaxWidth = (size?: ImageSizeKey): number => {
  const table = (Platform as any).isPad ? IMAGE_SIZE_MAX_WIDTH_IPAD : IMAGE_SIZE_MAX_WIDTH_PHONE;
  return table[size ?? DEFAULT_IMAGE_SIZE];
};

export type PickAndSaveImageResult =
  | { uri: string }
  | { error: 'tooLarge' };

/** ローカル画像の保存ディレクトリ（`local://images/xxx` の実体）。iCloud 同期も参照する。 */
export const IMAGE_DIR = FileSystem.documentDirectory + 'images/';

/** images/ ディレクトリが無ければ作成する（同期エンジンからも使う）。 */
export async function ensureImageDir() {
  const info = await FileSystem.getInfoAsync(IMAGE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
  }
}

/** フォトライブラリから画像を選択してアプリストレージにコピーする。
 *  戻り値: 成功時 `{ uri }`（`local://images/{uuid}.{ext}` 形式）、サイズ超過時 `{ error: 'tooLarge' }`、キャンセル/権限なしは null。 */
export async function pickAndSaveImage(): Promise<PickAndSaveImageResult | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    allowsEditing: false,
  });

  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];

  if (asset.fileSize && asset.fileSize > MAX_IMAGE_BYTES) {
    return { error: 'tooLarge' };
  }

  const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const uuid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const filename = `${uuid}.${ext}`;

  await ensureImageDir();
  await FileSystem.copyAsync({ from: asset.uri, to: IMAGE_DIR + filename });

  return { uri: `local://images/${filename}` };
}

/** `local://images/xxx.jpg` → 実際のファイルシステム URI に変換する */
export function resolveImageUri(localUri: string): string {
  if (localUri.startsWith('local://images/')) {
    const filename = localUri.slice('local://images/'.length);
    return IMAGE_DIR + filename;
  }
  return localUri;
}

/** ローカル保存画像を削除する */
export async function deleteImage(localUri: string): Promise<void> {
  if (!localUri.startsWith('local://images/')) return;
  const fsUri = resolveImageUri(localUri);
  const info = await FileSystem.getInfoAsync(fsUri);
  if (info.exists) {
    await FileSystem.deleteAsync(fsUri, { idempotent: true });
  }
}

/** ブロック配列から画像URIをすべて抽出して削除する */
export async function deleteImagesInBlocks(blocks: { type: string; uri?: string }[]): Promise<void> {
  await Promise.all(
    blocks
      .filter((b) => b.type === 'image' && b.uri)
      .map((b) => deleteImage(b.uri!))
  );
}

/** `decks.htmlImages`（JSON文字列）を `DeckImage[]` へ正規化する（043）。
 *  NULL・壊れた JSON・非配列・欠けた要素はすべて捨てて `[]` に倒す（表示側で例外を出さないため）。 */
export function parseDeckImages(raw: string | null | undefined): DeckImage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is DeckImage =>
        !!v && typeof (v as DeckImage).name === 'string' && typeof (v as DeckImage).uri === 'string'
    );
  } catch {
    return [];
  }
}

/** `DeckImage[]` を DB 保存用の JSON 文字列にする（043）。空配列は NULL（既存デッキと同じ形）。 */
export function serializeDeckImages(images: DeckImage[] | null | undefined): string | null {
  if (!images || images.length === 0) return null;
  return JSON.stringify(images.map(({ name, uri }) => ({ name, uri })));
}

/** DB 上のユーザーデータから参照されている画像ファイル名（`local://images/` の後ろ）を収集する。
 *
 *  **参照元は2系統ある（043 で追加）**：
 *  1. `card_contents` の image ブロック（画像ブロック）
 *  2. `decks.htmlImages` の HTML 画像ライブラリ
 *
 *  この集合に入らないファイルは `cleanupOrphanImages` に削除され、iCloud 同期の対象にもならない
 *  （`lib/sync/syncEngine.ts` の上り/下り/リモート整理が本関数を使う）。**新しい画像の持ち方を
 *  増やしたら必ずここに足すこと。**
 *
 *  `schema` に `'bkimg.'` を渡すと ATTACH したバックアップDBの参照も集計できる（029）。 */
export async function getReferencedImageFilenames(
  db: SQLiteDatabase,
  schema = '',
): Promise<Set<string>> {
  const referencedFilenames = new Set<string>();
  const addUri = (uri?: string) => {
    if (uri?.startsWith('local://images/')) referencedFilenames.add(uri.slice('local://images/'.length));
  };

  const rows = await db.getAllAsync<{ frontContent: string; backContent: string; memoContent: string }>(
    `SELECT frontContent, backContent, memoContent FROM ${schema}card_contents`
  );
  for (const row of rows) {
    for (const json of [row.frontContent, row.backContent, row.memoContent]) {
      try {
        const blocks = JSON.parse(json) as { type: string; uri?: string }[];
        for (const block of blocks) {
          if (block.type === 'image') addUri(block.uri);
        }
      } catch {}
    }
  }

  // HTML 画像ライブラリ（043）。古いバックアップDBには htmlImages 列が無く SELECT が落ちるため、
  // ここだけ握り潰してカード側の集計は活かす（列が無い＝ライブラリ未使用の世代なので取りこぼしも無い）。
  try {
    const deckRows = await db.getAllAsync<{ htmlImages: string | null }>(
      `SELECT htmlImages FROM ${schema}decks`
    );
    for (const row of deckRows) {
      for (const image of parseDeckImages(row.htmlImages)) addUri(image.uri);
    }
  } catch {}

  return referencedFilenames;
}

/**
 * 保持中の自動バックアップが参照する画像ファイル名を集計する（029 案B）。
 * 各バックアップDBを ATTACH して card_contents を走査する。1世代の失敗で全体を止めない。
 */
async function getBackupReferencedImageFilenames(
  db: SQLiteDatabase,
  backupPaths: string[],
): Promise<Set<string>> {
  const all = new Set<string>();
  for (const path of backupPaths) {
    const escaped = path.replace(/^file:\/\//, '').replace(/'/g, "''");
    try {
      await db.execAsync(`ATTACH DATABASE '${escaped}' AS bkimg;`);
      try {
        const refs = await getReferencedImageFilenames(db, 'bkimg.');
        refs.forEach((f) => all.add(f));
      } finally {
        await db.execAsync('DETACH DATABASE bkimg;');
      }
    } catch {
      // 1世代の走査失敗（古いスキーマ・破損等）で掃除全体を止めない
    }
  }
  return all;
}

/**
 * DBに登録されていない孤立画像ファイルを検出して削除する。
 * 029: `backupPaths` を渡すと「ライブDB ∪ 保持中バックアップが参照する画像」を温存し、
 * デッキ単位マージ復元のために負けたデッキの画像を消さない（案B）。
 */
export async function cleanupOrphanImages(
  db: SQLiteDatabase,
  backupPaths: string[] = [],
): Promise<void> {
  // images/ ディレクトリが存在しなければ何もしない
  const dirInfo = await FileSystem.getInfoAsync(IMAGE_DIR);
  if (!dirInfo.exists) return;

  const referencedFilenames = await getReferencedImageFilenames(db);
  // 保持中バックアップが参照する画像も温存対象に加える（マージ復元の素材を残す）。
  const backupReferenced = await getBackupReferencedImageFilenames(db, backupPaths);

  // ディレクトリ内のファイルのうち、ライブ・バックアップどちらからも参照されていないものを削除
  const files = await FileSystem.readDirectoryAsync(IMAGE_DIR);
  const orphans = files.filter(
    (filename) => !referencedFilenames.has(filename) && !backupReferenced.has(filename)
  );
  await Promise.all(
    orphans.map((filename) => FileSystem.deleteAsync(IMAGE_DIR + filename, { idempotent: true }))
  );
}
