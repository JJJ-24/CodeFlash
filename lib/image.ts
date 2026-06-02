import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import type { SQLiteDatabase } from 'expo-sqlite';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

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

/** DB 上の全カードから参照されている画像ファイル名（`local://images/` の後ろ）を収集する。
 *  `from` に `'bkimg.card_contents'` 等を渡すと ATTACH したバックアップDBの参照も集計できる（029）。 */
export async function getReferencedImageFilenames(
  db: SQLiteDatabase,
  from = 'card_contents',
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ frontContent: string; backContent: string; memoContent: string }>(
    `SELECT frontContent, backContent, memoContent FROM ${from}`
  );
  const referencedFilenames = new Set<string>();
  for (const row of rows) {
    for (const json of [row.frontContent, row.backContent, row.memoContent]) {
      try {
        const blocks = JSON.parse(json) as { type: string; uri?: string }[];
        for (const block of blocks) {
          if (block.type === 'image' && block.uri?.startsWith('local://images/')) {
            referencedFilenames.add(block.uri.slice('local://images/'.length));
          }
        }
      } catch {}
    }
  }
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
        const refs = await getReferencedImageFilenames(db, 'bkimg.card_contents');
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
