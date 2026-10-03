import { pagesFromDeckStages } from '@/lib/deckStages';
import type { CodeBlock, DeckStage } from '@/types';

/**
 * 058：コードブロックの中で J/K が止まる「あったり無かったりする」項目。
 * 並びは画面の上から順（`CodeBlockItem` の描画順と同じ）。
 */
export type CodeSubStop = 'sqlInit' | 'sqlStage' | 'htmlInit' | 'htmlStage' | 'previewInit' | 'pyPages' | PyPageStop;

/** 059：「デッキのページ」の一覧の i 番目の URL（一覧が**開いているときだけ**止まる） */
export type PyPageStop = `pyPage:${number}`;

/** 止まり先が「デッキのページ」の URL なら、その番号（それ以外は null） */
export function pyPageIndexOf(sub: CodeSubStop | null | undefined): number | null {
  if (!sub || !sub.startsWith('pyPage:')) return null;
  const n = Number(sub.slice('pyPage:'.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** 土台（HTML/CSS）を積む web 系の言語か */
export function isWebLanguage(language: string): boolean {
  return language === 'html' || language === 'javascript' || language === 'typescript' || language === 'css';
}

/**
 * 選択中のデッキ土台の id。選択 id 未指定なら先頭。
 * **「使わない」と、削除済みの id を指しているときは null**（効果としては土台なし）。
 */
export function activeDeckStageId(stages: DeckStage[], off: boolean | undefined, selectedId: string | undefined): string | null {
  if (off) return null;
  return stages.find((st) => st.id === (selectedId ?? stages[0]?.id))?.id ?? null;
}

/**
 * 058：そのブロックで表示されている止まり先（編集モード・折りたたみでないとき）。
 * ⚠️ 表示条件は `CodeBlockItem` の各セクションと同じにしておく（ずれると見えない項目に止まる／見える項目に止まらない）。
 */
export function codeBlockSubStops(
  block: CodeBlock,
  { isPro, htmlStages, sqlStages, pyPagesExpanded }: { isPro: boolean; htmlStages: DeckStage[]; sqlStages: DeckStage[]; pyPagesExpanded?: boolean },
): CodeSubStop[] {
  if (!isPro) return [];
  const web = isWebLanguage(block.language);
  const sql = block.language === 'sql';
  const stops: CodeSubStop[] = [];
  // 本文から近い順＝強い順（ブロック → デッキ）。SQL も HTML/CSS も同じ並び
  if (sql) stops.push('sqlInit');
  if (sql && sqlStages.length > 0) stops.push('sqlStage');
  if (web) stops.push('htmlInit');
  if (web && htmlStages.length > 0) stops.push('htmlStage');
  if (block.language === 'html') stops.push('previewInit');
  // 059：Python の「デッキのページ」（URL 名の土台があるときだけ出る）。**一覧が開いているときだけ**中の URL にも止まる
  // ＝閉じていれば見出しで1回止まるだけ（ふだんの J の手数は増えない・053 の「折りたたんだ中身は飛ばす」と同じ）
  if (block.language === 'python') {
    const pages = pagesFromDeckStages(htmlStages);
    if (pages.length > 0) {
      stops.push('pyPages');
      if (pyPagesExpanded) pages.forEach((_, i) => stops.push(`pyPage:${i}`));
    }
  }
  return stops;
}
