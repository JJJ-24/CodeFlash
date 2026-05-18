import { LANG_LABELS } from './code-execution/constants';
import type { Block } from '@/types';

export function getCardPreview(blocks: Block[], imageLabel: string): string {
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = block.content.trim();
      if (text) return text;
      continue;
    }
    if (block.type === 'code') {
      const firstLine = block.content.split('\n')[0].trim();
      if (!firstLine) continue;
      const lang = LANG_LABELS[block.language] ?? block.language;
      return `[${lang}]\n${firstLine}`;
    }
    if (block.type === 'image') {
      const alt = block.alt?.trim();
      const label = `[${imageLabel}]`;
      return alt ? `${label}\n${alt}` : label;
    }
  }
  return '';
}
