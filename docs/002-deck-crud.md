# 002 デッキ管理 CRUD

**フェーズ:** MVP
**ステータス:** 完了
**依存:** 001
**被依存:** 003, 014, 019

---

## 概要

デッキの作成・一覧表示・編集・削除機能を実装する。ホーム画面がデッキ一覧になる。

---

## Todo

### データ層
- [x] デッキ作成（`INSERT INTO decks`）
- [x] デッキ一覧取得（`SELECT * FROM decks ORDER BY updatedAt DESC`）
- [x] デッキ詳細取得（`SELECT * FROM decks WHERE id = ?`）
- [x] デッキ更新（name, description, language）
- [x] デッキ削除（カスケード: 紐付きカード・レビューも削除）
- [x] cardCount の自動更新（カード追加/削除時にトリガー）
- [x] Zustand デッキストア（`useDeckStore`）

### 画面 / UI
- [x] `app/(tabs)/index.tsx` — デッキ一覧画面
  - [x] デッキカード表示（名前・説明・カード枚数）
  - [x] 新規デッキ作成ボタン（FAB）
  - [x] アイコンボタンで削除・編集（確認ダイアログ付き）
  - [x] 空状態（デッキなし）の表示
- [x] `app/deck/new.tsx` — デッキ作成モーダル
  - [x] 名前・説明入力
  - [x] 言語選択（ja / en）
- [x] `app/deck/[id]/index.tsx` — デッキ詳細（カード一覧）
  - [x] カード一覧（003 チケット実装後に結合）
  - [x] デッキ編集ボタン
  - [x] デッキ削除確認ダイアログ
- [x] `app/deck/[id]/edit.tsx` — デッキ編集

### i18n
- [x] デッキ関連テキストの翻訳キー追加（ja / en）

---

## 技術メモ

- デッキ削除時は `ON DELETE CASCADE` でカード・レビューも連鎖削除
- `cardCount` はトリガーまたはアプリ側で同期
