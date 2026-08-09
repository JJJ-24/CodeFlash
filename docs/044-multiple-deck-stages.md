# 044 デッキ土台の複数持ち（名前付き土台ライブラリ）

**フェーズ:** 将来
**ステータス:** **完了（2026-08-09・実機確認済み）**。SQL 初期化への追随は `docs/045` に分離（そちらも完了）
**要ネイティブ再ビルド:** 不要（JS のみ）
**依存:** 040（HTML/CSS プレビュー実行・デッキ土台）・043（`decks` への JSON 列追加の前例）
**被依存:** 045（SQL 初期化の複数持ち＝本チケットの部品を共用する）

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
| SQL 初期化 | **本チケットは HTML のみ**。SQL は同じ形で追随 → **`docs/045`（完了）** |

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

### Phase 2: デッキ編集の土台リスト UI ＝**実装完了（2026-08-08）**
- [x] **`components/deck/DeckStagesModal.tsx`** を新設：一覧シート（追加/削除）＋ 行タップで編集面が開く2段構成
- [x] 各土台の編集は既存 `SqlInitModal` を流用。**`onTitleChange`/`titlePlaceholder` を追加してタイトルを入力欄にし、名前の編集は編集面で行う**
  - **リストに名前入力を置かなかった理由**：リスト側にもキーボード追従（`SqlInitModal` が持っている持ち上げロジック）が必要になる。一覧は「見て・選んで・消す」だけに絞った
- [x] 先頭に「既定」バッジ。削除確認は**先頭（かつ残りがある）だけ文言を分ける**（既定が次の土台にずれる旨）
- [x] 一覧の各行に**最初の非空行を1行プレビュー**（開かずに見分けるため）。空の土台は「（空）」
- [x] `deck/new`・`deck/[id]/edit` の `H` キーと「HTML/CSS 共通土台」行を接続（状態を `htmlInit: string` → `htmlStages: DeckStage[]` に置換）
- [x] **中身が空の土台は保存しない**（名前だけ作って離脱した行が残らないように）＝`isDirty` も同じ基準で比較
- [x] 行の要約表示を `土台 {{count}}件`（`deck.htmlStagesSet`）に。土台が無く画像だけあるときは従来の「設定済み」
- [x] `updateStore` の `htmlInit` は `legacyHtmlInitMirror(stages)` にして DB 側と食い違わせない（Phase 1 の暫定処理は撤去）
- [x] 043 の画像ライブラリは**編集面の `footer` のまま**（デッキ単位のデータなのでどの土台を編集していても同じものが出る＝土台を書きながら参照名が見える 043 の狙いを維持）
- [x] i18n（`deck.stagesHint`/`stagesEmpty`/`stageDefaultName`/`stageDefaultBadge`/`stageEmptyBody`/`stageDelete*Confirm`/`htmlStagesSet`・ja/en）
- [x] Esc は階層ディスマス（削除確認 → 編集面は自前の Esc → 一覧を閉じる）。親画面は `subModalOpen()` で従来どおり抑止
- [x] `npx tsc --noEmit` / `npm run lint` ともにエラーなし

> **Phase 3/4 が入るまでの制限**：土台を2つ以上作れるようになったが、コードブロック側はまだ
> `deckHtmlInit`（＝先頭土台のミラー）を読んでいるため、**2つ目以降の土台はまだカードに効かない**。

#### 踏んだ落とし穴：RN `Modal` を兄弟に並べると2枚目が開かない（再発防止）

最初の実装は `DeckStagesModal` が「一覧の `<Modal>`」と「編集面の `<SqlInitModal>`」「削除確認の
`<ConfirmDeleteModal>`」を**フラグメント直下の兄弟**として並べていた。結果、

- 行をタップしても**編集面が開かない**（`setEditingId` は走っているのに何も出ない）
- 🗑 を押しても**削除確認が開かない**
- ✓ で一覧を閉じた後、**デッキ編集画面がタップを一切受け付けなくなる**（ヘッダーの ×/✓ だけ効く）

原因は **iOS が「すでに modal を提示している VC」からもう1枚を提示できない**こと。RN の `Modal` は
ルート VC から提示するため、兄弟に並べると2枚目の `presentViewController` が黙って失敗し、
提示状態も固着する。**2枚目は1枚目の `<Modal>` の children の中に置く**のが正解で、そうすると
一覧シートの VC から提示されて正しく重なる。043 の `HtmlImageLibrary`（`SqlInitModal` の
`footer` ＝ Modal の中に描画され、さらにその中に確認モーダルを持つ）が最初から正しい形だった。

### Phase 3: ブロック側の選択 UI と土台解決 ＝**実装完了（2026-08-08）**
- [x] `lib/deckStages.ts` に **`resolveDeckStageHtml(stages, block)`** を追加（`noDeckHtmlInit`→空／未指定→先頭／解決不能→空）。Pro ゲートは呼び出し側の責任
- [x] `CodeRunnerView` / `CodeBlockItem` の `htmlInits` 組み立てを解決関数に差し替え
  - [x] `CodeRunnerView` の `useMemo` には **`block` 丸ごとではなく必要な2フィールドだけ**渡す（依存配列を最小に保つ＝exhaustive-deps 警告も増やさない）
- [x] `CodeBlockItem`：**土台1個は従来の ON/OFF トグルのまま**、2個以上のときだけ「使わない＋各土台」のチップ選択に切り替え
  - [x] 選択中は `noDeckHtmlInit ? null : (deckStageId ?? 先頭)` を解決した id。**削除済みの id を指しているときは「使わない」をハイライト**（効果としてそうなっているため。stale な id が残っても解決不能＝常に土台なしなので害はない）
  - [x] 土台名が空なら「土台N」で表示（`DeckStagesModal` と同じ規則）
- [x] `stageDroppedByPro`（非Pro時の1行ヒント）の判定も解決関数ベースに追従
- [x] i18n（`editor.deckStagePickerLabel`/`deckStagePickerHint`/`deckStageNone`・ja/en）
- [x] **トグル表示のバグ修正**（実機確認で発覚）：土台2つ→片方を削除して1つに戻ると、ブロックは
  削除済み `deckStageId` を指したままトグル branch に戻る。トグルの `value` が `!noDeckHtmlInit`
  だったため、**実態は「土台なし」なのに ON と表示**され「ONなのにプレビューが出ない」状態になっていた。
  `value={activeStageId !== null}`（解決結果を見る）に修正し、**ON に戻す操作で `deckStageId` も
  クリア**（＝未指定＝先頭に復帰）するようにして復帰経路を作った。
  この修正が無いと、トグルを触っても死んだ参照が残り続けて土台が積まれない

### Phase 4: 配線の差し替え ＝**実装完了（2026-08-08）**
- [x] `deckHtmlInit?: string | null` → `deckHtmlStages?: DeckStage[]` に置換
  - [x] `app/study/session.tsx`（`currentDeckHtmlInit` → `currentDeckHtmlStages`・受け渡し5箇所）→ `BlocksView` → `CodeRunnerView`
  - [x] `app/deck/[id]/card/new.tsx`・`app/deck/[id]/card/[cardId]/edit.tsx` → `BlockEditor` → `CodeBlockItem`
- [x] **画面から `deck.htmlInit` を読む箇所が無くなったことを確認**（残っているのは DB 層のミラー書き・import の列・ショートカットの i18n キー名だけ）
- [x] `npx tsc --noEmit` / `npm run lint` ともにエラーなし（警告48件は変更前と同数）

### Phase 5: i18n・ショートカット ＝**実装完了（2026-08-08）**
- [x] 土台リスト・ピッカー・削除確認の文言は Phase 2/3 で追加済み（ja/en セット）
- [x] **「共通」を外す文言の棚卸し**：土台は1つではなくブロックが選ぶものになったので、
  「共通土台」という言い回しが実態と合わなくなった箇所を直した
  - `deck.htmlInitLabel`：`HTML/CSS 共通土台` → **`HTML/CSS 土台`**（デッキ編集の行・`DeckStagesModal` のタイトル）
  - `deck.htmlInitHint`：デッキ全カードの説明 → **「この土台を選んだコードブロックの実行前に…」**（＝土台1つ分の編集面の説明になったため）
  - `shortcut.htmlInit`：`HTML/CSS 共通土台を開く` → **`HTML/CSS 土台を開く`**
  - `editor.htmlInitHint`（ブロック固有土台）：差し替えたいときの案内を
    「『デッキ共通の土台を使う』をオフに」→ **「デッキ土台を『使わない』に」**（土台2つ以上では
    トグルではなくチップ選択になるため、両方の UI で通じる言い方にした）
  - `dataManagement.tsvLossDeckHtmlStages`：`HTML/CSS共通土台` → **`HTML/CSS土台`**
- [x] **据え置いたもの**：`editor.useDeckHtmlInitLabel`/`useDeckHtmlInitHint`（「デッキ共通の土台を使う」）は
  **土台がちょうど1つのときにしか出ない**ので「共通」のままで正しい
- [x] `ShortcutsModal` は `descKey` 参照のみ＝文字列差し替えで自動追従（構造変更なし）
- [x] `npx tsc --noEmit` / `npm run lint` ともにエラーなし

### Phase 6: 検証 ＝**机上検証は完了（2026-08-09）／実機の目視確認だけ残**

データ層・分岐ロジックは **`node:sqlite` 上で実コードを直接呼ぶハーネス**（`npm run verify:db`）で
確認した（42 アサーション全通過）。RN コンポーネントは node で描画できないため、UI の見え方だけ実機に残る。

- [x] **旧DBで起動**して既存デッキの土台が「土台1」として見えること（`toDeck` 正規化）
  - 実 `migrateDbIfNeeded` を通し、`ALTER TABLE decks DROP COLUMN htmlStages` で 044 以前の DB に
    戻してから再マイグレーション → `getAllDecks` が `[{id: LEGACY_STAGE_ID, name: '', html: 旧htmlInit}]`
    を返すこと、再読込で id が揺れないこと、土台なしデッキが `[]` になることを確認
  - `parseDeckStages` が壊れた JSON／形の違う要素を空・除外に倒すことも確認（デッキ読込を殺さない）
- [x] JSON エクスポート → `replace` インポートで `htmlStages` と `deckStageId` が復元されること
  - 実 `exportDatabase`／`importDatabase`（FileSystem だけスタブ）で往復。`merge` も同じく復元
  - エクスポート JSON の `decks[].htmlStages` と `card_contents` 内の `"deckStageId"` を実物で確認
- [x] **旧バージョンのエクスポートファイル**を新バージョンで読めること
  - 出力 JSON から `htmlStages`/`htmlImages`/`grade_logs` を削って読み込み → `htmlInit` から
    土台1件に合成されること、その土台が未指定ブロックに積まれることを確認
- [x] 非 Pro：土台が積まれないこと（`isPro` ゲートが新経路でも効く）
  - コード確認：`CodeRunnerView` / `CodeBlockItem` の**両方**で `deckStage = isPro ? resolve… : ''`。
    下流（`previewSource`・`stages`・`canExpand`・`run()` の `hasStage`）は全部 `htmlInits` 派生なので
    044 で新しい抜け道は増えていない。`canStaticPreview`・`canExpand`・選択 UI にも `isPro` が別途ある
- [x] 土台を削除 → 参照カードが土台なしに落ちること
  - `updateDeck` で土台を消して再読込 → `resolveDeckStageHtml` が `''`（**先頭にフォールバックしない**）。
    未指定ブロックは残った先頭を使う／先頭を消すと既定が次にずれる、も確認
- [x] 保存経路の互換（`htmlInit` ミラー）
  - `createDeck`/`updateDeck` が先頭土台を `htmlInit` にミラー書きし、先頭が変われば追従すること
  - **`htmlStages` を渡さない更新で土台が消えない**こと（他画面からのデッキ更新）
  - **旧バージョンの `UPDATE`（`htmlStages` を知らない）の後も列が残る**こと＝新バージョンで復帰する
- [x] iCloud 同期：土台だけの変更で `sync_state.localVersion` が進むこと（列指定なしトリガー）
- [x] TSV：`inspectTsvExport` の `deckHtmlStages` が件数（旧 `htmlInit` デッキも1件）・土台なしは警告なし
- [x] i18n：044 で追加/変更したキーが ja/en 両方に存在すること
- [x] **実機の目視確認（2026-08-09・OK）**：実行前プレビュー・ソースタブ・⛶ 全画面・`img://`（043）が
      **選択した土台**で描画されること。※合成 HTML は `htmlInits` から作られ 043 の解決は最終 HTML に
      1回かかる構造なので、**044 が変えたのは `htmlInits[0]` に入る文字列だけ**＝経路自体は 040/041/043 のまま
- [x] **実機の目視確認（2026-08-09・OK）**：土台1つ＝従来のトグル／2つ以上＝チップ選択の切り替わり、「既定」バッジ、
      削除確認の文言分け（先頭 vs それ以外）

> **検証ハーネスについて**：本リポジトリにはテストフレームワークが無いため、`node:sqlite` を
> expo-sqlite 互換の薄いシムでくるみ、`Module._resolveFilename` を差し替えて expo/RN モジュールを
> スタブする方式で実施した（`sucrase-node` で TS を直接実行）。**リポジトリに残してある**：
> 土台部分が `scripts/db-harness.ts`、044 のテストが `scripts/verify-db.ts`（`npm run verify:db`）。
> 同じ土台は `docs/db-migration-checklist.md` の確認（列追加・旧エクスポート読み込み・往復）に流用できる。
> ⚠️ ハーネス側でアプリのモジュールを読むときは **`import` ではなく `require()`**（`import` は巻き上げられ、
> スタブを入れる前に expo モジュールが解決されて落ちる）。

### Phase 7: SQL 初期化への追随 → **`docs/045` に分離（完了）**

SQL 初期化（`decks.sqlInit`）を同じ形にする作業は **`docs/045-multiple-deck-sql-stages.md`** に
独立したチケットとして切り出した（2026-08-09 実装・実機確認とも完了）。

045 は**本チケットの部品をそのまま共用**する（`lib/deckStages.ts`・`DeckStagesModal`・
ブロック側の選択 UI）。そのため 044 側にも次の変更が入っている：

- **`DeckStage.html` → `DeckStage.content` にリネーム**（HTML/SQL 共通の型にするため）。
  044 初期実装で書かれた JSON の旧キー `html` は `parseDeckStages` が読み取り時に吸収する
  ＝**データ移行の操作は不要**（保存し直すと新キーに移る）
- `resolveDeckStageHtml` は共通本体 `resolveStage()` の薄いラッパーになった（規則は不変）
- `legacyHtmlInitMirror` → **`legacyInitMirror`**（旧列がどちらでも使える名前に）
- ブロック側の選択 UI は `components/editor/DeckStagePicker.tsx` に抽出（`kind="html"` で使う）
- 一覧モーダルは `kind` prop で文言を切り替え、043 の画像ライブラリは `editorFooter` prop で差す

> ⚠️ **下の Phase 1〜6 は実装当時の記録**なので、`DeckStage.html` や `legacyHtmlInitMirror` など
> **リネーム前の名前で書かれている箇所がある**。現在の名前は上のとおり。

---

## 不採用（再提案しないこと）

- **`htmlInit2` / `htmlInit3` の固定枠列追加** — 上限が恣意的、名前が付かない、増やすたびに
  マイグレーションが要る。JSON 1列で全部解決する
- **土台を「コピペ用プリセット」として持つ**（ブロック土台に貼り付けるだけで生きた参照は張らない）
  — 実装は軽いが、**土台を直しても既存カードに反映されない**＝本チケットの目的そのものを満たさない
- **解決できない `deckStageId` を先頭土台にフォールバック** — 別の土台が黙って適用され、
  出題の前提が変わる。土台なしに落として作者が気づけるようにする
- **土台の並べ替え（v1）** — 「先頭＝既定」が動く場面が増える。必要になってから足す
