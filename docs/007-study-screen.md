# 007 学習画面（通常モード）

**フェーズ:** MVP
**ステータス:** 未着手
**依存:** 003, 005, 006
**被依存:** 008, 012, 016

---

## 概要

カードをフリップして自己評価するメイン学習画面を実装する。デッキ単位 or タグ単位で学習対象を選択できる。カードフリップは60fps アニメーション。

---

## Todo

### 学習セッション管理
- [x] 学習対象選択（デッキ単位）— `app/(tabs)/study.tsx`
- [x] 復習対象カードのキュー管理（`hooks/useStudySession.ts`）
- [x] セッション進捗管理（reviewed / totalCards）
- [x] セッション完了画面（学習結果サマリー）

### カードフリップ UI
- [x] カードフリップアニメーション（`react-native-reanimated`、320ms）— `components/study/FlipCard.tsx`
- [x] 表面ブロックレンダリング（Markdown / コードブロック）— `components/study/BlocksView.tsx`
- [x] 裏面ブロックレンダリング
- [x] メモ表示/非表示 トグル
- [x] タップで表→裏切替

### 自己評価 UI
- [x] 裏面表示後に自己評価ボタン表示（もう一度 / 難しい / 普通 / 簡単）
- [x] 評価タップ → SM-2 計算 → 次のカードへ
- [ ] スワイプジェスチャーで評価 — 将来対応

### 学習開始フロー
- [x] `app/(tabs)/study.tsx` — デッキ選択・due枚数表示
- [x] `app/study/session.tsx` — 学習セッション画面
- [x] デッキ詳細の「学習開始」ボタン接続

### i18n
- [x] 学習画面テキストの翻訳キー追加（study.* / grade.*）

---

## 技術メモ

- カードフリップ: `useSharedValue` + `interpolate` で Y軸回転
- フリップ時間: 300ms 程度
- セッション中は画面スリープ防止（`expo-keep-awake`）
