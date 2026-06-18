import type { Block, CodeBlock, TextBlock } from '@/types';

export type LinkItem = { text: string; url: string };

export function extractLinks(blocks: Block[]): LinkItem[] {
  const links: LinkItem[] = [];
  const seen = new Set<string>();
  // 生URL の終端に含めない文字。空白・閉じ括弧に加え、HTML（<a href="...">…</a>）や
  // 引用符・コードで URL の直後に来る " ' < > ] } ` も除外する。
  // これがないと https://apple.com">リンク</a> のように後続まで URL に取り込んでしまう。
  const urlTail = '[^\\s)"\'<>\\]}`]+';
  // markdown リンク [text](url) を先にマッチさせることで、括弧内の URL が生URLとして重複抽出されるのを防ぐ
  const combinedRe = new RegExp(`\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)|https?:\\/\\/${urlTail}`, 'g');
  const urlRe = new RegExp(`https?:\\/\\/${urlTail}`, 'g');
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
