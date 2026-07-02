// 033 Phase7: ハイライト複数色。==g|文字== / ==p|文字== のように「== の直後に color1文字+|」を
// 置いて色を指定する（== のみ＝黄＝デフォルト＝後方互換）。この記法を解釈するのは mark トークンだけに
// 閉じた core ルールで、markdown-it-attrs のような全体的な {..} 解釈は使わない（コード本文の
// { } : ! % を誤爆させないため）。プレフィックスは表示から取り除き、色は mark_open の attr 'hl' に載せる。
//
// 使い方: MarkdownIt(...).use(markdownItMark).use(markdownItHighlightColor)
// 表示側は render rule の mark で node.attributes.hl（'g' | 'p' | undefined）を読んで背景色を選ぶ。

const HL_PREFIX = /^([gp])\|/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function markdownItHighlightColor(md: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.core.ruler.push('hl_color', (state: any) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue;
      const children = token.children;
      for (let i = 0; i < children.length; i++) {
        if (children[i].type !== 'mark_open') continue;
        // mark_open の直後の text トークン先頭に色プレフィックスがあれば attr に移し、本文からは削る。
        const next = children[i + 1];
        if (next && next.type === 'text') {
          const m = HL_PREFIX.exec(next.content);
          if (m) {
            children[i].attrSet('hl', m[1]);
            next.content = next.content.slice(m[0].length);
          }
        }
      }
    }
    return true;
  });
}
