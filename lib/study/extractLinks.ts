import type { Block, CodeBlock, TextBlock } from '@/types';

export type LinkItem = { text: string; url: string };

export function extractLinks(blocks: Block[]): LinkItem[] {
  const links: LinkItem[] = [];
  const seen = new Set<string>();
  // markdown リンク [text](url) を先にマッチさせることで、括弧内の URL が生URLとして重複抽出されるのを防ぐ
  const combinedRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+/g;
  const urlRe = /https?:\/\/[^\s)]+/g;
  for (const block of blocks) {
    if (block.type === 'text') {
      const content = (block as TextBlock).content;
      let m: RegExpExecArray | null;
      combinedRe.lastIndex = 0;
      while ((m = combinedRe.exec(content)) !== null) {
        const url = m[2] ?? m[0];
        const text = m[1] ?? m[0];
        if (!seen.has(url)) { seen.add(url); links.push({ text, url }); }
      }
    } else if (block.type === 'code') {
      const content = (block as CodeBlock).content;
      let m: RegExpExecArray | null;
      urlRe.lastIndex = 0;
      while ((m = urlRe.exec(content)) !== null) {
        if (!seen.has(m[0])) { seen.add(m[0]); links.push({ text: m[0], url: m[0] }); }
      }
    }
  }
  return links;
}
