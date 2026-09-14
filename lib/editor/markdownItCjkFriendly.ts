// CJK 文字に隣接した装飾記法（`**`・`*`・`~~`・`==`・`++`）を効くようにする markdown-it プラグイン。
//
// markdown-it は CommonMark の「flanking」規則で開き/閉じマーカーを判定する＝
//   開き：直後が空白でなく、かつ直後が約物なら直前が空白か約物であること
//   閉じ：直前が空白でなく、かつ直前が約物なら直後が空白か約物であること
// `「」（）、。` のような CJK の約物も Unicode 上は約物なので、`あいうえお==「かきくけこ」==` は
// 「直前が文字・直後が約物」で開けず、そのまま表示されてしまう（`==「あいうえお」==` と行頭に
// 置いたときだけ効く）。英語の `a*"foo"*` を強調にしないための規則が、単語の間に空白を
// 置かない日本語では裏目に出る。
//
// CJK-friendly Markdown 仕様（https://github.com/tats-u/markdown-cjk-friendly）に沿って
// `scanDelims` を差し替える。変更点は2つだけ：
//   1. CJK の約物は「約物」に数えない（普通の文字と同じ扱い）
//   2. 直後が英語の約物（`"` など）でも、直前が CJK 文字なら開ける（閉じ側も同様）
// 英語だけのテキスト（`a * b * c`・`a*"foo"*`・`5*3*2`）の結果は変わらない。
//
// `scanDelims` は5つの記法（emphasis / strikethrough / mark / ins）が共有する1つのメソッドなので、
// ここを差し替えれば全部に同じ規則が効く（記法ごとに直すと「マーカーは `「」` で効くのに太字は
// 効かない」という不揃いになる）。差し替え先は `md.inline.State.prototype`＝同じ markdown-it から
// 作った全インスタンスに効くので、`BlocksView`（学習画面）と `TextBlockItem`（編集プレビュー）の
// どちらが先に `.use()` しても両方に効く。読み上げ（`lib/blocksToSpeech.ts`）は正規表現で
// `==…==` を落としていて元から `「」` を区別しないので、表示がそちらに揃う形になる。
//
// 使い方: MarkdownIt(...).use(markdownItCjkFriendly)
// 検証: `npm run verify:markdown`

// CJK 文字＝East Asian Width が W/F/H の文字（絵文字を除く）とハングル。
// ハングル字母・CJK 部首/康熙部首・漢字構成記述文字・CJK 記号と句読点（`「」、。` を含む）・
// ひらがな/カタカナ・注音/ハングル互換字母/漢文/CJK の筆画/カタカナ拡張・囲み CJK/CJK 互換・
// 漢字（拡張 A＋統合漢字）・ハングル字母拡張 A/ハングル音節/字母拡張 B・CJK 互換漢字・
// 縦書き形/CJK 互換形/小字形・半角/全角形（全角の `！？（）` と半角カナ）・SIP/TIP の漢字（拡張 B 以降）。
const CJK_RE =
  /[ᄀ-ᇿ⺀-⿟⿰-〿぀-ヿ㄀-ㇿ㈀-㏿㐀-䶿一-鿿ꥠ-꥿가-퟿豈-﫿︐-︟︰-﹯＀-￯]|[\uD840-\uD8BF][\uDC00-\uDFFF]/;

const LOW_SURROGATE_RE = /[\uDC00-\uDFFF]/;

export function isCjkChar(ch: string): boolean {
  return CJK_RE.test(ch);
}

export function markdownItCjkFriendly(md: any) {
  const State = md.inline.State;
  const proto = State.prototype;
  if (proto.__cjkFriendly) return;
  proto.__cjkFriendly = true;

  const { isWhiteSpace, isPunctChar, isMdAsciiPunct } = md.utils;

  proto.scanDelims = function (start: number, canSplitWord: boolean) {
    const src: string = this.src;
    const max: number = this.posMax;
    const marker = src.charCodeAt(start);

    // 前後は「文字」単位で見る（サロゲートペア＝拡張 B 以降の漢字を1文字として扱う）。
    // 行頭・行末は本家と同じく空白扱い。
    let lastStr = ' ';
    if (start > 0) {
      const from = start >= 2 && LOW_SURROGATE_RE.test(src[start - 1]) ? start - 2 : start - 1;
      lastStr = String.fromCodePoint(src.codePointAt(from) as number);
    }
    let pos = start;
    while (pos < max && src.charCodeAt(pos) === marker) pos++;
    const count = pos - start;
    const nextStr = pos < max ? String.fromCodePoint(src.codePointAt(pos) as number) : ' ';

    const lastChar = lastStr.charCodeAt(0);
    const nextChar = nextStr.charCodeAt(0);
    const isLastCjk = isCjkChar(lastStr);
    const isNextCjk = isCjkChar(nextStr);
    // 変更点1：CJK の約物は約物に数えない。
    const isLastPunct = (isMdAsciiPunct(lastChar) || isPunctChar(lastStr)) && !isLastCjk;
    const isNextPunct = (isMdAsciiPunct(nextChar) || isPunctChar(nextStr)) && !isNextCjk;
    const isLastWhiteSpace = isWhiteSpace(lastChar);
    const isNextWhiteSpace = isWhiteSpace(nextChar);

    // 変更点2：直前/直後が CJK 文字なら、反対側が約物でも開ける/閉じられる。
    const leftFlanking = !isNextWhiteSpace && (!isNextPunct || isLastWhiteSpace || isLastPunct || isLastCjk);
    const rightFlanking = !isLastWhiteSpace && (!isLastPunct || isNextWhiteSpace || isNextPunct || isNextCjk);

    // ここから下は本家と同じ（`_` の単語内強調の禁止など）。
    let can_open: boolean;
    let can_close: boolean;
    if (!canSplitWord) {
      can_open = leftFlanking && (!rightFlanking || isLastPunct);
      can_close = rightFlanking && (!leftFlanking || isNextPunct);
    } else {
      can_open = leftFlanking;
      can_close = rightFlanking;
    }
    return { can_open, can_close, length: count };
  };
}
