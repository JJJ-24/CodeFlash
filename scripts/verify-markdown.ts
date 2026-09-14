/**
 * テキストブロックの Markdown 拡張（`==ハイライト==`・`++下線++`・CJK-friendly な flanking 規則）を
 * Node 上で検証する。
 *
 * `lib/editor/markdownIt*.ts` は markdown-it のプラグイン＝純粋な JS なので、学習画面・編集プレビューと
 * 同じ組み合わせ（markdown-it-mark → 色プレフィックス → ins → CJK-friendly）で本物のまま呼べる。
 * 実行: `npm run verify:markdown`
 *
 * 目的は主に2つ：
 *   1. `あいうえお==「かきくけこ」==` のように CJK の約物に隣接した記法が効くこと
 *      （markdown-it 標準の CommonMark 規則では効かない＝markdown-it を上げたときの退行検知）
 *   2. 英語だけのテキスト（`a * b * c`・`a*"foo"*`・`if (a==b)`）の結果が変わっていないこと
 *
 * ⚠️ アプリのモジュールは `import` ではなく `require()` で読む（他の verify スクリプトと同じ流儀）。
 */
import nodePath from 'node:path';
import Module from 'node:module';

const root = nodePath.join(__dirname, '..');
const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  const resolved = request.startsWith('@/') ? nodePath.join(root, request.slice(2)) : request;
  return origResolve.call(this, resolved, ...rest);
};

/* eslint-disable @typescript-eslint/no-require-imports */
const MarkdownIt = require('markdown-it');
const markdownItMark = require('markdown-it-mark');
const { markdownItHighlightColor } = require('@/lib/editor/markdownHighlight');
const { markdownItIns } = require('@/lib/editor/markdownItIns');
const { markdownItCjkFriendly, isCjkChar } = require('@/lib/editor/markdownItCjkFriendly');
/* eslint-enable @typescript-eslint/no-require-imports */

let passed = 0;
let failed = 0;
function assertEq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual  : ${JSON.stringify(actual)}`);
  }
}

// ---- 学習画面・編集プレビューと同じ組み合わせ --------------------------------------------

const md = MarkdownIt({ linkify: true })
  .use(markdownItMark)
  .use(markdownItHighlightColor)
  .use(markdownItIns)
  .use(markdownItCjkFriendly);
md.linkify.set({ fuzzyLink: false });
md.disable('code');

// react-native-markdown-display は独自にレンダリングするので、HTML 出力は「トークン列の検証」として読む。
// mark_open の `hl` 属性は表示側が読むだけで HTML には出ないため、別途トークンで確かめる。
const render = (s: string) => md.renderInline(s);

// T1: CJK の約物に隣接した記法（本題）
console.log('T1: CJK の約物に隣接した記法が効く');
assertEq(render('あいうえお==「かきくけこ」=='), 'あいうえお<mark>「かきくけこ」</mark>', '後ろに文字がある ==「」==');
assertEq(render('==「あいうえお」=='), '<mark>「あいうえお」</mark>', '行頭の ==「」==（従来から効く）');
assertEq(render('あいうえお==「かきくけこ」==さしすせそ'), 'あいうえお<mark>「かきくけこ」</mark>さしすせそ', '前後に文字がある ==「」==');
assertEq(render('あいうえお==（かきくけこ）=='), 'あいうえお<mark>（かきくけこ）</mark>', '全角括弧');
assertEq(render('あいうえお=="かきくけこ"=='), 'あいうえお<mark>&quot;かきくけこ&quot;</mark>', '英語の引用符でも直前が CJK なら開く');
assertEq(render('English==「かきくけこ」=='), 'English<mark>「かきくけこ」</mark>', '直前が英字でも CJK の約物なら開く');
assertEq(render('𠮷==「野家」=='), '𠮷<mark>「野家」</mark>', 'サロゲートペア（拡張 B の漢字）を1文字として扱う');
assertEq(render('あいうえお**「かきくけこ」**'), 'あいうえお<strong>「かきくけこ」</strong>', '太字');
assertEq(render('あいうえお*「かきくけこ」*'), 'あいうえお<em>「かきくけこ」</em>', '斜体');
assertEq(render('あいうえお~~「かきくけこ」~~'), 'あいうえお<s>「かきくけこ」</s>', '訂正線');
assertEq(render('あいうえお++「かきくけこ」++'), 'あいうえお<ins>「かきくけこ」</ins>', '下線');
assertEq(render('あいうえお==~~「かきくけこ」~~=='), 'あいうえお<mark><s>「かきくけこ」</s></mark>', '入れ子（マーカー＞訂正線）');
assertEq(render('「**あ**」'), '「<strong>あ</strong>」', '約物の内側の記法（従来から効く）');

// T2: 英語だけのテキストは CommonMark のまま（変えない）
console.log('T2: 英語のテキストの結果は不変');
assertEq(render('a * b * c'), 'a * b * c', '空白で囲まれた * は強調にしない');
assertEq(render('5*3*2'), '5<em>3</em>2', '単語内の * は強調（CommonMark どおり）');
assertEq(render('foo**bar**baz'), 'foo<strong>bar</strong>baz', '単語内の **');
assertEq(render('a*"foo"*'), 'a*&quot;foo&quot;*', 'CommonMark の例：a*"foo"* は強調にしない');
assertEq(render('**foo"**bar'), '**foo&quot;**bar', 'CommonMark の例：閉じられない **');
assertEq(render('English=="quoted"=='), 'English==&quot;quoted&quot;==', '英字＋英語の約物は従来どおり開かない');
assertEq(render('x == y == z'), 'x == y == z', '空白で囲まれた == は文字のまま');
assertEq(render('if (a==b) return'), 'if (a==b) return', 'コード片の == は文字のまま');
assertEq(render('snake_case_name'), 'snake_case_name', '_ の単語内強調は禁止のまま');

// T3: 色プレフィックスは CJK-friendly と併用しても解釈される
console.log('T3: 色プレフィックスとの併用');
{
  const tokens = md.parseInline('あいうえお==g|「かきくけこ」==', {});
  const children = tokens[0].children as { type: string; content: string; attrGet: (n: string) => string | null }[];
  const open = children.find((t) => t.type === 'mark_open');
  assertEq(open?.attrGet('hl'), 'g', 'mark_open に hl=g が載る');
  const inner = children[children.indexOf(open as never) + 1];
  assertEq(inner?.content, '「かきくけこ」', '本文から g| が消える');
}

// T4: isCjkChar の境界
console.log('T4: isCjkChar');
for (const ch of ['あ', 'ア', '漢', '「', '」', '、', '。', '（', '！', 'ｱ', '한', '𠮷']) assertEq(isCjkChar(ch), true, `CJK: ${ch}`);
for (const ch of ['a', 'Z', '"', '*', '(', ' ', 'é', 'Я', '😀']) assertEq(isCjkChar(ch), false, `非 CJK: ${ch}`);

// T5: 二重適用しても壊れない（両インスタンスが .use() する）
console.log('T5: 二重適用');
{
  const md2 = MarkdownIt().use(markdownItMark).use(markdownItCjkFriendly).use(markdownItCjkFriendly);
  assertEq(md2.renderInline('あ==「い」=='), 'あ<mark>「い」</mark>', '2回 use しても効く');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
