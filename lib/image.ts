import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import i18n from '@/lib/i18n';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

const IMAGE_DIR = FileSystem.documentDirectory + 'images/';

async function ensureImageDir() {
  const info = await FileSystem.getInfoAsync(IMAGE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
  }
}

/** フォトライブラリから画像を選択してアプリストレージにコピーする。
 *  戻り値: `local://images/{uuid}.{ext}` 形式の URI。キャンセル時は null。 */
export async function pickAndSaveImage(): Promise<string | null> {
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
    Alert.alert(
      i18n.t('card.imageSizeErrorTitle'),
      i18n.t('card.imageSizeError')
    );
    return null;
  }

  const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const uuid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const filename = `${uuid}.${ext}`;

  await ensureImageDir();
  await FileSystem.copyAsync({ from: asset.uri, to: IMAGE_DIR + filename });

  return `local://images/${filename}`;
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

/** DBに登録されていない孤立画像ファイルを検出して削除する */
export async function cleanupOrphanImages(db: SQLiteDatabase): Promise<void> {
  // images/ ディレクトリが存在しなければ何もしない
  const dirInfo = await FileSystem.getInfoAsync(IMAGE_DIR);
  if (!dirInfo.exists) return;

  // DB 上の全カードから参照されている画像ファイル名を収集
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

  // ディレクトリ内のファイルのうち参照されていないものを削除
  const files = await FileSystem.readDirectoryAsync(IMAGE_DIR);
  const orphans = files.filter((filename) => !referencedFilenames.has(filename));
  await Promise.all(
    orphans.map((filename) => FileSystem.deleteAsync(IMAGE_DIR + filename, { idempotent: true }))
  );
}
