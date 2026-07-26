# 032 デッキ・カードのアーカイブ

**フェーズ:** v1.1**ステータス:** 実装完了（Phase 1〜9）。iPhone 実機で UI 確認済み。エクスポート/インポートと iCloud 同期での `archived` 伝播は実機確認が残課題
**依存:** 002, 003, 012, 023
**被依存:** ―
**料金区分:** 無料機能

---

## 概要

学習が済んだデッキ・カードを「削除はせずに学習サイクルから外して保管する」アーカイブ機能。
アーカイブしたデッキ・カードは、学習対象・due/新規カウント・バッジ・通知・**将来指標系の統計**から除外される。
一方で **過去の学習実績（ヒートマップ・ストリーク・正答率ログ）は残す**（＝「やった記録」は消さない）。

「非表示」ではなく「アーカイブ」という概念・用語で統一する（内部フラグ・UI ラベルとも）。

### 決定事項（設計レビュー済み）

- **用語:** アーカイブ（内部フラグ `archived`）
- **カスケード:** デッキをアーカイブ → 配下カードも含めて全除外（デッキ側が優先）。カードは個別アーカイブも可能。
- **統計/履歴:** 将来指標（due・新規・習熟度・当日対象）からは除外するが、過去のヒートマップ・ストリーク・正答率ログは残す。
- **ホーム:** 「すべて」「有効」の 2 ブロック。既定＝有効。最後の選択を AsyncStorage で永続化（ホーム専用設定は作らず「直近モード固定」）。
- **「有効」ブロックの色:** オレンジ（= due/復習色 `FILTER_COLORS.due`）とは衝突するので使わない。ニュートラル/primary とする。
- **カード一覧:** アーカイブカードは「すべて」フィルターのときのみグレー表示。`学習中/復習/新規` では非表示。
- **due ベースの「復習」ホームブロック（オレンジ）は本チケットの対象外**（将来別途追加）。

---

## 実装内容

### Phase 1 — DB スキーマ・マイグレーション ✅

- [x] `lib/database/schema.ts` に `archived` カラムを追加（既存ユーザー・新規両対応の PRAGMA table_info チェック方式）
  - [x] `ALTER TABLE decks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`
  - [x] `ALTER TABLE cards ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`（card_contents 再作成後でも判定できるよう table_info を取り直して実行）
  - [x] 部分インデックスは見送り（boolean の低カーディナリティで効果薄。除外条件は既存 `idx_cards_deckId` + サブクエリで対応）
- [x] iCloud 同期は既存の `sync_state` トリガーで自動追跡されるため追加対応不要（実機で動作確認済み）
- [x] `docs/db-migration-checklist.md` に追記（②に `cards` の明示列指定・boolean 正規化・TSV 判断の項目を追加し、`archived` を実例として記録）

### Phase 2 — 型・CRUD ✅

- [x] `types/index.ts` の `Deck` / `Card` に `archived: boolean` を追加
- [x] `lib/database/decks.ts`
  - [x] `setDeckArchived(db, deckId, archived)` を追加（`updatedAt` も更新）
  - [x] `RawDeck`→`toDeck` で `archived: !!row.archived` に正規化（`getAllDecks` / `getDeckById`）、`createDeck` は `archived: false` を返す
- [x] `lib/database/cards.ts`
  - [x] `setCardArchived(db, cardId, archived)` を追加
  - [x] 一括: `setCardsArchived(db, cardIds, archived)`（チャンク + トランザクション）
  - [x] `CARD_SELECT` に `c.archived` を追加、`toCard` で `archived: !!raw.archived`、`createCard` は `archived: false`
- [ ] `store/decks.ts` / `store/cards.ts` は既存の `updateDeck` / `updateCard`（全置換）で対応可能なため新規ヘルパー不要 → UI 実装（Phase 4/5）で利用

### Phase 3 — 「将来指標」クエリの除外ロジック ✅

> 方針: 「これから学習する／現在の状態」を表すクエリは `lib/database/utils.ts` の
> `activeCardCond(alias)`（カード非アーカイブ かつ 所属デッキ非アーカイブ）で絞る。
> 「過去にやった実績」を表すログ系クエリは **絞らない**。

**除外する（`activeCardCond` 適用済み）:**
- [x] 学習対象カードの抽出（`getDueCardIdsByDeckId` / `getDueCardIdsByTagId` / `getTodayCreatedCardIdsByDeckId` / `getTodayCreatedCardIdsByTagId` / `getUnlearnedCardIdsByDeckId` / `getUnlearnedCardIdsByTagId` / `getAllCardIdsByDeckId` / `getAllCardIdsByTagId` / `getTodayReviewedCardIdsByDeckId` / `getTodayReviewedCardIdsByTagId`）
- [x] due カウント（`getDueCountPerDeck` / `getDueCountByDeck` / `getDueCountPerTag` / `getTodayDueCount`）
- [x] 新規（当日作成）カウント（`getTodayCreatedCount` / `*PerDeck` / `*PerTag` / `*ByDeck`）
- [x] 未学習カウント（`getUnlearnedCountPerDeck` / `*PerTag` / `*ByDeck`）
- [x] 今日学習済みカウント（`getTodayReviewedCount` / `*PerDeck` / `*PerTag` / `*ByDeck`）
- [x] 学習済/未学習サマリー（`getLearnedUnlearnedCount`）
- [x] 今後7日の復習予定（`getUpcomingSchedule`）
- [x] 習熟度リスト（`getDeckMasteryList`）— アーカイブ済みデッキを除外
- [x] 現在状態スナップショット（`getAllGradeDistribution` / `getDeckGradeDistribution`）
- [x] 苦手カードランキング（`getWeakCards`）
- [x] タグ別カード総数（`getTotalCardCountPerTag`）
- [x] アプリアイコンバッジ（`updateBadgeCount` は `getTodayDueCount` 経由で自動除外。実機確認は残）

**除外しない（過去実績として残す・無変更）:**
- [x] ヒートマップ / 日次・月次（`getPast7DaysReviewedCount` / `getPast7DaysStudyActivity` / `getDailyReviewCounts` / `getMonthlyReviewCounts` / `getMonthlyReviewCountsByGrade`）
- [x] ストリーク（`getStudyStreak`）
- [x] 正答率・グレードログ系（`getGradeLogTotals` / `getCardGradeStats` / `getCardGradeHistory` / `getGradeAvgResponseTimes` / `getTopCardsByGrade` / `getCardCorrectRates`）
  - 追記（2026-07-11）: `getTopCardsByGrade` は実効アーカイブ（カード自身 or 所属デッキ）を `archived` として返し、統計タブの評価別ランキング行を一覧慣習と同じ**グレー表示（opacity 0.55＋archive アイコン）**にする。除外はしない（過去実績の原則どおり・デッキ選択/期間で絞り込み可能）
- [x] 新規作成の履歴チャート（`getPast7DaysCreatedCount`）— 作成履歴は実績扱いで無変更

> 注意: カード一覧/タグ一覧の生取得（`getCardsByDeckId` / `getCardsByTagId` / `searchCards`）は**意図的に除外していない**。アーカイブカードを「すべて」フィルターでグレー表示するため、絞り込みは UI 側（Phase 5）で行う。

### Phase 4 — 編集画面 UI（アーカイブトグル）✅

- [x] デッキ編集（`app/deck/[id]/edit.tsx`）にアーカイブトグル（Switch + 説明）を追加。保存時に `setDeckArchived` を呼び `isDirty` にも反映
- [x] カード編集（`app/deck/[id]/card/[cardId]/edit.tsx`）は `BlockEditor` の**末尾フッター（タグ・デッキ名と並ぶカード単位メタ情報の位置）にアーカイブトグル**を配置。`BlockEditor` に任意 props `archived` / `onArchivedChange` を追加し、`onArchivedChange` を渡した編集時のみ表示（新規作成画面では非表示）。デッキ同様**保存時に反映**（`handleSave` で `setCardArchived`、`handleClose` の未保存判定にも `archived` を含める）。ボトムバーは削除・保存の2ボタンに戻す
- [x] i18n: `deck.archive` / `deck.archiveHint`（カードのトグルでも流用）

### Phase 5 — 一覧 UI（グレー表示・フィルター）✅

- [x] **ホーム（`app/(tabs)/index.tsx`）**
  - [x] フィルターブロックを「有効（active）」「すべて（all）」の 2 つに
  - [x] 既定＝`'active'`、最後の選択を `lastHomeFilter` で永続化（直近モード固定）
  - [x] `'active'`: `archived=0` のデッキのみ。`'all'`: 全デッキ表示でアーカイブは `opacity 0.55` + `archive` アイコン
  - [x] 「有効」ブロックは primary 色（オレンジ不使用）
  - [x] 手動ドラッグは「有効」表示中も非表示分を末尾に保持して sortOrder を書き戻し（順序破壊防止）
  - [x] 有効デッキ0件時の専用 EmptyState（`home.noActiveDecks`）
- [x] **カード一覧（`app/deck/[id]/index.tsx`）**
  - [x] アーカイブカードは「すべて」のみグレー表示（`学習中/復習/新規` は Phase 3 のクエリ除外で自動的に非表示）
  - [x] グレー判定は**実効アーカイブ**（`card.archived || deck.archived`）。デッキ自体がアーカイブ済みなら配下カードは個別フラグ無しでもグレー＋アイコン表示（実際に学習対象外のため一貫させる）
  - [x] 選択モードに一括アーカイブ/解除ボタン（`setCardsArchived`、選択が全アーカイブ済みなら解除）
  - [x] 選択モードのキーボード `E` = アーカイブ切替（`shortcut.archiveSelected`）
- [x] **左スワイプにアーカイブ追加（`components/SwipeToDeleteRow.tsx`）**: 左スワイプで `[アーカイブ/解除][削除]` の2ボタンを表示。`onArchive` / `archived` を任意 props で追加（未指定なら従来どおり削除のみ）。デッキ一覧・カード一覧・タグカード一覧に配線（即時トグル）。タグカード一覧にはアーカイブのグレー表示も追加
- [x] **学習タブ（`app/(tabs)/study.tsx`）**: アーカイブ済みデッキを学習対象一覧と「すべて」合計から除外
- [x] **統計タブ（`app/(tabs)/stats.tsx`）**: 習熟度リストは Phase 3 の `getDeckMasteryList` 除外で自動的にアーカイブ済みデッキが落ちる（追加変更なし）

### Phase 6 — 設定ストア ✅

- [x] `store/settings.ts` に `lastHomeFilter: 'active' | 'all'`（既定 `'active'`）+ `setLastHomeFilter` + hydrate（`HOME_FILTER_KEY`）

### Phase 7 — エクスポート/インポート ✅

- [x] `lib/export.ts` — decks は `SELECT *` で `archived` を含む。cards の SELECT に `c.archived` を追加
- [x] `lib/import.ts` — decks/cards の INSERT に `archived` 列を追加（merge/replace 両モード）。旧データ（カラム無し）は `d.archived ? 1 : 0` で 0 フォールバック
- [x] `lib/tsv.ts` — **TSV には含めない**（Anki 互換のテキスト〈表/裏〉形式のため列追加は互換性を壊す。設計メモ参照）
- [x] iCloud 同期は DB ファイル全体をコピーするため `archived` カラムは自動的に伝播（追加対応不要）

### Phase 8 — i18n ✅

- [x] `deck.archive` / `deck.archiveHint`（デッキ・カード両編集のトグルで使用）
- [x] `common.active`（ホーム「有効」）/ `common.all`（既存「すべて」を流用）/ `common.archived`
- [x] `common.archive` / `common.unarchive`（カード一覧 選択バーの accessibilityLabel）
- [x] `home.noActiveDecks` / `home.noActiveDecksSub`（有効デッキ0件の空状態）
- [x] `shortcut.archiveSelected`（選択モード `E` キー）

### Phase 9 — アーカイブ中デッキからの学習（2択ダイアログ・閲覧モード）✅（2026-07-26）

> 背景: アーカイブ中デッキのカード一覧でも学習ボタンは**押せる状態のまま**で、押しても
> `startVisibleStudy` の対象が 0 件になり `return` するだけ＝**無反応**だった。
> 「学習できない仕様」ではなく行き止まりだったので、どの方針を採るにせよ解消が必要だった。

- [x] **2択ダイアログ**（`app/deck/[id]/index.tsx`・`ConfirmModal`）: アーカイブ中デッキで学習を開始しようとしたとき（学習ボタン・`Space`・`⇧Space`・右スワイプ「ここから学習」）に表示
  - [x] 学習開始の入口を `requestStudy(startId?)` に一本化（全入口で同じ分岐を通す）
  - [x] 「**アーカイブを解除して学習**」＝ `setDeckArchived(db, deckId, false)` → 通常学習。**解除するのは `decks.archived` だけ**で個別アーカイブのカードは戻さない（どれを個別アーカイブしていたかの記録が無く、一括復活は非可逆なため）＝対象は通常学習と同じ「非アーカイブカードのみ」
  - [x] 解除しても学習可能カードが 0 枚のときは、この選択肢自体を出さない（閲覧のみの1択）。フェード中にボタンが 2→1 に減って見えないよう直前構成を ref 保持（`InfoModal` の `lastInfoModalRef` と同じ流儀）
  - [x] 「**閲覧のみ（記録なし）**」＝ `/study/session` に `browse=1`
  - [x] 確定操作ではなく選択式なので `Return` は非割当（タップ / Esc）。表示中は背景ナビキーを `active` ゲートで解除し、Esc 階層に閉じるを追加
- [x] **閲覧モード**（`app/study/session.tsx`・`browse=1`）
  - [x] グレードボタンを出さず `submitGrade` を一切呼ばない ⇒ `reviews` / `review_logs` / `grade_logs` への書き込みも FSRS 計算も発生しない（バッジ・ヒートマップ・ストリークにも無影響）。`useStudySession` 側は無改造
  - [x] 裏面でも前後送り（`,` / `.`・FAB・「タップで裏返す」）のまま。通常/全画面の両モードで同じ扱い
  - [x] `1`–`4`（グレード）は無効化し、ショートカット一覧からも落とす
  - [x] 集計画面を持たない＝完了（最後まで送る / `Q`）でカード一覧へ即戻る。ヘッダーの ✓（終了）は戻るボタンと重複するため非表示、`Q` は「戻る」に読み替え
  - [x] ヘッダーに 👁（`eye-outline`）で状態表示（iPhone / iPad 両ヘッダー）
  - [x] 閲覧の対象は「一覧に見えているカードそのまま」＝**個別アーカイブのカードも含む**。記録しないので学習対象の概念が無く、「ここから」が指したカードから確実に始められるため
- [x] **無反応ケースの解消**: 学習ボタンの活性判定を `canStartStudy` に集約（通常デッキ＝非アーカイブカードが1枚以上／アーカイブ中デッキ＝一覧に1枚でもあれば有効）。全カードがアーカイブ済みなら半透明＋無効
- [x] **右スワイプ「ここから学習」の出し分け**: アーカイブ済みカード行では出さない（学習対象外なので押しても次のカードから始まってしまう）。デッキごとアーカイブ中は全行で出す＝ダイアログへの入口として残す
- [x] i18n: `deck.archivedStudyTitle` / `archivedStudyMessage` / `archivedStudyUnarchive` / `archivedStudyBrowse`・`study.browseMode`
- [x] `CLAUDE.md` のアーカイブ節に仕様を追記

**混在デッキ（デッキは通常・一部カードのみアーカイブ）ではダイアログを出さない**（従来どおり黙って除外）。
残りのカードで学習が成立するので提案することが無く、毎回確認が挟まると通常の学習導線が壊れるため。
除外されるカードは一覧で既にグレー表示されており視覚的に伝わっている。

---

## 設計メモ

- **TSV エクスポート/インポート:** `archived` は含めない。TSV は Anki 互換の「表\t裏」テキスト形式で、列を増やすと Anki との相互運用が壊れるため。アーカイブ状態を保持したい場合は JSON バックアップを使う。
- **検索（`app/search.tsx`）の扱い:** 明示的に探しているので結果には出すが、アーカイブ済みはグレー表示が無難。結果を完全に隠すと「探しても出ない」混乱を招くため表示する方針（実装時に確認）。
- **デッキの `cardCount` 表示（未対応・残課題）:** 現状 `decks.cardCount` はアーカイブ済みカードも含む総数。ホームのデッキ枚数バッジ・カード一覧「すべて」ブロック・学習タブ「すべて」合計は、デッキ内に個別アーカイブカードがあるとその分だけ多めに出る。ホームは学習文脈なので将来 **有効カード数（archived=0）** 表示へ寄せたいが、per-deck の有効カード数を別途ロードする必要があるため本フェーズでは見送り。デッキ単位のアーカイブは正しく除外される（学習対象・統計から消える）ので実害は小さい。
- **アーカイブ済みデッキ内のカード一覧:** デッキ自体がアーカイブ済みでも、デッキ詳細を開けばカードは閲覧・編集できる（学習サイクルから外れるだけでアクセス不能にはしない）。学習開始も Phase 9 の2択（解除して学習／閲覧のみ）で可能。
- **アーカイブのまま「記録に残る」通常学習は採らない（Phase 9 の検討・不採用）:** 「アラートで はい → そのまま通常学習」案は、アーカイブの意味（学習対象から外す）に反して FSRS の `nextReviewDate` が更新され、解除した瞬間の due 数・バッジの整合が読みづらくなる。またカード個別アーカイブ（明示操作でも学習できない）と非対称になる。**記録を残したいなら解除する**が正しい流れで、そのコスト（解除→学習→再アーカイブの往復でホーム「有効」・due・バッジが動く）を避けたい「昔のデッキを数枚めくりたいだけ」の需要には**閲覧モード**で応える、という住み分けにした。
- **閲覧モードをアーカイブ中デッキ限定にした理由:** 「記録を残さず見返したい」自体は通常デッキにもある需要（試験前に FSRS を汚さず通し見する等）だが、行き止まりが実在するのはアーカイブ中デッキだけ。一般機能への昇格（学習タブのトグル化など）は使われ方を見てから判断する。
- **「将来指標のみ除外、過去実績は残す」**の境界が本機能の肝。ログ系（review_logs / grade_logs ベース）は残し、現在状態・予定系（reviews.nextReviewDate / 当日作成 / 習熟度）は除外する。
- **ホームの既定永続化**はカード一覧の `initialFilterPreference='none'`（直近）と同じ挙動だが、ホームには対応設定が無いため「直近モード固定」とする。
- **iCloud 同期:** `archived` は `decks`/`cards` のカラムなので既存の sync トリガーで差分追跡される。LWW で端末間に伝播する。

---

## 将来拡張候補

- [ ] due があるデッキだけを表示するホーム「復習」ブロック（オレンジ）— アーカイブ軸とは別の軸として追加
- [x] 専用の「アーカイブ一覧」画面（設定 or ホームから導線）→ **docs/042 で実装**（設定タブ →`/archive`）
- [x] アーカイブ済みデッキの一括解除/一括削除 → **docs/042 で実装**（同画面の選択モード。カードの一括解除/削除も同時に対応）
