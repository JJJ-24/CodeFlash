# 024 詳細な学習統計

**フェーズ:** 将来
**ステータス:** 完了
**依存:** 006, 007, 012
**被依存:** なし

---

## 概要

現在の統計画面（012）を拡張し、より詳細な学習分析・レポートを Pro 機能として提供する。

---

## Todo

### データ集計
- [x] グレード別ランキング（grade_logs テーブルに評価履歴を蓄積、グレード別上位10カード）
- [x] 連続学習日数（ストリーク）← 012 で実装済み
- [x] 月次レポートの集計（月別学習枚数グラフ）
- [x] grade_logs に `responseTimeMs`（回答時間ミリ秒）カラム追加（schema.ts マイグレーション・saveReview・useStudySession で計測・記録）
- ~~カード別正答率の算出（全期間・直近N回）~~ → 取りやめ（グレード別ランキングで代替）
- ~~苦手カードランキング（fsrsLapses / easeFactor 順）~~ → 取りやめ（グレード別ランキングで代替）
- ~~時間帯別学習傾向~~ → 取りやめ（review_logs に時刻未保存のため対応不可）

### UI
- [x] 統計画面に「詳細統計」セクション追加（Pro バッジ付き）
- [x] 月別学習グラフ（棒グラフ・過去12ヶ月・横スクロール）
- [x] グレード別ランキング（再考/苦手/正解/即答 の4ブロック、タップで上位10カード表示）
- [x] グレード別ランキングのカードリスト上部に平均回答時間を表示（`getAvgResponseTimeByGrade` で grade_logs 全体の AVG を取得）
- [x] 学習完了サマリーに平均回答時間を表示（セッション全体の平均、正答率・次回予定と横並び）
- [x] カード統計シート（CardStatsSheet）に次回学習日を追加し、学習完了画面と同じレイアウト（数字／ラベル／単位の3行構造）で「正答率／次回予定／平均時間」を表示。評価数合計は最上部に強調配置。統計関連の i18n キーを `stats` namespace に集約
- [x] グレード別ランキングに「平均時間ランキング」モードを追加（行の右端にトグルアイコン）。ON で全グレード「時間のかかった順」に切り替え。「再考／苦手」では思考トラップになっているカード、「正解／即答」では即答に近づきつつある境界カード（学習の伸びしろ）が浮かび上がる。実装：`useSettingsStore.gradeRankingByTime` に永続化、4ブロック内の数値と TOP10 バッジを「平均秒数」に切替、見出し下にモードラベル（評価回数／平均回答時間（秒））を常時表示。最小サンプル数の閾値は未設定（avgResponseTimeMs IS NULL は末尾扱い）
- [x] グレード別ランキング詳細画面（TOP10カード一覧）に「学習開始」ボタンを追加。実装：`useStudySession.loadSession` に `cardIds` パラメータを追加して明示指定モード（cardSort/shuffle 無視・入力順厳守）を導入、`/study/session?cardIds=...&mode=focused` で遷移、学習画面ヘッダーは「重点復習」表示。ボタンはオレンジ色（`FILTER_COLORS.due`）で通常学習と区別、TOP10 件数を明示。`submitGrade` の判定はそのまま（due または今日学習済みなら 3 テーブルに記録、それ以外はスキップ）。ボタン下に注意書きを表示
- [x] グレード別ランキングに期間フィルター（全期間／過去90日／過去30日／過去7日 の 4 種類）を追加。実装：`useSettingsStore.gradeRankingPeriod` に永続化、見出し右にカレンダーアイコンを追加して期間ピッカーシート（Reanimated オーバーレイ）を開く、全期間以外のときはモードラベル下に × 付きチップ表示、`getGradeLogTotals`/`getGradeAvgResponseTimes`/`getTopCardsByGrade` に `since` パラメータを追加して `WHERE reviewedAt >= ?` で絞り込み
- [x] グレード別ランキングにデッキ別の絞り込みを追加。実装：`useSettingsStore.gradeRankingDeckId` に永続化、見出し右の最左に `albums-outline` アイコンを追加して DeckPickerSheet（「すべてのデッキ」+ デッキ一覧）を開く、選択中はモードラベル下にデッキ名チップ表示（× で解除）、`getGradeLogTotals`/`getGradeAvgResponseTimes`/`getTopCardsByGrade` に `deckId` パラメータを追加して `WHERE c.deckId = ?` で絞り込み

### 課金連携
- [x] Pro 未購入時はロック表示（機能一覧）＋アップグレードボタン
- [x] 016（課金）チケットと連携

---

## 技術メモ

- `review_logs` テーブルに既にデータが蓄積されているため、集計クエリの追加で対応可能
- 重い集計はバックグラウンドで実行し、結果をキャッシュする
- グラフは react-native-svg または Victory Native を検討
