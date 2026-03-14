# 006 SM-2 間隔反復アルゴリズム

**フェーズ:** MVP
**ステータス:** 未着手
**依存:** 001, 003
**被依存:** 007, 012

---

## 概要

SuperMemo SM-2 ベースのカスタム間隔反復アルゴリズムを実装する。自己評価4段階（もう一度 / 難しい / 普通 / 簡単）に対応し、次回復習日を計算する。

---

## Todo

### アルゴリズム実装
- [x] SM-2 コア計算関数（`calculateNextReview(state, grade) → ReviewResult`）— lib/sm2.ts
  - [x] easeFactor 更新（初期値 2.5、最小 1.3）
  - [x] interval 計算（初回:1日、2回目:6日、以降: interval * easeFactor）
  - [x] repetitions カウント
  - [x] grade=0（もう一度）時のリセット処理
  - [x] grade=1（Hard）時はインターバルを0.6倍に縮小
- [x] 自己評価 grade マッピング（0〜3）
- [ ] アルゴリズムのユニットテスト（テストフレームワーク未設定）

### データ層
- [x] レビュー記録保存（`INSERT OR REPLACE INTO reviews`）— lib/database/reviews.ts
- [x] 今日の復習対象カード取得（nextReviewDate <= today または未学習）
- [x] デッキ単位での復習対象カード取得
- [x] タグ単位での復習対象カード取得（デッキ横断）
- [x] Zustand レビューストア（`useReviewStore`）— store/reviews.ts

### 統計用データ
- [x] 今日学習したカード数の取得
- [x] 復習スケジュール（今後7日分）の集計
- [x] 学習ストリーク計算

### i18n
- [x] 自己評価ラベルの翻訳キー（もう一度 / 難しい / 普通 / 簡単）

---

## 技術メモ

- SM-2 参考: https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method
- grade=0 の場合: repetitions=0, interval=1, easeFactor は変更なし
- easeFactor 更新式: `EF' = EF + (0.1 - (3-q) * (0.08 + (3-q) * 0.02))`
