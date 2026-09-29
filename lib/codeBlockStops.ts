import type { CodeBlock, DeckStage } from '@/types';

/**
 * 058：コードブロックの中で J/K が止まる「あったり無かったりする」項目。
 * 並びは画面の上から順（`CodeBlockItem` の描画順と同じ）。
 */
export type CodeSubStop = 'sqlInit' | 'sqlStage' | 'htmlInit' | 'htmlStage' | 'previewInit';

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
  { isPro, htmlStages, sqlStages }: { isPro: boolean; htmlStages: DeckStage[]; sqlStages: DeckStage[] },
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
  return stops;
}
