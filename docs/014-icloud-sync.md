# 014 iCloud 同期（CloudKit）

**フェーズ:** v1.1
**ステータス:** 未着手
**依存:** 001, 002, 003, 004
**被依存:** 016

---

## 概要

iPhone / iPad / Mac 間のデータを CloudKit で同期する。last-write-wins 方式でコンフリクト解決。Android は JSON エクスポート/インポートで対応。

---

## Todo

### CloudKit セットアップ
- [ ] Expo Development Build の設定（CloudKit はマネージドワークフロー外）
- [ ] `app.json` に iCloud 権限追加
- [ ] CloudKit コンテナ設定（Apple Developer Console）
- [ ] ネイティブモジュール / Expo Config Plugin 選定

### 同期ロジック
- [ ] CloudKit レコード型定義（Deck, Card, Tag, CardTag, Review）
- [ ] ローカル DB → CloudKit へのアップロード
- [ ] CloudKit → ローカル DB へのダウンロード
- [ ] last-write-wins コンフリクト解決（updatedAt 比較）
- [ ] 差分同期（変更があったレコードのみ同期）
- [ ] オフライン時のローカル蓄積 → 復帰時自動同期
- [ ] 同期状態インジケーター（同期中 / 完了 / エラー）

### Android 対応
- [ ] デッキ JSON エクスポート機能（タグ情報含む）
- [ ] デッキ JSON インポート機能
- [ ] AirDrop / 共有シートでのファイル共有対応

### 設定画面
- [ ] iCloud 同期 ON/OFF 設定
- [ ] 最終同期日時表示
- [ ] 手動同期ボタン
- [ ] iCloud アカウント未サインイン時の案内

### i18n
- [ ] 同期関連テキストの翻訳キー追加

---

## 技術メモ

- CloudKit は Expo Go では動作しない → Development Build 必須
- `react-native-cloud-store` 等のライブラリを調査
- Pro 機能（016 チケット）として提供
