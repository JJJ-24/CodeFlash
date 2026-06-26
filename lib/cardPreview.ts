import { LANG_LABELS } from './code-execution/constants';
import type { Block } from '@/types';

/**
 * ブロック1個をプレビュー用の行配列にする（内容が空なら空配列）。
 * - text: 空行を除いた各行
 * - code: `[言語]` と コード1行目（コード本文が空なら空配列）
 * - image: `[画像]` と alt（uri が無ければ空配列）
 */
function blockPreviewLines(block: Block, imageLabel: string): string[] {
  if (block.type === 'text') {
    return block.content.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  }
  if (block.type === 'code') {
    const firstLine = block.content.split('\n')[0]?.trim() ?? '';
    if (!firstLine) return [];
    const lang = LANG_LABELS[block.language] ?? block.language;
    return [`[${lang}]`, firstLine];
  }
  if (block.type === 'image') {
    if (!block.uri) return [];
    const alt = block.alt?.trim();
    return alt ? [`[${imageLabel}]`, alt] : [`[${imageLabel}]`];
  }
  return [];
}

// blocks 配列の参照をキーにプレビュー結果をキャッシュする。カード一覧のソート/フィルタ
// 切替は同じカードオブジェクトを並べ替えるだけで frontContent の参照は変わらないため、
// 再描画のたびに解析し直さずキャッシュヒットで済む（編集すると新しい配列になり自動失効）。
// imageLabel（言語依存）が変わったときだけ再計算する。
const previewCache = new WeakMap<Block[], { label: string; value: string }>();

/**
 * カード一覧などで使う最大2行のプレビュー文字列を生成する（結果は blocks 参照でメモ化）。
 * 最初の非空ブロック（主ブロック）を基準にし、
 * - 主ブロックだけで2行ぶんあればその先頭2行を使う
 * - 主ブロックがテキストで1行だけのときは、次の非空ブロックの先頭行を2行目に補う
 *   （テキスト→先頭行、コード→`[言語]`、画像→`[画像]`）
 */
export function getCardPreview(blocks: Block[], imageLabel: string): string {
  const cached = previewCache.get(blocks);
  if (cached && cached.label === imageLabel) return cached.value;
  const value = computeCardPreview(blocks, imageLabel);
  previewCache.set(blocks, { label: imageLabel, value });
  return value;
}

function computeCardPreview(blocks: Block[], imageLabel: string): string {
  let primaryIdx = -1;
  let primaryLines: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const lines = blockPreviewLines(blocks[i], imageLabel);
    if (lines.length > 0) {
      primaryIdx = i;
      primaryLines = lines;
      break;
    }
  }
  if (primaryIdx === -1) return '';

  // 主ブロックだけで2行ぶんあればそれを使う。
  if (primaryLines.length >= 2) return primaryLines.slice(0, 2).join('\n');

  // 主ブロックがテキストで1行だけのときは、次の非空ブロックの先頭行を2行目に補う。
  if (blocks[primaryIdx].type === 'text') {
    for (let j = primaryIdx + 1; j < blocks.length; j++) {
      const lines = blockPreviewLines(blocks[j], imageLabel);
      if (lines.length > 0) return `${primaryLines[0]}\n${lines[0]}`;
    }
  }
  return primaryLines[0];
}
