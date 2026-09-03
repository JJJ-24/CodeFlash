/**
 * 翻訳ファイル（locales/*.json）の突き合わせ（047 Phase 1）。
 *
 * 1040 キーを人手で追わないための検査。`locales/` に置いたファイルを**すべて**読むので、
 * `es.json` を足せば自動で対象になる（スクリプト側の変更は不要）。
 *
 * 検査するもの:
 *   エラー（`npm run verify:i18n` が失敗する）
 *     E1 キーの網羅 — どれかの言語にあってどれかに無いキー
 *     E2 補間トークン — 同じキーの `{{name}}` の集合が言語間で食い違う
 *     E3 行記法       — `■` / `[見出し]` / `>` / `| 表 |` / 早見表の `@@`・タブ・`//` の**行数**
 *                       （表は列数も）が言語間で食い違う
 *     E4 コード側の参照 — ソースに書かれた翻訳キーが `ja.json` に無い（＝画面にキー名が出る）
 *   警告（失敗はしない）
 *     W1 複数形 — `{{count}}` を含むのに `_one` が無いキー（単数形が「1 cards」になる）
 *     W2 複数形 — 補間の直後が複数形の名詞なのに `_one` が無いキー。数を `{{count}}` 以外の
 *                名前で渡している文（`{{reviewed}} / {{total}} cards`）は**そもそも複数形が
 *                効かない**ので、名詞に掛かる数を `count` に改名するところから直す
 *
 * ⚠️ **E1〜E3 は言語間の突き合わせなので「全言語で欠けているキー」は見つけられない**。
 *    実際 `pro.featureDeckSpeech` が3言語とも無く、ペイウォールにキー名がそのまま出ていた。
 *    E4 はソース側から見るのでこれを捕まえる。
 * ⚠️ **複数形サフィックスを畳んでから比較する**：en にだけ `pro.trialRemaining_one` が
 *    あるのは**正常な差分**（日本語に単数形は無い）。素朴にキー集合を比べると誤検知する。
 * ⚠️ **`{{count}}` は数値とは限らない**：`InfoContent` のアイコントークンにも `count`
 *    （`layers-outline`＝枚数アイコン）があり、説明モーダルの本文で使われている。
 *    W1 は下の `COUNT_INVARIANT` で明示的に除外する。
 */

import fs from 'node:fs';
import path from 'node:path';

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
/** 基準にする言語（CLAUDE.md：ja を変更したら en もセットで更新する、の ja 側）。 */
const REFERENCE = 'ja';

/** W1 の対象外。**数が 1 でも文が壊れない**書き方をしているキー（理由つきで明示する）。 */
const COUNT_INVARIANT = new Set([
  // {{count}} が数値ではなくアイコン（InfoContent の ICON_TOKENS.count＝枚数アイコン）
  'home.deckListInfoMessage',
  'tag.tagListInfoMessage',
  // 名詞を伴わない・括弧つきなど、単数でも自然な形
  'tag.selectedCount',              // "{{count}} selected"
  'card.selectedCount',             // "{{count}} sel."
  'card.searchResultCount',         // "Results ({{count}})"（見出し＋括弧内が数字だけ）
  'card.searchResultCountMax',      // "{{count}}+ results"（上限表示なので常に複数）
  'study.goalRowRemaining',         // "{{count}} to go"
  'stats.gradeCount',               // "×{{count}}"
  'stats.goalLineLegend',           // "Goal {{count}}/day"（数の後ろに名詞が来ない）
  'dataManagement.tsvLossDeckSqlStages',
  'dataManagement.tsvLossDeckHtmlStages',
  'dataManagement.tsvLossBlockSqlInit',
  'dataManagement.tsvLossBlockHtmlInit',
  'dataManagement.tsvLossImages',
  'dataManagement.tsvLossDeckSpeechLangs',
]);

/**
 * W2 の対象外。**補間の直後に複数形の名詞が来るが、単数でも壊れない**キー。
 * ⚠️ ここに入れる前に「1 のとき実際にどう出るか」を確かめること
 *（`deck.speechLangsSet` は「N件」相当だと思って除外していたが、英語は "1 overrides" だった）。
 */
const PLURAL_NOUN_OK = new Set([
  'card.searchResultCountMax',   // "{{count}}+ results"（上限表示なので常に複数）
  'deck.htmlStagesAndImages',    // "{{stages}}, {{images}}"＝整形済みの断片を繋ぐだけ
  'study.historyInfoMessage',    // 説明モーダルの本文（数を差し込まない）
  'stats.gradeRankingListInfoMessage', // 同上（`{{funnel}}` はアイコンで数ではない）
]);

/** W2 で見る名詞。`{{token}} … cards` のように**補間のすぐ後ろ**に来るものだけを対象にする。 */
const PLURAL_NOUNS = 'cards|decks|tags|days|results|setups|stages|images|reminders|overrides|blocks|items|times';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

type Flat = Record<string, string>;

/** ネストと配列を `a.b.0` の形に潰す（配列は要素数の違いもキー差分として出したい）。 */
function flatten(value: unknown, prefix = '', out: Flat = {}): Flat {
  if (typeof value === 'string') {
    out[prefix] = value;
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

const baseKey = (key: string) => key.replace(PLURAL_SUFFIX, '');
const tokens = (s: string) => [...s.matchAll(/\{\{(\w+)/g)].map((m) => m[1]).sort();

/**
 * 説明モーダルの行記法の数を数える。2系統ある：
 * - `components/InfoContent.tsx`（ⓘ 全般）… `■` / `[見出し]` / `>` / `| 表 |`
 * - `components/editor/MarkdownHelpModal.tsx`（`editor.mdHelpBody` 専用）… `@@節` / タブ＝記法サンプル / `//` 補足
 *
 * ⚠️ 落とすのは**行末**の空白だけ（行頭のタブはサンプル行の目印そのもの）。
 */
function markupCounts(s: string) {
  const lines = s.split('\n').map((l) => l.replace(/\s+$/, ''));
  return {
    section: lines.filter((l) => l.startsWith('■')).length,
    header: lines.filter((l) => /^\[.+\]$/.test(l)).length,
    dense: lines.filter((l) => l.startsWith('>')).length,
    // マークダウン早見表（`@@` 節見出し・タブ＝サンプル・`//` 補足）。
    // 訳で `//` を1本落としても他の検査には掛からないため、行数だけ突き合わせる。
    mdSection: lines.filter((l) => l.startsWith('@@')).length,
    mdSample: lines.filter((l) => l.startsWith('\t')).length,
    mdNote: lines.filter((l) => l.startsWith('//')).length,
    // 表（`| a | b |`）は行数と列数の両方を数える。列が1つ欠けると他言語だけ列がずれるため。
    rows: lines.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length,
    cells: lines
      .filter((l) => /^\s*\|.*\|\s*$/.test(l))
      .reduce((n, l) => n + l.trim().slice(1, -1).split('|').length, 0),
  };
}

/** エラー表示での記法の呼び名（`markupCounts` の全キーを網羅すること）。 */
const NOTATION_LABELS: Record<keyof ReturnType<typeof markupCounts>, string> = {
  section: '■',
  header: '[…]',
  dense: '>',
  mdSection: '@@',
  mdSample: 'タブ',
  mdNote: '//',
  rows: '|行',
  cells: '|セル',
};

// ---- 読み込み ------------------------------------------------------------------

const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).sort();
const locales = files.map((f) => f.replace(/\.json$/, ''));
const data: Record<string, Flat> = {};
for (const f of files) {
  data[f.replace(/\.json$/, '')] = flatten(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, f), 'utf8')));
}
if (!locales.includes(REFERENCE)) {
  console.error(`✗ 基準言語 ${REFERENCE}.json が見つからない`);
  process.exit(1);
}

const errors: string[] = [];
const warnings: string[] = [];

// ---- E1 キーの網羅 --------------------------------------------------------------
// 複数形サフィックスを畳んだ「基準キー」で比べる（言語ごとに必要な複数形の種類が違うため）。

const allBase = new Set<string>();
for (const lng of locales) for (const k of Object.keys(data[lng])) allBase.add(baseKey(k));

for (const lng of locales) {
  const have = new Set(Object.keys(data[lng]).map(baseKey));
  const missing = [...allBase].filter((k) => !have.has(k)).sort();
  for (const k of missing) errors.push(`[キー欠落] ${lng}.json に無い: ${k}`);
}

// ---- E2 補間トークン ------------------------------------------------------------
// 翻訳で `{{count}}` が消える・名前が変わるのが最も起きやすい壊れ方。

for (const k of Object.keys(data[REFERENCE])) {
  const ref = tokens(data[REFERENCE][k]).join(',');
  for (const lng of locales) {
    if (lng === REFERENCE) continue;
    const other = data[lng][k];
    if (other === undefined) continue; // E1 が報告済み（複数形の正常な差分もここに来る）
    const got = tokens(other).join(',');
    if (got !== ref) {
      errors.push(`[トークン不一致] ${k}: ${REFERENCE}={{${ref || '—'}}} / ${lng}={{${got || '—'}}}`);
    }
  }
}

// ---- E3 行記法 ------------------------------------------------------------------
// 崩れると説明モーダルのレイアウトが変わる（見出しが太字にならない・小さい行にならない）。

for (const k of Object.keys(data[REFERENCE])) {
  const ref = markupCounts(data[REFERENCE][k]);
  for (const lng of locales) {
    if (lng === REFERENCE) continue;
    const other = data[lng][k];
    if (other === undefined) continue;
    const got = markupCounts(other);
    const fields = Object.keys(NOTATION_LABELS) as (keyof typeof ref)[];
    if (fields.some((f) => ref[f] !== got[f])) {
      // 双方 0 の記法は出さない（早見表の `@@` 等が全キーの表示に混ざると読みにくい）
      const shown = fields.filter((f) => ref[f] || got[f]);
      const fmt = (c: typeof ref) => shown.map((f) => `${NOTATION_LABELS[f]}${c[f]}`).join(' ');
      errors.push(`[行記法] ${k}: ${REFERENCE}=(${fmt(ref)}) / ${lng}=(${fmt(got)})`);
    }
  }
}

// ---- E4 コード側の参照 ----------------------------------------------------------
// E1〜E3 は言語間の突き合わせなので、**全言語で欠けているキー**は素通りする（実際に
// `pro.featureDeckSpeech` が3言語とも無く、ペイウォールにキー名が出ていた）。ここだけ
// ソース側から見る＝コードに書かれた「翻訳キーらしき文字列リテラル」を ja.json と突き合わせる。
//
// ⚠️ **`t('...')` の形だけを探さない**：paywall は `titleKey: 'pro.featureDeckSpeech'` の
//    ようにオブジェクトへ入れてから `t(f.titleKey)` で引く。まさにこれが漏れた形なので、
//    「名前空間で始まるドット区切りの文字列リテラル」を広く拾う方式にしてある。
// ⚠️ **テンプレートリテラルは対象外**（`` t(`grade.${key}`) `` のような動的キーは静的に追えない）。
// ⚠️ コメントは先に落とす（説明文に書いたキー名を拾わないため）。

/** 文字列リテラル（' と "）だけを取り出す。コメントとテンプレートリテラルは飛ばす。 */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '`') { i++; while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; } i++; continue; }
    if (c === "'" || c === '"') {
      const quote = c; let buf = ''; i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') { buf += src[i + 1] ?? ''; i += 2; continue; }
        if (src[i] === '\n') break; // 未終端（型定義の中の < > など）は捨てる
        buf += src[i]; i++;
      }
      i++; out.push(buf); continue;
    }
    i++;
  }
  return out;
}

const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks', 'store'];
/** 拡張子に見える末尾（`stats.tsx` のようなファイル名を翻訳キーと誤認しない）。 */
const FILE_EXT = /\.(tsx?|jsx?|json|md|mjs|cjs|png|jpe?g|svg|db|sql|html?|css|patch|lock)$/;
/** 名前空間で始まるドット区切り＝翻訳キーの形。 */
const KEY_SHAPE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/;

const NAMESPACES = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${REFERENCE}.json`), 'utf8'))));
const refBase = new Set(Object.keys(data[REFERENCE]).map(baseKey));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const repoRoot = path.join(__dirname, '..');
const seen = new Map<string, string>(); // キー → 最初に見つけたファイル
for (const dir of SOURCE_DIRS) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    for (const lit of stringLiterals(fs.readFileSync(file, 'utf8'))) {
      if (!KEY_SHAPE.test(lit)) continue;
      if (!NAMESPACES.has(lit.split('.')[0])) continue;
      if (FILE_EXT.test(lit)) continue;
      if (!seen.has(lit)) seen.set(lit, path.relative(repoRoot, file));
    }
  }
}
for (const [key, file] of [...seen].sort()) {
  if (refBase.has(baseKey(key))) continue;
  errors.push(`[コード参照] ${REFERENCE}.json に無いキーをソースが参照: ${key}（${file}）`);
}

// ---- W1 複数形 ------------------------------------------------------------------
// その言語に 'one' の区分があるなら、数を差し込むキーには `_one` が要る。
// 規約は「サフィックス無しのキー＝other／`_one` を別に置く」（CLAUDE.md）。

for (const lng of locales) {
  let categories: readonly string[];
  try {
    categories = new Intl.PluralRules(lng).resolvedOptions().pluralCategories;
  } catch {
    continue; // 未知の言語コードは判定しない
  }
  if (!categories.includes('one')) continue; // ja など：単複が無いので不要

  for (const [k, v] of Object.entries(data[lng])) {
    if (PLURAL_SUFFIX.test(k)) continue;
    if (!v.includes('{{count}}')) continue;
    if (COUNT_INVARIANT.has(k)) continue;
    if (`${k}_one` in data[lng]) continue;
    warnings.push(`[複数形] ${lng}.json の ${k} に _one が無い: ${JSON.stringify(v.split('\n')[0].slice(0, 70))}`);
  }
}

// ---- W2 複数形（{{count}} 以外の数） ---------------------------------------------
// W1 は `{{count}}` を含むキーしか見ないので、**数を別の名前で渡している**文
//（`Studied {{reviewed}} / {{total}} cards`・`{{n}} cards`）を取りこぼす。i18next の複数形は
// `count` にしか効かないため、この形は**そもそも複数形にできない**＝名詞に掛かる数を `count`
// に改名するところから直す必要がある。実機で「Done 1/1 cards」を見つけて追加した検査。

const nounRe = new RegExp(`\\{\\{\\w+\\}\\}[^\\n]{0,12}?\\b(${PLURAL_NOUNS})\\b`);
for (const lng of locales) {
  let categories: readonly string[];
  try {
    categories = new Intl.PluralRules(lng).resolvedOptions().pluralCategories;
  } catch {
    continue;
  }
  if (!categories.includes('one')) continue;

  for (const [k, v] of Object.entries(data[lng])) {
    if (PLURAL_SUFFIX.test(k)) continue;
    if (PLURAL_NOUN_OK.has(k)) continue;
    if (`${k}_one` in data[lng]) continue;
    if (!nounRe.test(v)) continue;
    warnings.push(`[複数形] ${lng}.json の ${k} に _one が無い（補間の後ろが複数形）: ${JSON.stringify(v.split('\n')[0].slice(0, 70))}`);
  }
}

// ---- 結果 ----------------------------------------------------------------------

const keyCount = Object.keys(data[REFERENCE]).length;
console.log(`===== i18n 検証（${locales.join(', ')}／基準 ${REFERENCE}・${keyCount} キー）=====\n`);

const label = (n: number, ok: string) => (n === 0 ? `✓ ${ok}` : `✗ ${n} 件`);
const byTag = (tag: string) => errors.filter((e) => e.startsWith(`[${tag}]`));
console.log(`  キーの網羅        ${label(byTag('キー欠落').length, '欠落なし')}`);
console.log(`  補間トークン      ${label(byTag('トークン不一致').length, '不一致なし')}`);
console.log(`  行記法 ■ […] > | @@ ${label(byTag('行記法').length, '不一致なし')}`);
console.log(`  コード側の参照    ${label(byTag('コード参照').length, `未定義なし（${seen.size} キー参照）`)}`);
console.log(`  複数形（警告）    ${warnings.length === 0 ? '✓ なし' : `⚠️ ${warnings.length} 件`}`);

if (errors.length > 0) {
  console.error('\n--- エラー ---');
  for (const e of errors) console.error('  ' + e);
}
if (warnings.length > 0) {
  console.log('\n--- 警告（単数形が「1 cards」のようになる） ---');
  for (const w of warnings) console.log('  ' + w);
}

console.log(`\n===== エラー ${errors.length} / 警告 ${warnings.length} =====`);
if (errors.length > 0) process.exit(1);
