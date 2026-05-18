import { LANG_LABELS } from './code-execution/constants';
import type { Block, CodeBlock, ImageBlock, TextBlock } from '@/types';

export function getCardPreview(blocks: Block[], imageLabel: string): string {
  // 上から順に走査し、最初に内容のあるブロックを返す
  // 空のテキストブロックはスキップ
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = (block as TextBlock).content.trim();
      if (text) return text;
      continue;
    }
    if (block.type === 'code') {
      const { language, content } = block as CodeBlock;
      const lang = LANG_LABELS[language] ?? language;
      const firstLine = content.split('\n')[0].trim();
      return firstLine ? `[${lang}]\n${firstLine}` : `[${lang}]`;
    }
    if (block.type === 'image') {
      const alt = (block as ImageBlock).alt?.trim();
      const label = `[${imageLabel}]`;
      return alt ? `${label}\n${alt}` : label;
    }
  }
  return '';
}
