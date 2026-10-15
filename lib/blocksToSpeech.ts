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

  text = speakParens(text);

  // 空行の連続を1つにまとめ、行頭行末の空白を落とす。
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

/** 半角の括弧1組（入れ子は内側から1段ずつ）。行をまたがない。 */
const RE_PARENS = /\(([^()\n]*)\)/;
/** 英字を含むか（括弧を読み分ける対象） */
const RE_LATIN_WORD = /[A-Za-z]/;
/** かな・漢字・ハングルを含むか（含むなら括弧はそのまま＝日本語などの今の読み方を変えない） */
const RE_NON_LATIN = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
/** そのまま残す括弧の一時的な置き場（私用領域の文字＝本文には現れない） */
const KEEP_OPEN = '\ue000';
const KEEP_CLOSE = '\ue001';

/**
 * 半角の括弧 `( )` を、**中身で読み分けて**取り除く（読み上げ用）。
 *
 * - **中身が1語**（空白を含まない）＝「省略してもよい語」の書き方（`It says (that)〜`）とみなし、
 *   **空白**にして間を置かずに読む → `It says that〜`
 * - **中身が2語以上**＝補足・挿入（`I'll go (if it doesn't rain) tomorrow`）とみなし、
 *   **カンマ**にして前後に短い間を残す → `I'll go, if it doesn't rain, tomorrow`
 * - **中身が空**（`map()`）＝何も読まない
 *
 * 括弧を iOS にそのまま渡すと、**声によっては直前の語の区切りを誤る**
 * （`It says (that)` が「イッツエス ザット」になる＝括弧の無い `It says that` は正しく読む）。
 * 変換規則は声ごとに違いアプリからは直せないので、渡す前に括弧を消す。
 * ⚠️ **全角の（）は触らない**＝日本語の声では問題が起きておらず、今の間を変えないため。
 * ⚠️ 1語の補足（`Tokyo (Japan)`）も間なしになるのは割り切り（短い補足は間が無くても聞き取れる）。
 */
export function speakParens(text: string): string {
  let out = text;
  // 入れ子は内側から外す（`RE_PARENS` は括弧を含まない中身にだけ当たる）。回数の上限は暴走よけ。
  // 残す括弧は私用領域の文字に退避して、外側の括弧の判定から外す（最後に戻す）。
  for (let i = 0; i < 20 && RE_PARENS.test(out); i++) {
    out = out.replace(new RegExp(RE_PARENS.source, 'g'), (_, inner: string) => {
      const body = inner.trim();
      if (body === '') return ' ';
      // ⚠️ **中身が英語のときだけ**変える＝`変数(へんすう)` のような日本語の中の半角括弧は、
      //    今の読み方（問題が起きていない）を変えない。
      if (!RE_LATIN_WORD.test(body) || RE_NON_LATIN.test(body)) return `${KEEP_OPEN}${inner}${KEEP_CLOSE}`;
      return /\s/.test(body) ? `, ${body}, ` : ` ${body} `;
    });
  }
  out = out.replaceAll(KEEP_OPEN, '(').replaceAll(KEEP_CLOSE, ')');
  if (out === text) return text;
  return out
    .split('\n')
    .map((line) => line
      .replace(/[ \t]+/g, ' ')
      // 足したカンマが元の句読点とぶつかったら元のほうを残す（`(…),` → `,,` / `(…).` → `,.`）。
      .replace(/,\s*(?=[,.!?;:])/g, '')
      .replace(/\s+([,.!?;:])/g, '$1')
      // 行頭に来たカンマ（`(see below) Then`）は読むものが無い。
      .replace(/^\s*,\s*/, '')
      .trim())
    .join('\n');
}
