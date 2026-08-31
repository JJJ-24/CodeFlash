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
 *     E3 行記法       — `■` / `[見出し]` / `>` / `| 表 |` の**行数**（表は列数も）が言語間で食い違う
 *   警告（失敗はしない）
 *     W1 複数形 — `{{count}}` を含むのに `_one` が無いキー（単数形が「1 cards」になる）
 *     W2 複数形 — 補間の直後が複数形の名詞なのに `_one` が無いキー。数を `{{count}}` 以外の
 *                名前で渡している文（`{{reviewed}} / {{total}} cards`）は**そもそも複数形が
 *                効かない**ので、名詞に掛かる数を `count` に改名するところから直す
 *
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

/** 説明モーダルの行記法（`components/InfoContent.tsx`）の数を数える。 */
function markupCounts(s: string) {
  const lines = s.split('\n').map((l) => l.replace(/\s+$/, ''));
  return {
    section: lines.filter((l) => l.startsWith('■')).length,
    header: lines.filter((l) => /^\[.+\]$/.test(l)).length,
    dense: lines.filter((l) => l.startsWith('>')).length,
    // 表（`| a | b |`）は行数と列数の両方を数える。列が1つ欠けると他言語だけ列がずれるため。
    rows: lines.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length,
    cells: lines
      .filter((l) => /^\s*\|.*\|\s*$/.test(l))
      .reduce((n, l) => n + l.trim().slice(1, -1).split('|').length, 0),
  };
}

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
    if (ref.section !== got.section || ref.header !== got.header || ref.dense !== got.dense || ref.rows !== got.rows || ref.cells !== got.cells) {
      const fmt = (c: typeof ref) => `■${c.section} […]${c.header} >${c.dense} |${c.rows}行${c.cells}セル`;
      errors.push(`[行記法] ${k}: ${REFERENCE}=(${fmt(ref)}) / ${lng}=(${fmt(got)})`);
    }
  }
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
console.log(`  行記法 ■ […] > |   ${label(byTag('行記法').length, '不一致なし')}`);
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
