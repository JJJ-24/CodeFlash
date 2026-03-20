# 021 JSONエクスポート/インポート

**フェーズ:** v1.1
**ステータス:** 未着手
**依存:** 001, 002, 003, 004
**被依存:** 014, 015

---

## 概要

全デッキ・カード・タグ・学習履歴を1つのJSONファイルにエクスポートし、
同じファイルからインポートして完全復元できる機能を実装する。
機種変更・バックアップ・iCloud同期（014）の基盤となる。

---

## Todo

### エクスポート
- [ ] `lib/export.ts` — DB全体をJSONにシリアライズする関数
  - [ ] decks / cards（Block[] JSON含む）/ tags / card_tags / reviews を収集
  - [ ] フォーマットバージョン番号を付与（将来の互換性管理用）
- [ ] `expo-file-system` でJSONファイルをキャッシュディレクトリに書き出し
- [ ] `expo-sharing` でiOS共有シート（AirDrop / Files / メール等）を呼び出し

### インポート
- [ ] `lib/import.ts` — JSONをパースしてDBに書き込む関数
  - [ ] フォーマットバージョンチェック
  - [ ] データ検証（必須フィールド・型チェック）
  - [ ] 既存データとのマージ方針: 同一id存在時は上書き（last-write-wins）
  - [ ] decks → cards → tags → card_tags → reviews の順で挿入
- [ ] `expo-document-picker` でJSONファイルを選択
- [ ] インポート完了後にZustandストア全体を再読み込み

### UI
- [ ] 設定画面（`app/(tabs)/settings.tsx`）に「データ管理」セクションを追加
  - [ ] 「エクスポート」ボタン（全データをJSONで書き出し）
  - [ ] 「インポート」ボタン（JSONファイルを選択して読み込み）
- [ ] インポート前に確認ダイアログ（既存データが上書きされる旨）
- [ ] 処理中インジケーター（ActivityIndicator）
- [ ] 完了/エラー時のフィードバック（Alert）

### i18n
- [ ] `locales/ja.json` / `locales/en.json` に翻訳キー追加
  - [ ] export.title, export.success, export.error
  - [ ] import.title, import.confirm, import.success, import.error, import.invalidFile

---

## 将来検討: CSVエクスポート/インポート

Numbers / Excel / Google スプレッドシートとの連携を目的とした機能。
JSON実装後に需要を確認してから着手する。

### 設計メモ
- 列構成: `deck_name, front, back, memo, tags`
- `front`/`back`/`memo` は**テキストブロックのみ**結合して出力（コード・画像は対象外）
- インポートでは各行を「テキストブロック1つのカード」として作成
- `tags` 列はセミコロン区切り（例: `Swift;基礎`）
- 学習履歴（SM-2データ）はCSVに含めない

### 制約・注意
- コードブロック・画像ブロックはCSV出力時にデータが失われる
- 学習履歴はCSVに含まれないため、インポート後は未学習状態になる
- CSVインポートはテキストカードの一括作成用途に限定する

---

## 技術メモ

- `expo-file-system`, `expo-sharing`, `expo-document-picker` が必要（インストール確認要）
- 画像ブロックのuriはローカルパスのため、エクスポート時に画像バイナリをbase64で埋め込むか、
  uriのみ保存してインポート時にリンク切れを許容するか、要検討（初期実装はuri保存のみ推奨）
- 015（Web版）のJSONデータ連携と実装を共有できる
