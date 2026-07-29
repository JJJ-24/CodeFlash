# 043 HTML 画像ライブラリ（デッキに登録した写真を `<img>` で参照）

**フェーズ:** 将来
**ステータス:** **実装完了（2026-07-29）**。全 Phase（1〜7・実機確認含む）完了
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
  - [x] 動作確認：デッキに画像を登録 → アプリ再起動 → **消えていないこと**（登録UIが Phase 5 のため持ち越していた分。**Phase 7 の実機確認で OK**）
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
  - [x] 縮小後も 1MB を超える場合の警告 `InfoModal` 表示（判定材料をここで揃え、**表示は Phase 5 で実装済み**＝`deck.htmlImagesLarge*`）
- [x] `npx tsc --noEmit` / `npm run lint` ともにエラーなし

### Phase 3: 参照解決（新規モジュール）＝**実装完了（2026-07-29）**
- [x] `lib/htmlImages.ts` を新設
  - [x] `resolveHtmlImageRefs(html: string, images: DeckImage[]): Promise<string>`
    - [x] `/img:\/\/([A-Za-z0-9_-]+)/g` で走査 → 名前で引いて `data:{mime};base64,…` に置換
    - [x] 未解決名は**プレースホルダSVG**（グレー地の破線枠＋`img://name` を等幅で描画）の data URI に置換。`encodeURIComponent` で包むので `"`・`#` を含まず、属性値でも `url()` でも壊れない
    - [x] 参照が無ければ**ファイルを一切読まずに即 return**（通常のカードに余計なI/Oを増やさない）
  - [x] **メモリキャッシュ**（`Map<localUri, dataUri>`）。実行前プレビューは土台編集の400msデバウンスごとに再構築されるため、毎回 `readAsStringAsync` すると重い
    - [x] 上限12枚（1枚最大1.4MB程度になりうるため、挿入順で古いものから捨てる）
  - [x] `invalidateHtmlImageCache(localUri?)` を公開（画像の削除・差し替え時に呼ぶ。引数省略で全消し）
  - [x] 拡張子 → MIME 判定（png/gif/webp/svg、既定は jpeg）
  - [x] `isValidImageName()` / `buildImageRef()` / `buildImageTag()` を公開＝**参照構文の定義元をこのモジュールに集約**（Phase 5 の入力バリデーションとコピー機能が同じ定義を使う）
- [x] 正規表現の境界を確認：`src="img://x"` / `src='img://x'` / `url(img://x-1)` のいずれでも**閉じ引用符・閉じ括弧を巻き込まない**。`img://`（名前なし）は非マッチ
- [x] `npx tsc --noEmit` / `npm run lint` ともにエラーなし

### Phase 4: 実行系の配線 ＝**実装完了（2026-07-29）**
- [x] **解決は「合成後の最終HTML」に対して1回だけ行う**方式にした（土台と本文を別々に解決しない）。`img://` は土台にも本文にも書けるため、最終形に対して1回かければ両方まとめて拾える＝差し込み口が3つで済む
- [x] `hooks/useCodeExecution.ts`：`run(content, language, sqlInits?, htmlInits?, deckImages?)` に画像配列を追加
  - [x] **`img://` を含むときだけ**非同期解決に入る（`hasImageRefs()` の同期判定）。含まなければ従来どおり同期で `setHtmlSource`＝**既存カードは挙動も速度も不変**
  - [x] **web 系（`isWeb`）に限定**。python/sql の本文にたまたま現れた `img://` を書き換えないため
  - [x] 解決待ちの間に次の実行・`clear`・`reset` が走った場合に古い結果で上書きしないよう `runSeqRef` の通し番号で判定（`runNonce` は関数更新で同期に値を読めないため別 ref）。`clear`/`reset` 側も番号を進めて**解決待ちが後から `htmlSource` を蘇らせない**ようにした
- [x] `components/code/ExecutionOutput.tsx`：静的プレビューに `deckImages` prop を追加し、**400msデバウンスの「後」で解決**する（前だと打鍵のたびにファイルを読む）
- [x] `components/code/InteractivePreviewModal.tsx`（041）：同じ解決を通す。**解決待ちの間は WebView を出さない**（未解決HTMLを一瞬描画してから差し替えるとスクリプトが2回走るため）
- [x] `deckHtmlInit` を流している既存経路に `deckHtmlImages` を併走させた
  - [x] 編集：`card/new`・`card/[cardId]/edit` → `BlockEditor` → `CodeBlockItem`
  - [x] 学習：`session.tsx`（`currentDeckHtmlImages`・5箇所）→ `BlocksView` → `CodeRunnerView`
- [x] `[プレビュー | ソース]` の**ソース表示は置換前**（`previewSource` は土台の生テキストなので元から置換対象外＝変更不要だった）
- [x] `npx tsc --noEmit` / `npm run lint` ともにエラーなし

> **疎通確認：2026-07-29 実機で OK**。登録UI（Phase 5）が無い状態で、デッキの HTML/CSS 土台に
> `<img src="img://test">` と書き、**破線枠のプレースホルダ**が描画されることを確認した。
> ＝「本文/土台 → 解決 → サンドボックス → WebView」が最後まで通っている。

### Phase 5: デッキ編集 UI（画像ライブラリ）＝**実装完了（2026-07-29）**
- [x] `components/SqlInitModal.tsx` に `footer?: React.ReactNode` を追加（テキストエリア専用の汎用性を壊さず、デッキ編集側から画像ライブラリUIを差し込む）
- [x] 画像ライブラリUI（`components/deck/HtmlImageLibrary.tsx` を新設）
  - [x] **既定は折りたたみ**（ヘッダー行のみ）。土台モーダルは `autoFocus` でキーボードが出るため、リストを常時展開すると入力欄が潰れる。追加した直後だけ自動展開する
  - [x] `+` ボタン → `pickAndSaveImage({ maxDimension: IMAGE_LIBRARY_MAX_DIMENSION })`。5MB超は既存の `card.imageSizeError*` を再利用、縮小後1MB超は `deck.htmlImagesLarge*` で警告（登録はブロックしない＝Phase 2 からの持ち越し分を回収）
  - [x] 一覧行：サムネイル（`expo-image`）｜名前（インライン編集）｜`<img src="img://name">` をコピー｜削除。リストは `maxHeight: 168` ＋スクロール
  - [x] 名前は**編集中テキストを別 state（`nameDrafts`・key は uri）に持ち、確定時だけ配列へ書く**。不正（形式NG・重複）な間は枠を赤くし、blur で破棄＝元の名前に戻る。これで不正な名前が保存されることがない
  - [x] 削除は `ConfirmDeleteModal`（参照中でも消せる＝未解決はプレースホルダで気づける）。**配列から外すだけでファイルは消さない**（保存前にキャンセルされたら参照が生き残るため。孤児は起動時掃除が回収）。あわせて `invalidateHtmlImageCache(uri)` を呼ぶ（同名で登録し直したとき古い絵が出るのを防ぐ）
  - [x] 空状態は1行テキスト（`EmptyState` はアイコン64pxで折りたたみ内には大きすぎるため不採用）
  - [x] **タップで本文へ挿入はしない**（コピーのみ）。制御された `TextInput` に `selection` を当てて挿入する方式は、カーソル行き過ぎの既知問題（`textblock-toolbar-cursor-overshoot`・再試行禁止）と同じ形になるため避けた
- [x] デッキ新規（`app/deck/new.tsx`）・デッキ編集（`app/deck/[id]/edit.tsx`）の「HTML/CSS 共通土台」モーダルに組み込み。**Pro ゲートは追加コード不要**（行自体が `{isPro && ...}` の中にあり、非 Pro は行→モーダル→ライブラリのどれにも到達しない）
- [x] 保存は既存のデッキ保存に相乗り（土台テキストと同じくライブ反映 → 画面の保存で確定）。未保存判定（`isDirty`/`hasChanges`）にも画像を追加
- [x] 行の「設定済み」表示を `htmlConfigured = 土台テキスト or 画像あり` に変更（行が両方への入口なので、画像だけ登録した状態を「未設定」と見せない）
- [x] **新規キーは割り当てない**（追加はタップのみ。`I` はアイコン選択で使用済み・土台モーダル内は Esc で閉じる既存挙動のまま）
- [x] i18n：`deck.htmlImages*` 6キーを ja/en に追加（既存 JSON の整形を崩さないようテキスト挿入で追記）
- [x] `npx tsc --noEmit` / `npm run lint` ともにエラーなし

### Phase 6: 仕上げ ＝**実装完了（2026-07-29）**
- [x] `locales/ja.json` / `locales/en.json`（`deck.htmlImages*` 6キー・ja/en 揃い確認済み）＝Phase 5 で実施。プレースホルダは画像内に `img://name` を描くだけなので `code.imageNotFound` のような文言キーは不要だった（言語非依存）
- [x] Pro ゲート確認（土台の行が `{isPro && ...}` の中＝非 Pro は行・モーダル・ライブラリのどれにも到達しない）
- [x] `lib/settings-keys.ts` への影響なし確認（新しい AsyncStorage キーなし＝`store/` にも変更なし）
- [x] `docs/db-migration-checklist.md` の②「既存テーブルに新カラム」を上から通した
  - [x] `ALTER TABLE` を書いた／ユーザーデータ＝バックアップ対象
  - [x] `lib/export.ts`：`decks` は `SELECT *` なので列は自動。**画像本体**は `extractImageFilenames()` に `decks` を渡して同梱（`estimateExportSize()` も同じ集合）
  - [x] `lib/import.ts`：INSERT 列に追加。旧エクスポート（列なし）は `?? null` で吸収
  - [x] boolean 列ではないので 0/1 正規化は N/A（JSON 文字列 → `parseDeckImages` で配列化）
  - [x] TSV：**対象外と判断**（Anki 互換の表/裏テキストのみ・`sqlInit`/`htmlInit` と同じ扱い）
  - [x] iCloud 同期：`decks` は `SYNC_TRACKED_TABLES` にあり、トリガーは列を問わない `AFTER UPDATE ON decks` なので**追加対応なし**
- [x] `CLAUDE.md` に追記
  - [x] ディレクトリ構成に `lib/htmlImages.ts` と `components/deck/HtmlImageLibrary.tsx`
  - [x] コード実行アーキテクチャに「HTML 画像ライブラリ（043）」の段落（保存形式・解決の差し込み口3つ・同期判定・web 系限定・runSeq・削除の扱い）
  - [x] 「HTML ブロック／HTML 土台で書けるもの」のローカル画像不可の記述に **043 なら可**の逃げ道を明記
  - [x] **`getReferencedImageFilenames()` が画像参照集計の唯一の定義元**であること（返さない＝消される／同期されない・参照元2系統・スキーマ接頭辞・旧バックアップの握り潰し・`extractImageFilenames` は別実装）を「DB・データ操作」に追記
  - [x] デッキ削除がライブラリ画像も消すことを削除の後始末に追記
- [x] `docs/040` の「サンドボックスの実測制約 > 画像」に 043 への導線を追記

### Phase 7: 実機確認 ＝**全項目 OK（2026-07-29）**
- [x] 写真アプリから登録 → `<img src="img://name">` でプレビューに表示される（HTMLブロック・土台の両方）
- [x] **アプリ再起動後も画像が残っている**（＝孤児掃除に消されない）
- [x] iCloud 同期：別端末で同じデッキのプレビューに画像が出る
- [x] JSON エクスポート（画像を含む）→ 別端末で `replace` インポート → 表示される
- [x] 画像を削除 → 参照側がプレースホルダになる（壊れた画像アイコンにならない）
- [x] 041 全画面プレビューでも表示される
- [x] 通常のカード（`img://` を含まないカード）の実行速度が変わっていないこと

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
