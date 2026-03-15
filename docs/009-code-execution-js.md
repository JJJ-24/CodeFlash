# 009 コード実行（JavaScript / TypeScript）

**フェーズ:** v1.0
**ステータス:** 完了
**依存:** 005
**被依存:** 010, 018

---

## 概要

カード内のコードブロック（JavaScript / TypeScript）をサンドボックス化された WebView 内で実行し、stdout / stderr をカード内に表示する機能を実装する。

---

## Todo

### WebView サンドボックス
- [x] `react-native-webview` インストール確認
- [x] JS 実行用 HTML テンプレート作成（サンドボックス設定）
- [x] `console.log` / `console.error` のキャプチャ
- [x] stdout / stderr の WebView → RN へのメッセージパッシング
- [x] 実行タイムアウト（5秒）実装
- [x] エラーハンドリング（構文エラー・ランタイムエラー）
- [x] 実行ごとのステート リセット（ステートレス）

### TypeScript 対応
- [x] TypeScript → JavaScript トランスパイル（sucrase）
- [x] トランスパイルエラーの表示

### UI
- [x] コードブロックに「実行」ボタン追加（`executable: true` のブロックのみ）
- [x] 実行結果表示エリア（コードブロック下部）
- [x] 実行中インジケーター（スピナー）
- [x] 実行結果のクリアボタン
- [x] エラー時の赤色表示

### セキュリティ
- [x] `sandbox` 属性設定（外部ネットワーク・DOM アクセス禁止）
- [x] `allowsInlineMediaPlayback: false`
- [x] 危険な API の無効化（`fetch`, `XMLHttpRequest` 等）

### i18n
- [x] コード実行関連テキストの翻訳キー追加

---

## 技術メモ

- WebView は実行時のみ生成し、結果受信後にアンマウント（ステートレス）
- 実行用 HTML に JS コードを埋め込み `source={{ html }}` でロード
- `postMessage` で RN ↔ WebView 通信
- タイムアウトは WebView 内の `setTimeout` で実装（5秒）
- `pointerEvents` を FlipCard の前面/背面カードに設定し、非表示側がタッチを透過するよう修正（バグ修正）
