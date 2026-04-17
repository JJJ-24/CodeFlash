---
name: 編集・新規作成画面の文字サイズ統一
description: デッキ/カード/タグの編集・新規作成画面は文字サイズや仕組みを揃える
type: feedback
---

デッキ編集・新規作成、カード編集・新規作成、タグ編集・新規作成の3組の画面を変更する際は、文字サイズや実装パターンを統一する。

**Why:** バラバラに実装すると画面間で見た目が揃わなくなる。過去に修正が必要になった。

**How to apply:** 以下の規約を全3組に同時に適用する。

## 現在の統一規約

### ヘッダータイトル
- `headerTitle: () => <Text style={{ fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.text }}>` 形式のカスタムコンポーネントを使う
- `title: '文字列'` + `headerTitleStyle` の組み合わせは Expo Router で効かないケースがあるため使わない

### ヘッダーボタン（キャンセル・保存・作成）
- `fontSize: Math.min(theme.fontSize.md, 19.2)` で上限キャップ
- 小: 13.6px / 中: 16px / 大: 19.2px（上限）

### 画面下部ボタン（作成・削除・保存）
- `fontSize: theme.fontSize.lg` でテーマ連動（キャップなし）

### 対象ファイル
- `app/deck/new.tsx`
- `app/deck/[id]/edit.tsx`
- `app/deck/[id]/card/new.tsx`
- `app/deck/[id]/card/[cardId]/edit.tsx`
- `app/tags/new.tsx`
- `app/tags/[tagId]/edit.tsx`
