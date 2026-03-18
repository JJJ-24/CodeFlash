# 005 カードエディタ（Markdown・ブロック）

**フェーズ:** MVP
**ステータス:** 未着手
**依存:** 001, 003, 004
**被依存:** 007, 009, 011, 015, 020

---

## 概要

Notion風のブロックベースカードエディタを実装する。表面・裏面・メモをタブで切り替え、`/` コマンドでブロックタイプを選択できる。Markdown 記法ベース。

---

## Todo

### エディタ基盤
- [x] `react-native-markdown-display` インストール（プレビュー用）
- [x] `react-syntax-highlighter` インストール（コードブロック用）— 外部ライブラリ非依存のカスタムトークナイザー（`lib/syntax-highlight.ts`）で実装
- [x] ブロックリスト表示コンポーネント（`components/editor/BlockEditor.tsx`）
- [x] ブロック追加メニュー UI（テキスト / コード選択）
- [x] 編集 / プレビュー 切替トグル

### テキストブロック
- [x] テキスト入力コンポーネント（`components/editor/TextBlockItem.tsx`）
- [x] Markdownプレビューレンダリング（`react-native-markdown-display`）
- [x] 太字・斜体・コード・見出し等の書式（Markdown記法）

### コードブロック
- [x] コードブロック入力コンポーネント（`components/editor/CodeBlockItem.tsx`）
- [x] 言語選択モーダル（JavaScript / TypeScript / Python / SQL / C++ 等 12言語）
- [x] シンタックスハイライト表示（`lib/syntax-highlight.ts` + `components/study/SyntaxHighlightedCode.tsx`）
- [x] `executable` フラグ（Switch UIで切替可能）

### 画像ブロック（プレースホルダー）
- [x] 画像ブロックのプレースホルダー表示（011チケットで本実装）

### 画面 / UI
- [x] `app/deck/[id]/card/new.tsx` — 新規カード作成（BlockEditor使用）
- [x] `app/deck/[id]/card/[cardId]/edit.tsx` — カード編集（タグ差分更新付き）
- [x] 表面 / 裏面 / メモ タブ切替
- [x] タグ入力欄（候補サジェスト付き、`components/editor/TagSelector.tsx`）
- [x] 保存ボタン（手動）
- [ ] 未保存変更の警告（戻る時）— 将来対応

### i18n
- [x] エディタ関連テキストは既存キー（card.front/back/memo/save）を使用

---

## 技術メモ

- ブロック編集は `FlatList` + ドラッグ並び替え（react-native-reanimated）
- `/` コマンドは入力中にモーダル表示
- コードブロックのハイライトは100ms以内の目標
