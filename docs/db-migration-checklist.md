# DB スキーマ変更時のチェックリスト

`lib/database/schema.ts` に新しいテーブル・カラムを追加したり、`store/` 配下に新しい AsyncStorage キーを追加したときに、エクスポート/インポートへの追加を**忘れないため**のチェックリスト。

過去にこのチェックを怠って `grade_logs` テーブルの `responseTimeMs` がバックアップ対象から漏れ、平均回答時間が表示されない問題が発生した（2026-05-14 修正）。同じ事故を繰り返さないために、スキーマや永続化キーを増やしたら必ず以下を確認する。

---

## ① 新しい SQLite テーブルを追加した場合

- [ ] 追加したテーブルは**ユーザーデータか？**（YES → バックアップ対象）
  - 一時キャッシュ・派生データならスキップしてよい
- [ ] `lib/export.ts`
  - [ ] `ExportData` 型に対応プロパティを追加
  - [ ] `exportDatabase()` の SELECT に追加
  - [ ] `estimateExportSize()` の COUNT クエリと `metaBytes` 計算に追加
- [ ] `lib/import.ts`
  - [ ] バリデーション（`INVALID_FORMAT` チェック）に追加
  - [ ] `replace` モードの `DELETE` 文に追加
  - [ ] `bulkInsert` で INSERT を追加
  - [ ] 旧データに対する後方互換：`data.xxx ?? []` のようにデフォルト空配列で対応
- [ ] 動作確認：エクスポート → `replace` モードでインポート → 復元できる

## ② 既存テーブルに新しいカラムを追加した場合

- [ ] `lib/database/schema.ts` で `ALTER TABLE ... ADD COLUMN` のマイグレーションを書いた
- [ ] そのカラムは**ユーザーデータか？**（YES → バックアップ対象）
- [ ] `lib/export.ts` の SELECT 文に新カラムを含めた
- [ ] `lib/import.ts` の INSERT 文に新カラムを含めた
  - 旧エクスポートデータ（新カラムが含まれていない）にも対応するため、`(r.newColumn as 型 | undefined) ?? null` の形で吸収
- [ ] 動作確認：旧バージョンでエクスポートしたファイルが新バージョンでも読み込める

## ③ 新しい AsyncStorage キーを追加した場合（`store/` 配下）

- [ ] そのキーは**ユーザーが設定した値か？**（YES → バックアップ対象）
  - 例：テーマ、フォントサイズ、通知設定、FSRS設定、ソート順など
  - **例外**：購入ステータス（`@codeflash_is_pro`）は不正利用防止のため**意図的に除外**
- [ ] `lib/settings-keys.ts` の `SETTINGS_ASYNC_STORAGE_KEYS` 配列に追加
- [ ] 該当ストアの `hydrateXxx()` 関数に読み込み処理を追加（インポート後の再 hydrate に必要）

## ④ 動作確認の全体フロー

リリース前に以下のシナリオを必ず実施：

1. 一通りの設定変更・カード作成・学習を行う
2. エクスポート（画像含めるオプションも試す）
3. アプリを削除して再インストール（または別端末）
4. `replace` モードでインポート
5. **すべての**データ・設定が復元されていることを確認
   - カード・デッキ・タグ
   - 学習履歴（評価数・平均回答時間・最新日付）
   - テーマ・フォントサイズ
   - FSRSカスタマイズ
   - 通知設定（時刻含む）
   - 各種ソート順・最終選択フィルター

---

## 関連ファイル

- `lib/database/schema.ts` — DB スキーマ定義・マイグレーション
- `lib/export.ts` — エクスポート処理
- `lib/import.ts` — インポート処理
- `lib/settings-keys.ts` — エクスポート対象の AsyncStorage キー一覧
- `store/theme.ts` — `hydrateTheme()`
- `store/settings.ts` — `hydrateSettings()`
