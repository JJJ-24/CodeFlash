# 018 コード実行（SQL / C++）

**フェーズ:** 将来
**ステータス:** 未着手
**依存:** 009
**被依存:** なし

---

## 概要

SQL（sql.js WASM SQLite）および C/C++（WASM コンパイラ or 外部 API）のコード実行機能を追加する。

---

## Todo

### SQL 実行（sql.js）
- [ ] `sql.js` の WebView 組み込み調査
- [ ] SQL クエリ実行（SELECT / INSERT / UPDATE / DELETE）
- [ ] テーブル定義の初期化オプション
- [ ] クエリ結果のテーブル表示 UI
- [ ] エラーハンドリング（構文エラー等）

### C / C++ 実行
- [ ] 実行方式の選定検討:
  - [ ] Option A: WebAssembly コンパイラ（Emscripten WASM）
  - [ ] Option B: 外部サンドボックス API（Judge0 等）
- [ ] 選定方式での実装
- [ ] コンパイルエラー・ランタイムエラー表示

### UI 拡張
- [ ] SQL 結果テーブル表示コンポーネント
- [ ] C/C++ コンパイル中インジケーター

---

## 技術メモ

- sql.js は ~1MB の WASM ファイル
- C/C++ は外部 API 利用の場合はオフライン非対応になる点に注意
- Pro 機能として提供
