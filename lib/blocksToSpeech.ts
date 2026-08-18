import type { Block } from '@/types';

/**
 * 049：ブロック配列を読み上げ用のプレーンテキストにする。
 *
 * カード本文は `Block[]`（Markdown テキスト／コード／画像）で、**そのまま読ませられる
 * プレーンテキストがどこにも無い**のが読み上げ実装の本体。ここが唯一の変換元。
 *
 * - **text** … Markdown 記法を落として読む（落とさないと `==g|重要==` の記法まで読まれる）
 * - **code** … **読まない**。`{` `=>` `;` を読み上げても意味がない
 * - **image** … `alt` があれば読む（無ければ何も足さない。「画像」と読み上げても情報が無いため）
 *
 * ⚠️ 結果が空文字になるカード（コードブロックだけのカードなど）がある。
 * 呼び出し側は**空なら読み上げボタン自体を出さない**こと（押しても無音＝
 * 「オンに見えるのに効いていない」状態になる）。
 */
export function blocksToSpeech(blocks: Block[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = stripMarkdown(block.content);
      if (text) parts.push(text);
    } else if (block.type === 'image') {
      const alt = block.alt?.trim();
      if (alt) parts.push(alt);
    }
    // code ブロックは読まない
  }
  return parts.join('\n');
}

/** ``` で始まる行（フェンス）。長さは可変（CommonMark 同様 3個以上） */
const RE_FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Markdown 記法を落として、読み上げに適した素の文章にする。
 *
 * 記法の対象は `BlocksView` が実際に解釈しているもの
 * （標準 Markdown ＋ `==ハイライト==`〈色プレフィックス付き〉＋ `++下線++`）。
 *
 * ⚠️ **アンダースコアの強調（`_em_` / `__strong__`）は落とさない**。
 * このアプリの本文には `snake_case` や `__init__` のような識別子が普通に出てくるので、
 * 強調として剥がすと単語が壊れる（`my_var_name` → `myvarname`）。
 * 記法として使いたいときはアスタリスクで書く、という割り切り。
 */
export function stripMarkdown(md: string): string {
  const lines: string[] = [];
  let fence: string | null = null;

  for (const rawLine of md.split('\n')) {
    const fenceMatch = RE_FENCE.exec(rawLine);
    if (fence) {
      // フェンスの中（コード）。閉じフェンスを見つけるまで丸ごと捨てる。
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) { fence = fenceMatch[1]; continue; }

    let line = rawLine;

    // 水平線（--- / *** / ___）は読み上げるものが無い。
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
    // 表の区切り行（|---|:--:|）も同様。
    if (/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')) continue;

    // 見出し・引用・リストの行頭記号を落とす（記号そのものは読み上げても意味がない）。
    line = line.replace(/^\s{0,3}#{1,6}\s+/, '');
    line = line.replace(/^\s*>+\s?/, '');
    line = line.replace(/^\s*([-*+]|\d+[.)])\s+/, '');
    // ⚠️ **ハイライトの色プレフィックス（`==g|…==`）を先に落とす**。
    // 下の表セル変換より後にすると、この `|` が表の区切りと誤認されて `、` に化け、
    // その結果 `==g|緑==` が「g、緑」と読まれる（検証で実際に踏んだ）。
    line = line.replace(/==([a-z])\|/g, '==');
    // 表のセル区切りは読点にして、行として自然に読めるようにする。
    if (line.includes('|')) line = line.replace(/\s*\|\s*/g, '、').replace(/^、|、$/g, '');

    lines.push(line);
  }

  let text = lines.join('\n');

  // 画像・リンクは表示テキストだけ残す（URL は読み上げると雑音にしかならない）。
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // linkify で自動リンク化される生 URL も落とす。
  text = text.replace(/https?:\/\/\S+/g, '');

  // インラインコードは中身を残す（`useEffect` のような語は読ませたい）。
  text = text.replace(/`+([^`]*)`+/g, '$1');
  // ==ハイライト==（==g|… の色プレフィックス付きを含む）・++下線++。
  // ⚠️ インライン記法は **行内に閉じる**（`[^\n]`）。`[\s\S]` にすると、閉じ忘れた記号1つで
  // 段落をまたいで巻き込み、本文が丸ごと消えることがある（例：「3 * 4」の掛け算記号）。
  text = text.replace(/==(?:[a-z]\|)?([^\n]*?)==/g, '$1');
  text = text.replace(/\+\+([^\n]*?)\+\+/g, '$1');
  // 強調・打ち消し（アスタリスクのみ。アンダースコアは識別子を壊すので触らない）。
  text = text.replace(/\*\*([^\n]*?)\*\*/g, '$1');
  text = text.replace(/\*([^\n]*?)\*/g, '$1');
  text = text.replace(/~~([^\n]*?)~~/g, '$1');

  // 空行の連続を1つにまとめ、行頭行末の空白を落とす。
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}
