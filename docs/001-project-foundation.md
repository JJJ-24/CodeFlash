# 001 プロジェクト基盤（DB・ナビゲーション・i18n）

**フェーズ:** MVP
**ステータス:** 進行中
**依存:** なし
**被依存:** 002, 003, 004, 005, 006, 013, 014

---

## 概要

全チケットの土台となる基盤を構築する。SQLite スキーマ定義、画面ナビゲーション構造、i18n（日英）基盤をセットアップする。

---

## Todo

### DB（expo-sqlite）
- [x] `expo-sqlite` インストール・初期設定
- [x] `decks` テーブル作成（id, name, description, language, cardCount, createdAt, updatedAt）
- [x] `cards` テーブル作成（id, deckId, frontContent JSON, backContent JSON, memoContent JSON, createdAt, updatedAt）
- [x] `tags` テーブル作成（id, name, color, createdAt）
- [x] `card_tags` テーブル作成（cardId, tagId 複合主キー）
- [x] `reviews` テーブル作成（cardId, easeFactor, interval, repetitions, nextReviewDate, lastReviewDate）
- [x] DB初期化ロジック（マイグレーション管理）
- [ ] DB操作ユーティリティ（型安全なクエリヘルパー）

### 状態管理（Zustand）
- [ ] `zustand` インストール
- [ ] ストア設計方針の決定（スライス分割など）

### ナビゲーション
- [x] `app/_layout.tsx` でルートスタック構成
- [ ] タブナビゲーション導入（ホーム / 学習 / 統計 / 設定）
- [ ] 型付きルート（`expo-router` の typed routes）設定確認

### i18n（i18next）
- [ ] `i18next` + `react-i18next` インストール
- [ ] `locales/ja.json` 作成（日本語）
- [ ] `locales/en.json` 作成（英語）
- [ ] 端末言語に応じた自動切替ロジック
- [ ] 翻訳キー型安全化（TypeScript型定義）

### その他
- [ ] `@/` パスエイリアス動作確認
- [ ] ESLint / Prettier 設定確認
- [x] 共通型定義ファイル（`types/index.ts`）作成（Deck, Card, Tag, Review）

---

## 技術メモ

- DB初期化は `useSQLiteContext` を使用
- i18n初期化は `app/_layout.tsx` で最上位に配置
- ブロックJSON型: `Array<TextBlock | CodeBlock | ImageBlock>`
