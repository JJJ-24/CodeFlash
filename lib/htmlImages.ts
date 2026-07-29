import * as FileSystem from 'expo-file-system/legacy';

import type { DeckImage } from '@/types';
import { resolveImageUri } from './image';

/**
 * HTML 画像ライブラリ（043）の参照解決。
 *
 * カード本文・HTML 土台に書かれた `img://{name}` を、実行の直前に data URI へ置換する。
 * **DB には短い `img://name` しか保存されない**（base64 はここで作るメモリ上の一時物）ため、
 * エクスポート・iCloud 同期・エディタの入力欄が画像データで膨らまない。
 *
 * 置換はただの文字列置換なので `<img src>` でも CSS の `url()` でも同じように効く。
 * サンドボックス（`lib/code-execution/sandbox.ts`）側は一切変更しない。
 */

/** 参照名に使える文字。正規表現置換の境界を明確にするため記号は `_` と `-` のみに絞る
 *  （日本語やスペースを許すと CSS の `url()` 内などで終端判定が曖昧になる）。 */
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** `img://name` を拾う正規表現。`/g` の `lastIndex` 事故を避けるため毎回新しく作る。 */
const refPattern = () => /img:\/\/([A-Za-z0-9_-]+)/g;

/** base64 data URI のメモリキャッシュ（key: `local://images/xxx.jpg`）。
 *  実行前プレビューは土台編集の 400ms デバウンスごとに再構築されるため、
 *  キャッシュが無いと打鍵のたびに画像ファイルを読み直すことになる。 */
const dataUriCache = new Map<string, string>();

/** キャッシュの保持上限（枚）。1枚あたり base64 で最大 1.4MB 程度になりうるため、
 *  際限なく持たないように挿入順で古いものから捨てる。 */
const MAX_CACHE_ENTRIES = 12;

/** 画像参照を含みうるかの**同期**判定。`resolveHtmlImageRefs` は async なので、
 *  含まないとき（＝ほぼ全てのカード）に await を挟まず従来どおり同期で処理を進めるために使う。
 *  誤検出しても解決側が名前無しを非マッチにするため実害はない。 */
export function hasImageRefs(html: string): boolean {
  return html.includes('img://');
}

/** 参照名が使える形式か（Phase 5 の入力バリデーションと定義を共有する）。 */
export function isValidImageName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/** UI から「参照をコピー」するときの文字列（構文の定義元をここに集約する）。 */
export function buildImageRef(name: string): string {
  return `img://${name}`;
}

/** UI から「タグをコピー」するときの文字列。 */
export function buildImageTag(name: string): string {
  return `<img src="${buildImageRef(name)}">`;
}

/** 拡張子から MIME を決める。登録時に png / jpg へ正規化されている（043 Phase 2）が、
 *  手動で置かれたファイルや将来の拡張に備えて主要形式は拾えるようにしておく。 */
function mimeFromUri(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'image/jpeg';
  }
}

/** 画像が見つからないときに描く代替画像。`img://name` をそのまま表示するので、
 *  「壊れた画像アイコン」と違ってどの参照が外れているか一目で分かる。
 *  `encodeURIComponent` で包むため `"` や `#` を含んでも属性値・`url()` の中で壊れない。 */
function placeholderDataUri(name: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120">` +
    `<rect x="1" y="1" width="238" height="118" rx="8" fill="#E5E7EB" stroke="#9CA3AF" stroke-width="2" stroke-dasharray="6 4"/>` +
    `<text x="120" y="66" text-anchor="middle" font-family="monospace" font-size="14" fill="#6B7280">img://${name}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** ローカル画像を data URI 化する（キャッシュ付き）。読めなければ null。 */
async function toDataUri(localUri: string): Promise<string | null> {
  const cached = dataUriCache.get(localUri);
  if (cached) return cached;
  try {
    const base64 = await FileSystem.readAsStringAsync(resolveImageUri(localUri), { encoding: 'base64' });
    const dataUri = `data:${mimeFromUri(localUri)};base64,${base64}`;
    if (dataUriCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = dataUriCache.keys().next().value;
      if (oldest !== undefined) dataUriCache.delete(oldest);
    }
    dataUriCache.set(localUri, dataUri);
    return dataUri;
  } catch {
    return null; // ファイルが無い／読めない → プレースホルダに倒す
  }
}

/** キャッシュを捨てる。画像を削除・差し替えたときに呼ぶ（引数省略で全消し）。 */
export function invalidateHtmlImageCache(localUri?: string): void {
  if (localUri) dataUriCache.delete(localUri);
  else dataUriCache.clear();
}

/**
 * HTML 中の `img://{name}` をすべて data URI に置換する。
 * 参照が 1 つも無ければ**ファイルを一切読まずに即返す**（通常のカードに I/O を足さない）。
 * 解決できない参照はプレースホルダ画像に置換する（実行を止めない）。
 */
export async function resolveHtmlImageRefs(html: string, images: DeckImage[]): Promise<string> {
  if (!html) return html;

  const names = new Set<string>();
  for (const match of html.matchAll(refPattern())) names.add(match[1]);
  if (names.size === 0) return html;

  const uriByName = new Map(images.map((image) => [image.name, image.uri]));
  const replacements = new Map<string, string>();
  for (const name of names) {
    const uri = uriByName.get(name);
    const dataUri = uri ? await toDataUri(uri) : null;
    replacements.set(name, dataUri ?? placeholderDataUri(name));
  }

  return html.replace(refPattern(), (whole, name: string) => replacements.get(name) ?? whole);
}
