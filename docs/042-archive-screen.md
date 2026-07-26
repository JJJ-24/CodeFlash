# 042 アーカイブ一覧画面（一括解除／一括削除）

**フェーズ:** v1.10
**ステータス:** 実装完了（Phase 1〜4）。実機確認は残
**依存:** 032
**被依存:** ―
**料金区分:** 無料機能

---

## 概要

docs/032 の「将来拡張候補」に残っていた2項目 — 専用の「アーカイブ一覧」画面と、アーカイブ済みデッキの一括解除/一括削除 — をまとめて実装する。
一括操作は置き場所となる一覧画面が無いと成立せず、逆に一覧画面だけではホームの「すべて」フィルターと重複するため、1チケットにまとめた。

### 何が足りなかったか（着手前の実測）

- **アーカイブ済みデッキ**はホームの「すべて」フィルターでグレー表示され、左スワイプで1件ずつ解除できる＝「見る」導線はあった。足りないのは**まとめて解除/削除**する手段（1件ずつスワイプ、または各デッキの編集画面を開くしかない）。
- **個別アーカイブしたカード**は、各デッキを開いて「すべて」フィルターにするか全文検索で当てるしか無い＝**全デッキ横断で見る手段がゼロ**。ここが唯一の実質的な空白だった。
- 付随して `deleteDeck` は `grade_logs` も画像ファイルも消しておらず、`deleteCard` / `deleteCardsBulk` も `grade_logs` を残していた（孤児データが溜まる既存バグ）。一括削除で顕在化するため同梱で修正。

### 決定事項（設計レビュー済み）

- **導線:** 設定タブに専用行「アーカイブ」→ `/archive` を push。独立画面にしたのは `components/settings/SettingsDetail.tsx` が children を ScrollView で包む作りで、選択モード付き FlatList を入れ子にできないため
- **対象:** デッキ＋カードの2タブ。カードタブは `cards.archived = 1` のカードのみで、**アーカイブ済みデッキ配下の「実効アーカイブ」カードは含めない**（それはデッキタブで解除/削除する対象）
- **一括操作:** 解除＋削除の両方。解除は可逆なので確認なし、削除は件数を明示した確認モーダル
- **見た目:** 一覧の全行がアーカイブ済みなので慣習のグレー表示（`opacity: 0.55`）は**使わない**（全部灰色では区別にならない）。右端の `archive` アイコンだけで示す
- **Pro ゲートなし**（032 と同じく無料機能）

---

## 実装内容

### Phase 1 — DB 層 ✅

- [x] `lib/database/decks.ts`
  - [x] `setDecksArchived(db, ids, archived)` を追加（`setCardsArchived` と同じ CHUNK 500＋トランザクション）
  - [x] `deleteDecksBulk(db, ids)` を追加。`deleteDeck` は `deleteDecksBulk(db, [id])` に委譲して1本化
  - [x] **後始末の修正**: `grade_logs` の DELETE と画像ファイル削除（`deleteImagesOfDecks` → `deleteImagesInBlocks`）を追加。画像は DB 行を消す前に本文 JSON から拾う
- [x] `lib/database/cards.ts`
  - [x] `getArchivedCards(db)` を追加（`CARD_SELECT` 流用・`WHERE c.archived = 1 ORDER BY c.updatedAt DESC`。デッキ名はストアから引くので JOIN しない）
  - [x] `deleteCard` / `deleteCardsBulk` に `grade_logs` の DELETE を追加
  - [x] `deleteCardsBulk` の第3引数を `deckId | deckIds[]` に拡張し、`cardCount` の数え直しを対象デッキ分ループ（アーカイブ一覧は複数デッキのカードが混ざるため）

### Phase 2 — 画面 ✅

- [x] `app/archive/index.tsx` を新規作成（`app/tags/[tagId]/cards.tsx` を骨格として流用）
  - [x] カスタムヘッダー（`useLockedHeaderHeights`・戻る／タイトル＋キーボードアイコン／選択モード切替）
  - [x] 上部に [デッキ N][カード M] の2ブロック（ホーム/カード一覧のフィルターブロックと同寸法）
  - [x] 行: デッキ＝`DeckIcon`＋名前＋枚数、カード＝プレビュー2行＋所属デッキ名。右端に `archive` アイコン
  - [x] タップ＝通常モードは開く（デッキ→カード一覧／カード→編集）、選択モードは選択トグル
  - [x] 左スワイプ＝`SwipeToDeleteRow` に `archived` を渡して [解除][削除]
  - [x] 選択モード＝下部バーに [全選択] 件数 [解除][削除]（削除だけ赤）
  - [x] 解除後は `ArchivePill` で通知（行が一覧から消えるため）。フォーカスのスクロール追従はしない（032 の結論）
  - [x] 空状態は `EmptyState`（`archive-outline`）をタブごとに表示
  - [x] タブ切替時は選択とフォーカスを必ずリセット（デッキとカードで操作対象が別のため）
  - [x] 余白タップのフォーカス解除 Pressable は固定部（タブ行）と `ListFooterComponent` に分けて配置（リストの祖先に置かない＝スクロール不能を避ける）
  - [x] iCloud 同期（`dataRevision`）でデッキ/カードを再読込

### Phase 3 — 導線・ルート登録 ✅

- [x] `app/_layout.tsx` に `<Stack.Screen name="archive/index" options={{ headerShown: false }} />`
- [x] `app/(tabs)/settings.tsx` の `navItems` に「アーカイブ」行（`archive-outline`）を追加。`focusActions` は `navItems` から生成されるため J/K フォーカスは自動で追随する

### Phase 4 — キーボード・i18n・文書 ✅

- [x] キー（034 の慣習どおり。編集が無い画面なので矢印は iPhone/iPad 両方で登録）
  - 通常: `J/K`(↑/↓)=フォーカス、`Return`=開く、`E`=解除、`Delete`=削除、`S`=選択モード、`1`/`2`・`,`/`.`・`H/L`・`←/→`=タブ切替、`?`=一覧、`Esc`/`B`=戻る
  - 選択: `J/K`=フォーカス、`Space`=選択/解除、`A`(⌘A)=全選択、`E`=一括解除、`Delete`=一括削除、`S`=終了
  - 削除確認/ショートカット表示中は main を `active` ゲートで解除、Esc は別フックで常時有効、Return は確定操作なので削除確認に**割り当てない**
- [x] i18n: `archive.*`（title/decks/cards/noDecks(Sub)/noCards(Sub)/deleteDecksConfirm）、`shortcut.unarchiveFocused` / `unarchiveSelected` / `deleteSelectedItems` / `switchArchiveTab`。既存の `common.cardsCount`・`card.deleteSelectedConfirm`・`deck.deleteConfirm` は流用
- [x] `CLAUDE.md`（ディレクトリ構成・アーカイブ節・キー一覧）と `docs/032`（将来拡張候補）に追記

---

## 設計メモ

- **カードタブが `archived = 1` 限定な理由:** アーカイブ済みデッキ配下のカードまで並べると、デッキ1件のアーカイブで数百行が現れて一覧が使い物にならない。デッキ単位はデッキタブで解除/削除できるので、カードタブは「個別に退避したカード」に絞るのが自然。
- **グレー表示を使わない理由:** 一覧の全行がアーカイブ済みなので `opacity: 0.55` を適用しても情報にならず、可読性だけ落ちる。アーカイブであることは画面自体とアイコンが示す。
- **解除に確認を出さない理由:** 可逆な操作であり、確認は摩擦にしかならない。代わりに `ArchivePill` で「解除した」ことを通知する（行が消えるため何が起きたか分からなくなるのを防ぐ）。
- **削除の確認文:** デッキは配下カードと学習履歴が消えることを件数付きで明示する（`archive.deleteDecksConfirm`）。カードは既存の `card.deleteSelectedConfirm` を流用。
- **`grade_logs` の後始末を同梱した判断:** 032 の原則「過去実績は消さない」はアーカイブ（カードは残る）に対するもの。**削除**ではカード自体が消えるためログは孤児であり、残す理由が無い。ただし過去にカードを削除したユーザーの全体正答率が変わる可能性がある（従来は孤児ログが集計に混ざっていたため）。
- **アーカイブ済みデッキのカード一覧は初期フィルターを「すべて」にする:** デッキ行タップで開くのは通常のカード一覧（`app/deck/[id]/index.tsx`）なので、設定「初期表示フィルター」が復習などだとそのフィルターで開く。しかしアーカイブ済みデッキでは `activeCardCond` により「学習済み/復習/新規」が**構造的に常に 0 件**（たまたま空なのではない）で、空リスト＋学習ボタン無効＝041 の2択ダイアログにも到達できない状態になる。そのため `selectedFilter` の**初期値だけ**アーカイブ判定で `'all'` に倒す。`setLastDeckDetailFilter` は呼ばない（「直近」設定のユーザーが通常デッキ用に覚えていた値を潰さないため）。ホームの「すべて」からアーカイブ済みデッキを開いた場合にも同じく効く。フィルターブロック4つは表示したまま（0が並ぶこと自体が「学習対象から外れている」という情報になる）。
- **GestureHandlerRootView は置かない:** 同型の `app/tags/[tagId]/cards.tsx`（スワイプ行＋下部バー）が無しで動いており、必要なのは `DraggableFlatList` を使う画面（ホーム/カード一覧/タグ管理）だけ。

---

## 残課題・将来拡張

- [ ] 実機確認（デッキ/カードの解除・削除、キーボード、iPad レイアウト）
- [ ] 一括削除の前にバックアップを促す導線（データ管理へのリンク）を出すかどうか
- [ ] タグのアーカイブ（`tags` に `archived` 列が無い。別チケット）
- [ ] アーカイブ済みデッキの統合/復元（029 と関連）
