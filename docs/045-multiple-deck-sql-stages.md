# 045 SQL 初期化の複数持ち（044 の土台を HTML/SQL 共用に）

**フェーズ:** 将来
**ステータス:** **完了（2026-08-09・実機確認済み）**
**要ネイティブ再ビルド:** 不要（JS のみ）
**依存:** 044（デッキ土台の複数持ち＝設計・部品の出どころ）・018（SQL 実行とデッキ共通初期化）
**被依存:** なし

---

## 概要

044 でデッキの **HTML/CSS 土台**が「1つ → 名前付きで複数」になった。本チケットはそれを
**SQL 初期化（`decks.sqlInit`）にも同じ形で広げる**。

```
デッキ「SQL入門」
├─ 初期化「users テーブル」   CREATE TABLE users(...); INSERT ...
├─ 初期化「orders テーブル」  CREATE TABLE orders(...); INSERT ...
└─ 初期化「空のDB」          （中身なし）

カードA の SQL ブロック → 初期化「users テーブル」を使う
カードB の SQL ブロック → 初期化「orders テーブル」を使う
カードC の SQL ブロック → 使わない（素の DB）
```

**設計は 044 と完全に同じ**（持ち方・旧データ吸収・解決規則・UI の出し分け）。
その設計判断そのものの記録は `docs/044` にあるので、本チケットでは**差分と、共用にあたって
決めたこと**だけを書く。

---

## 確定仕様

| 論点 | 決定 |
|---|---|
| 持ち方 | **`decks.sqlStages` に JSON 列を1本追加**（`DeckStage[]`）＝044 の `htmlStages` と同型 |
| ブロック側の参照 | `CodeBlock.deckSqlStageId?: string`。**未指定＝先頭＝045 以前の挙動** |
| 「使わない」 | **`CodeBlock.noDeckSqlInit` を新設**（044 以前の SQL には無く `sqlInits` は常に `[deck, block]` だった） |
| 旧列 `sqlInit` | **残す＋先頭土台をミラー書き**（旧バージョン・旧エクスポートとの互換） |
| 部品 | **044 のものを共用**（並行実装は不採用・下記） |
| 呼び名 | **HTML＝「土台」／SQL＝「初期化」で分ける**（下記） |
| Pro ゲート | **`sqlInits` の組み立てに `isPro` は不要**（下記） |

### 部品は共用にした（並行実装は不採用）

土台の**持ち方・一覧 UI・選択 UI・解決規則が HTML と SQL で完全に同じ**なので、SQL 用に
コピーを作らず 044 の部品を共用した。並行実装は約400行（`lib/deckStages.ts` 83行＋
`DeckStagesModal` 251行＋ブロック側チップ 57行）が二重化し、**「土台の並べ替え」（044 で
v1 不採用＝必要になったら足す）のような仕様追加のたびに2箇所直す**ことになる。
片方だけ直して食い違うのが、この手のコードで最も起きやすい壊れ方。

共用にあたって必要になったのは次の3つだけだった：

1. **`DeckStage.html` → `DeckStage.content` にリネーム**（HTML/SQL 共通の型にするため）
2. 解決関数を `resolveStage()`（共通本体）＋言語ごとの薄いラッパー2本に分割
3. 文言だけ `kind: 'html' | 'sql'` で差し替え（`lib/deckStageLabels.ts`）

### 呼び名は HTML と SQL で分ける

共通部品を使うが、**画面に出る言葉は分けた**：HTML＝「土台」／SQL＝「初期化」。
実物の語彙（HTML/CSS 土台／初期化SQL）が元から違うので、片方に寄せると画面ごとに
言い方が食い違って読み手が迷う。部品側に `html`/`sql` の分岐を持ち込まないよう、
**文言キーの対応表を `lib/deckStageLabels.ts` に置いて部品はそれを引く**。

### Pro ゲートは 044 と非対称でよい

- **HTML**：非 Pro では土台を積まない処理が要る（**JS 実行は無料**なので、土台を積むと
  可視プレビューが出て html/css の実行ゲートが素通しになる）
- **SQL**：**言語自体が `PRO_LANGUAGES`＝実行ボタンで止まる**ので、`sqlInits` の組み立てに
  `isPro` は要らない（045 以前からそうなっており、変えていない）

選択 UI の**表示**だけは 044 と同じく Pro のときのみ（非 Pro に選ばせる意味がないため）。

---

## データモデル

```ts
// types/index.ts（044 と同じ型を使う）
export interface DeckStage {
  id: string;
  name: string;
  content: string;   // ← 044 初期実装では `html` だった（045 でリネーム）
}

interface Deck {
  sqlInit: string | null;   // 【互換用】先頭土台のミラー。読み取りには使わない
  sqlStages: DeckStage[];   // 新・正となる持ち方
}

interface CodeBlock {
  deckSqlStageId?: string;   // 未指定＝先頭。noDeckSqlInit が true なら無視
  noDeckSqlInit?: boolean;   // このブロックでは初期化を流さない（既定 false）
}
```

### 旧キー `html` の吸収

044 初期実装で `decks.htmlStages` に書かれた JSON は中身のキーが `html` になっている。
**`parseDeckStages()` が読み取り時に `content ?? html` で吸収する**ので、データ移行の操作は不要
（保存し直した時点で新キーに移る）。この関数が**キー名を知る唯一の場所**。

### 解決規則（044 と同一）

`lib/deckStages.ts` の `resolveStage()` が本体で、言語ごとのラッパーが2本：

```
resolveDeckStageHtml(stages, block)  … deckStageId    / noDeckHtmlInit
resolveDeckStageSql (stages, block)  … deckSqlStageId / noDeckSqlInit

「使わない」フラグ    → 積まない
id 未指定             → 先頭（＝045 以前のカードの挙動）
id が解決できない     → 積まない（**先頭にフォールバックしない**）
```

解決できない参照を先頭に落とすと、**別の初期化が黙って適用されて出題の前提が変わる**。
初期化なしなら素の DB になり「テーブルが無い」エラーで作者が気づける。

---

## UI

- **デッキ編集**（`deck/new`・`deck/[id]/edit`）：「SQL初期化」行／`Q` キー →
  `DeckStagesModal`（**044 と同じ部品**・`kind="sql"`）。一覧＝追加/削除/1行プレビュー、
  先頭に「既定」バッジ、行タップで編集面（名前はタイトル欄で編集）
  - 043 の画像ライブラリは `editorFooter` prop で**HTML のときだけ**差す（SQL では渡さない）
- **ブロック側**（`CodeBlockItem`）：`components/editor/DeckStagePicker.tsx`（**044 と同じ部品**）。
  **初期化が1つなら ON/OFF トグル、2つ以上のときだけ「使わない＋各初期化」のチップ選択**
  ＝初期化を1つしか使わないデッキは 045 以前と見た目も操作も同じ

---

## Todo ＝**全完了（2026-08-09）**

- [x] `types/index.ts`：`Deck.sqlStages`、`CodeBlock.deckSqlStageId?`、**`CodeBlock.noDeckSqlInit?` を新設**
- [x] **`DeckStage.html` → `content` にリネーム**＋`parseDeckStages` で旧キーを吸収
- [x] `lib/deckStages.ts` を HTML/SQL 共通に（`resolveStage` ＋ ラッパー2本、
      `legacyHtmlInitMirror` → **`legacyInitMirror`**）
- [x] `lib/database/schema.ts`：`decks.sqlStages TEXT` を `PRAGMA table_info` 確認つき `ALTER TABLE` で追加
- [x] `lib/database/decks.ts`：`toDeck` で `sqlInit` → `sqlStages` を正規化、`createDeck`/`updateDeck` で
      `sqlInit` に先頭土台をミラー書き。`sqlStages` も **「渡されたときだけ」更新**
- [x] `lib/import.ts` に `sqlStages` 列を追加（`lib/export.ts` は `SELECT *` なので自動）
- [x] `lib/tsv.ts`：`TsvExportLoss.deckSqlInit`（bool）→ **`deckSqlStages`（件数）**。
      `app/settings/data.tsx` の文言組み立てと i18n も追従
- [x] **`lib/deckStageLabels.ts` を新設**＝共通部品が引く文言キーの対応表
- [x] `DeckStagesModal` を共用化（`kind` prop・`editorFooter` prop）
- [x] **`components/editor/DeckStagePicker.tsx` を新設**＝ブロック側の選択 UI を `CodeBlockItem` から抽出して共用
      （トグルの `value` が解決結果を見る 044 Phase 3 の修正もそのまま両方に効く）
- [x] 配線：`deckSqlInit?: string | null` → **`deckSqlStages?: DeckStage[]`**（`session.tsx`・`card/new`・
      `card/[cardId]/edit` → `BlockEditor`/`BlocksView` → `CodeBlockItem`/`CodeRunnerView`）
- [x] i18n（`deck.sqlStages*`/`sqlStageDelete*`・`editor.useDeckSqlInit*`/`deckSqlStagePicker*`・
      `dataManagement.tsvLossDeckSqlStages`・ja/en）。`deck.sqlInitLabel`・`shortcut.sqlInit` から「共通」を外した
- [x] 検証：`npm run verify:db`（`scripts/verify-db.ts`）を SQL まで拡張＝**67 アサーション全通過**。
      旧DB正規化・保存/ミラー・エクスポート往復・解決規則の全分岐・**HTML と SQL が互いに影響しないこと**・旧キー互換
- [x] `npx tsc --noEmit` エラーなし／`npm run lint` 0 errors・48 warnings（変更前と同数）
- [x] **実機確認（2026-08-09・OK）**：デッキ編集の SQL 行→一覧→編集面、SQL ブロックのトグル/チップ、
      「使わない」で初期化なしの素の DB になること

---

## 見つけて直した穴：`updateDeck` が互換ミラーを黙って NULL にしていた

`updateDeck` は `htmlStages`/`sqlStages` を「渡されたときだけ」更新する一方、**旧列（`htmlInit`/`sqlInit`）は
無条件に `data.htmlInit ?? null` で書いていた**（044 から）。そのため土台を渡さない更新をすると、
土台の JSON は残るのに**ミラーだけが NULL になる**。新バージョンは配列を読むので画面は正常に見えるが、
**旧バージョンの端末（iCloud 経由）と旧エクスポートからは土台が消える**という、最も気づきにくい壊れ方をする。

現在の呼び出し元は `deck/[id]/edit.tsx` の1箇所だけで両方を渡しているため実害は出ていなかったが、
045 の検証（土台を渡さない更新のあとにエクスポート→インポート）で顕在化した。**旧列も「渡されたときだけ」
書く**ように修正済み（`updatesHtmlInit` / `updatesSqlInit`）。ミラーは土台と同じデータの一部なので、
更新条件も土台に揃えるのが正しい。

---

## 不採用（再提案しないこと）

- **SQL 用に部品を並行実装する**（`lib/deckSqlStages.ts`・`DeckSqlStagesModal` を別に作る）
  — 約400行の重複を抱え、土台の仕様変更のたびに2箇所直すことになる。共用で足りる
- **`DeckStage.content` を言語ごとに別フィールドにする**（`html` と `sql` を持つ）
  — 型が1つで済まなくなり、共通部品がどちらを読むかの分岐を持つことになる
- **HTML と SQL で呼び名を統一する**（どちらも「土台」等）
  — 実物の語彙が既に違うため、画面ごとに言い方が食い違って読み手が迷う
- 044 の「不採用」（固定枠列・コピペ用プリセット・先頭へのフォールバック・並べ替え）は
  **そのまま SQL にも適用される**（`docs/044` 参照）
