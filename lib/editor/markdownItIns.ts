// アンダーライン記法 `++text++`（HTML の <ins>）を markdown-it に追加するプラグイン。
// markdown-it-mark（`==text==` → <mark>）と同型で、マーカーを `+`（0x2B）・タグを ins に置換したもの。
// 依存追加を避けるためローカル実装する（mark と同じ「delimiter run」方式）。
// 使い方: MarkdownIt(...).use(markdownItIns)
/* eslint-disable @typescript-eslint/no-explicit-any */
export function markdownItIns(md: any) {
  function tokenize(state: any, silent: boolean) {
    const start = state.pos;
    const marker = state.src.charCodeAt(start);
    if (silent) return false;
    if (marker !== 0x2b /* + */) return false;

    const scanned = state.scanDelims(state.pos, true);
    let len = scanned.length;
    const ch = String.fromCharCode(marker);
    if (len < 2) return false;

    if (len % 2) {
      const token = state.push('text', '', 0);
      token.content = ch;
      len--;
    }
    for (let i = 0; i < len; i += 2) {
      const token = state.push('text', '', 0);
      token.content = ch + ch;
      if (!scanned.can_open && !scanned.can_close) continue;
      state.delimiters.push({
        marker,
        length: 0, // emphasis 用の「rule of 3」長さチェックを無効化
        jump: i / 2, // 1 delimiter = 2 文字
        token: state.tokens.length - 1,
        end: -1,
        open: scanned.can_open,
        close: scanned.can_close,
      });
    }
    state.pos += scanned.length;
    return true;
  }

  function postProcess(state: any, delimiters: any[]) {
    const loneMarkers: number[] = [];
    const max = delimiters.length;
    for (let i = 0; i < max; i++) {
      const startDelim = delimiters[i];
      if (startDelim.marker !== 0x2b /* + */) continue;
      if (startDelim.end === -1) continue;
      const endDelim = delimiters[startDelim.end];

      const token_o = state.tokens[startDelim.token];
      token_o.type = 'ins_open';
      token_o.tag = 'ins';
      token_o.nesting = 1;
      token_o.markup = '++';
      token_o.content = '';

      const token_c = state.tokens[endDelim.token];
      token_c.type = 'ins_close';
      token_c.tag = 'ins';
      token_c.nesting = -1;
      token_c.markup = '++';
      token_c.content = '';

      if (
        state.tokens[endDelim.token - 1].type === 'text' &&
        state.tokens[endDelim.token - 1].content === '+'
      ) {
        loneMarkers.push(endDelim.token - 1);
      }
    }

    // 奇数個のマーカー列は分割されて先頭に 1 個余るので、後続の ins_close の後ろへ移動する。
    while (loneMarkers.length) {
      const i = loneMarkers.pop() as number;
      let j = i + 1;
      while (j < state.tokens.length && state.tokens[j].type === 'ins_close') j++;
      j--;
      if (i !== j) {
        const token = state.tokens[j];
        state.tokens[j] = state.tokens[i];
        state.tokens[i] = token;
      }
    }
  }

  md.inline.ruler.before('emphasis', 'ins', tokenize);
  md.inline.ruler2.before('emphasis', 'ins', function (state: any) {
    const tokens_meta = state.tokens_meta;
    const max = (state.tokens_meta || []).length;
    postProcess(state, state.delimiters);
    for (let curr = 0; curr < max; curr++) {
      if (tokens_meta[curr] && tokens_meta[curr].delimiters) {
        postProcess(state, tokens_meta[curr].delimiters);
      }
    }
  });
}
