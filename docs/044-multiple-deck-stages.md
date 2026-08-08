# 044 デッキ土台の複数持ち（名前付き土台ライブラリ）

**フェーズ:** 将来
**ステータス:** **Phase 1（データ基盤）完了（2026-08-08）**。Phase 2 以降は未着手
**要ネイティブ再ビルド:** 不要（JS のみ）
**依存:** 040（HTML/CSS プレビュー実行・デッキ土台）・043（`decks` への JSON 列追加の前例）
**被依存:** なし

---

## 概要

デッキが持てる HTML/CSS 土台を **1つ → 名前付きの複数**にし、コードブロック側で
**どの土台を使うか選べる**ようにする。

```
デッキ「HTML入門」
├─ 土台「フレックス」   <div class="row">…</div> + <style>…</style>
├─ 土台「グリッド」     <div class="grid">…</div> + <style>…</style>
└─ 土台「素の箱」       <div id="box">…</div>

カードA のコードブロック → 土台「フレックス」を使う
カードB のコードブロック → 土台「グリッド」を使う
カードC のコードブロック → 使わない
```

---

## なぜ必要か（現状の切り分け）

**「できない」わけではない。** 2026-08-08 に html にもブロック固有土台が付いたため、
「デッキ共通の土台を使う」を OFF にしてブロック土台に別パターンを貼れば、**1つのデッキで
複数パターンの土台を使い分けること自体は既にできる**。デッキを分ける必要はない。

足りないのは **再利用と一元管理**：

- パターン2を使うカードが10枚あれば、**10箇所に同じ土台をコピペ**することになる
- 土台を直したくなったら **10箇所すべてを直す**（1箇所忘れるとそのカードだけ挙動が違う、
  という最も気づきにくい壊れ方をする）

つまり本チケットの価値は「不可能→可能」ではなく、**「コピペ運用 → 名前付きで1箇所を直せば
全カードに効く」**。この位置づけを踏まえると、**既存カードの UI・挙動を一切変えずに**
入れられる（下記「ブロック側 UI」）。

---

## 確定仕様（設計合意・2026-08-08）

| 論点 | 決定 |
|---|---|
| 持ち方 | **`decks.htmlStages` に JSON 列を1本追加**（`DeckStage[]`）。`htmlInit2`/`htmlInit3` の**固定枠列追加は不採用** |
| 個数の上限 | **仕様上の上限なし**（実用は2〜5想定）。UI でも急かさない |
| 土台の識別 | **`id` で参照**（名前ではない）＝**リネームしても参照が壊れない** |
| ブロック側の参照 | `CodeBlock.deckStageId?: string`。**未指定＝先頭の土台＝既存カードの現状動作** |
| 「使わない」 | **既存の `noDeckHtmlInit` をそのまま流用**（フラグを作り直さない） |
| ブロック側 UI | 土台が**0〜1個のデッキでは現状のトグルのまま**、**2個以上のときだけピッカーに変わる** |
| 並べ替え | **v1 では無し**（先頭＝既定が動く場面を削除時だけに限定するため） |
| Pro ゲート | **Pro 限定**（土台自体が Pro 限定なので自然に従属） |
| 旧列 `htmlInit` | **残す＋先頭土台をミラー書き**（旧バージョン・旧エクスポートとの互換） |
| SQL 初期化 | **本チケットは HTML のみ**。SQL は同じ形で追随（Phase 7・後述） |

### なぜ固定3枠ではなく名前付きリストか

1. **前例がある** — 043 の `decks.htmlImages`（`{name, uri}[]` の JSON 列）と同じ形。
   UI も `HtmlImageLibrary`（追加/リネーム/削除）がそのまま雛形になる
2. **名前が付く** — 「土台1/2/3」だと作者自身が数週間後にどれがどれか分からなくなる
3. **上限を決めなくていい** — 3 で足りなくなっても列追加もマイグレーションも不要
4. **`id` 参照ならリネームで壊れない** — 名前で参照すると改名時に全カードの参照が切れる

---

## データモデル

```ts
// types/index.ts
export interface DeckStage {
  id: string;      // generateId()
  name: string;    // 表示名（既定は自動採番「土台1」「土台2」…）
  html: string;    // 土台の HTML/CSS
}

interface Deck {
  htmlInit: string | null;   // 【互換用】先頭土台のミラー。読み取りには使わない
  htmlStages: DeckStage[];   // 新・正となる持ち方
}

interface CodeBlock {
  deckStageId?: string;      // 未指定＝先頭の土台。noDeckHtmlInit が true なら無視
}
```

### 正規化は DB 層（`toDeck`）に閉じる（重要）

**画面・コンポーネントは `htmlStages` だけを見る。** 旧データの吸収は `toDeck` で行う：

```
htmlStages が非空          → そのまま
htmlStages が空 & htmlInit あり → [{ id: 生成, name: 既定名, html: htmlInit }] を合成して返す
どちらも無い                → []
```

こうすると `deckHtmlInit` を引き回している既存の配線（`session.tsx` → `BlocksView` →
`CodeRunnerView`、`card/new`・`card/[cardId]/edit` → `BlockEditor` → `CodeBlockItem`）を
**`deckHtmlStages: DeckStage[]` に置き換えるだけ**で済み、各所に「旧列フォールバック」が
散らばらない。

### 土台の解決（`htmlInits` 組み立て）

`CodeRunnerView` / `CodeBlockItem` の2箇所（下流は全部 `htmlInits` 派生なので自動追従）：

```
deckStage =
  非Pro                      → ''
  noDeckHtmlInit             → ''
  deckStageId 未指定         → stages[0]?.html ?? ''
  deckStageId が解決できる   → 該当の html
  deckStageId が解決できない → ''   ← 削除済みの土台を指している
```

**解決できない参照は「土台なし」に落とす**（先頭にフォールバックしない）。先頭に落とすと
**別の土台が黙って適用されて出題の前提が変わる**ため。土台なしなら js/ts はコンソール実行に
戻り、html は本文だけになるので**作者が気づける**。

---

## UI

### デッキ編集（`deck/new`・`deck/[id]/edit`）

現在は `H` キー／「HTML/CSS 共通土台」行 → `SqlInitModal`（テキスト1面）。これを
**土台リスト**に変える。

- 一覧：土台名＋先頭数行のプレビュー、`＋追加`／リネーム／削除
- 各行タップで編集面（＝現行の `SqlInitModal` をそのまま流用できる）
- **先頭の土台には「既定」バッジ**を出す（`deckStageId` 未指定のブロックが使う土台であることを示す）
- **先頭の土台を削除するときだけ確認**を出す（「土台を選んでいないカードは次の土台を使うようになります」）。
  2番目以降の削除は、参照しているカードが**土台なしになる**旨の確認
- 043 の画像ライブラリ（`SqlInitModal` の `footer`）との同居に注意＝画像はデッキ単位のまま変えない

### ブロック側（`CodeBlockItem`）

**土台が0〜1個のデッキでは今と完全に同じ**（`noDeckHtmlInit` のトグル行のみ／土台0なら非表示）。
**2個以上あるときだけ**、同じ位置のセクションがピッカーに変わる：

```
[ 使わない ] [ フレックス ] [ グリッド ] [ 素の箱 ]     ← 横並びチップ（選択中を塗り）
```

- 「使わない」＝ `noDeckHtmlInit: true`、それ以外＝ `deckStageId` をセット（`noDeckHtmlInit: false`）
- **学習画面には出さない**（土台の選択は作者の設定であって学習者の操作ではない）

---

## 後方互換（ここが本チケットの主リスク）

iCloud 同期は **DB ファイル丸ごと**を LWW で往復させるため、**更新前の端末と行き来する**
可能性がある。`htmlInit` を空にして `htmlStages` へ完全移行すると、**旧バージョンの端末では
土台が消えて見える**（データは残るが表示されない）。

対策：**`htmlInit` に先頭土台の `html` をミラー書きする**。

- 旧バージョンは `htmlInit` を読むので**先頭土台だけは今までどおり動く**
- 旧バージョンが `updateDeck` しても、知らない `htmlStages` 列は UPDATE 文に無いので**残る**
- 新バージョンは読み取りに `htmlStages` を使うのでミラーは書き捨てでよい
- 将来ミラーをやめるときは、旧バージョンが十分に消えてから

---

## Todo

### Phase 1: データ基盤 ＝**実装完了（2026-08-08）**
- [x] `types/index.ts`：`DeckStage` を追加、`Deck.htmlStages: DeckStage[]`、`CodeBlock.deckStageId?: string`
  - [x] `DeckStage.name` は**空文字を許容**する（旧 `htmlInit` から合成した土台は DB 層で名前を付けられないため）。空のときは UI が「土台N」で表示する
- [x] `lib/database/schema.ts`：`decks` に `htmlStages TEXT`（nullable・JSON文字列）を `PRAGMA table_info` 確認つき `ALTER TABLE` で追加（`htmlImages` と同型）
- [x] **`lib/deckStages.ts` を新設**（`parseDeckStages` / `serializeDeckStages` / `normalizeDeckStages` / `legacyHtmlInitMirror` / `LEGACY_STAGE_ID`）。Phase 3 の土台解決もここに置く
  - [x] 旧 `htmlInit` から合成する土台の id は**定数 `LEGACY_STAGE_ID`**（読むたびに `generateId()` すると `deckStageId` の照合や React の key が揺れる）
- [x] `lib/database/decks.ts`
  - [x] **`toDeck` で正規化**（`htmlStages` 空 → `htmlInit` から1件合成）＝下流に旧列を見せない
  - [x] `createDeck`/`updateDeck` で `htmlStages` を通し、**`htmlInit` に先頭土台をミラー書き**（`legacyHtmlInitMirror`）
  - [x] `updateDeck` は **`data.htmlStages !== undefined` のときだけ**列を更新する（043 の `htmlImages` と同じ落とし穴＝渡さない呼び出しで無条件 `?? null` すると土台が黙って消える）
  - [x] `createDeck` の戻り値も `normalizeDeckStages` を通す（読み直したときと同じ形にそろえる）
- [x] `lib/import.ts`：`decks` の明示列 INSERT に `htmlStages` を追加（**漏れるとエラーにならず黙って消える**）。旧データは `?? null` で吸収
- [x] `lib/export.ts`：`decks` は `SELECT *` なので自動＝**確認のみで変更なし**
- [x] `lib/tsv.ts`：`TsvExportLoss.deckHtmlInit`（bool）→ **`deckHtmlStages`（件数）** に変更。`hasTsvExportLoss` と `app/settings/data.tsx` の文言組み立て、i18n（`tsvLossDeckHtmlStages` に `{{count}}` 追加・ja/en）も追従。TSV 往復対象外は据え置き（判断として記録）
- [x] iCloud 同期：トリガーは `AFTER UPDATE ON decks`（列指定なし）＝**追加対応なし**（032/043 と同じ）＝確認のみ
- [x] `docs/db-migration-checklist.md` の②を消化（旧エクスポートの読み込み確認だけ Phase 6 へ持ち越し）
- [x] **Phase 1 は挙動不変**：土台を読むのは引き続き `deckHtmlInit`（＝ミラー）経路なので、画面の見た目・動作は変わらない
- [x] `npx tsc --noEmit` / `npm run lint` ともにエラーなし（警告48件は変更前と同数）

> **Phase 2 で消す暫定処理**：`app/deck/[id]/edit.tsx` の保存で、ストア更新に
> `htmlStages: normalizeDeckStages(null, normalizedHtmlInit)` を足してある。この画面はまだ旧
> `htmlInit` を編集するため、これが無いと**再読み込みまでストアの `htmlStages` が古いまま**になる。
> Phase 2 でこの画面が土台リストを直接編集するようになったら行ごと置き換えること。

### Phase 2: デッキ編集の土台リスト UI
- [ ] `components/deck/DeckStageList.tsx`（仮）：一覧＋追加/リネーム/削除。`HtmlImageLibrary` の作りを踏襲
- [ ] 各土台の編集は既存 `SqlInitModal` を流用（`title` に土台名）
- [ ] 先頭に「既定」バッジ、削除時の確認（先頭 / 2番目以降で文言を分ける）
- [ ] `deck/new`・`deck/[id]/edit` の `H` キーと「HTML/CSS 共通土台」行をリストに接続
- [ ] `isDirty` 判定に `htmlStages` を追加（破棄確認が効くこと）
- [ ] 043 の画像ライブラリ（`footer`）と同居して崩れないこと

### Phase 3: ブロック側の選択 UI と土台解決
- [ ] `CodeRunnerView` / `CodeBlockItem` の `htmlInits` 組み立てを `deckStageId` 解決に対応（上記ルール）
- [ ] `CodeBlockItem`：土台2個以上でチップピッカー、0〜1個は現行トグルのまま
- [ ] `stageDroppedByPro`（非Pro時の1行ヒント）の判定を新ロジックに追従
- [ ] 削除済み土台を指すブロックが**土台なし**に落ちること

### Phase 4: 配線の差し替え
- [ ] `deckHtmlInit?: string | null` → `deckHtmlStages?: DeckStage[]` に置換
  - [ ] `app/study/session.tsx`（5箇所）→ `BlocksView` → `CodeRunnerView`
  - [ ] `app/deck/[id]/card/new.tsx`・`app/deck/[id]/card/[cardId]/edit.tsx` → `BlockEditor` → `CodeBlockItem`

### Phase 5: i18n・ショートカット
- [ ] `locales/ja.json` / `en.json`（土台リスト・ピッカー・削除確認の文言）。**ja/en セットで**
- [ ] `H` キーの説明文言を「HTML/CSS 共通土台」→ 複数前提の表現に
- [ ] `ShortcutsModal` の記載を確認

### Phase 6: 検証
- [ ] **旧DBで起動**して既存デッキの土台が「土台1」として見えること（`toDeck` 正規化）
- [ ] JSON エクスポート → `replace` インポートで `htmlStages` と `deckStageId` が復元されること
- [ ] **旧バージョンのエクスポートファイル**を新バージョンで読めること
- [ ] 非 Pro：土台が積まれないこと（`isPro` ゲートが新経路でも効く）
- [ ] 土台を削除 → 参照カードが土台なしに落ちること
- [ ] 実行前プレビュー・ソースタブ・⛶ 全画面・`img://`（043）が選択した土台で動くこと

### Phase 7: SQL 初期化への追随（HTML 完成後）
- [ ] `decks.sqlStages` を同じ形で追加、`CodeBlock.deckSqlStageId`
- [ ] **`noDeckSqlInit` を新設**（現状 SQL には「デッキ共通を使わない」が無い＝`sqlInits` は常に `[deck, block]`）
- [ ] UI は HTML と同型（Phase 2・3 の部品を共用できるはず）

---

## 不採用（再提案しないこと）

- **`htmlInit2` / `htmlInit3` の固定枠列追加** — 上限が恣意的、名前が付かない、増やすたびに
  マイグレーションが要る。JSON 1列で全部解決する
- **土台を「コピペ用プリセット」として持つ**（ブロック土台に貼り付けるだけで生きた参照は張らない）
  — 実装は軽いが、**土台を直しても既存カードに反映されない**＝本チケットの目的そのものを満たさない
- **解決できない `deckStageId` を先頭土台にフォールバック** — 別の土台が黙って適用され、
  出題の前提が変わる。土台なしに落として作者が気づけるようにする
- **土台の並べ替え（v1）** — 「先頭＝既定」が動く場面が増える。必要になってから足す
