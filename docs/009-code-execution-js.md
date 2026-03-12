# 009 コード実行（JavaScript / TypeScript）

**フェーズ:** v1.0
**ステータス:** 未着手
**依存:** 005
**被依存:** 010, 018

---

## 概要

カード内のコードブロック（JavaScript / TypeScript）をサンドボックス化された WebView 内で実行し、stdout / stderr をカード内に表示する機能を実装する。

---

## Todo

### WebView サンドボックス
- [ ] `react-native-webview` インストール確認
- [ ] JS 実行用 HTML テンプレート作成（サンドボックス設定）
- [ ] `console.log` / `console.error` のキャプチャ
- [ ] stdout / stderr の WebView → RN へのメッセージパッシング
- [ ] 実行タイムアウト（5秒）実装
- [ ] エラーハンドリング（構文エラー・ランタイムエラー）
- [ ] 実行ごとのステート リセット（ステートレス）

### TypeScript 対応
- [ ] TypeScript → JavaScript トランスパイル（Babel または esbuild WASM）
- [ ] トランスパイルエラーの表示

### UI
- [ ] コードブロックに「実行」ボタン追加（`executable: true` のブロックのみ）
- [ ] 実行結果表示エリア（コードブロック下部）
- [ ] 実行中インジケーター（スピナー）
- [ ] 実行結果のクリアボタン
- [ ] エラー時の赤色表示

### セキュリティ
- [ ] `sandbox` 属性設定（外部ネットワーク・DOM アクセス禁止）
- [ ] `allowsInlineMediaPlayback: false`
- [ ] 危険な API の無効化（`fetch`, `XMLHttpRequest` 等）

### i18n
- [ ] コード実行関連テキストの翻訳キー追加

---

## 技術メモ

- WebView は画面に表示せず hidden で常駐させるか、実行時のみ生成
- postMessage で RN ↔ WebView 通信
- タイムアウトは `setTimeout(() => webview.injectJavaScript('...'), 5000)` で実装
