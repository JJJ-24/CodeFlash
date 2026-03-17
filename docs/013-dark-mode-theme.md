# 013 ダークモード＆テーマ

**フェーズ:** v1.0
**ステータス:** 完了
**依存:** 001
**被依存:** 016

---

## 概要

ダークモード・ライトモード切替と、フォントサイズ変更機能を実装する。端末設定に連動した自動切替にも対応する。

---

## Todo

### テーマシステム
- [x] テーマ型定義（AppColors, AppTheme）
- [x] ライトテーマ定数
- [x] ダークテーマ定数
- [x] `useTheme` カスタムフック（`lib/theme/index.ts`）
- [x] Zustand テーマストア（`useThemeStore`）※手動切替時に追加

### ダークモード
- [x] 端末設定に応じた自動切替（`useColorScheme`）
- [x] ライト / ダーク / システム連動 の3択設定
- [x] タブ画面（4画面）+ タブバー・ヘッダーへのテーマ適用
- [x] モーダル・詳細画面（deck/new, deck/edit, deck/detail, tags）へのテーマ適用
- [x] Stack デフォルトヘッダーのテーマ化（app/_layout.tsx）
- [x] カード作成・編集画面 + BlockEditor / TextBlockItem / CodeBlockItem / TagSelector へのテーマ適用

### フォントサイズ
- [x] フォントサイズ選択（小 / 中 / 大）
- [x] 全テキストコンポーネントへの反映

### 設定画面連携
- [x] `app/(tabs)/settings.tsx` — テーマ切替（ライト / ダーク / システム）
- [x] フォントサイズ変更（設定画面）
- [x] 設定の永続化（AsyncStorage）

### i18n
- [x] テーマ・設定関連テキストの翻訳キー追加

---

## 技術メモ

- テーマ変数は `ThemeContext` or Zustand で全体に配布
- Markdown / シンタックスハイライトのテーマも切替対応が必要
- `react-syntax-highlighter` はダーク / ライトテーマを指定可能
