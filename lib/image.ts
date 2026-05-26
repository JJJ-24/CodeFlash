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

/** DB 上の全カードから参照されている画像ファイル名（`local://images/` の後ろ）を収集する。 */
export async function getReferencedImageFilenames(db: SQLiteDatabase): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ frontContent: string; backContent: string; memoContent: string }>(
    'SELECT frontContent, backContent, memoContent FROM card_contents'
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

/** DBに登録されていない孤立画像ファイルを検出して削除する */
export async function cleanupOrphanImages(db: SQLiteDatabase): Promise<void> {
  // images/ ディレクトリが存在しなければ何もしない
  const dirInfo = await FileSystem.getInfoAsync(IMAGE_DIR);
  if (!dirInfo.exists) return;

  const referencedFilenames = await getReferencedImageFilenames(db);

  // ディレクトリ内のファイルのうち参照されていないものを削除
  const files = await FileSystem.readDirectoryAsync(IMAGE_DIR);
  const orphans = files.filter((filename) => !referencedFilenames.has(filename));
  await Promise.all(
    orphans.map((filename) => FileSystem.deleteAsync(IMAGE_DIR + filename, { idempotent: true }))
  );
}
