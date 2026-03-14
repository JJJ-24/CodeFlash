# 003 カード管理 CRUD

**フェーズ:** MVP
**ステータス:** 未着手
**依存:** 001, 002
**被依存:** 004, 005, 006, 007, 014, 019, 020

---

## 概要

カードの作成・一覧表示・編集・削除機能を実装する。カードはデッキに属し、表面・裏面・メモの3面をブロック配列で持つ。

---

## Todo

### データ層
- [x] カード作成（`INSERT INTO cards`、frontContent/backContent/memoContent は JSON文字列）
- [x] デッキ内カード一覧取得
- [x] カード詳細取得
- [x] カード更新
- [x] カード削除（紐付き card_tags, reviews も削除）
- [x] カード並び替え（createdAt ASC）
- [x] Zustand カードストア（`useCardStore`）

### 型定義
- [x] `Block` 型ユニオン（TextBlock / CodeBlock / ImageBlock）— types/index.ts に定義済み
- [x] `Card` 型 — types/index.ts に定義済み
- [x] JSON シリアライズ / デシリアライズ ユーティリティ（lib/database/cards.ts 内）

### 画面 / UI
- [x] `app/deck/[id]/index.tsx` のカード一覧部分
  - [x] カードプレビュー表示（表面テキスト先頭を表示）
  - [x] 新規カード作成ボタン（FAB）
  - [x] 長押し or トラッシュアイコンで削除
  - [x] 空状態の表示
- [x] カード削除確認ダイアログ
- [x] `app/deck/[id]/card/new.tsx` — 簡易カード作成画面（表面・裏面テキスト入力）

### i18n
- [x] カード関連テキストの翻訳キー追加

---

## 技術メモ

- `frontContent` 等は SQLite の TEXT 型に JSON.stringify して保存
- `Block[]` の型安全な parse には zod 等の利用を検討
