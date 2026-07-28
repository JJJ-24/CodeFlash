# 043 HTML 画像ライブラリ（デッキに登録した写真を `<img>` で参照）

**フェーズ:** 将来
**ステータス:** Phase 1・2 実装完了（2026-07-29）／Phase 3 以降 未着手
**要ネイティブ再ビルド:** `expo-image-manipulator` 追加のため dev client を1回作り直すこと
**依存:** 040（HTML/CSS プレビュー実行・デッキ土台）・009（コード実行基盤）
**被依存:** なし

---

## 概要

デッキに**写真アプリから画像を登録**しておき、HTML ブロック／HTML 土台から
`<img src="img://logo">` のように**名前で参照**できるようにする。実行の瞬間だけ
data URI に差し替えてプレビューに表示する。

画像ブロックとの違いは「**カード上に絵が見えず、ソース（`<img>` タグ）だけが見える**」こと。
CSS の `object-fit` / `filter` / `clip-path` / `background-size` のように、**画像そのものが
教材の対象になる**カードで使う。

### なぜ base64 直貼りではなくこの方式か

data URI をカード本文に直接貼る運用（現状の唯一の手段）は、base64 文字列が
`card_contents` に保存され、**JSON/TSV エクスポートにも iCloud 同期にも丸ごと乗る**。
写真1枚で数MBのテキストがDBに入り、エディタの `TextInput` も重くなる。

本方式は**カード本文には `img://logo` という短い文字列しか残らない**。実体は既存の
`images/` ディレクトリにファイルとして置かれ（＝画像ブロックと同じ資産管理に乗る）、
base64 化は実行時のメモリ上だけで行われる。**DBは一切太らない**のが最大の利点。

---

## 確定仕様（設計合意・2026-07-29）

| 論点 | 決定 |
|---|---|
| 登録の粒度 | **デッキ単位のみ**（土台と同じ粒度。ブロック単位は将来拡張） |
| 保存先 | **`decks.htmlImages` に JSON 列を1本追加**（テーブル新設はしない＝同期トリガーの新規追加も不要） |
| 参照名 | **手入力＋既定値は自動採番**（`img1`, `img2`…）。HTMLに書く名前なので意味のある語を付けられること優先 |
| 画像の縮小 | **登録時に長辺 1024px へ縮小**（`expo-image-manipulator` を新規追加） |
| Pro ゲート | **Pro 限定**（HTML/CSS 土台自体が Pro 限定なので自然に従属） |

### 参照構文

```html
<img src="img://logo">                        <!-- HTML ブロック本文 / 土台 どちらでも -->
<div style="background-image:url(img://bg)">  <!-- CSS でも同じ（単純な文字列置換のため） -->
```

- 名前は **`[A-Za-z0-9_-]+`**（正規表現置換の安全性とURLとしての素直さのため記号を制限）。
- 名前は**デッキ内で一意**。重複は登録時に弾く。
- **未解決の参照**（画像を消した等）は、名前を書いた**グレーのプレースホルダ SVG** に置換する
  （そのまま残すと「壊れた画像」アイコンになり原因が分からないため）。

### 置換のタイミング

実行時（および実行前プレビューの構築時）に、**サンドボックスHTMLへ渡す直前**で文字列置換する。

```
土台 + 本文（img://logo を含む）
   ↓  resolveHtmlImageRefs()   ← 043 で新設
土台 + 本文（data:image/jpeg;base64,… に差し替え済み）
   ↓  buildWebSandboxHtml() / buildStaticPreviewHtml() / buildInteractiveWebSandboxHtml()
WebView
```

**`lib/code-execution/sandbox.ts` は無改造**。オリジン制約（`about:blank`・opaque origin）にも
一切触れない＝ `docs/040` の「サンドボックスの実測制約」はそのまま有効。

---

## ⚠️ 実装順の注意（最初に読む）

**Phase 1 の「参照集計の拡張」を後回しにすると、登録した画像が次回アプリ起動で消える。**

`app/_layout.tsx:53` が起動時に `cleanupOrphanImages(db, …)` を呼び、
`getReferencedImageFilenames()`（`lib/image.ts:96`）が返す集合に**入っていないファイルを削除する**。
この関数は現在 **`card_contents` のブロックだけ**を走査するため、`decks.htmlImages` に登録した
画像は**孤立扱いで即削除される**。

同じ関数は `lib/sync/syncEngine.ts` の **3箇所**（141・161・183行）でも
「iCloudへ上げる／から落とす画像」の決定に使われている。つまり：

> **`getReferencedImageFilenames()` を1つ直せば、孤児掃除・iCloud同期（上り/下り）・
> 自動バックアップの温存（029）がまとめて解決する。**

一方 `lib/export.ts:24` の `extractImageFilenames()` は**別実装**なので個別に対応が要る。

---

## Todo

### Phase 1: データ基盤（※ 参照集計の拡張まで一気にやる）＝**実装完了（2026-07-29）**
- [x] `types/index.ts`：`DeckImage = { name: string; uri: string }`（`uri` は `local://images/xxx`）と `Deck.htmlImages: DeckImage[]` を追加
- [x] `lib/database/schema.ts`：`decks` に `htmlImages TEXT`（nullable・JSON文字列）を `PRAGMA table_info` 確認つき `ALTER TABLE` で追加（`htmlInit` と同型。`CREATE TABLE decks` は最小定義のままで新規インストールも同じ ALTER 経路を通る）
- [x] `lib/database/decks.ts`：`createDeck`/`updateDeck` に `htmlImages` を通す。`RawDeck` を `htmlImages: string | null` に分け、`toDeck` で配列へ正規化
  - [x] **`updateDeck` は `data.htmlImages !== undefined` のときだけ列を更新する**（他の任意項目と扱いが違う）。画像ライブラリはフォームの入力欄と1対1ではないため、渡さない呼び出し（他画面からのデッキ更新）で無条件に `?? null` すると登録済みライブラリが黙って消える
  - [x] `deleteImagesOfDecks()`：デッキ削除時にライブラリの画像ファイルも消す（image ブロックと同じ形に均して同経路へ）
- [x] `lib/image.ts`：**`getReferencedImageFilenames()` を `decks.htmlImages` も走査するよう拡張**
  - [x] 引数を `from = 'card_contents'` → **スキーマ接頭辞 `schema = ''`** へ変更し、`${schema}card_contents` と `${schema}decks` の2本を走査。呼び出し3種（`cleanupOrphanImages`・`getBackupReferencedImageFilenames`（`'bkimg.'` へ修正）・`syncEngine` の3箇所＝既定引数のまま）を追従
  - [x] `decks` の SELECT だけ try/catch で握り潰す（**旧スキーマのバックアップDBには `htmlImages` 列が無く落ちる**。ここで全体を諦めるとカード側の参照まで失って復元素材を消すため）
  - [x] `parseDeckImages()` / `serializeDeckImages()` を新設し、DB層・エクスポート・削除処理で共用
  - [ ] 動作確認：デッキに画像を登録 → アプリ再起動 → **消えていないこと**（※ 登録UIが Phase 5 のため**実機確認は Phase 5 まで持ち越し**。コード上は全経路が上記1関数に集約されていることを確認済み）
- [x] `lib/import.ts`：`decks` の明示列 INSERT に `htmlImages` を追加。旧データは `(d.htmlImages as string | null) ?? null` で吸収
- [x] `lib/export.ts`：`decks` は `SELECT *` なので列自体は自動。`extractImageFilenames(cards, decks)` にデッキ側の参照を追加（**ここが漏れると画像本体がエクスポートに入らない**）。`estimateExportSize()` も `SELECT htmlImages FROM decks` を足して同じ集合で見積もる
- [x] TSV（`lib/tsv.ts`）：**対象外とする**（Anki互換の表/裏テキストのみ・`sqlInit`/`htmlInit` と同じ扱い）＝判断済みとして記録
- [x] iCloud 同期：`sync_state` トリガーは列を問わず `decks` の変更を捕捉するため**追加対応なし**（032 の `archived` と同じ）。画像ファイル本体は上記 `getReferencedImageFilenames()` の拡張で自動的に同期対象に入る
- [x] `npx tsc --noEmit` / `npm run lint` ともにエラーなし

### Phase 2: 画像の登録・縮小 ＝**実装完了（2026-07-29）**
- [x] `expo-image-manipulator`（`~14.0.8`）を追加（`npx expo install`）。**ネイティブ依存のため dev client の再ビルドが1回必要**
- [x] `lib/image.ts`：`pickAndSaveImage(options?)` を**縮小オプション付きに拡張**（引数なしの既存呼び出し＝画像ブロックの挙動は不変）
  - [x] `pickAndSaveImage({ maxDimension: IMAGE_LIBRARY_MAX_DIMENSION })`。**長辺が上限を超えるときだけ** `resize`（拡大はしない・長辺だけ指定して比率は自動）
  - [x] 形式は**元が png なら png、それ以外は jpeg**（透過を保つ）。**長辺が上限以下でも変換は通す**＝HEIC 等を JPEG に揃え、Phase 3 の拡張子→MIME 対応を png/jpg の2択に単純化するため
  - [x] 既存の 5MB 上限チェックは**縮小前の元ファイル**に対する判定として維持（巨大な原本を読む前に弾く）
  - [x] 変換の中間ファイル（キャッシュ領域）は保存後に削除（best-effort）
  - [x] 新 API（`ImageManipulator.manipulate()` → `renderAsync()` → `saveAsync()`）を使用。`manipulateAsync` は deprecated のため不使用
- [x] 戻り値に `bytes`（保存後のサイズ）を追加し、`IMAGE_LIBRARY_WARN_BYTES`（1MB）を公開
  - [ ] 縮小後も 1MB を超える場合の警告 `InfoModal` 表示（**UI 側なので Phase 5 で実装**。判定材料はここで揃えた）
- [x] `npx tsc --noEmit` / `npm run lint` ともにエラーなし

### Phase 3: 参照解決（新規モジュール）
- [ ] `lib/htmlImages.ts` を新設
  - [ ] `resolveHtmlImageRefs(html: string, images: DeckImage[]): Promise<string>`
    - [ ] `/img:\/\/([A-Za-z0-9_-]+)/g` で走査 → 名前で引いて `data:{mime};base64,…` に置換
    - [ ] 未解決名は**プレースホルダSVG**（グレー地＋名前）の data URI に置換
    - [ ] 参照が無ければ**ファイルを一切読まずに即 return**（通常のカードに余計なI/Oを増やさない）
  - [ ] **メモリキャッシュ**（`Map<filename, dataUri>`）。実行前プレビューは土台編集の400msデバウンスごとに再構築されるため、毎回 `readAsStringAsync` すると重い
  - [ ] キャッシュ無効化：画像の削除・差し替え時（登録は新ファイル名なので不要）
  - [ ] 拡張子 → MIME 判定（jpg/jpeg・png・gif・webp。不明は jpeg 扱い）

### Phase 4: 実行系の配線
- [ ] `hooks/useCodeExecution.ts`：`run()` の web 系経路を**非同期化**（`resolveHtmlImageRefs` の await が入る）
  - [ ] `run(content, language, sqlInits?, htmlInits?, deckImages?)` に画像配列を追加
  - [ ] await 後に `setHtmlSource` するため、**遅れて解決した実行結果が新しい実行を上書きしないよう `runNonce` で自分の実行が最新か確認**してから反映する（C++ の `AbortController` と同じ思想）
  - [ ] console 専用言語（js/ts/python/sql/cpp）は従来どおり同期のまま＝影響なし
- [ ] `components/code/ExecutionOutput.tsx`：静的プレビュー（`buildStaticPreviewHtml`）も解決後のHTMLを受け取る形にする（`staticPreview` prop の生成元を非同期化）
- [ ] `components/code/InteractivePreviewModal.tsx`（041）：モーダル内でHTMLを組み立てているため、**ここでも同じ解決を通す**
- [ ] `deckHtmlInit` を流している既存経路に `deckHtmlImages` を併走させる
  - [ ] 編集：`card/new`・`card/[cardId]/edit` → `BlockEditor` → `CodeBlockItem`
  - [ ] 学習：`session.tsx` → `BlocksView` → `CodeRunnerView`
- [ ] `[プレビュー | ソース]` の**ソース表示は置換前**（`img://logo` のまま）を出す。巨大なbase64を表示しても読めないため

### Phase 5: デッキ編集 UI（画像ライブラリ）
- [ ] `components/SqlInitModal.tsx` に `footer?: React.ReactNode` を追加（テキストエリア専用の汎用性を壊さず、デッキ編集側から画像ライブラリUIを差し込む）
- [ ] 画像ライブラリUI（`components/deck/HtmlImageLibrary.tsx` を新設）
  - [ ] `[写真から追加]` ボタン → `pickAndSaveImage({ maxDimension: 1024 })`
  - [ ] 一覧行：サムネイル（`expo-image`）｜名前（インライン編集可・`[A-Za-z0-9_-]+` バリデーション・重複不可）｜`<img src="img://name">` をコピー｜削除
  - [ ] 削除は `ConfirmDeleteModal`（カードから参照中でも消せる＝未解決はプレースホルダで気づける）
  - [ ] 空状態は `EmptyState`（使い方1行＋`img://` の書式例）
- [ ] デッキ新規（`app/deck/new.tsx`）・デッキ編集（`app/deck/[id]/edit.tsx`）の「HTML/CSS 共通土台」モーダルに組み込み（**Pro 時のみ**・`htmlInit` 入力欄と同じ出し分け）
- [ ] 保存は既存のデッキ保存に相乗り（土台テキストと同じくライブ反映 → 画面の保存で確定）
- [ ] **新規キーは割り当てない**（追加はタップのみ。`I` はアイコン選択で使用済み・土台モーダル内は Esc で閉じる既存挙動のまま）

### Phase 6: 仕上げ
- [ ] `locales/ja.json` / `locales/en.json`（`deck.htmlImages*`・`code.imageNotFound` 等・ja/en 揃い確認）
- [ ] Pro ゲート確認（非 Pro は土台入力欄ごと非表示＝ライブラリにも到達しない）
- [ ] `lib/settings-keys.ts` への影響なし確認（新しい AsyncStorage キーなし）
- [ ] `docs/db-migration-checklist.md` の②「既存テーブルに新カラム」を上から通す
- [ ] `CLAUDE.md` に追記（`decks.htmlImages`・`img://` 構文・`lib/htmlImages.ts`・`getReferencedImageFilenames` が **card_contents と decks の両方**を見ること）
- [ ] `docs/040` の「サンドボックスの実測制約 > 画像」に「デッキ画像ライブラリ（043）を使えばローカル画像を参照できる」を追記

### Phase 7: 実機確認
- [ ] 写真アプリから登録 → `<img src="img://name">` でプレビューに表示される（HTMLブロック・土台の両方）
- [ ] **アプリ再起動後も画像が残っている**（＝孤児掃除に消されない）
- [ ] iCloud 同期：別端末で同じデッキのプレビューに画像が出る
- [ ] JSON エクスポート（画像を含む）→ 別端末で `replace` インポート → 表示される
- [ ] 画像を削除 → 参照側がプレースホルダになる（壊れた画像アイコンにならない）
- [ ] 041 全画面プレビューでも表示される
- [ ] 通常のカード（`img://` を含まないカード）の実行速度が変わっていないこと

---

## データ／実装方針

- **型**：`Deck.htmlImages: DeckImage[]`（`DeckImage = { name, uri }`）。DBには JSON 文字列で保存し、`toDeck` で配列へ正規化する（`archived` の boolean 正規化と同じ思想）。
- **DB**：`decks` に `htmlImages TEXT`（nullable）。テーブル新設を避けたのは、**新テーブルには `sync_state` 用トリガーの追加が要る**のに対し、`decks` の列追加ならトリガーが列を問わず変更を捕捉するため（032 `archived` の実例）。
- **画像の実体**：既存の `images/` ディレクトリ・`local://images/{uuid}.{ext}` 形式を**そのまま流用**。画像ブロックと同じ資産管理（同期・孤児掃除・エクスポート）に自動的に乗る。
- **置換は実行時のみ**：DB・エクスポート・同期のいずれにも base64 は入らない。
- **Pro**：土台入力欄が Pro 限定なので、ライブラリも同じ出し分けで足りる。買い切り失効がないためデータはPro解除後もDBに残る（018/040 と同じ）。

---

## 技術メモ / 注意点

- **`getReferencedImageFilenames()` が本チケットの急所**。ここを直さないと「登録した画像が起動のたびに消える」「同期されない」が同時に起きる。逆にここさえ直せば3系統（孤児掃除・同期上り・同期下り）が一度に片付く。バックアップDB用の `'bkimg.card_contents'` 呼び出しがあるため、**引数はテーブル名ではなくスキーマ接頭辞に変える**必要がある。
- **`run()` の非同期化に伴う競合**：await を挟むと「古い実行の結果が後から届いて新しいプレビューを上書きする」経路ができる。`runNonce` で自分が最新かを確認してから `setHtmlSource` する。
- **キャッシュしないと実行前プレビューが重い**：静的プレビューは土台編集400msデバウンスごとに再構築されるため、`img://` を含む土台では毎回ファイル読み込みが走る。
- **ソースタブは置換前を表示**する（置換後は数十万文字のbase64で読めない）。
- **名前の記号制限**は正規表現置換の安全性のため。日本語名を許すと `img://ロゴ` の境界判定が曖昧になり、CSS の `url()` 内などで誤爆しうる。
- **画像ブロックとの使い分け**は文言で明示する（ただ絵を見せたい＝画像ブロック／CSSの実験対象＝ライブラリ）。UI上で迷わせないこと。

---

## 将来拡張（本チケット対象外）

- **ブロック単位の画像**（`CodeBlock.htmlImages`）。デッキ単位で不足が出たら検討。
- **画像ブロックの画像を参照**（`card-image://1` 等）。カード上に絵が二重に出るため、需要が確認できてから。
- **登録済み画像のプレビュー内での差し替え**（`img://` を選ぶピッカーをコードエディタに出す）。
- **音声/動画**：`<video>`/`<audio>` はサンドボックスの制約（`allowsInlineMediaPlayback={false}`・要ユーザー操作）で実質使えないため対象外（`docs/040` 参照）。
