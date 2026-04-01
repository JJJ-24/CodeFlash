# 022 カード全文検索

**フェーズ:** v1.1
**ステータス:** 完了
**依存:** 001, 002, 003

---

## 概要

全デッキ横断でカードを検索する機能。どのデッキにあるか分からないカードを
素早く見つけて編集画面に遷移できる。検索対象はカードの表面（frontContent）のみ。
ホーム画面のヘッダーに検索アイコンを追加し、タップで専用の検索画面へ遷移する。

---

## Todo

### DB
- [x] `lib/database/cards.ts` に `searchCards(db, query)` を追加
  - [x] `frontContent LIKE ?` で検索（frontContent は JSON文字列として保存されているため LIKE で検索可能）
  - [x] `ORDER BY updatedAt DESC LIMIT 100` で過剰な結果を防ぐ

### 画面
- [x] `app/search.tsx` — 検索画面を新規作成
  - [x] 自動フォーカス TextInput（`setTimeout` で 100ms 後にフォーカス）
  - [x] クエリ変更のたびにリアルタイム検索
  - [x] FlatList で結果表示（プレビューテキスト太字 + デッキ名サブテキスト）
  - [x] 各行タップで `/deck/[id]/card/[cardId]/edit` へ遷移
  - [x] クエリ空のときは結果0件
  - [x] 一致なし時は「一致するカードはありません」を表示
  - [x] `useDeckStore` でデッキ名を解決（追加DBクエリなし）

### ナビゲーション
- [x] `app/_layout.tsx` に `<Stack.Screen name="search" />` を追加

### ホーム画面ヘッダー
- [x] `app/(tabs)/_layout.tsx` のホームタブに `headerRight` で検索アイコンを追加
  - [x] `Pressable` + `Ionicons name="search-outline"` でタップ → `/search` に遷移

### i18n
- [x] `common.search` — 「検索」/ "Search"
- [x] `card.searchPlaceholder` — 「カードを検索...」/ "Search cards..."
- [x] `card.searchNoResults` — 「一致するカードはありません」/ "No cards found"

---

## 設計メモ

- `frontContent` は SQLite に JSON文字列として保存されるため、LIKE 検索で
  テキストブロックの `content` フィールドの部分一致が可能。
  ただし JSON キー名（`"type":"text","content":"..."` など）にも一致してしまうため、
  クエリが `"type"` や `"content"` 等のJSON予約語と被ると誤ヒットする可能性がある（実用上は問題なし）。

---

## 検索対象フィールド選択（追加実装）

「すべて / 表面 / 裏面 / メモ」をセグメントボタンで切り替えられるよう拡張。
裏面に答えが含まれるため表面のみを検索したいケースがある一方、
裏面・メモから引きたいケースもあるため、ユーザーが選択できる方式とした。

### Todo

- [x] `searchCards(db, query, field)` に `field: SearchField` 引数を追加
  - [x] `SearchField = 'all' | 'front' | 'back' | 'memo'` 型をエクスポート
  - [x] `field` に応じて SQL の WHERE 句を切り替え（`all` のみ3列 OR 結合）
  - [x] デフォルト値は `'all'`
- [x] `app/search.tsx` に検索フィールド選択UIを追加
  - [x] 検索バー直下に横並びセグメントボタン（すべて / 表面 / 裏面 / メモ）
  - [x] 選択中はプライマリカラー背景・白文字で強調
  - [x] `searchField` state を `useEffect` の依存配列に追加（切替時に即再検索）
- [x] `locales/ja.json` / `locales/en.json` にキー追加
  - [x] `card.searchFieldAll` / `card.searchFieldFront` / `card.searchFieldBack` / `card.searchFieldMemo`
