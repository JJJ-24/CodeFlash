# 010 コード実行（Python / Pyodide）

**フェーズ:** v1.0
**ステータス:** 完了（プリロード・専用UIは将来対応）
**依存:** 009
**被依存:** 018

---

## 概要

Pyodide（Python in WASM）を WebView 経由で動作させ、Python コードをオフラインで実行できるようにする。

---

## Todo

### Pyodide セットアップ
- [x] Pyodide CDN or バンドル方法の調査（v0.26.2 CDN で実装、オフラインバンドルは将来対応）
- [x] WebView HTML テンプレートに Pyodide ローダー組み込み（`lib/code-execution/sandbox.ts`）
- [ ] Pyodide の初期ロード（アプリ起動時 or 初回実行時）— 現状は実行ボタン押下時にロード
- [ ] ロード中インジケーター（専用 UI）— 現状は既存の「実行中」スピナーを流用

### Python 実行
- [x] `pyodide.runPythonAsync()` での実行
- [x] `sys.stdout` / `sys.stderr` キャプチャ（io.StringIO 経由）
- [x] 実行タイムアウト（ユーザーコード 5秒 + Pyodide ロード込み 30秒）
- [x] エラーハンドリング（構文エラー・ランタイムエラー・インポートエラー）
- [x] 実行ごとのステートリセット（WebView アンマウント → 再マウントで実現）

### 標準ライブラリ対応
- [x] 組み込みライブラリ（math, json, re 等）動作確認（Pyodide v0.26.2 = CPython 3.12 フル標準ライブラリ同梱）
- [x] `micropip` による追加パッケージインストール（`# pip: package1 package2` コメントで自動インストール）

### UI
- [x] コードブロック言語が `python` の場合に実行ボタン表示（`executable: true` で 009 のまま動作）
- [x] 実行結果表示（009 の共通 UI を再利用）
- [ ] Pyodide ロード状態の専用表示

### i18n
- [x] Python 実行関連テキストの翻訳キー追加（`code.pyodideLoading` / `code.pyodideLoadError`）

---

## 技術メモ

- Pyodide はサイズが大きい（~10MB）のでバンドル方法を慎重に選択
- 初回ロードに数秒かかる可能性あり → バックグラウンドプリロード
- 009 の WebView サンドボックスを拡張して使用
