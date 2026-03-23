# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### ディレクトリ構成

```
app/                     # Expo Router ルート（ファイル = 画面）
├── _layout.tsx          # ルートレイアウト: SQLiteProvider + Stack 登録
└── (tabs)/              # タブグループ（URLに影響しない透過グループ）
    ├── _layout.tsx      # タブバー定義（ホーム / 学習 / 統計 / 設定）
    ├── index.tsx        # ホーム画面（デッキ一覧）
    ├── study.tsx        # 学習対象選択画面
    ├── stats.tsx        # 統計画面
    └── settings.tsx     # 設定画面

lib/
├── database/            # SQLite CRUD 関数（entity ごとにファイル分離）
│   ├── schema.ts        # テーブル定義 + migrateDbIfNeeded()
│   ├── utils.ts         # generateId()・todayISO() の共通ユーティリティ
│   ├── decks.ts         # Deck CRUD
│   ├── cards.ts         # Card CRUD（JSON シリアライズ含む）
│   ├── tags.ts          # Tag CRUD + card_tags 操作
│   └── reviews.ts       # SM-2 レビューデータ操作
├── code-execution/      # コード実行サンドボックス
│   ├── sandbox.ts       # buildSandboxHtml()：言語別 HTML サンドボックス生成
│   ├── constants.ts     # LANGUAGES・LANG_LABELS
│   └── types.ts         # ExecResult・ExecStatus・LogEntry
├── i18n/index.ts        # i18next 設定（端末言語自動検出、フォールバック: ja）
├── theme/index.ts       # useTheme()・lightTheme/darkTheme・AppColors・AppFontSize 型定義
├── image.ts             # resolveImageUri()：画像パス解決
└── sm2.ts               # SM-2 間隔反復アルゴリズム実装

store/                   # Zustand ストア（インメモリキャッシュ）
├── decks.ts             # useDeckStore
├── cards.ts             # useCardStore
├── tags.ts              # useTagStore
├── reviews.ts           # useReviewStore（学習セッション状態）
├── theme.ts             # useThemeStore（preference: 'light'|'dark'|'system'、AsyncStorage永続化）
└── settings.ts          # useSettingsStore（initialFilterPreference・lastSelectedCodeLanguage、AsyncStorage永続化）

components/
├── code/
│   └── ExecutionOutput.tsx  # コード実行結果表示（WebView + ログ）
├── editor/              # BlockEditor, TextBlockItem, CodeBlockItem, ImageBlockItem, TagSelector
│   └── BlockItemHeader.tsx  # ブロックの共通ヘッダー（並び替えハンドル・削除ボタン）。各 *BlockItem が使用
└── study/               # FlipCard（reanimated）, BlocksView, CodeRunnerView, ZoomableImage

hooks/
├── useStudySession.ts   # 学習セッション管理（キュー管理・SM-2連携）
└── useCodeExecution.ts  # コード実行状態管理（run/clear/reset/handleMessage）

types/index.ts           # 全ドメイン型（唯一の定義元）
locales/ja.json          # 日本語翻訳
locales/en.json          # 英語翻訳
docs/000〜020-*.md       # 機能チケット（実装計画・Todoチェックリスト）
```

### データフロー

画面 → `lib/database/*.ts`（DB 読み書き）→ `store/*.ts`（Zustand でインメモリ更新） の3層構造。Zustand は SQLite の読み取りキャッシュとして機能し、DB 書き込みと同時に手動で更新する。

### DB 初期化

`app/_layout.tsx` の `<SQLiteProvider databaseName="codeflash.db" onInit={migrateDbIfNeeded}>` がアプリ起動時に `lib/database/schema.ts` の `migrateDbIfNeeded()` を実行し5テーブルを作成する。子画面では `useSQLiteContext()` でDBインスタンスを取得する。

### ナビゲーション構造

`app/_layout.tsx` の `Stack` がルートシェル。モーダル画面はここで `presentation: 'modal'` として登録する。

```
Stack (_layout.tsx)
├── (tabs) グループ — タブバー付き画面
├── deck/new, deck/[id]/edit            — モーダル（デッキ作成・編集）
├── deck/[id]/card/new                  — モーダル（カード作成）
├── deck/[id]/card/[cardId]/edit        — モーダル（カード編集）
├── deck/[id]/index                     — デッキ詳細（カード一覧）
├── tags/index                          — タグ管理
└── study/session                       — 学習セッション
```

### 型定義

`types/index.ts` がドメイン型の唯一の定義元。ブロックは `TextBlock | CodeBlock | ImageBlock` のユニオン型で、カードの `frontContent / backContent / memoContent` は SQLite に JSON文字列として保存される。

### コード実行アーキテクチャ

`useCodeExecution(onResult?)` フックが状態管理を担う。`run()` が `buildSandboxHtml()` で HTML を生成し、`ExecutionOutput` 内の `WebView` で実行する。WebView からの `postMessage` を `handleMessage()` で受け取り `result` を更新する。`onResult` コールバックは `result` がセットされた直後（50ms 遅延）に呼ばれるため、実行完了後のスクロールなどに使える。Python は Pyodide（CDN）を利用するため `baseUrl` が設定される。

### 実装上の注意点

- **`lib/database/utils.ts`**: `generateId()`・`todayISO()`・`localDateStr(d: Date)` をエクスポート。全 DB ファイルはここから import する。新しい DB ファイルを作る際も同様。日付集計は `toISOString().slice(0,10)` が UTC 日付を返すため、ローカル日付が必要な箇所は `localDateStr()` を使う。
- **`foreign_keys` pragma は未設定** → `deleteCard` / `deleteTag` では `card_tags` / `reviews` / `review_logs` を明示的に先に削除する
- **SM-2 グレード対応**: `grade 0` = もう一度, `1` = 難しい, `2` = 普通, `3` = 簡単（`lib/sm2.ts` 参照）
- **i18n**: 端末言語を自動検出し、未対応言語の場合は日本語にフォールバック
- **テーマ**: `useTheme()` を呼び出すだけで現在のテーマ（`AppTheme`）が取得できる。テーマ色は `theme.colors.*`、フォントサイズは `theme.fontSize.*` で参照する（StyleSheet に直書きしない）。セクションタイトル文字色は `theme.colors.textSecondary` で統一。
- **フォントサイズシステム**: `AppFontSize` は `xs(12)/sm(14)/md(16)/lg(18)/xl(20)/xxl(26)` の6段階（medium設定時）。`store/theme.ts` の `fontSizePreference`（small=0.85×/medium=1.0×/large=1.2×）で全体スケールされる。StyleSheet の静的 fontSize は使わず、必ずインラインスタイルで `{ fontSize: theme.fontSize.md }` のように指定する。
- **テーマ hydration ガード**: `app/_layout.tsx` は `useThemeStore` の `hydrated` が `true` になるまで `<RootStack />` を描画しない。
- **モーダルから戻った後のデータ更新**: モーダルを閉じた後に最新データが必要な画面では `useFocusEffect` で DB を再読み込みする（`deck/[id]/index.tsx`・`study/session.tsx` が実例）。
- **Bluetooth キーボード対応**: 学習セッション（`app/study/session.tsx`）は見えない `TextInput`（`keyboardType="ascii-capable"`、`showSoftInputOnFocus={false}`）を置き `onKeyPress` でキー入力を受け取る。`keyboardType="default"` では iOS の日本語 IME がスペースキーを横取りするため必ず `ascii-capable` を使う。キー割り当ては Vim 慣習（`J` = 次のカード、`K` = 前のカード）。矢印キーは iOS の `onKeyPress` では検知できないため未対応。`Tab` キーは iPadOS がシステムフォーカス移動（UIFocusSystem）に使用するため `onKeyPress` で検知不可。コードブロック選択には `T` キーを使用。
- **ホーム画面のフィルターブロック**: `app/(tabs)/index.tsx` の `selectedFilter` は将来のブロック追加（タグ別フィルタ等）を想定した拡張ポイント。現状は `'all'` のみ。型は `useState<'all'>` のユニオン型を拡張して対応する。
- **CodeRunnerView のヘッダー色**: 状態（選択中・編集中・実行中）に応じてヘッダー背景色が変わる（選択: `#1A3050`、編集: `#4A3400`、実行: `#1E5024`）。ボーダー色と連動しているため、状態管理を変更する際は両方を確認する。
- **「新規」フィルターの意味**: 学習タブ・カード一覧・統計タブの「新規」ブロックは「今日作成したカード数」を表す。学習してもカウントは減らず、翌日に 0 にリセットされる。内部フィルターキーは `'unlearned'` のままだが、実際のクエリは `getTodayCreatedCardIdsByDeckId` を使う。
- **エクスポート/インポート**: `lib/export.ts` と `lib/import.ts` が担当。`review_logs` テーブルも含めて全テーブルをエクスポートする。インポートは `merge`（`INSERT OR IGNORE`）と `replace`（全削除後に挿入）の2モード。

### ジェスチャー実装パターン

react-native-gesture-handler (RNGH) v2 と react-native-reanimated を組み合わせる際の必須ルール：

- **worklet から JS 関数を呼ぶ**: `onEnd(() => runOnJS(fn)())` の形式を使う。`onEnd(() => fn())` はクラッシュする。
- **worklet に渡す引数は serializable のみ**: `runOnJS(setState)((v) => !v)` は NG（関数は渡せない）。必ず `const toggle = () => setState(v => !v); runOnJS(toggle)()` のように名前付き関数でラップする。
- **worklet 内でインライン closure を作らない**: `runOnJS(() => { setA(x); setB(y); })()` はクラッシュする。必ず外で名前付き関数として定義する。
- **ジェスチャーオブジェクトの安定化**: 複数の `GestureDetector` が入れ子になる場合、内側が外側に優先されるには両方のジェスチャーオブジェクトが安定している必要がある。ハンドラは `useCallback`、ジェスチャーオブジェクトは `useMemo` でメモ化する。
- **ScrollView と FlipCard の共存**: `FlipCard` の tap ジェスチャーを RNGH の `GestureDetector + Tap` にすることで、ScrollView の縦スクロールと競合しなくなる（旧来の `Pressable` では ScrollView のスクロールが阻害される）。

### 主要な設定

- `app.json`: `newArchEnabled: true`（新アーキテクチャ）、`typedRoutes: true`、`reactCompiler: true`（実験的）
- `tsconfig.json`: strictモード、`@/*` がリポジトリルートに対応
- VSCode: 保存時に ESLint 自動修正とインポート整理が実行される

**技術スタック:** React Native 0.81 / React 19 / Expo 54 / expo-router 6 / expo-sqlite / Zustand 5 / i18next。アニメーションに react-native-reanimated、ジェスチャー操作に react-native-gesture-handler が利用可能。

### 実装チケット

`docs/` 配下に機能チケット（000〜020）がある。各チケットにはフェーズ・依存関係・Todoチェックリストが記載されており、実装完了時に `- [ ]` → `- [x]` に更新する。`docs/000-ticket-overview.md` に全体の依存関係図がある。

完了済み: 001〜013（プロジェクト基盤・デッキ/カード/タグCRUD・エディタ・SM-2・学習画面・全画面+Bluetoothキーボード・JS/TS/Python コード実行・画像ブロック・統計画面・ダークモード）。その後エディタリファクタリング（`BlockItemHeader` 抽出）・ホーム画面フィルターブロック・コードブロックヘッダー色変更・バッジ表示・「新規」フィルター意味変更・エクスポート review_logs 追加・コードリファクタリングなどを実施。

未着手: 014（iCloud同期）・015（Web版）・016（買い切り課金）・017（App Store申請）・018（SQL/C++実行）・019（マーケットプレイス）・020（AI生成）

### UI パターン（実装済み画面の慣習）

- **統計ブロック**: 数字（`theme.fontSize.xxl`・色付き）→ラベル（`theme.fontSize.xs`・`textSecondary`）の縦並び。`theme.colors.surface` 背景・角丸・影付き。`deck/[id]/index.tsx` の `statItem` スタイルが基準。
- **バッジ色**: 「復習」（due）= 青（`#1976D2`）、それ以外のフィルター = グレー（ライト: `#8B949E`、ダーク: `#4B5563`）。`theme.dark` で分岐する。
- **セクションタイトル**: `theme.fontSize.lg, fontWeight: '700', color: theme.colors.textSecondary`。ホーム画面・カード一覧画面で使用。
- **コードブロック（学習画面）**: `components/study/SyntaxHighlightedCode.tsx` は `theme.fontSize.md` を使用。フォントサイズ設定に連動する。
- **locales の改行**: ラベルに改行が必要な場合は `"カード\n総数"` のように `\n` を埋め込む（`Text` コンポーネントがそのまま改行として解釈する）。
