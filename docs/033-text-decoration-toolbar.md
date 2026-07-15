# 033 テキスト装飾ツールバー（マークダウン記法挿入）とハイライト

**フェーズ:** v1.8 候補
**ステータス:** 実装済み（Phase 1〜7）。※ Phase 7 は**実機確認待ち**（緑/ピンクの視認性を8テーマ×light/dark で確認）
**依存:** 005（カードエディタ）, 007（学習画面）, 008（全画面+Bluetoothキーボード）, 013（ダークモード/テーマ）, 028-2（カード表示テーマ）
**被依存:** ―
**料金区分:** 無料機能（ハイライト複数色は将来 Pro 候補にしてもよい）

---

## ⚠️ 設計変更（2026-07-02）— ツールバーをインライン補助パレット方式へ置換

当初は装飾ツールバーを **`InputAccessoryView`（キーボード上端ドック）** に置く設計だったが（下記の旧「決定事項」「Phase 2」「設計メモ」はその前提の歴史記録）、**iPad でテキストブロック編集突入時に `InputAccessoryView` 単体がフリーズ→クラッシュ**する独立バグがあり、当面 iPad では非表示にしていた。

これを解消するため、**コードブロックの `SymbolPalette` と同じ「フォーカス中ブロック直下にインライン描画する `View`」方式へ置換**した。

- 新規 `components/editor/MarkdownPalette.tsx`（旧 `MarkdownToolbar.tsx` は削除）。`TextBlockItem` が `visible={focused && !isPreview}` でブロック直下にインライン描画。
- 適用ロジック（`lib/editor/applyMarkdown.ts`・選択範囲の `selectionRef`・set-then-release）は**そのまま流用**。`BlockEditor` 側の共有 `InputAccessoryView`／クロスブロック登録（`activeWrapRef`・`onActivate/DeactivateToolbar`）は撤去し、各テキストブロックがローカルの `stableApply` を直接呼ぶ。
- **効果:** ① iPad のクラッシュ原因（accessory）を設計から排除＝**プラットフォーム gate なしで iPhone/iPad 両対応**（iPad 実機で動作・フリーズ無し確認済み）。② iPhone のコールド起動初回1タップ空振りも解消（accessory のウォームアップ問題が消滅）。
- **許容した既知の制約:** ドラッグ選択中、iOS 純正の編集メニュー（Cut/Copy/AutoFill）がパレットに一瞬重なることがある（ブロックが画面上部＝メニューが選択の下に降りるケース。スクロールで解消）。メニュー位置は OS が選択基準で動的決定するため回避ロジックは脆く入れない。コードブロックの `SymbolPalette` と同じ宿命としてユーザー合意で許容。

> 以降の本文（特に「決定事項」のツールバー配置・Phase 2・設計メモのツールバー置き場所/ハードウェアキーボード項）は **InputAccessoryView 前提の歴史記録**。実装は上記インラインパレット方式が正。

## 概要

テキストブロックの本文に対し、**範囲選択 → ツールバーから装飾を選ぶ**操作でマークダウン記法を挿入できるようにする。
あわせて、現状の記法（太字・斜体・見出し等）に加えて**ハイライト（背景色）**を新たにサポートする。

現状、テキストブロックは `react-native-markdown-display`（markdown-it ベース）で本文をレンダリングしており、
装飾は「本文文字列に記法を埋め込む → 表示側のスタイル/ルールで描画する」方式で成立する。
そのため `TextBlock`（`content: string`）の型・DB スキーマの変更は不要で、**表示ルールの追加**と**記法挿入の入力補助（ツールバー）**の2軸で実装する。

### ゴール

- 文字を選択して、ツールバーのボタン or キーボードショートカットで装飾記法を挿入できる
- 太字・斜体・インラインコード・取り消し線・ハイライト（囲みタイプ）と、見出し・箇条書き・引用（行頭タイプ）に対応
- ハイライトはまず**半透明1色**で全カードテーマに対応。将来的に複数色へ拡張できる土台を持つ
- iOS 純正の選択メニュー（Cut/Copy/Paste）は**消さず共存**させる
- Bluetooth キーボード接続時もツールバーのタップ操作が可能、かつキーショートカットでも装飾できる

---

## 決定事項（設計検討済み）

- **記法ベースで実装する。** リッチテキスト化（独自データ構造）はしない。本文はあくまでマークダウン文字列のまま。表示は既存の markdown レンダラを拡張する。
- **ハイライトは背景色。** 文字色は変えず、選択箇所の背後に帯を敷く（蛍光ペン風）。記法は `==文字==`（`markdown-it-mark`）。
- **ハイライト色は半透明（rgba＋アルファ）。** カードテーマ（`cardThemePreference`：paper/sky/rose…）の上に乗っても下地に色が混ざってなじむため、**1色で全テーマに対応**できる。不透明ベタ塗りは避ける。
  - ライト系: 例 `rgba(255, 193, 7, 0.5)`（アンバー）/ ダーク系: アルファを下げて `rgba(255, 193, 7, 0.3)` 程度（明るい文字を潰さない）
- **複数色は当面見送り。** `==` は1記法=1色しか表せず、複数色には独自記法＋ツールバー必須となり工数が跳ねるため。まず1色で出し、ニーズが固まってから拡張する。
- ~~**ツールバーは `InputAccessoryView`（キーボード上端ドック）に置く。**~~ 〔**撤回（設計変更 2026-07-02 参照）。** 通常 View でも `ScrollView` の `keyboardShouldPersistTaps="handled"` でフォーカス＝選択を失わずにボタンを押せる（コードブロックの `SymbolPalette` で実証）。現在はブロック直下インライン描画。〕画面内の通常 View に置くとタップで `TextInput` がフォーカス＝**選択を失う**。`InputAccessoryView` ならフォーカスを保持したままボタンを押せて、選択範囲に記法を適用できる。
- **iOS 純正メニューは隠さない。** `contextMenuHidden` は使わない（Copy/Paste も消えてしまうため）。純正メニューは選択の近くに浮き、装飾ツールバーは下端、で住み分ける。
- **ハードウェアキーボード対応。** 接続時はソフトキーボードが隠れるが `InputAccessoryView` は画面下端にドッキングして残る想定（**要実機確認**）。加えてキーショートカットでも装飾できるようにする。
- **純正メニューへの項目追加（「太字」等をネイティブメニューに足す）はしない。** RN/Expo マネージドでは標準サポートが弱くネイティブ実装が必要なため初版では非採用。

---

## 実装内容

### Phase 1 — ハイライト表示基盤（1色・半透明）

- [x] `markdown-it-mark` を導入（`package.json` ^4.0.0）。`==文字==` → `<mark>` トークン化。型定義なしのため `types/markdown-it-mark.d.ts` に最小宣言を追加
- [x] `components/editor/TextBlockItem.tsx` の `markdownItLinkify` インスタンスに `.use(markdownItMark)` を適用
- [x] `components/study/BlocksView.tsx` 側の markdown-it インスタンス（`mdInstance`）にも同様に適用（**編集プレビューと学習画面で表示を揃える**）
- [x] 両ファイルの `rules` に `mark` ルールを追加し、半透明背景色を当てる（背景色のみ・文字色は親から継承）
  - [x] ライト/ダークで `backgroundColor` のアルファを出し分け（明るい文字を潰さない）
  - [x] `theme.dark` 分岐。色は `lib/theme` に `HIGHLIGHT_COLORS`（light/dark）として定数化
- [x] 8つのカードテーマ（default/paper/mint/graphite/lavender/sepia/sky/rose × light/dark）すべてで視認性を実機確認 ← **残: 実機確認**

> 実装メモ: react-native-markdown-display は `mark` ルール未提供だと「unknown render rule」警告＋非表示になるため、カスタム `mark` ルールの提供が必須（既存 `em`/`strong`/`s` と同形）。`mark_open`/`mark_close` は `_open`/`_close` が剥がされて `mark` ノード型になる。

### Phase 2 — 装飾ツールバー基盤（InputAccessoryView + 記法挿入）

- [x] テキストブロックの `TextInput`（`components/editor/TextBlockItem.tsx`）に `onSelectionChange` を追加し、選択範囲 `{start, end}` を `selectionRef` で保持
- [x] `InputAccessoryView`（`inputAccessoryViewID` 紐付け・インスタンスごとに一意な nativeID）でツールバーを表示。iOS のみ（Android は `InputAccessoryView` 非対応のため非表示）
- [x] 記法挿入のユーティリティを新設（`lib/editor/applyMarkdown.ts`）
  - [x] 囲みタイプ: `wrapSelection(text, sel, left, right)` — 選択を `left…right` で囲む。未選択時はカーソル位置に挿入して内側へカーソル移動。start/end の逆順・範囲外も正規化
  - [x] 適用後の選択範囲を返し、`TextInput` の `selection` prop を**一時的に**制御して復元（onSelectionChange で制御解放＝以後は非制御に戻す「set then release」方式）
- [x] 挿入後に **選択が外れない / カーソルが記法の内側に来る** ことを iOS で確認（実装済み・**要実機確認**。Android はツールバー非表示）
- [x] このアプリの hidden TextInput ＋ `useKeyboardFocus`（フォーカス管理）との干渉確認（**要実機確認**。ツールバーは block TextInput 編集中のみ表示＝hidden 入力は既に blur 済みのため理論上は非干渉）

> 実装メモ〔**現行**〕: パレットは `components/editor/MarkdownPalette.tsx`（`MaterialIcons` の format 系アイコン）。`TOOLBAR_BUTTONS` 配列で記法を定義し、ボタン追加は配列に1行足すだけ。`TextBlockItem` がフォーカス中ブロック直下にインライン描画し、`onAction` に各ブロックローカルの `stableApply` を渡す。`ScrollView` の `keyboardShouldPersistTaps="handled"` によりボタンタップでフォーカス・選択を奪わないため、選択 → タップで装飾が当たる。
> selectionRef はフォーカス時に末尾で初期化（プログラム的フォーカス直後は末尾カーソルの onSelectionChange が発火しないことがあるため）。
>
> **〔歴史記録・InputAccessoryView 時代の回帰対策。設計変更で不要に〕** accessory 方式では `InputAccessoryView` を**ブロックごとに mount/unmount しない**ことが必須だった。仮想化リスト内の各 `TextBlockItem` で個別に mount/unmount すると、iOS にタッチを横取りする残留ビューが生じ、**画面下部の保存/削除ボタンが初回タップで反応しなくなる**ため、`BlockEditor` 直下に1つだけ常設（共有 nativeID `MD_TOOLBAR_ID`）し各ブロックで `inputAccessoryViewID` を共有、フォーカス中ブロックが `activeWrapRef` に適用関数を登録していた。インライン化でこの共有機構ごと撤去した（各ブロックが直下に自前のパレットを出すため残留ビュー問題が原理的に発生しない）。

### Phase 3 — 囲みタイプ記法ボタン

> `lib/editor/applyMarkdown.ts` の `toggleWrap()` で実装。**トグル方式**：選択ありは外側/内側が厳密一致なら解除・なければ付与、無選択は空ペアの2度押しで付与→解除。

- [x] 太字 `**…**`（表示は既存対応済み）
- [x] 斜体 `*…*`（表示は既存対応済み）
- [x] インラインコード `` `…` ``（表示は既存対応済み）
- [x] 取り消し線 `~~…~~`（markdown-it 標準で表示可。default rules に `s` あり）
- [x] ハイライト `==…==`（Phase 1 の表示と連動）
- [x] **トグル化**: 押すほど `****` が増える挙動を廃止。再押下で解除（行頭タイプと挙動を統一）

### Phase 4 — 行頭タイプ記法ボタン

> `lib/editor/applyMarkdown.ts` の `togglePrefixLines()` で実装。アクションは `MdAction`（`wrap` / `prefix`）に一般化し、`applyAction()` で振り分け。ツールバーは囲みタイプと区切り線で2グループ表示。

- [x] 見出し（`cycleHeadingLines`）— **レベル循環**（なし → `# ` → `## ` → `### ` → なし）。最初の行のレベルで判定し全対象行を揃える
- [x] 箇条書き（行頭に `- `・トグル）
- [x] 引用（行頭に `> `・トグル）
- [x] 複数行選択時の扱い: **選択がまたぐ全行**に付与（全行付与済みなら一括除去のトグル）。選択なしはカーソル行のみ・カーソルは prefix 分ずらして維持。空行はボタンで prefix を付けて見出し等を開始可能。机上テストで主要ケース検証済み（要実機確認）

### Phase 5 — キーボードショートカット統合（※ 034 完了後に実装）

> **依存: 034（キーボードのネイティブ化／UIKeyCommand）。** 装飾を効かせたいのは実テキストブロックが
> 編集中（フォーカス中）の瞬間だが、そのとき隠し TextInput は blur されており現行の `onKeyPress` 機構は
> 動かない。実 TextInput の `onKeyPress` は修飾キー（Cmd/Shift）状態を返さず Cmd+B 等のコンボが取れない＝
> 単一キーだと文字入力と衝突する。034 の UIKeyCommand なら**編集中でも Cmd+B/Cmd+I 等が自然に発火**する
> （テキスト入力が消費しないコンボは責任者チェーンを上って VC の key command が拾う）。よって本フェーズは
> 034（少なくともカードエディタ移行）を前提に実装する。現行方式で先に作ると作り直しになるため着手しない。

- [x] カード編集の入力モード中に、装飾用キーを割り当て（既存の `CARD_EDITOR_SHORTCUTS_EDIT` / `lib/cardEditorShortcuts.ts` と整合）
- [x] 既存キー（J/K/E/D/Q/`,`/`.`/A/R/T/S/X 等）と衝突しない割り当てを設計
- [x] `components/study/ShortcutsModal` のヘルプ表記を更新（EDIT リストに装飾4行を追加）

> **実装（2026-07-02）:**
> - **ルーティング:** `BlockEditor` に `activeApplyRef`（`useRef<((a: MdAction) => void) | null>`）を1本復活。`TextBlockItem` が `onFocus` で `onActivateApply(stableApply)`・`onBlur`/アンマウントで `onDeactivateApply(stableApply)`（親は**同一関数のときだけ** null 化＝フォーカス移動の競合ガード）。パレット（タッチ）はブロックローカルのまま＝共有 UI は復活させない。コードブロックは登録しないので自動的にテキストブロック限定にスコープされる。
> - **なぜ編集中でも発火するか:** 実 TextInput は**素の（リッチ非対応）入力**なので `⌘B/I/U` を消費せず、責任者チェーンを上って VC の key command が拾う。既存の Esc 代替 `Cmd+.`（編集中に入力欄から抜ける）が動いている実績が、Cmd コンボが編集中でも届くことの裏付け。非編集時は `activeApplyRef` が null＝無反応。
> - **キーマップ（Word/Docs 準拠を採用）:** 太字 `⌘B` / 斜体 `⌘I` / インラインコード `⌘E`（GitHub 準拠）/ 取り消し線 `⌘⇧X` / ハイライト `⌘⇧M`（mark）/ 見出し循環 `⌘⇧H` / 箇条書き `⌘⇧8` / 引用 `⌘⇧9`。iOS 予約の `⌘C/V/X/A/Z` は奪わない。`⌘.` は Esc 代替なので使わない。
> - **⌘⇧数字の取りこぼし対策:** Shift+数字が `'8'`/`'*'` のどちらの input 表現で届くか環境差があるため、`numDeco()` で「`'8'`+⌘⇧」「`'*'`+⌘⇧」「`'*'`+⌘」の3候補を登録（`deleteKeySpecs` と同じ防御的多重登録）。引用も同様に `'9'`/`'('`。
> - **iPad 安全:** Cmd 修飾コンボはフォーカスエンジンの予約対象外（予約は素の矢印/Tab のみ）。よって矢印のような `isPad ? [] : [...]` ゲート不要＝両プラットフォーム共通登録。
> - **流用（追加不要だった部分）:** 無選択時の空ペア挿入・見出し循環・行頭付与は `applyAction` が既に対応。選択復元の set-then-release（`pendingSelection`）はトリガー非依存で既に動く。
> - **要実機確認:** ① 素の TextInput が `⌘B/I` を消費しないか（理論上しないが個体差確認）。② `⌘⇧8`/`⌘⇧9` が実機で発火するか・iPad の OS ショートカット（スクショ等）と衝突しないか。衝突/不発なら英字ベース（例 `⌘⇧L`/`⌘⇧Q`）へ差し替え可能（`decoSpecs` の該当2行を変えるだけ）。

### Phase 6 — i18n

- [x] ツールバーボタンの `accessibilityLabel`（太字・斜体・コード・取り消し線・ハイライト・見出し・箇条書き・引用）を `editor.toolbar.*` として `ja.json` / `en.json` に追加
- [x] ショートカット説明文の追加（Phase 5 で対応）＝ `shortcut.decoInline` / `decoStrikeMark` / `decoHeading` / `decoListQuote` を ja/en に追加

### Phase 7 — ハイライト複数色（実装済み・要実機確認）

- [x] 記法の設計 ＝ **mark 限定の色プレフィックス方式**を採用。デフォルト（黄）は `==文字==`（**後方互換**）、緑 `==g|文字==`、ピンク `==p|文字==`。`markdown-it-attrs` は不採用（`{..}` を全体解釈するとコード本文の `{ } : ! %` を誤爆させるため）。代わりに `lib/editor/markdownHighlight.ts` の core ルール `markdownItHighlightColor` が **mark トークンだけ**を見て、開き `==` 直後の `g|`/`p|` を `mark_open` の attr `hl` に移し、本文からは除去する（`node.attributes.hl` が render rule に届くのは検証済み）。
- [x] ツールバー UI ＝ **1ボタンで色を循環**（なし→黄→緑→ピンク→なし。見出しと同じ循環 UX）。`applyMarkdown.ts` の `cycleHighlight()`（`MdAction { kind: 'highlight' }`）。色プレフィックスは常に選択範囲の外側（開き `==` の直後）に置くので、色を変えても選択は中身のまま保たれる。キーボードは `⌘⇧M`。
- [x] 各色をカードテーマ全種で視認性確認（半透明前提）← **残: 実機確認**（8テーマ × light/dark。特に緑/ピンクが `mint`/`rose`/`sky` テーマ上で沈まないか）。色は `lib/theme` の `HIGHLIGHT_COLORS`（`{ light/dark } × { y/g/p }`）で調整可能。
- [x] Pro 機能化するかの判断（現状は無料。将来 Pro 候補のまま保留）

> **実装メモ（2026-07-02）:**
> - **表示2経路を同期**：`TextBlockItem`（編集プレビュー）と `BlocksView`（学習画面）の両 MarkdownIt インスタンスに `.use(markdownItMark).use(markdownItHighlightColor)` を適用し、`mark` render rule で `HIGHLIGHT_COLORS[mode][node.attributes?.hl ?? 'y']` を使う（片方だけだと崩れる）。
> - **波及なし**：本文はプレーンな markdown 文字列のままなので、エクスポート/インポート・TSV・検索（LIKE）・iCloud 同期はスキーマ変更・追加対応なし。
> - **後方互換**：既存の `==文字==` は `hl` 無し＝黄で描画。循環でも「黄」状態として検出される。
> - **循環ロジックは node で単体検証済み**（選択・カーソル両方で なし→黄→緑→ピンク→なし が正しく巡回し、選択範囲が保持されることを確認）。

---

## 設計メモ

- **なぜ半透明か:** ハイライトはカード背景の上に乗る。カードテーマ自体がパステル（paper=クリーム/sky=水色/rose=ピンク…）なので、不透明色だとテーマごとに浮く/沈む。アルファで下地に色を混ぜると、どのテーマでも「マーカーでなぞった」見た目を保てる＝1色で全対応できる。
- **表示2箇所の同期:** テキスト装飾は「編集プレビュー（`TextBlockItem`）」と「学習画面（`BlocksView`）」の両方で同じ見た目にする必要がある。markdown-it インスタンスの `.use()` と `rules` を**両ファイルで揃える**こと（片方だけだと崩れる）。
- ~~**ツールバーの置き場所が肝:**~~ 〔**訂正（設計変更 2026-07-02）。** 通常 View でも `keyboardShouldPersistTaps="handled"` 配下なら selection を失わずタップできる。「accessory 必須」は誤りだった＝現在はインライン描画。〕`InputAccessoryView` 以外（通常 View）に置くと、ボタンタップで `TextInput` の selection が消えて装飾を適用できない。ここが本機能の最重要ポイント。
- **iOS 純正メニュー共存:** Cut/Copy/Paste は出る位置（選択の近く）が装飾ツールバー（下端）と異なるため、両方表示されても操作上ぶつからない。純正メニューは**消さない**（ユーザー要望）。
- **ハードウェアキーボード:** 〔設計変更で解決〕インラインパレットは**ブロック直下に描画＝ソフトキーボードの有無に依存しない**ため、ハードウェアキーボード接続時（ソフトキーボード非表示）でもパレットは常に出る。accessory 時代に懸念していた「アシスタントバー化で出ない」問題は消滅。本メモ末尾の代替案「エディタ内インライン固定バー」が結果的に採用された形だが、選択維持は `keyboardShouldPersistTaps="handled"` で足りた（追加対策不要）。
- **リッチテキスト化はしない:** 記法ベースに留めることで、エクスポート/インポート（JSON/TSV）・iCloud 同期・検索（`searchCards` の LIKE）が**追加対応不要**で済む（本文は従来どおりプレーンな文字列）。
- **コードブロックは対象外:** 装飾はテキストブロックのみ。コードブロックはシンタックスハイライト管轄で別物。
- **見出しのフォントサイズ（一般的な慣習に合わせて調整）:** 本文 lg(18) は据え置き、見出しは H1=xxxl(28) / H2=xxl(22) / H3=xl(20) / H4=lg(18) / H5=md(16) / H6=sm(14)。「本文 ≒ H4、H1〜H3 は本文より大きい、H5〜H6 は小さい」という標準構成に寄せた。**学習画面（`BlocksView`）と編集プレビュー（`TextBlockItem` の isPreview 分岐）の2箇所を必ず同一に保つ**こと（片方だけ変えると表示がズレる）。
- **記号衝突はインラインコードで回避（パーサー改造しない）:** `COUNT(*)` のようなコード片を本文に直接書くと、`*` や `_` が markdown 標準の強調記号として解釈され、意図せずイタリック/太字になる（markdown-it に限らず一般的な markdown 仕様。単なる改行では止まらず、空行で段落を割らない限り強調が継続する）。これはコード暗記アプリで頻発する。対策として「`()` 内の `*` を強調扱いしない」等のパーサー改造は**行わない**（`(*強調*)` のような正当ケースを壊し、本機能の太字/斜体判定とも衝突する）。**正しい解は「コード片はインラインコード `` `…` `` で囲む」**で、意味的にも適切。よってツールバーには**インラインコードボタンを必ず含め**、ユーザーが記号をエスケープ（`\*`）せず済むようにする。これが記号衝突の一次対策。

---

## 将来拡張候補

- [ ] ハイライト複数色（Phase 7）＋色で意味付け（重要=赤/補足=青 等）
- [ ] 文字色変更（背景ではなく文字自体の色）
- [ ] リンク挿入ボタン（`[文字](url)`）
- [ ] ツールバーのカスタマイズ（表示するボタンの選択）
