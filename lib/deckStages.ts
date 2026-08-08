import type { DeckStage } from '@/types';

/**
 * 044：デッキの名前付き HTML/CSS 土台（`decks.htmlStages`）の永続化ヘルパー。
 *
 * **正となる持ち方は `htmlStages`（JSON 列）**で、旧 `decks.htmlInit`（単一土台）は
 * 互換用のミラーとして残っている。旧データの吸収は `normalizeDeckStages()` に集約し、
 * DB 層（`toDeck`）でだけ呼ぶ＝**画面・コンポーネントは `Deck.htmlStages` だけを見ればよい**。
 */

/** 旧 `decks.htmlInit`（単一土台）から合成する土台の固定 id。
 *  読み取りのたびに id が変わると、ブロック側の選択（`deckStageId`）や React の key が
 *  揺れてしまうため定数にする。 */
export const LEGACY_STAGE_ID = 'stage-legacy';

/** DB の JSON 文字列を `DeckStage[]` に戻す。壊れた JSON・想定外の形は空配列に倒す
 *  （土台が消えるだけで実行は成立する＝ここで例外を投げてデッキ読み込み全体を殺さない）。 */
export function parseDeckStages(raw: string | null | undefined): DeckStage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is DeckStage =>
        !!v &&
        typeof (v as DeckStage).id === 'string' &&
        typeof (v as DeckStage).name === 'string' &&
        typeof (v as DeckStage).html === 'string'
    );
  } catch {
    return [];
  }
}

/** `DeckStage[]` を DB 保存用の JSON 文字列にする。空配列は NULL（044 以前のデッキと同じ形）。 */
export function serializeDeckStages(stages: DeckStage[] | null | undefined): string | null {
  if (!stages || stages.length === 0) return null;
  return JSON.stringify(stages.map(({ id, name, html }) => ({ id, name, html })));
}

/** DB 行（`htmlStages` の JSON ＋ 旧 `htmlInit`）から土台一覧を正規化する。
 *  `htmlStages` が空で旧 `htmlInit` があるデッキは、それを1件の土台に合成して返す
 *  （名前は空＝UI 側で「土台1」と表示する。DB 層に i18n を持ち込まないため）。 */
export function normalizeDeckStages(
  rawStages: string | null | undefined,
  legacyHtmlInit: string | null | undefined
): DeckStage[] {
  const stages = parseDeckStages(rawStages);
  if (stages.length > 0) return stages;
  if (legacyHtmlInit && legacyHtmlInit.trim() !== '') {
    return [{ id: LEGACY_STAGE_ID, name: '', html: legacyHtmlInit }];
  }
  return [];
}

/** コードブロックが使うデッキ土台の HTML を解決する（044）。
 *
 * - `noDeckHtmlInit` が true → 積まない
 * - `deckStageId` 未指定 → **先頭の土台**（＝044 以前のカードの挙動）
 * - `deckStageId` が解決できない（土台が削除された）→ **積まない**
 *
 * 解決できないときに先頭へフォールバックしないのは、**別の土台が黙って適用されて出題の前提が
 * 変わる**のを避けるため。土台なしなら js/ts はコンソール実行に戻り html は本文だけになるので、
 * 作者が「土台が外れている」ことに気づける。
 *
 * Pro ゲートは呼び出し側の責任（非 Pro では本関数を呼ばずに空文字を使う）。 */
export function resolveDeckStageHtml(
  stages: DeckStage[] | null | undefined,
  block: { deckStageId?: string; noDeckHtmlInit?: boolean }
): string {
  if (block.noDeckHtmlInit) return '';
  const list = stages ?? [];
  if (block.deckStageId === undefined) return list[0]?.html ?? '';
  return list.find((s) => s.id === block.deckStageId)?.html ?? '';
}

/** 旧 `decks.htmlInit` へ書き戻すミラー値（＝先頭土台の HTML）。
 *  **旧バージョンのアプリはこの列しか読まない**ので、先頭土台だけは今までどおり動く。
 *  iCloud 同期は DB ファイルごと往復するため、この書き戻しを外すと旧端末で土台が消えて見える。 */
export function legacyHtmlInitMirror(stages: DeckStage[] | null | undefined): string | null {
  const html = stages?.[0]?.html;
  return html && html.trim() !== '' ? html : null;
}
