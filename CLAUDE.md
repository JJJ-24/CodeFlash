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
├── search.tsx           # カード全文検索画面（全デッキ横断、frontContent LIKE 検索）
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
├── i18n/index.ts        # i18next 設定（端末言語自動検出、フォールバック: en）
├── theme/index.ts       # useTheme()・lightTheme/darkTheme・AppColors・AppFontSize 型定義
├── image.ts             # resolveImageUri()：画像パス解決
├── syntax-highlight.ts  # シンタックスハイライト（Token/TokenType）。学習画面の SyntaxHighlightedCode が使用
├── FlipSuppressContext.ts  # コードブロックのボタンタップ時にカードフリップを一時抑制する Context
├── export.ts            # 全テーブル（review_logs 含む）を JSON エクスポート
├── import.ts            # merge（INSERT OR IGNORE）/ replace（全削除後挿入）の2モードでインポート
├── notifications.ts     # requestPermission()・scheduleDailyReminder()・updateBadgeCount(db)：毎日繰り返し通知スケジュール＋アイコンバッジ更新
├── study/
│   └── extractLinks.ts  # カードブロックからリンクを抽出（学習画面 L キー = リンク一覧用）
└── sm2.ts               # SM-2 間隔反復アルゴリズム実装

store/                   # Zustand ストア（インメモリキャッシュ）
├── decks.ts             # useDeckStore
├── cards.ts             # useCardStore
├── tags.ts              # useTagStore
├── reviews.ts           # useReviewStore（学習セッション状態）
├── theme.ts             # useThemeStore（preference: 'light'|'dark'|'system'、AsyncStorage永続化）
└── settings.ts          # useSettingsStore（initialFilterPreference・lastDeckDetailFilter・lastSelectedCodeLanguage・deckSortOrder・通知設定、AsyncStorage永続化）

components/
├── code/
│   └── ExecutionOutput.tsx  # コード実行結果表示（WebView + ログ）
├── editor/              # BlockEditor, TextBlockItem, CodeBlockItem, ImageBlockItem, TagSelector
│   └── BlockItemHeader.tsx  # ブロックの共通ヘッダー（並び替えハンドル・削除ボタン）。各 *BlockItem が使用
├── stats/
│   └── ActivityHeatmap.tsx  # 学習履歴ヒートマップ（草グラフ）。weeks props で表示週数を制御
└── study/               # FlipCard（reanimated）, BlocksView, CodeRunnerView, SyntaxHighlightedCode, ZoomableImage

hooks/
├── useStudySession.ts        # 学習セッション管理（キュー管理・SM-2連携）
├── useCodeExecution.ts       # コード実行状態管理（run/clear/reset/handleMessage）
├── useCodeBlockSelection.ts  # コードブロックフォーカス選択状態管理
└── useSwipeGesture.ts        # 学習セッションのスワイプジェスチャー管理

types/index.ts           # 全ドメイン型（唯一の定義元）
locales/ja.json          # 日本語翻訳
locales/en.json          # 英語翻訳
docs/000〜023-*.md       # 機能チケット（実装計画・Todoチェックリスト）
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
├── deck/[id]/card/[cardId]/edit        — モーダル（カード編集）。`?tab=back` パラメータで裏面タブを初期表示できる
├── deck/[id]/index                     — デッキ詳細（カード一覧）
├── tags/index                          — タグ管理
├── tags/new, tags/[tagId]/edit         — モーダル（タグ作成・編集）
├── tags/[tagId]/cards                  — タグ別カード一覧
├── study/session                       — 学習セッション
└── search                              — カード全文検索（ホーム画面ヘッダーの検索アイコンから遷移）
```

### 型定義

`types/index.ts` がドメイン型の唯一の定義元。ブロックは `TextBlock | CodeBlock | ImageBlock` のユニオン型で、カードの `frontContent / backContent / memoContent` は SQLite に JSON文字列として保存される。

### コード実行アーキテクチャ

`useCodeExecution(onResult?)` フックが状態管理を担う。`run()` が `buildSandboxHtml()` で HTML を生成し、`ExecutionOutput` 内の `WebView` で実行する。WebView からの `postMessage` を `handleMessage()` で受け取り `result` を更新する。`onResult` コールバックは `result` がセットされた直後（50ms 遅延）に呼ばれるため、実行完了後のスクロールなどに使える。Python は Pyodide（CDN）を利用するため `baseUrl` が設定される。

### 実装上の注意点

- **`lib/database/utils.ts`**: `generateId()`・`todayISO()`・`localDateStr(d: Date)` をエクスポート。DB ファイルだけでなく UI コンポーネントからも import して使用する。日付集計は `toISOString().slice(0,10)` が UTC 日付を返すため、ローカル日付が必要な箇所は `localDateStr()` を使う。
- **`foreign_keys` pragma は未設定** → `deleteCard` / `deleteTag` では `card_tags` / `reviews` / `review_logs` を明示的に先に削除する
- **SM-2 グレード対応**: `grade 0` = もう一度, `1` = 難しい, `2` = 普通, `3` = 簡単（`lib/sm2.ts` 参照）
- **i18n**: 端末言語を自動検出し、未対応言語の場合は**英語**にフォールバック（`lib/i18n/index.ts` の `fallbackLng: 'en'`）
- **テーマ**: `useTheme()` を呼び出すだけで現在のテーマ（`AppTheme`）が取得できる。テーマ色は `theme.colors.*`、フォントサイズは `theme.fontSize.*` で参照する（StyleSheet に直書きしない）。セクションタイトル文字色は `theme.colors.textSecondary` で統一。
- **フォントサイズシステム**: `AppFontSize` は `xs(12)/sm(14)/md(16)/lg(18)/xl(20)/xxl(26)` の6段階（medium設定時）。`store/theme.ts` の `fontSizePreference`（small=0.85×/medium=1.0×/large=1.2×）で全体スケールされる。StyleSheet の静的 fontSize は使わず、必ずインラインスタイルで `{ fontSize: theme.fontSize.md }` のように指定する。
- **テーマ hydration ガード**: `app/_layout.tsx` は `useThemeStore` の `hydrated` が `true` になるまで `<RootStack />` を描画しない。
- **モーダルから戻った後のデータ更新**: モーダルを閉じた後に最新データが必要な画面では `useFocusEffect` で DB を再読み込みする（`deck/[id]/index.tsx`・`study/session.tsx` が実例）。
- **Bluetooth キーボード対応**: 学習セッション（`app/study/session.tsx`）とカード一覧（`app/deck/[id]/index.tsx`）は見えない `TextInput`（`keyboardType="ascii-capable"`、`showSoftInputOnFocus={false}`）を置き `onKeyPress` でキー入力を受け取る。`keyboardType="default"` では iOS の日本語 IME がスペースキーを横取りするため必ず `ascii-capable` を使う。矢印キーは iOS の `onKeyPress` では検知できないため未対応。`Tab` キーは iPadOS がシステムフォーカス移動（UIFocusSystem）に使用するため `onKeyPress` で検知不可。
  - **学習画面キー**: J/K = 次/前カード、Space = 表裏反転、1–4 = グレード、T/Y = コードブロック次/前フォーカス、M = メモ開閉、F = 全画面、P = カード編集、L = リンク一覧
  - **カード一覧キー（通常モード）**: Space = 学習開始、1–4 = フィルター切替、T/Y = カードフォーカス次/前、P = フォーカスカード編集、N = 新規カード、S = 選択モード開始、U/D = スクロール、B = 戻る
  - **カード一覧キー（選択モード）**: T/Y = フォーカス移動、Space = 選択/解除、A = 全選択、M = 移動、D = 削除、S/C = 選択モード終了（複製はバーボタンのみ、キーショートカットなし）
- **T/Yキーのコードブロックサイクル（学習画面）**: T = 次へ / Y = 前へ。表面表示中は表面のコードブロックのみサイクル。裏面表示中は裏面＋メモのコードブロックを**通しで**サイクルする（裏面ブロック0→1→…→メモブロック0→1→…→裏面ブロック0）。サイクルの両端で `null`（フォーカスなし）を経由する**ヌルサイクル**方式。メモブロックに到達するとメモを自動展開する。combined index は `selectedCodeBlockSide`（`'back'` か `'memo'`）と `selectedCodeBlockIdx` の組み合わせで管理する。
- **T/Yキーのカードフォーカス（カード一覧）**: `app/deck/[id]/index.tsx` でも同じヌルサイクル方式。`focusedCardIndex` が `null` → 0 → 1 → … → last → `null` と循環（Y は逆順）。フォーカス中のカードは `borderColor` で強調（通常モード: `theme.colors.primary`〈青〉、選択モードカーソル: `#F57C00`〈オレンジ〉、選択モード選択済み: `theme.colors.primary`〈青〉）。
- **ホーム画面のフィルターブロック**: `app/(tabs)/index.tsx` の `selectedFilter` は将来のブロック追加（タグ別フィルタ等）を想定した拡張ポイント。現状は `'all'` のみ。型は `useState<'all'>` のユニオン型を拡張して対応する。
- **CodeRunnerView のヘッダー色**: 状態（選択中・編集中・実行中）に応じてヘッダー背景色が変わる（選択: `#1A3050`、編集: `#4A3400`、実行: `#1E5024`）。ボーダー色と連動しているため、状態管理を変更する際は両方を確認する。
- **「新規」フィルターの意味**: 学習タブ・カード一覧・統計タブの「新規」ブロックは「今日作成したカード数」を表す。学習してもカウントは減らず、翌日に 0 にリセットされる。実際のクエリは `getTodayCreatedCardIdsByDeckId` を使う。
- **フィルターキーの統一**: 全画面でフィルターキーは `'all' | 'learned' | 'review' | 'new'` に統一。`DeckDetailFilter = Exclude<InitialFilterPreference, 'none'>` で型を派生させている（`store/settings.ts`）。
- **初期フィルター「保持」の挙動**: 学習・統計タブはタブがアンマウントされないため React state が残る。カード一覧（stack screen）は `lastDeckDetailFilter`（AsyncStorage 永続化）で最後のフィルターを復元する。
- **`FILTER_COLORS`**: `lib/theme/index.ts` にエクスポートされた定数。`learned: '#4CAF50'`、`due: '#F57C00'`。フィルター色を複数画面で使う場合はここから import する（ハードコード禁止）。
- **エクスポート/インポート**: `lib/export.ts` と `lib/import.ts` が担当。`review_logs` テーブルも含めて全テーブルをエクスポートする。インポートは `merge`（`INSERT OR IGNORE`）と `replace`（全削除後に挿入）の2モード。
- **`BlockEditor` の初期タブ**: `initialTab?: 'front' | 'back' | 'memo'` prop で開くタブを制御できる。学習セッションの編集ボタンは `?tab=back` クエリパラメータを付与して裏面タブを初期表示する（`deck/[id]/card/[cardId]/edit.tsx` が受け取り）。
- **`BlockEditor` のスクロール**: `NestableDraggableFlatList` のアイテムは絶対位置で管理されるため、上のブロックの高さが変わっても下ブロックの `onLayout` が発火しない。コードブロック実行後・テキスト/コード/画像ブロックの入力フォーカス時はキャッシュ位置でなく `measureLayout` を使ってリアルタイム位置を取得する。各ブロックの wrapper View の ref は `blockViewRefs`（`Map<string, View>`）で管理する。
- **`DraggableFlatList` の ref 型**: `react-native-gesture-handler` の `FlatList` 型と React Native の `FlatList` 型が異なるため型エラーが発生する。`ref={listRef as any}` でキャストして回避する（`scrollToIndex` などの呼び出しは実行時に正常動作する）。
- **ヘッダータイトルの切り詰め**: ヘッダー右側にアイコンを置く場合、タイトル文字列に `maxWidth: screenWidth * 0.5` と `flexShrink: 1` を付与する。`useWindowDimensions` でスクリーン幅を取得する。React Navigation のヘッダータイトルコンテナは絶対配置のため `flexShrink` 単独では効かない。
- **選択バーのアクションボタン**: 削除・移動などのバーボタンは言語/フォントサイズ非依存にするためアイコンのみ（テキストなし）の円形ボタンにする。`iconBtn` スタイル: `{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }`。無効時は `opacity: 0.4`。
- **学習セッションのヘッダータイトル**: デッキ学習時はデッキ名、タグ学習時はタグ名を表示する。`useDeckStore` / `useTagStore` から `deckId` / `tagId` で検索して取得し、`Stack.Screen` の `headerTitle` に渡す。
- **通知リマインダー**: `lib/notifications.ts` の `scheduleDailyReminder(hour, minute)` が identifier `'daily-reminder'` 固定で毎日繰り返し通知をスケジュール（再呼び出し前に既存通知をキャンセル）。設定画面でオン/オフと時刻を管理。`useSettingsStore` に `notificationEnabled`・`notificationHour`・`notificationMinute` を AsyncStorage 永続化で保存。
- **アイコンバッジ**: `lib/notifications.ts` の `updateBadgeCount(db)` が `getTodayDueCount()` で全デッキ横断の due 枚数を取得し `setBadgeCountAsync()` でバッジに反映。`app/_layout.tsx` のフォアグラウンド復帰時と学習セッション完了時に呼ばれる。
- **デッキソート**: `store/settings.ts` の `deckSortOrder`（`'manual' | 'name' | 'cardCount'`）で制御。`'manual'` 時のみ長押しドラッグが有効。他のソートは Zustand の `decks` 配列を `.sort()` するだけで DB 順序を変えない。
- **カード複製**: `lib/database/cards.ts` の `duplicateCard(db, cardId)` が元カードの内容・タグを複製して新カードを作成。カード一覧の選択モードバーの複製ボタン（`copy-outline`）から呼び出す。
- **カード全文検索**: `app/search.tsx` はホーム画面ヘッダーの検索アイコンから遷移。`searchCards(db, query)` が `frontContent LIKE ?` で検索（JSON文字列のまま LIKE 可能）し `ORDER BY updatedAt DESC LIMIT 100`。クエリ変更ごとにリアルタイム検索。結果タップで `/deck/[id]/card/[cardId]/edit` へ遷移。

### ジェスチャー実装パターン

react-native-gesture-handler (RNGH) v2 と react-native-reanimated を組み合わせる際の必須ルール：

- **worklet から JS 関数を呼ぶ**: `onEnd(() => runOnJS(fn)())` の形式を使う。`onEnd(() => fn())` はクラッシュする。
- **worklet に渡す引数は serializable のみ**: `runOnJS(setState)((v) => !v)` は NG（関数は渡せない）。必ず `const toggle = () => setState(v => !v); runOnJS(toggle)()` のように名前付き関数でラップする。
- **worklet 内でインライン closure を作らない**: `runOnJS(() => { setA(x); setB(y); })()` はクラッシュする。必ず外で名前付き関数として定義する。
- **ジェスチャーオブジェクトの安定化**: 複数の `GestureDetector` が入れ子になる場合、内側が外側に優先されるには両方のジェスチャーオブジェクトが安定している必要がある。ハンドラは `useCallback`、ジェスチャーオブジェクトは `useMemo` でメモ化する。
- **ScrollView と FlipCard の共存**: `FlipCard` の tap ジェスチャーを RNGH の `GestureDetector + Tap` にすることで、ScrollView の縦スクロールと競合しなくなる（旧来の `Pressable` では ScrollView のスクロールが阻害される）。

### 主要な設定

- `app.json`: `newArchEnabled: true`（新アーキテクチャ）、`typedRoutes: true`、`reactCompiler: true`（実験的）。Android は `edgeToEdgeEnabled: true`、`predictiveBackGestureEnabled: false`。URL スキーム: `codeflashcard`
- `tsconfig.json`: strictモード、`@/*` がリポジトリルートに対応
- VSCode: 保存時に ESLint 自動修正とインポート整理が実行される
- `patch-package`: `postinstall` フックで自動適用。`patches/` 配下に差分ファイルを置く

**技術スタック:** React Native 0.81 / React 19 / Expo 54 / expo-router 6 / expo-sqlite / Zustand 5 / i18next。アニメーションに react-native-reanimated、ジェスチャー操作に react-native-gesture-handler が利用可能。

### 実装チケット

`docs/` 配下に機能チケット（000〜023）がある。各チケットにはフェーズ・依存関係・Todoチェックリストが記載されており、実装完了時に `- [ ]` → `- [x]` に更新する。`docs/000-ticket-overview.md` に全体の依存関係図がある。

完了済み: 001〜013（プロジェクト基盤・デッキ/カード/タグCRUD・エディタ・SM-2・学習画面・全画面+Bluetoothキーボード・JS/TS/Python コード実行・画像ブロック・統計画面・ダークモード）。その後エディタリファクタリング（`BlockItemHeader` 抽出）・ホーム画面フィルターブロック・コードブロックヘッダー色変更・バッジ表示・「新規」フィルター意味変更・エクスポート review_logs 追加・コードリファクタリング・フィルターキー統一・初期フィルター「保持」の全画面対応・統計画面ヒートマップ追加・T/Yキーヌルサイクル（学習画面コードブロック + カード一覧カードフォーカス）・カード編集初期タブ指定・BlockEditor スクロール改善・カード一覧選択モード（複数選択・移動・削除・アイコンボタン）・学習セッションヘッダーにデッキ/タグ名表示・i18n フォールバック英語化・021（JSONエクスポート/インポート）・022（カード全文検索）・023（通知リマインダー）を実施。その後、学習完了サマリー改善（グレード分布・正答率・次回予定表示）・ホームデッキソート（手動/名前/枚数）・アプリアイコンバッジ（due 枚数）・カード複製（選択モードから一括複製）を追加実装。

未着手: 014（iCloud同期）・015（Web版）・016（買い切り課金）・017（App Store申請）・018（SQL/C++実行）・019（マーケットプレイス）・020（AI生成）

### UI パターン（実装済み画面の慣習）

- **統計ブロック**: 数字（`theme.fontSize.xxl`・色付き）→ラベル（`theme.fontSize.xs`・`textSecondary`）の縦並び。`theme.colors.surface` 背景・角丸・影付き。`deck/[id]/index.tsx` の `statItem` スタイルが基準。
- **バッジ色**: 「復習」（due）= 青（`#1976D2`）、それ以外のフィルター = グレー（ライト: `#8B949E`、ダーク: `#4B5563`）。`theme.dark` で分岐する。
- **セクションタイトル**: `theme.fontSize.lg, fontWeight: '700', color: theme.colors.textSecondary`。ホーム画面・カード一覧画面で使用。
- **コードブロック（学習画面）**: `components/study/SyntaxHighlightedCode.tsx` は `theme.fontSize.md` を使用。フォントサイズ設定に連動する。
- **locales の改行**: ラベルに改行が必要な場合は `"カード\n総数"` のように `\n` を埋め込む（`Text` コンポーネントがそのまま改行として解釈する）。
