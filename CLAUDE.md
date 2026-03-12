# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイドです。

## コマンド

```bash
# 開発サーバーを起動（iOS / Android / Web の選択肢が表示される）
npm start

# プラットフォーム別に起動
npm run ios
npm run android
npm run web

# リント（コードチェック）
npm run lint
```

テストフレームワークはまだ設定されていません。

## アーキテクチャ

**Expo Router** を使ったアプリで、**ファイルベースのルーティング**を採用しています。エントリーポイントは `expo-router/entry`（`package.json` に設定）。

- `app/` — 画面とレイアウト。ファイルがそのままルートに対応する。`_layout.tsx` はナビゲーションのラッパー（現在は `<Stack />` のみ）。
- `app/index.tsx` — ホーム画面（現在は空の状態）。
- `app-example/` — Expo テンプレートの元コード（参照用。アクティブなアプリには含まれない）。
- `assets/images/` — 静的な画像ファイル。

**主要な設定:**
- `app.json`: スラッグ・スキームは `codeflashcard`、新アーキテクチャ有効（`newArchEnabled: true`）、型付きルートと React Compiler の実験的機能も有効。
- `tsconfig.json`: strictモード、パスエイリアス `@/*` がリポジトリルートに対応。
- VSCode: 保存時に ESLint 自動修正とインポート整理が実行される。

**技術スタック:** React Native 0.81 / React 19 / Expo 54 / expo-router 6。アニメーションに react-native-reanimated、ジェスチャー操作に react-native-gesture-handler が利用可能。

## アプリ要件

### 1. プロダクト概要
- アプリ名: CodeFlash
- コンセプト: プログラマー向け Notion風エディタ搭載フラッシュカードアプリ
- ターゲット: CS学生・プログラミング学習者
- プラットフォーム: iOS / Android（Expo）、Web版（カード作成・編集専用）
- データ同期: iCloud（Appleデバイス間）＋ JSONエクスポート（Android・Web連携）
- 収益モデル: 買い切り
- UI言語: 日本語 / 英語（i18n対応）

### 2. 機能要件

#### 2.1 カード管理
データ構造（2階層）:
  デッキ（Deck）
   └── カード（Card）
       ├── 表面（Front）── ブロックの配列
       ├── 裏面（Back） ── ブロックの配列
       ├── メモ（Memo） ── ブロックの配列（学習時非表示）
       └── タグ（Tags） ── タグIDの配列

対応ブロックタイプ:
| ブロック | 説明 | 優先度 |
|---|---|---|
| テキスト | Markdown記法 | MVP |
| コードブロック | シンタックスハイライト付き、言語プルダウン選択 | MVP |
| 画像 | ローカルから挿入 | MVP |
| コード実行ブロック | コード実行機能と連携 | v1.0 |

タグ機能:
- カードに複数タグ付与可能、デッキ横断でグローバル管理
- タグによるフィルタリング・検索・学習セッション
- タグの色分け（任意）

#### 2.2 カードエディタ
- Markdown記法ベース
- Notion風 `/` コマンドでブロックタイプ選択
- 表面 / 裏面 / メモ をタブで切替
- タグ入力欄（候補サジェスト付き）
- 編集/プレビュー切替

#### 2.3 学習画面：全画面表示モード
- ステータスバー・ナビゲーションバー非表示のイマーシブ表示
- 全画面モードのON/OFFワンタップ切替

Bluetoothキーボード操作:
| キー | 動作 |
|---|---|
| Space | 表→裏の切替 |
| →（右矢印） | 次のカードへ |
| ←（左矢印） | 前のカードへ |
| 1 | 自己評価「もう一度」 |
| 2 | 自己評価「難しい」 |
| 3 | 自己評価「普通」 |
| 4 | 自己評価「簡単」 |
| M | メモの表示/非表示 |
| R | コード実行 |
| Escape | 全画面モード終了 |

#### 2.4 コード実行機能
| 言語 | 実行方式 | 優先度 |
|---|---|---|
| JavaScript / TypeScript | WebView内サンドボックス | MVP |
| Python | Pyodide（WASM） | v1.0 |
| SQL | sql.js（WASM SQLite） | 将来 |
| C / C++ | WASMコンパイラ or 外部API | 将来 |

- セキュリティ: サンドボックス化
- タイムアウト: 5秒
- 出力: stdout / stderr をカード内に表示
- 状態: 実行ごとにリセット（ステートレス）

#### 2.5 復習（間隔反復）アルゴリズム
- SM-2ベースのカスタム実装
- 自己評価4段階: もう一度 / 難しい / 普通 / 簡単
- 学習対象: デッキ単位 or タグ単位（デッキ横断）
- SM-2データ: easeFactor（初期2.5）、interval、repetitions、nextReviewDate、lastReviewDate

#### 2.6 デッキ共有機能
- JSON形式でエクスポート / インポート（タグ情報含む）
- MVP: AirDrop等でのファイル共有
- 将来: アプリ内マーケットプレイス

#### 2.7 データ保存・同期
- ローカル保存: expo-sqlite
- iCloud同期: CloudKit（iPhone / iPad / Mac 間）、last-write-wins方式
- Android: JSONエクスポート/インポートで対応
- オフライン時はローカルに蓄積、オンライン復帰時に自動同期

#### 2.8 Web版（カード作成専用）
- 機能範囲: カード作成・編集・プレビューのみ（学習機能なし）
- 技術: Expo Web（同一コードベース）
- データ連携: JSONエクスポート → モバイルアプリにインポート

### 3. 非機能要件
- パフォーマンス: カードフリップ60fps、コードハイライト100ms以内、アプリ起動3秒以内
- オフライン: 全基本機能がオフラインで動作（コード実行もWASM）
- アクセシビリティ: ダークモード、フォントサイズ変更、スクリーンリーダー対応
- i18n: 日本語・英語の2言語、端末設定に応じた自動切替

### 4. 技術スタック（案）
| レイヤー | 技術 |
|---|---|
| 状態管理 | Zustand |
| ローカルDB | expo-sqlite |
| iCloud同期 | CloudKit（ネイティブモジュール） |
| Markdownレンダリング | react-native-markdown-display |
| シンタックスハイライト | react-syntax-highlighter |
| JS実行 | react-native-webview（サンドボックス） |
| Python実行 | Pyodide（WebView経由） |
| i18n | i18next + react-i18next |
| キーボード入力 | react-native-keyevent or カスタムフック |
| テスト | Jest + React Native Testing Library |

### 5. データモデル（SQLite）
- `decks`: id, name, description, language, cardCount, createdAt, updatedAt
- `cards`: id, deckId, frontContent(JSON), backContent(JSON), memoContent(JSON), createdAt, updatedAt
- `tags`: id, name, color, createdAt
- `card_tags`: cardId, tagId（複合主キー）
- `reviews`: cardId, easeFactor, interval, repetitions, nextReviewDate, lastReviewDate

ブロックJSON構造:
```json
[
  { "type": "text", "content": "## タイトル\n**強調**テキスト" },
  { "type": "code", "language": "python", "content": "def foo(): pass", "executable": true },
  { "type": "image", "uri": "local://images/foo.png", "alt": "説明" }
]
```

### 6. 画面構成（モバイル）
- ホーム → デッキ一覧 → デッキ詳細（カード一覧）→ カードエディタ
- 学習画面: 通常モード / 全画面モード、学習対象選択（デッキ/タグ単位）
- タグ管理画面
- 統計画面: 今日の学習数、復習スケジュール、学習ストリーク
- 設定画面: 言語・テーマ・フォントサイズ・iCloud同期・キーボードショートカット・データ管理

### 7. 開発フェーズ
- **Phase 1 — MVP**: デッキ・カードCRUD、タグ、エディタ、SM-2、ローカルDB、i18n
- **Phase 2 — v1.0**: 全画面モード、コード実行（JS/Python）、画像ブロック、統計、ダークモード
- **Phase 3 — v1.1**: iCloud同期、Web版、買い切り課金、ストア申請
- **Phase 4 — 将来**: SQL/C++実行、クラウド同期、マーケットプレイス、AI自動生成

### 8. 買い切りモデル
| プラン | 内容 |
|---|---|
| 無料版 | デッキ3つ・カード50枚まで、JS実行のみ、iCloud同期なし |
| Pro（買い切り） | 無制限、全言語実行、統計、iCloud同期、全画面モード、Web版 |

想定価格帯: ¥980〜¥1,480
