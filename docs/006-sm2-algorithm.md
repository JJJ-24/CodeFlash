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
- [ ] SM-2 コア計算関数（`calculateNextReview(card, grade) → ReviewResult`）
  - [ ] easeFactor 更新（初期値 2.5、最小 1.3）
  - [ ] interval 計算（初回:1日、2回目:6日、以降: interval * easeFactor）
  - [ ] repetitions カウント
  - [ ] grade=0（もう一度）時のリセット処理
- [ ] 自己評価 grade マッピング
  - grade 0 = もう一度（Again）
  - grade 1 = 難しい（Hard）
  - grade 2 = 普通（Good）
  - grade 3 = 簡単（Easy）
- [ ] アルゴリズムのユニットテスト

### データ層
- [ ] レビュー記録保存（`INSERT OR REPLACE INTO reviews`）
- [ ] 今日の復習対象カード取得（`nextReviewDate <= today`）
- [ ] デッキ単位での復習対象カード取得
- [ ] タグ単位での復習対象カード取得（デッキ横断）
- [ ] 新規カードの初期レビューデータ作成
- [ ] Zustand レビューストア（`useReviewStore`）

### 統計用データ
- [ ] 今日学習したカード数の取得
- [ ] 復習スケジュール（今後7日分）の集計
- [ ] 学習ストリーク計算

### i18n
- [ ] 自己評価ラベルの翻訳キー（もう一度 / 難しい / 普通 / 簡単）

---

## 技術メモ

- SM-2 参考: https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method
- grade=0 の場合: repetitions=0, interval=1, easeFactor は変更なし
- easeFactor 更新式: `EF' = EF + (0.1 - (3-q) * (0.08 + (3-q) * 0.02))`
