import type { DeckStage } from '@/types';

/**
 * 044/045：デッキの名前付き土台の永続化ヘルパー。
 * **HTML/CSS 土台（`decks.htmlStages`）と SQL 初期化（`decks.sqlStages`）で共通**に使う
 * （持ち方・旧データの吸収・解決規則がまったく同じで、違うのは中身の言語と参照するブロック側の
 * フィールド名だけ。差分は `resolveDeckStageHtml` / `resolveDeckStageSql` の薄いラッパーに閉じる）。
 *
 * **正となる持ち方は `htmlStages` / `sqlStages`（JSON 列）**で、旧 `decks.htmlInit` / `decks.sqlInit`
 * （単一土台）は互換用のミラーとして残っている。旧データの吸収は `normalizeDeckStages()` に集約し、
 * DB 層（`toDeck`）でだけ呼ぶ＝**画面・コンポーネントは配列だけを見ればよい**。
 */

/** 旧 `decks.htmlInit` / `decks.sqlInit`（単一土台）から合成する土台の固定 id。
 *  読み取りのたびに id が変わると、ブロック側の選択（`deckStageId`）や React の key が
 *  揺れてしまうため定数にする。HTML と SQL で同じ値でよい（参照はデッキ内の同じ配列に閉じるため）。 */
export const LEGACY_STAGE_ID = 'stage-legacy';

/** DB の JSON 文字列を `DeckStage[]` に戻す。壊れた JSON・想定外の形は空配列に倒す
 *  （土台が消えるだけで実行は成立する＝ここで例外を投げてデッキ読み込み全体を殺さない）。
 *
 *  ⚠️ **旧キー `html` を吸収する**：044 の初期実装は中身のキーが `html` だった（045 で HTML/SQL 共通の
 *  `content` に統一）。読み取り側でだけ吸収すれば、書き戻しの瞬間に新キーへ移るのでデータ移行は要らない。 */
export function parseDeckStages(raw: string | null | undefined): DeckStage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const stages: DeckStage[] = [];
    for (const v of parsed) {
      if (!v || typeof v !== 'object') continue;
      const row = v as { id?: unknown; name?: unknown; content?: unknown; html?: unknown };
      // 044 初期実装の `html` キーをここで吸収する（この関数がキー名を知る唯一の場所）
      const content = typeof row.content === 'string' ? row.content : typeof row.html === 'string' ? row.html : null;
      if (typeof row.id !== 'string' || typeof row.name !== 'string' || content === null) continue;
      stages.push({ id: row.id, name: row.name, content });
    }
    return stages;
  } catch {
    return [];
  }
}

/** `DeckStage[]` を DB 保存用の JSON 文字列にする。空配列は NULL（044/045 以前のデッキと同じ形）。 */
export function serializeDeckStages(stages: DeckStage[] | null | undefined): string | null {
  if (!stages || stages.length === 0) return null;
  return JSON.stringify(stages.map(({ id, name, content }) => ({ id, name, content })));
}

/** DB 行（土台の JSON ＋ 旧単一土台の列）から土台一覧を正規化する。
 *  JSON が空で旧列（`htmlInit` / `sqlInit`）があるデッキは、それを1件の土台に合成して返す
 *  （名前は空＝UI 側で「土台N」と表示する。DB 層に i18n を持ち込まないため）。 */
export function normalizeDeckStages(
  rawStages: string | null | undefined,
  legacyInit: string | null | undefined
): DeckStage[] {
  const stages = parseDeckStages(rawStages);
  if (stages.length > 0) return stages;
  if (legacyInit && legacyInit.trim() !== '') {
    return [{ id: LEGACY_STAGE_ID, name: '', content: legacyInit }];
  }
  return [];
}

/** 土台の解決規則（HTML/SQL 共通の本体）。
 *
 * - `skip` が true → 積まない
 * - `stageId` 未指定 → **先頭の土台**（＝044/045 以前のカードの挙動）
 * - `stageId` が解決できない（土台が削除された）→ **積まない**
 *
 * 解決できないときに先頭へフォールバックしないのは、**別の土台が黙って適用されて出題の前提が
 * 変わる**のを避けるため。土台なしなら js/ts はコンソール実行に戻り、html は本文だけ、SQL は
 * 初期化なしの素の DB になるので、作者が「土台が外れている」ことに気づける。 */
function resolveStage(
  stages: DeckStage[] | null | undefined,
  stageId: string | undefined,
  skip: boolean | undefined
): string {
  if (skip) return '';
  const list = stages ?? [];
  if (stageId === undefined) return list[0]?.content ?? '';
  return list.find((s) => s.id === stageId)?.content ?? '';
}

/** コードブロックが使うデッキ HTML/CSS 土台を解決する（044）。
 *  Pro ゲートは呼び出し側の責任（非 Pro では本関数を呼ばずに空文字を使う）。 */
export function resolveDeckStageHtml(
  stages: DeckStage[] | null | undefined,
  block: { deckStageId?: string; noDeckHtmlInit?: boolean }
): string {
  return resolveStage(stages, block.deckStageId, block.noDeckHtmlInit);
}

/** コードブロックが使うデッキ SQL 初期化を解決する（045）。
 *  SQL は言語自体が Pro 限定（`PRO_LANGUAGES`）＝実行ゲートで止まるので、ここに Pro 判定は要らない。 */
export function resolveDeckStageSql(
  stages: DeckStage[] | null | undefined,
  block: { deckSqlStageId?: string; noDeckSqlInit?: boolean }
): string {
  return resolveStage(stages, block.deckSqlStageId, block.noDeckSqlInit);
}

/** 旧単一土台の列（`decks.htmlInit` / `decks.sqlInit`）へ書き戻すミラー値（＝先頭土台の中身）。
 *  **旧バージョンのアプリはこの列しか読まない**ので、先頭土台だけは今までどおり動く。
 *  iCloud 同期は DB ファイルごと往復するため、この書き戻しを外すと旧端末で土台が消えて見える。 */
export function legacyInitMirror(stages: DeckStage[] | null | undefined): string | null {
  const content = stages?.[0]?.content;
  return content && content.trim() !== '' ? content : null;
}
