# 029 デッキ単位のマージ復元（自動バックアップから）

**フェーズ:** v1.5系（同期UX改善の延長）
**ステータス:** 未着手
**依存:** 014（iCloud同期 / 自動バックアップ）, 021（エクスポート/インポート）, 011（画像ブロック）
**被依存:** なし

---

## 概要

オフライン状態で2台以上の端末がそれぞれ別デッキを学習し、再接続で一方の端末が
丸ごと負けて（whole-file LWW）学習が失われたときの**救済措置**。

負けた端末には「同期で上書きされる直前の自動バックアップ」（`backupLocalDbBeforeReplace`
が作る世代付き DB スナップショット）が残っている。そこから**特定デッキだけを取り出し、
現在のデータに行単位でマージ復元**できるようにする。これにより「デッキa は端末A・
デッキb は端末B で学習」したものを、どちらも失わずに統合できる。

### なぜ「デッキ単位」なら両立できるのか

既存のフル JSON インポート（merge）は `reviews` を `INSERT OR REPLACE`（cardId 主キー）で
取り込むが、フルバックアップは**全デッキのカード**を含むため、デッキa を入れると
デッキb の reviews まで上書きされ巻き戻る。**スコープを1デッキに絞れば**、触れるのは
そのデッキのカードだけなので他デッキは無傷で、2台ぶんの学習を両立できる。

### 「上書き」ではなく「マージ」にする

restore（バックアップの姿に戻す＝上書き）ではなく、**何も破壊しない加算的マージ**にする。
カードごと・行ごとに新しい方を残し、履歴は合算し、削除は行わない。

---

## マージ規則（行単位・非破壊）

| テーブル | 規則 |
|---|---|
| `reviews`（学習状態） | 行単位 LWW：カードごとに `lastReviewDate` が新しい方を残す（現データに新しい学習があれば維持） |
| `review_logs` | union（`INSERT OR IGNORE`）＝両方の履歴を合算 |
| `grade_logs` | union（`INSERT OR IGNORE`、id 保持で重複回避） |
| `cards` | LWW by `updatedAt`：新しい方の内容。バックアップにしか無いカードは追加。現データのカードは削除しない |
| `card_contents` | 対応する `cards` の LWW 勝者に追従（cards を更新したら同時に更新） |
| `decks` | LWW by `updatedAt`（デッキ名・アイコン・カラー等）。マージ後に `cardCount` を再計算 |
| `tags` | union（`INSERT OR IGNORE`、既存タグ定義は維持） |
| `card_tags` | union（`INSERT OR IGNORE`） |
| 削除 | 行を決して消さない（merge なので欠落させない） |

- LWW のタイムスタンプ比較は端末ローカル時計に依存（同期の後勝ちと同じ前提）。
- `reviews` の `lastReviewDate` は ISO 文字列 TEXT のため辞書順比較で時系列比較できる。
- 片側にしか review 行が無い場合：バックアップのみ→挿入、現データのみ→維持。

---

## 画像の保護（案B：単一ディレクトリ＋掃除をバックアップ考慮に）

画像は一意名・内容不変・単一ディレクトリ（`IMAGE_DIR`）。現状は同期DL後に
`cleanupOrphanImages(db)` が「ライブDBが参照しない画像」を削除するため、負けたデッキの
画像が消えてしまい、後からマージ復元しても画像が欠ける。

**対策（案B）**: 画像はコピーせず1か所のまま、掃除の判定を
**「ライブDB ∪ 保持中の全自動バックアップが参照する画像」を残す**よう変更する。
保持中バックアップが参照する画像はライブの画像フォルダに残るので、そのバックアップから
デッキをマージするときにそのまま使える。重複が無く（一意名・内容不変）ストレージ増は最小。

- メリット：画像コピー不要（バックアップ作成は従来どおり軽い）、重複なし＝1倍。
- デメリット：掃除時に保持中バックアップDBを走査して参照画像を集計（最大3世代＝軽いスキャン3回）。
  ライブが参照しなくなったが保持中バックアップが参照する画像は、その世代がローテーションで
  消えるまで残る（容量は union 相当で頭打ち）。
- 制約：**本機能導入前に既に削除済みの画像は救済不可**（導入後の保護のみ）。

---

## UI（「データ復元」画面を拡張）

`app/settings/sync.tsx` の自動バックアップ復元（`sync.restoreShort` =「データ復元」）画面に、
従来の「全体を置き換える復元」に加えて以下を追加する。

1. バックアップ世代を選ぶ → そのバックアップDBを `ATTACH` して**中のデッキ一覧**を表示
   （デッキ名・カード数・最終学習日などを併記して選びやすくする）。
2. デッキを1つ（将来は複数）選んで「**今のデータに統合（マージ）**」を実行。
3. 確認ダイアログ（「○○ を現在のデータにマージします。既存データは削除されません」）。
4. 完了後に `useSyncStore.bumpDataRevision()` を呼び、学習/統計/ホーム/カード一覧へ即反映。

- 文言は「復元（上書き）」と区別して「**マージ（統合）**」を用いる。
- 既存の whole-replace 復元はそのまま残す（用途が違う）。

---

## Todo

### マージエンジン

- [ ] `lib/sync/deckMerge.ts`（新規）
  - [ ] `listDecksInBackup(backupPath)` — バックアップDBを開き（または ATTACH）デッキ一覧（id/name/cardCount/最終学習日）を返す
  - [ ] `mergeDeckFromBackup(db, backupPath, deckId)` — 1デッキを行単位マージ
    - [ ] ATTACH backup（`replaceLocalDataFromDownloadedDb` と同様に withTransactionAsync 内で実施、終了時 DETACH）
    - [ ] decks：`INSERT ... ON CONFLICT(id) DO UPDATE ... WHERE excluded.updatedAt > decks.updatedAt`
    - [ ] cards / card_contents：cards を updatedAt LWW で upsert、勝者の content を同期更新
    - [ ] reviews：`ON CONFLICT(cardId) DO UPDATE ... WHERE excluded.lastReviewDate > reviews.lastReviewDate`
    - [ ] review_logs / grade_logs：`INSERT OR IGNORE`
    - [ ] tags / card_tags：`INSERT OR IGNORE`（対象デッキのカードに紐づくものだけ）
    - [ ] 対象デッキの `cardCount` を再計算して更新
  - [ ] マージ後に `refreshGlobalCaches(db)` 相当（decks/tags 再読込）

### 画像保護（案B）

- [ ] `lib/image.ts` の掃除をバックアップ考慮に変更
  - [ ] `getReferencedImageFilenames` を任意DB（ATTACH したバックアップ）に対しても集計できる形に
  - [ ] `cleanupOrphanImages(db)` を「ライブ ∪ 保持中バックアップの参照画像」を残すよう変更
    （保持中バックアップ一覧は `listLocalBackups()` から取得）
- [ ] マージ実行後、復元デッキが参照する画像でライブに無いものはバックアップ側から確保
  （案Bでは既にライブに残っている想定だが、欠落時のフォールバックとして best-effort コピー）

### UI

- [ ] `app/settings/sync.tsx`（または復元用サブ画面）にデッキ選択マージ動線を追加
  - [ ] バックアップ選択 → デッキ一覧表示（カード数・最終学習日）
  - [ ] デッキ選択 → 確認モーダル（`ConfirmModal`）→ マージ実行
  - [ ] 処理中インジケーター・完了/エラーのフィードバック（`InfoModal`）
  - [ ] 完了後 `bumpDataRevision()`

### i18n

- [ ] `locales/ja.json` / `en.json` に翻訳キー追加（ja/en セットで）
  - [ ] restore.mergeDeckTitle, mergeDeckInfo, mergeDeckConfirm, mergeDeckSuccess, mergeDeckEmpty 等
  - [ ] デッキ一覧の「最終学習: {{date}}」「{{count}} 枚」など

### 動作確認

- [ ] オフライン2端末で別デッキ学習→一方が負け→自動バックアップからデッキをマージ→両方の学習が残ることを確認
- [ ] 現データに同デッキの新しい学習があるカードは維持される（行単位LWW）ことを確認
- [ ] 画像付きカードのデッキで、マージ後に画像が表示されることを確認
- [ ] マージ後に学習/統計/ホーム/カード一覧へ即反映（dataRevision）されることを確認

---

## 設計メモ

- ATTACH＋テーブルコピーは `syncEngine.ts` の `replaceLocalDataFromDownloadedDb` が実績パターン
  （接続を閉じずクラッシュしない・main/remote 共通カラムのみコピー）。これを流用する。
- `foreign_keys` pragma は未設定。親→子の順で挿入し、削除は行わないため整合は保てる。
- `decks.cardCount` はマージで増減し得るので必ず再計算する。
- 将来拡張：複数デッキ同時マージ、ファイルベースの1デッキ書き出し/取り込み（021 のデッキ別
  エクスポート構想と統合可能）。本チケットでは自動バックアップ起点の単一デッキマージに限定する。

## 制約・注意

- LWW は端末時計に依存（同期と同じ前提）。
- 本機能導入前に削除済みの画像は救済できない（導入後に作られる自動バックアップから有効）。
- 自動バックアップは最新3世代のみ（`MAX_LOCAL_BACKUPS`）。それより古い時点へは戻せない。
