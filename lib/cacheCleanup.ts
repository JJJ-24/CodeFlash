import * as FileSystem from 'expo-file-system/legacy';

// 書き出しファイルの名前（JSON＝lib/export.ts の exportDatabase・TSV＝lib/tsv.ts の exportDeckToTsv）。
// どちらも cacheDirectory の直下に「日時_時刻」付きで置く。
const EXPORT_FILE_PATTERNS = [/^CF_\d{8}_\d{6}\.json$/, /_\d{8}_\d{6}\.tsv$/];

// ライブラリが選んだファイルの一時コピーを置くフォルダ（cacheDirectory 直下）。
// - DocumentPicker：インポートで選んだ JSON/TSV（copyToCacheDirectory）＝読み込んだら使わない
// - ImagePicker：選んだ写真＝pickAndSaveImage が images/ へコピーし終えたら使わない
// どちらもライブラリは消さない（実機の iPhone で 59MB＋22MB 溜まっていた）。
const PICKER_CACHE_DIRS = ['DocumentPicker', 'ImagePicker'];

/**
 * キャッシュに残った使い終わりのファイルを消す（起動時に呼ぶ）。
 * Library/Caches は iOS が空き容量の不足時にしか消さないので、それまでアプリの容量に数えられ続ける。
 * 起動の直後は書き出し・ファイル選択・写真選択のどれも動いていない＝使用中のファイルを消すことはない。
 * ⚠️ WebKit（Pyodide 等）と画像表示のキャッシュには触れない＝消すと次の実行・表示で取り直しになる。
 */
export async function cleanupCacheLeftovers(): Promise<void> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;
  // 書き出しは共有シートを閉じた時点で消しているが、共有中に落ちた分・修正前の分を回収する
  const names = await FileSystem.readDirectoryAsync(dir);
  for (const name of names) {
    if (!EXPORT_FILE_PATTERNS.some((re) => re.test(name))) continue;
    await FileSystem.deleteAsync(dir + name, { idempotent: true }).catch(() => {});
  }
  for (const sub of PICKER_CACHE_DIRS) {
    await FileSystem.deleteAsync(dir + sub, { idempotent: true }).catch(() => {});
  }
}
