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
├── search.tsx           # カード全文検索画面（全デッキ横断、フィールド別検索: all/front/back/memo）
├── archive/index.tsx    # アーカイブ一覧（042・設定タブから push）。[デッキ|カード]2タブ＋選択モードで一括解除/削除
└── (tabs)/              # タブグループ（URLに影響しない透過グループ）
    ├── _layout.tsx      # タブバー定義（ホーム / 学習 / 統計 / 設定）
    ├── index.tsx        # ホーム画面（デッキ一覧）
    ├── study.tsx        # 学習対象選択画面
    ├── stats.tsx        # 統計画面
    └── settings.tsx     # 設定画面

lib/
├── database/            # SQLite CRUD 関数（entity ごとにファイル分離）
│   ├── schema.ts        # テーブル定義 + migrateDbIfNeeded()（ALTER による差分マイグレーション + iCloud同期トリガー）
│   ├── utils.ts         # generateId()・todayISO()・todayLocalRange()・localDateStr()・activeCardCond()（非アーカイブ条件）
│   ├── decks.ts         # Deck CRUD + setDeckArchived()
│   ├── cards.ts         # Card CRUD（本文は card_contents テーブルへ分離）+ setCardArchived/setCardsArchived・各種カウント/キュー取得（activeCardCond でアーカイブ除外）
│   ├── tags.ts          # Tag CRUD + card_tags 操作
│   └── reviews.ts       # レビューデータ操作（FSRS永続化）+ 統計集計（due/習熟度/ランキング/ヒートマップ）
├── code-execution/      # コード実行サンドボックス
│   ├── sandbox.ts       # buildSandboxHtml()：言語別 HTML サンドボックス生成。buildWebSandboxHtml（html/js＋HTML土台の可視プレビュー実行）・buildStaticPreviewHtml（実行前プレビュー＝土台のみ表示）・buildInteractiveWebSandboxHtml（041・全画面インタラクティブ＝生きたまま実行しconsoleを逐次ストリーム）も
│   ├── constants.ts     # LANGUAGES・LANG_LABELS・EXECUTABLE_LANGUAGES・PRO_LANGUAGES（sql/cpp/html は Pro 限定）
│   └── types.ts         # ExecResult・ExecStatus・LogEntry
├── i18n/index.ts        # i18next 設定（端末言語自動検出、フォールバック: en）
├── theme/index.ts       # useTheme()・lightTheme/darkTheme・AppColors・AppFontSize 型定義
├── image.ts             # resolveImageUri()：画像パス解決
├── syntax-highlight.ts  # シンタックスハイライト（Token/TokenType）。学習画面の SyntaxHighlightedCode が使用
├── FlipSuppressContext.ts  # コードブロックのボタンタップ時にカードフリップを一時抑制する Context
├── InteractivePreviewContext.ts  # 041・全画面インタラクティブプレビューの開閉を子（CodeRunnerView/CodeBlockItem）から親（session/BlockEditor）のキー抑止へ伝える Context（setOpen のみ）
├── export.ts            # 全テーブル（review_logs 含む）を JSON エクスポート
├── import.ts            # merge（INSERT OR IGNORE）/ replace（全削除後挿入）の2モードでインポート
├── tsv.ts               # TSV形式でのデッキエクスポート/インポート（Anki互換）。コードブロックは ```言語 フェンスで往復（blocksToText ⇄ textToBlocks）
├── notifications.ts     # requestPermission()・scheduleDailyReminder()・updateBadgeCount(db)
├── fsrs.ts              # FSRS スケジューリングエンジン（ts-fsrs ライブラリのラッパー）。実際の次回復習日計算はここ
├── sm2.ts               # Grade 型（0〜3）の定義元。アルゴリズム本体は fsrs.ts に移行済み
├── donut.ts             # ドーナツグラフの定数（DONUT_SIZE 等）とパス計算（donutArcPath）
├── cardPreview.ts       # getCardPreview()：ブロック配列からプレビューテキストを生成
├── cardEditorShortcuts.ts  # CARD_EDITOR_SHORTCUTS_EDIT / _SORT の定義（ShortcutsModal 用）
├── useKeyCommands.ts    # ネイティブ UIKeyCommand（react-native-key-command）でハードキーを受ける共通フック（隠しTextInput不使用・034）。deleteKeySpecs（Backspace/Delete）・scrollKeySpecs（U/D・PgUp/PgDn・Home/End・⇧U/⇧D の8spec生成）・useShortcutsToggleKeys（?で開く/表示中Esc・Returnで閉じる）もここ
├── study/
│   └── extractLinks.ts  # カードブロックからリンクを抽出（学習画面 L キー = リンク一覧用）
└── ...

store/                   # Zustand ストア（インメモリキャッシュ）
├── decks.ts             # useDeckStore
├── cards.ts             # useCardStore
├── tags.ts              # useTagStore
├── reviews.ts           # useReviewStore（学習セッション状態）
├── theme.ts             # useThemeStore（themePreference・fontSizePreference、AsyncStorage永続化）
├── sync.ts              # useSyncStore（iCloud同期状態・dataRevision）
├── pro.ts               # useProStore（買い切り課金の Pro フラグ）
└── settings.ts          # useSettingsStore（initialFilterPreference・lastDeckDetailFilter・lastHomeFilter・lastSelectedCodeLanguage・deck/tag/cardSortOrder・shuffleEnabled・lastSearchField・fsrsDesiredRetention・studyHideEmpty・gradeRanking系・cardThemePreference・languagePreference・通知設定、AsyncStorage永続化）。永続化定義は DEFS テーブル（キー・既定値・parse・persist・onApply）に一元化＝設定追加は DEFS 1エントリ＋setter 1行。**追加したら lib/settings-keys.ts（JSONエクスポート対象キー一覧）にも必ず追加する**（漏れるとエクスポート/インポートで復元されない）

components/
├── code/
│   └── ExecutionOutput.tsx  # コード実行結果表示（WebView + ログ）
├── editor/              # BlockEditor, TextBlockItem, CodeBlockItem, ImageBlockItem, TagSelector
│   └── BlockItemHeader.tsx  # ブロックの共通ヘッダー（並び替えハンドル・削除ボタン）。各 *BlockItem が使用
├── stats/
│   └── ActivityHeatmap.tsx  # 学習履歴ヒートマップ（草グラフ）。weeks props で表示週数を制御
├── study/               # FlipCard（reanimated）, BlocksView, CodeRunnerView, SyntaxHighlightedCode, ZoomableImage, LinksSheet, ShortcutsModal
├── ConfirmDeleteModal.tsx  # 削除確認モーダル（単一メッセージ + 確認/キャンセル）
├── ConfirmModal.tsx        # 汎用確認モーダル（複数アクション対応）
├── InfoModal.tsx           # 情報表示モーダル（OK のみ）
├── DeckPickerModal.tsx     # デッキ選択モーダル（タグカード一覧・カード移動で共用）
├── DeckIcon.tsx            # デッキの色付きアイコン（iconName + colorHex、未設定は primary）
├── IconPickerModal.tsx     # デッキアイコン選択モーダル
├── SwipeToDeleteRow.tsx    # 左スワイプで [アーカイブ/解除][削除] を出す共通ラッパー（onArchive は任意）
├── ModalFormHeader.tsx     # 入力系モーダル（デッキ/タグ/カードの新規・編集6画面）共通の自前固定ヘッダー（×・中央タイトル＋キーボードアイコン・✓。useLockedTopInset 内蔵）
├── DiscardConfirmModal.tsx # 「変更を破棄しますか？」確認（保存/破棄 actions。ConfirmModal のラッパー）
├── FormBottomBar.tsx       # 入力系モーダル共通の底部バー（削除?・複製?・保存。アイコンのみ）
└── EmptyState.tsx          # 空状態表示（アイコン＋タイトル＋サブタイトル）

hooks/
├── useStudySession.ts        # 学習セッション管理（キュー管理・FSRS連携・finishSession）
├── useCodeExecution.ts       # コード実行状態管理（run/clear/reset/handleMessage）
├── useCodeBlockSelection.ts  # コードブロックフォーカス選択状態管理
├── useSwipeGesture.ts        # 学習セッションのスワイプジェスチャー管理
├── useListNavigation.ts      # リスト J/K フォーカスのヌルサイクル（ID ベース追跡で並び替え後も正しい位置を保持）
├── useShortcutsHeader.tsx    # ショートカットモーダルのヘッダータイトル UI を生成するフック
└── useInsertPair.ts          # ブラケット・クォートの自動閉じ挿入

types/index.ts           # 全ドメイン型（唯一の定義元）
locales/ja.json          # 日本語翻訳
locales/en.json          # 英語翻訳
docs/000〜032-*.md       # 機能チケット（実装計画・Todoチェックリスト）
```

### データフロー

画面 → `lib/database/*.ts`（DB 読み書き）→ `store/*.ts`（Zustand でインメモリ更新） の3層構造。Zustand は SQLite の読み取りキャッシュとして機能し、DB 書き込みと同時に手動で更新する。

### DB 初期化

`app/_layout.tsx` の `<SQLiteProvider databaseName="codeflash.db" onInit={migrateDbIfNeeded}>` がアプリ起動時に `lib/database/schema.ts` の `migrateDbIfNeeded()` を実行する。テーブルは `decks`・`cards`・`card_contents`（カード本文を分離）・`tags`・`card_tags`・`reviews`・`review_logs`・`grade_logs`・`notification_schedules`・`sync_state`（iCloud同期用）。既存DBには `PRAGMA table_info` で存在確認しつつ `ALTER TABLE` で列を追加するマイグレーション方式（`sortOrder`・FSRS列・`lastGrade`・`iconName`/`colorHex`・`archived` など）。`sync_state` はユーザーデータ変更をトリガーで捕捉し `localVersion` を進める。子画面では `useSQLiteContext()` でDBインスタンスを取得する。

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
├── search                              — カード全文検索（ホーム画面ヘッダーの検索アイコンから遷移）
└── archive/index                       — アーカイブ一覧（設定タブの「アーカイブ」行から遷移）
```

### カスタムヘッダーパターン

push 遷移する全画面（`deck/[id]`・`tags/index`・`tags/[tagId]/cards`・`search`・`study/session`）は React Navigation の標準ヘッダーを使わず、`headerShown: false` ＋ インラインカスタムヘッダー View を採用している（遷移アニメーション中の戻るボタン残像を防ぐため）。

```jsx
// _layout.tsx でも設定
<Stack.Screen name="deck/[id]" options={{ headerShown: false }} />

// 画面コンポーネント内でも明示
<Stack.Screen options={{ headerShown: false }} />

// カスタムヘッダー構造（headerHeights = useLockedHeaderHeights()）
<View style={{ height: headerHeights.total, backgroundColor: theme.colors.surface }}>
  <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: headerHeights.content,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
    {/* タイトル: position: absolute で left:0 right:0 に広げて中央配置 */}
    {/* 戻るボタン(左) + スペーサー + アクションボタン(右) */}
  </View>
</View>
```

- 高さは `lib/useLockedTopInset.ts` の **`useLockedHeaderHeights()`**（`{ total, content }`）を使う。標準ヘッダーと同じ `getDefaultHeaderHeight` 算出（**Dynamic Island 搭載機は inset−5.33 の補正・iPad はコンテンツ行 50**）＋「縮まない」`useLockedTopInset`（観測した最大 `insets.top` を保持＝上方向にだけ自己修復）の組み合わせ。旧 `lockedTopInset + 44` の直書きは DI 機で標準/ホームのヘッダーより約5.3pt 高くズレるため全画面置換済み（ホームの旧 `computeHeaderHeights` もこのフックに統合）。旧 `initialTopInsetRef = useRef(insets.top)` はマウント時に過小値を掴むと縮んだままになるため廃止済み。
- 戻るボタンには 350ms ガード（モーダルを閉じた直後の誤タップ防止）

**入力系モーダルは必ず自前の固定ヘッダーにする（標準ヘッダー禁止）**：デッキ/カード/タグの新規・編集6画面（`deck/new`・`deck/[id]/edit`・`deck/[id]/card/new`・`deck/[id]/card/[cardId]/edit`・`tags/new`・`tags/[tagId]/edit`）は `presentation: 'fullScreenModal'` だが、**標準（native-stack）ヘッダーではなく `headerShown: false` ＋ `useLockedTopInset` の自前固定ヘッダー**にしている。理由は、コード実行 WebView が iOS ステータスバーを隠すと、標準ヘッダーは高さが status bar inset に追従して**縮む**うえ、**ネイティブのバーボタンのホバー/ハイライトのカプセルが横長の楕円に変形する**（保存ボタンの丸枠がタイトルまで伸びる）ため。自前ヘッダー（ただの `Pressable`＋`Ionicons`）ならネイティブのバーボタンが無いので、縮み・楕円変形ともに原理的に発生しない。詳細は [[project_statusbar-header-inset-ipad]]。**新しい入力系モーダルを追加するときも同じ自前ヘッダーにすること**（標準ヘッダーで追加するとその画面だけ再発する）。この自前ヘッダーは **`components/ModalFormHeader.tsx` に共通化済み**（底部バーは `FormBottomBar`・破棄確認は `DiscardConfirmModal`）なので、新規追加時はこれらを使う。
  - 落とし穴：モーダルで `headerShown` を画面側で動的に `true→false` すると remount ループ（`Maximum update depth exceeded`）になる。**必ず `_layout.tsx` の各 `Stack.Screen` 登録に静的に `headerShown: false` を付ける**（画面側の `<Stack.Screen options={{ headerShown:false }} />` は同値の再指定にとどめる）。
- `presentation: 'modal'`（`paywall` など純粋な情報/購入モーダル）は標準ヘッダーのままでよい（テキスト入力もコード実行 WebView も無いため）。

### 型定義

`types/index.ts` がドメイン型の唯一の定義元。ブロックは `TextBlock | CodeBlock | ImageBlock` のユニオン型で、カードの `frontContent / backContent / memoContent` は `card_contents` テーブルに JSON文字列として保存される（`cards` テーブルはメタ情報のみ）。`Deck` / `Card` には `archived: boolean` がある（SQLite は 0/1 を返すため `getAllDecks`/`toCard` で boolean に正規化する）。

### コード実行アーキテクチャ

`useCodeExecution(onResult?)` フックが状態管理を担う。`run()` が `buildSandboxHtml()` で HTML を生成し、`ExecutionOutput` 内の `WebView` で実行する。WebView からの `postMessage` を `handleMessage()` で受け取り `result` を更新する。`onResult` コールバックは `result` がセットされた直後（50ms 遅延）に呼ばれるため、実行完了後のスクロールなどに使える。Python は Pyodide（CDN）を利用するため `baseUrl` が設定される。

実行できる言語は `EXECUTABLE_LANGUAGES`（`javascript`・`typescript`・`python`・`sql`・`cpp`・`html`）で、うち `PRO_LANGUAGES`（`sql`・`cpp`・`html`）は Pro 限定。**C++ だけは WebView サンドボックスを使わない例外**で、`runCppViaWandbox()` が Wandbox の公開 API（`https://wandbox.org/api/compile.json`・gcc-13.2.0 / `-std=c++17`）に POST して結果を受け取る。ネットワーク実行のため固有の事情がある：全体30秒の `AbortController` タイムアウト（超過で `status: 'timeout'`）、公開インスタンスの混雑（`WANDBOX_TRANSIENT_PATTERN` に一致する一時障害）は 800ms→1600ms のバックオフで自動リトライし、それでも復旧しなければコードの誤りと区別して `code.serverBusy` を案内する。コンパイルエラー（`compiler_error` に `error:` を含む）はユーザーのコードの問題なのでリトライ対象にしない。

**HTML/CSS プレビュー実行（040・Pro 限定）**：`html` ブロックは本文（HTML/CSS/JS）をそのまま描画、`javascript`/`typescript` ブロックは **HTML/CSS 土台**（`Deck.htmlInit`＝デッキ共通 ＋ `CodeBlock.htmlInit`＝ブロック固有）を JS で操作する。土台は SQL 初期化と同じ加算型（デッキ→ブロック）。実行系は `buildWebSandboxHtml()`＝`<head>` にネットワーク遮断・console キャプチャ・保留タイマー追跡を置き、インライン `<script>` の未捕捉例外は `window.onerror`、完了判定は `DOMContentLoaded` 後（後出しログはマクロタスク境界まで待つ・全体5秒上限）。`ExecutionOutput` は web 系のとき **可視 WebView**（`pointerEvents="none"`・`onInteract` で学習画面のタップ時に `suppress()` してフリップ抑止）で描画し `[プレビュー | ソース]` トグル（ソース＝土台テキスト）を出す。未実行の js/ts＋土台は `buildStaticPreviewHtml()`（土台のみ・表示専用・postMessage しない）の**実行前プレビュー**を自動表示（土台編集は400msデバウンス）、実行結果表示中は右端の⟲リセットで初期状態へ戻す。同一コードの再実行で完了メッセージが来ず固着するのを防ぐため、WebView は `runNonce` を key にして毎回再マウントする。Pro ゲートは言語で方式が異なる：html は `PRO_LANGUAGES`（実行ゲート）、js/ts は土台入力欄・静的プレビューを `isPro` で出し分け（非 Pro は従来コンソールのみ）。

**全画面インタラクティブプレビュー（041・Pro 限定）**：040 のインライン可視 WebView は `pointerEvents="none"` の表示専用で `addEventListener` が発火しない。041 は `ExecutionOutput` のプレビューバーに ⛶ ボタン（`onExpand`）を出し、`InteractivePreviewModal`（`components/code/`）＝ **`presentation="fullScreen"` の RN Modal（別ネイティブ VC）** で操作可能な WebView を開く。別 VC ゆえカードの ScrollView/FlipCard・編集の `NestableDraggableFlatList` と**ジェスチャー競合しない**（これがインライン操作化を採らずモーダルにした理由）。実行系は `buildInteractiveWebSandboxHtml()`＝完了判定・5秒タイムアウトを持たず生きたまま動き、console・未捕捉例外を**1行ずつ逐次 postMessage**（イベントで出たログをライブ表示）。モーダルは下部にライブ console＋✕/⟲（リセット再実行＝`nonce` 再マウント）。TS はモーダル内で sucrase 変換。学習/編集の両画面（`CodeRunnerView`/`CodeBlockItem`）で描画し、`isPro` かつ Web プレビュー対象（html／js・ts＋土台）のときのみボタン表示。**背後キー抑止**：モーダルは別 VC でもアプリの `UIKeyCommand` は生きるため、`InteractivePreviewContext`（`setOpen`）で開閉を親へ伝え、学習は `session.tsx` の main キー active に `&& !interactivePreviewOpen`＋常時 Esc ハンドラ先頭で `if (interactivePreviewOpen) return;`（**Esc→safeBack でセッションごと抜ける暴発を防止**・閉じるはモーダル自身の Esc）、編集は `BlockEditor` の main/Esc 両 active に `&& !interactivePreviewOpen`（`suspendKeys` と同型で main＋Esc を一括解除）。開くのは ⛶ タッチのみ（開くキーは未割当）、閉じるは Esc／✕。

**サンドボックスで使えない/使える API（JS・web 系／console・040 インライン・041 全画面 共通）**：無効化＝呼ぶと TypeError なのは `fetch`・`XMLHttpRequest`・`WebSocket`・`window.open`（通信とウィンドウ生成を遮断）。`window.close()` はエラーにならないが**無反応**（開いた窓が無い）。WebView の `baseUrl` が `about:blank`（オリジンなし＝opaque origin）のため **Storage 系は使用不可**：`localStorage`/`sessionStorage`/`indexedDB` は SecurityError「The operation is insecure.」（`localStorage` は実測確認済み）、`document.cookie` は例外は出ないが保存されない。`import`/`export`・`require()`・npm・動的 `import()` も不可（バンドラ/通信なし）。同じ理由で **`isSecureContext === false`（実測確認済み）＝セキュアコンテキスト限定 API は一律不可**：`navigator.clipboard`・`crypto.subtle`・`crypto.randomUUID`（いずれも `undefined`）・Service Worker 登録・`Notification`・`getUserMedia`・Geolocation。乱数は**セキュアコンテキスト限定ではない `crypto.getRandomValues()` が使える**（UUID が要るならこれで自作する）。**`history.pushState` は `'#x'` のようなハッシュ変更なら通る（実測 OK）**が、`about:blank` は相対パス解決ができないためパス変更（`'/foo'`）は落ちる想定＝SPA ルーティングのデモは不可。一方 **`alert()`/`confirm()`/`prompt()` はネイティブダイアログとして動作する**（react-native-webview の WKUIDelegate 既定・特別な実装なし。`confirm`/`prompt` は同期ブロックのため console・040 では5秒タイムアウトに掛かりうる／041 全画面は上限なし）。localStorage を使えるようにする案（メモリ内 shim／`incognito`／実在オリジン付与）は 2026-07 に検討したが、非永続で誤解を生む・「毎回まっさら／カードごとに独立」の実行モデルと衝突するため**見送り**（この記述が結論＝再提案しない）。

**HTML ブロック／HTML 土台で書けるもの・書いても効かないもの**：`buildWebSandboxHtml`/`buildInteractiveWebSandboxHtml`/`buildStaticPreviewHtml` はいずれも **土台（`${stages}`）とブロック本文（`${markup}`）を `<body>` 直下へ文字列連結**する構造で、`<head>` は固定（charset・viewport・遮断スクリプト）＝**ユーザーが head に足す手段は無い**。そのため head 系は「無視される」のではなく「置き場所が悪くて効果がない」：`<meta charset>`（エンコーディング確定済み）・`<meta name="description">`/`og:*`/`keywords`/`robots`・`<meta name="theme-color">`・`<title>`（表示先が無い。041 のヘッダーは言語名固定。`document.title` では読める）・`<link rel="icon"/"manifest"/"canonical"/"preconnect">` はすべて無効果。`<!DOCTYPE>` と `<head>` 開始タグは本文中では無視され、`<meta name="viewport">` は head 側で指定済み（後勝ちで効く可能性はあるので書かない）。ただし **`<html lang>`/`<body style>` の属性は既存要素にマージされて実際に効く**（HTML 仕様の挙動）。フル HTML ドキュメントを丸ごと貼っても「head の中身が body に落ちるだけ」でだいたい動く。**画像は `<img src="data:...">` とインライン `<svg>`（＋CSS の `url(data:...)`）なら通信もオリジンも不要で確実**。相対パス・ローカルファイル・アプリ内の画像ブロックの画像は `baseUrl='about:blank'`＋`allowFileAccess` 未設定のため**不可**。**外部 https の `<img>` は実測で表示された**（CSP 無し・`originWhitelist={['*']}`）＝`<script src>`/`<link rel=stylesheet>`/`<iframe src>` も同経路で通るが、**オフラインで無音で壊れる**ので教材では非推奨（`@font-face` の Web フォントだけは CORS 必須＝`Origin: null` を許す CDN のみ）。**両プレビューで等しく無意味**なのは `:hover`/`:focus-visible`（指にホバーが無い）・`<noscript>`（JS 常時有効）・`target="_blank"`（`window.open` 無効・別窓を開けない）・`<base target>`・`<video>`/`<audio>`（`allowsInlineMediaPlayback={false}`＋要ユーザー操作＋ソースが無い＝実質使えない）。**040 インライン特有**の制限は 220pt 固定高・`scrollEnabled={false}`・`pointerEvents="none"`＝はみ出しは切れる／`100vh`=220pt／操作不可（041 全画面では解消）。**土台の `<script>` 内の `console.log` は静的プレビュー（未実行時）では console キャプチャが無いのでどこにも出ない**（実行後は出る）。

### 実装上の注意点

#### DB・データ操作

- **`lib/database/utils.ts`**: `generateId()`・`todayISO()`・`todayLocalRange()`・`localDateStr(d: Date)` をエクスポート。DB ファイルだけでなく UI コンポーネントからも import して使用する。日付範囲クエリ（当日作成・当日学習済み判定など）は `todayLocalRange()` が返す `{ start, end }` を使う（`toISOString()` は UTC を返すためローカル日付がずれる）。
- **`foreign_keys` pragma は未設定** → `deleteCard` / `deleteTag` / `deleteDeck` では関連行（`card_contents` / `card_tags` / `reviews` / `review_logs` / `grade_logs`）を明示的に先に削除する
- **アーカイブ（学習対象からの除外）**: `decks` / `cards` の `archived` 列。`lib/database/utils.ts` の `activeCardCond(alias)`（カード自身が非アーカイブ **かつ** 所属デッキが非アーカイブ）を「将来指標」系クエリ（due・新規・未学習・習熟度・当日対象・学習キュー・バッジ）に適用して除外する。`review_logs`/`grade_logs` ベースの過去実績（ヒートマップ・ストリーク・正答率）には**適用しない**（消さない）。一覧の生取得（`getCardsByDeckId`/`searchCards` 等）も除外しない（UI 側でグレー表示）。詳細は `docs/032`。
- **アーカイブ一覧画面（042）**: 設定タブ →「アーカイブ」→ `app/archive/index.tsx`（push・カスタムヘッダー）。上部 [デッキ N][カード M] の2タブで、**デッキタブ＝`decks.archived`（ストアから取得＝クエリ不要）／カードタブ＝`getArchivedCards()`＝`cards.archived = 1` のみ**（アーカイブ済みデッキ配下の実効アーカイブカードは含めない＝それはデッキタブの対象）。選択モード（`S`・`Space`・`A`）で一括解除（`setDecksArchived`/`setCardsArchived`）と一括削除（`deleteDecksBulk`/`deleteCardsBulk`）。**解除は可逆なので確認なし＋`ArchivePill` 通知、削除は件数明示の `ConfirmDeleteModal`**。全行がアーカイブ済みなので一覧慣習のグレー（`opacity: 0.55`）は使わず `archive` アイコンのみで示す。タブ切替時は選択とフォーカスを必ずリセットする。詳細は `docs/042`。
- **アーカイブ済みデッキのカード一覧は初期フィルター「すべて」**: `app/deck/[id]/index.tsx` の `selectedFilter` 初期値は、デッキがアーカイブ中なら設定（`initialFilterPreference`/`lastDeckDetailFilter`）に関わらず `'all'`。理由はアーカイブ済みデッキだと `activeCardCond` により学習済み/復習/新規が**構造的に常に0件**で、空リスト＋学習ボタン無効（＝2択ダイアログにも到達できない）になるため。**`setLastDeckDetailFilter` は呼ばない**（「直近」設定の記憶値を潰さない）。
- **削除時の後始末（042 で修正）**: `deleteDeck` は `deleteDecksBulk(db, [id])` に委譲し、**`grade_logs` の削除と画像ファイルの削除**を含む（旧実装は両方とも取りこぼして孤児データが溜まっていた）。`deleteCard`/`deleteCardsBulk` も `grade_logs` を削除する。`deleteCardsBulk` の第3引数は `deckId | deckIds[]` で、複数デッキのカードを混ぜて削除しても `cardCount` を全対象デッキ分数え直す。**カード削除系を追加するときは `card_contents`/`card_tags`/`reviews`/`review_logs`/`grade_logs`＋画像の6点セットを必ず消すこと**（`foreign_keys` pragma 未設定のため）。
- **アーカイブ中デッキからの学習＝2択ダイアログ（閲覧モード）**: アーカイブ中デッキのカード一覧で学習を始めようとすると（学習ボタン・Space・⇧Space・右スワイプ「ここから学習」）、`ConfirmModal` で「アーカイブを解除して学習」／「閲覧のみ（記録なし）」を選ばせる。かつては無反応（`cardIds.length === 0` で return）だったのを解消したもの。**解除するのは `decks.archived` だけ**で、個別アーカイブのカードは戻さない（どれを個別アーカイブしていたかの記録が無く非可逆なため）＝解除後の対象は通常学習と同じ「非アーカイブカードのみ」。解除後に0枚になるときは解除の選択肢自体を出さない。**閲覧モード**は `/study/session` に `browse=1` を渡す＝グレードボタンを出さず `submitGrade` を一切呼ばないので `reviews`/`review_logs`/`grade_logs` に書き込みが起きず FSRS も動かない（バッジ・ヒートマップにも無影響）。裏面でも前後送り（`,`/`.`・FAB）のままで、`Q` と完了は集計画面を出さず即戻る。ヘッダーに 👁 アイコン。閲覧の対象は「一覧に見えているカードそのまま」＝個別アーカイブのカードも含む（記録しないので学習対象の概念が無く、「ここから」が指したカードから確実に始められる）。**混在デッキ（デッキは通常・一部カードだけアーカイブ）ではダイアログを出さない**（残りのカードで学習が成立するため黙って除外）。カード一覧の右スワイプ「ここから学習」はアーカイブ済みカード行では出さない（デッキごとアーカイブ中は全行で出す＝ダイアログへの入口）。
- **グレード対応**: `grade 0` = 再考(again), `1` = 苦手(hard), `2` = 正解(good), `3` = 即答(easy)（`locales/ja.json` の `grade.*` が定義元。旧名称「もう一度/うろ覚え/わかった/バッチリ」はドキュメント上の残骸なので使わない）。型は `lib/sm2.ts` の `Grade = 0 | 1 | 2 | 3`。実際の次回復習日計算は `lib/fsrs.ts` の `calculateNextReviewFSRS()` が `ts-fsrs` ライブラリを使って行う（SM-2 ではなく FSRS アルゴリズム）。
- **`getDeckMasteryList` の戻り値**: `avgEase: number | null`（未学習デッキは NULL）・`learnedCount: number`・`newCount: number`（未学習枚数）を返す。`LEFT JOIN` で未学習デッキも含む。`masteryPercent()` は `avgEase == null` のとき 0 を返す。統計画面の `MasteryItem` 型も `avgEase: number | null` で定義。
- **「新規」フィルターの意味**: 学習タブ・カード一覧・統計タブの「新規」ブロックは「今日作成したカード数」を表す。学習してもカウントは減らず、翌日に 0 にリセットされる。実際のクエリは `getTodayCreatedCardIdsByDeckId` を使う。**アーカイブの扱いは画面で異なる**：統計タブ（`getTodayCreatedCount`）は作成実績なので除外しない（「過去7日間の新規作成」グラフと一致させる）。学習タブ・カード一覧（`getTodayCreatedCountPerDeck/PerTag` 等）は学習対象数なので `activeCardCond` で除外する。
- **エクスポート/インポート**: `lib/export.ts` と `lib/import.ts` が JSON 形式、`lib/tsv.ts` が TSV 形式（Anki互換・表/裏テキストのみ）を担当。JSON は全テーブル（`review_logs`・`grade_logs` 含む）＋ AsyncStorage 設定 ＋（任意で）画像 base64 をエクスポートし、`archived` も保持する。インポートは `merge`（`INSERT OR IGNORE`）と `replace`（全削除後に挿入）の2モード。TSV は `archived` を含まない。
- **TSV のコードブロック（フェンス往復）**: `blocksToText`（エクスポート）と `textToBlocks`（インポート）が対称。コードブロックは ` ```言語 ` で囲んで出力し、インポート時に言語・`executable`（`EXECUTABLE_LANGUAGES` で判定）付きのコードブロックへ戻す。フェンス長は CommonMark 同様「中身の最長バッククォート連続＋1」に自動拡張するので、本文に ``` を含むコードも壊れない。言語は `js`/`py`/`c++` などの略記を `LANGUAGE_ALIASES` で正規化し、`LANGUAGES` に無いものは `text`。**フェンスの無い旧 TSV は従来どおりテキストブロック1個**（後方互換）、閉じフェンスが無い開始フェンスはただの本文として扱う。往復で戻らないのは画像（`[image]` 文字列）と `sqlInit`/`htmlInit`＝忠実な保存は JSON エクスポートの役目。**落ちるものが実際にあるデッキだけ、エクスポート前に内訳（デッキ共通のSQL初期化/HTML土台・ブロック固有の初期化の件数・画像枚数）を出して確認する**（`inspectTsvExport`/`hasTsvExportLoss` → `app/settings/data.tsx` の `handleTsvDeckSelected`）。該当が無ければ確認は挟まない＝通常デッキで操作を増やさない。テキストブロック内にフェンスを書いた場合は往復でコードブロックに変わる（マークダウンと同じ解釈・許容）。
- **カード全文検索**: `app/search.tsx` はホーム画面ヘッダーの検索アイコンから遷移。`searchCards(db, query, field)` が指定フィールド（`SearchField = 'all' | 'front' | 'back' | 'memo'`）を LIKE 検索（JSON文字列のまま LIKE 可能）し `ORDER BY updatedAt DESC LIMIT 100`。選択中フィールドは `useSettingsStore` の `lastSearchField` に AsyncStorage 永続化。クエリ変更ごとにリアルタイム検索。結果タップで `/deck/[id]/card/[cardId]/edit` へ遷移。
- **カード複製**: `lib/database/cards.ts` の `duplicateCard(db, cardId)` が元カードの内容・タグを複製して新カードを作成。カード一覧の選択モードバーの複製ボタン（`copy-outline`）から呼び出す。

#### テーマ・UI スタイル

- **テーマ**: `useTheme()` を呼び出すだけで現在のテーマ（`AppTheme`）が取得できる。テーマ色は `theme.colors.*`、フォントサイズは `theme.fontSize.*` で参照する（StyleSheet に直書きしない）。セクションタイトル文字色は `theme.colors.textSecondary` で統一。
- **フォントサイズシステム**: `AppFontSize` は `xs(12)/sm(14)/md(16)/lg(18)/xl(20)/xxl(26)` の6段階（medium設定時）。`store/theme.ts` の `fontSizePreference`（small=0.85×/medium=1.0×/large=1.2×）で全体スケールされる。StyleSheet の静的 fontSize は使わず、必ずインラインスタイルで `{ fontSize: theme.fontSize.md }` のように指定する。
- **テーマ hydration ガード**: `app/_layout.tsx` は `useThemeStore` の `hydrated` が `true` になるまで `<RootStack />` を描画しない。
- **`FILTER_COLORS`**: `lib/theme/index.ts` にエクスポートされた定数。`learned: '#4CAF50'`、`due: '#F57C00'`。フィルター色を複数画面で使う場合はここから import する（ハードコード禁止）。
- **コードブロック/エディタブロックのフォーカス系ヘッダー色**: 状態（フォーカス/選択・編集中・実行中）に応じてヘッダー背景色が変わる。色は `lib/theme` の派生定数で統一：`CODE_FOCUS_HEADER`（≈`#0F477E`・primary を 60%）／`CODE_EDITING_HEADER`（≈`#643800`・grade hard `#FB8C00` を **40%**）／`CODE_RUNNING_HEADER`（≈`#28602B`・grade good `#43A047` を 60%）。いずれも `darkenHex(base, 係数)` で「対応するボーダー色を暗くした濃色」＝ボーダーより暗いのでヘッダー上のボタンの形が浮く。暖色（オレンジ）は同係数だと知覚的に明るく浮くため**編集だけ係数を 0.4** に下げ、青/緑（0.6）と知覚輝度（≈0.06〜0.09）を揃える。`CodeRunnerView`・`CodeBlockItem`・`TextBlockItem`・`ImageBlockItem` が使用（テキスト/画像は実行状態なし＝フォーカス青と編集アンバーのみ）。ボーダー色と連動するため、状態管理を変更する際は両方を確認する。
- **選択バーのアクションボタン**: 削除・移動などのバーボタンは言語/フォントサイズ非依存にするためアイコンのみ（テキストなし）の円形ボタンにする。`iconBtn` スタイル: `{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }`。無効時は `opacity: 0.4`。

#### iPad マルチウィンドウとキーボード通知（Split View / Stage Manager）

- **隣のアプリがキーボードを出すと、自アプリにも UIKeyboard\* 通知が届く**（`isEventFromThisApp = false` / ネイティブは `UIKeyboardIsLocalUserInfoKey = NO`）。無視しないと「分割表示で隣のメモアプリをタップした瞬間、カードエディタがほぼ真っ白に潰れる・デッキ/タグフォームのスクロールがズレる」不具合になる（実例・修正済み）。
- **JS 側の `Keyboard.addListener` は必ず `lib/keyboardEvent.ts` の `isRemoteKeyboardEvent(e)` で先頭ガードする**（`BlockEditor`・`BlocksView`・`study/session`・`SqlInitModal` に適用済み。新しくキーボードリスナーを書くときも同様にする）。
- **`KeyboardAvoidingView` と `automaticallyAdjustKeyboardInsets`（Fabric/Paper の ScrollView）は RN 本体がリモートキーボードを区別しない**ため、`patches/react-native+0.81.5.patch` でガードを注入済み（KAV の `_onKeyboardChange`・`RCTScrollViewComponentView.mm`・`RCTScrollView.m` の3箇所）。**RN をアップグレードしたらこのパッチの当たり直しを必ず確認する**。ネイティブ側の変更なので反映には dev client の再ビルドが必要（JS 側はリロードのみ）。
- **RN ネイティブへのパッチはビルド設定とセット（重要）**: Expo SDK 54 の iOS ビルドは既定で「プリコンパイル済み RN コア」を使うため、**node_modules 内の RN ネイティブソースにパッチを当ててもビルドに含まれない**（JS のパッチは Metro 経由で効く）。本プロジェクトは `expo-build-properties` の `ios.buildReactNativeFromSource: true` で RN 本体をソースビルドに切替済み。ただし**フルソースビルドは fmt が新しい Xcode の Clang で consteval エラーになる**ため、`plugins/withPrebuiltRNDeps.js`（config plugin）が Podfile に `RCT_USE_RN_DEP=1` を注入し、サードパーティ依存（fmt/folly/glog/boost）だけプリビルド（`ReactNativeDependencies`）を使う構成にしている。prebuild で `ios/` を作り直してもこの2つ（build-properties＋plugin）で再現される。RN/Expo を上げるときはこの組み合わせが維持されているか `ios/Podfile.lock`（`React-Core (from ../node_modules/react-native/)` と `ReactNativeDependencies` の共存・`fmt` Pod が無いこと）で確認する。

#### i18n

- **言語フォールバック**: 端末言語を自動検出し、未対応言語の場合は**英語**にフォールバック（`lib/i18n/index.ts` の `fallbackLng: 'en'`）。`ja.json` を変更したら `en.json` も必ずセットで更新する。

#### ナビゲーション・状態管理

- **モーダルから戻った後のデータ更新**: モーダルを閉じた後に最新データが必要な画面では `useFocusEffect` で DB を再読み込みする（`deck/[id]/index.tsx`・`study/session.tsx` が実例）。
- **フィルターキーの統一**: 全画面でフィルターキーは `'all' | 'learned' | 'review' | 'new'` に統一。`DeckDetailFilter = Exclude<InitialFilterPreference, 'none'>` で型を派生させている（`store/settings.ts`）。
- **初期フィルター「保持」の挙動**: 学習・統計タブはタブがアンマウントされないため React state が残る。カード一覧（stack screen）は `lastDeckDetailFilter`（AsyncStorage 永続化）で最後のフィルターを復元する。
- **`BlockEditor` の初期タブ**: `initialTab?: 'front' | 'back' | 'memo'` prop で開くタブを制御できる。学習セッションの編集ボタンは `?tab=back` クエリパラメータを付与して裏面タブを初期表示する（`deck/[id]/card/[cardId]/edit.tsx` が受け取り）。
- **学習セッションのヘッダータイトル**: デッキ学習時はデッキ名、タグ学習時はタグ名を表示する。カスタムヘッダー内の Text に直接セットする（`sessionTitle` 変数）。
- **ホーム画面のフィルターブロック**: `app/(tabs)/index.tsx` は「すべて（all・全デッキ／青数字）」「有効（active・非アーカイブのみ／グレー数字）」の2ブロック。選択は `useSettingsStore.lastHomeFilter`（既定 `'active'`）に永続化（直近モード固定）。「すべて」ではアーカイブ済みデッキをグレー表示。手動ドラッグ並べ替えは非表示デッキを元位置に固定したまま表示中だけを並べ替える。
- **ホームのカスタムヘッダー高さ**: `computeHeaderHeights` は `getDefaultHeaderHeight` の `total` と `content = total - insets.top` を返し、`useMemo` で inset/frame に追従させる（`useRef` 固定だと初期 inset 未解決の値を掴み、タブヘッダーとタイトル/アイコン位置がズレる）。

#### Bluetooth キーボード（ネイティブ UIKeyCommand 方式 / 034）

ハードウェアキーボードのショートカット（J/K 等）は **ネイティブの `UIKeyCommand`**（OSS `react-native-key-command`）で受ける。各画面は共通フック **`lib/useKeyCommands.ts`** に `{ input, modifierFlags?, handler }[]` を渡すだけ。フックが「画面フォーカス中（`useFocusEffect`）**かつ** `keyboardShortcutsEnabled`」のときだけ登録/解除する（OFF＝一切介入しない）。**かつて各画面に置いていた「常時フォーカスの隠し `TextInput`＋`onKeyPress`」は全廃した**（その常時フォーカス入力欄が本アプリで繰り返したタッチ食われ・復帰フリーズの構造的原因だったため）。

- **住み分けは責任者チェーンで自動成立**：テキストブロックや検索欄など**実 `TextInput` がフォーカス中はその入力欄がキーを消費**し、key command は発火しない。フォーカスが無いとき（J/K モード等）だけ VC の key command が発火する。→ 再フォーカス用の脆いワークアラウンド（`onBlur` 200ms 再フォーカス・`isTransitioning` 抑制等）は**不要になり削除済み**。
- **`Return`** は `KeyCommand.constants.keyInputEnter`（iOS では `'\r'`）で受ける。登録値とイベント payload の両方に同じ定数を使えば `useKeyCommands` 内の同値マッチで動く（旧 `onSubmitEditing` の代替）。型は `types/react-native-key-command.d.ts`。
- **早期 return がある画面**（カード一覧 `deck/[id]`・学習セッション・エディタ）は、フック規約上 `useKeyCommands` を early return より前で呼ぶ。ハンドラが後方定義の値を参照するのはクロージャなので可（実行＝キー押下時には初期化済み・tsc も通る）。
- **状態依存ガードはハンドラ内で再現**：旧 `onKeyPress` の「CardStats 表示中は A のみ」「DeckPicker 表示中は全無効」「選択/通常モード分岐」などは、各キーのハンドラ冒頭で `if (...) return` として表現する（フックはキー集合を focus 単位でしか変えられないため）。
- **ネイティブ組込**：`plugins/withKeyCommands.js`（config plugin）が prebuild 時に Swift `AppDelegate` へ keyCommands override＋ブリッジヘッダ import を注入する（`ios/` は gitignore のため必須）。ネイティブ依存追加後はシミュレータ／実機それぞれで1回再ビルドが必要、以後の JS 変更はリロードのみ。
- **余白タップでフォーカス解除の配置ルール（重要）**：解除用 Pressable を **ScrollView/FlatList の祖先に置いてはならない**。RN（Fabric）の `_shouldDisableScrollInteraction` が「スクロールビューの祖先が JS レスポンダ」だと `touchesShouldCancelInContentView` を NO にし、**押せる要素のない場所（下部余白・行間の隙間・Proカード周辺など）から始めたドラッグでスクロールが一切始まらない**（統計タブの「最下部でフリーズ」・他画面の単発空振りの原因だった）。正しい配置は①スクロール内容の**内側**に Pressable（統計・設定の全内容ラップ／各リストの `ListFooterComponent`）、②スクロールを含まない**固定部**（フィルターブロック行・タイトル行など）を Pressable 化、の2本立て。全6画面（ホーム/学習/統計/設定/タグ管理/検索）で適用済み。
- **矢印キー・ESC・Tab 対応済み**：`Return`/`Esc`/矢印は `KeyCommand.constants.keyInput*`、Tab は `'\t'`、Shift は `KeyCommand.constants.keyModifierShift`。ESC は階層ディスマス（開いているモーダル/シート/選択モード/全画面を閉じる→無ければ push 画面は戻る・エディタはキャンセル）。`B` は戻るの冗長エイリアスとして存続。**Esc キーの無いキーボード（iPad Magic Keyboard 等）向けに、`useKeyCommands` が各画面の Esc spec を代替キーへ自動展開する**：バッククォート `` ` ``（Esc の物理位置の単独キー。ただし実 TextInput フォーカス中は文字入力に消費され発火しない＝住み分け）と `Cmd+.`（iOS 標準キャンセル。修飾付きのため編集中も発火＝入力欄から抜ける用途も代替可）。展開は `expandEscapeAliases()` が担当し、画面側の Esc 登録は従来どおり1つでよい。
- `CodeRunnerView` の `onKeyPress`（Tab 検知）は**実コード入力欄**なので存続＝正しい（隠し入力ではない）。リストの J/K ヌルサイクルは引き続き `hooks/useListNavigation.ts` が担当。

#### iPad の落とし穴（UIFocusSystem）— 矢印/Tab の扱い

iPadOS は**ハードキーボードの「修飾なし矢印」と Tab を OS のフォーカス移動（UIFocusSystem）に予約**する（iPhone にはこの仕組みが無い）。そのままだとアプリの key command に届かない。対策と、それに伴うプラットフォーム差を必ず理解すること：

- **`withKeyCommands.js` は矢印4つと Tab の `wantsPriorityOverSystemBehavior = true` を「iPad のときだけ」立てる**（`UIDevice.current.userInterfaceIdiom == .pad`）。iPad ではフォーカスエンジンより優先させる必要があるため**固定が必須**：編集状態に応じて優先を出し分けたり、登録を動的に解除すると **iPad の UIKit が不安定化しフリーズ→クラッシュする**（keyCommands はキャッシュされ、登録解除しても“ただの矢印”を奪い続ける）。**iPad は「最初から登録しない」だけが安定**。一方 **iPhone は優先を立てない**：立てると**テキスト編集中に矢印がカーソル移動より優先されてキーコマンド（タブ切替等）が発火する不具合**になる（iPhone はフォーカスエンジンが無いので優先不要・責任者チェーンで自然に住み分く）。
- **そのため矢印は画面ごとに登録要否が変わる**：
  - **学習セッション・カードエディタ（＝ブロック編集が起きる画面）では、矢印を iPhone のみ登録し iPad では登録しない**（`(Platform as any).isPad ? [] : [...arrow specs]`）。iPad で登録すると、上記キャッシュにより**編集中に矢印でカーソル移動できなくなる**（OFF なら動くのに ON で動かない＝この現象）。iPad のこの2画面のナビは **J/K（フォーカス送り）・`,`/`.`（カード/タブ切替）** で行う。Tab もこの2画面では登録しない（同理由で編集中の Tab インデントが死ぬため）。
  - **編集が無い画面（ホーム/一覧/タグ/統計/下タブ）は両プラットフォームで矢印を登録**（iPad でも優先付きでナビが効く）。下タブ4画面は Tab/Shift+Tab でタブ切替も。
- **iPhone は全画面で矢印登録**（フォーカスエンジンが無く、登録しても編集中は入力欄が矢印を消費＝カーソル移動が両立）。→ **iPhone と iPad で学習/編集画面の矢印挙動だけが異なる**のは OS 制約由来で意図的（許容）。
- **iPad の編集中は「ただの矢印＝カーソル移動／Shift+矢印＝範囲選択／タップ＝カーソル位置」**で操作する。
- **テキスト装飾ツールバー（解決済み）**：かつて iPad ではテキストブロック編集突入で `InputAccessoryView`（旧 `MarkdownToolbar`）単体がフリーズ→クラッシュしたため iPad では出していなかった。現在は **`InputAccessoryView` を廃止し、コードブロックの `SymbolPalette` と同じ「フォーカス中ブロック直下にインライン描画する `View`」方式（`components/editor/MarkdownPalette.tsx`）に置換**したため、iPhone/iPad 両対応＝プラットフォーム gate なし（`TextBlockItem` が `visible={focused && !isPreview}` で描画）。クラッシュ原因（accessory）を設計から排除済み。適用ロジックは各テキストブロックがローカルに持つ `stableApply` を直接呼ぶ（旧 BlockEditor 側の共有登録機構 `onActivate/DeactivateToolbar` は撤去）。なお**ドラッグ選択中に iOS のネイティブ編集メニュー（Cut/Copy/AutoFill）がパレットに一瞬重なる**ことがある（選択近傍にメニューが出る OS 挙動・スクロールで解消）が、コードブロックのパレットと同じ宿命で**許容**（メニュー位置は OS が選択基準で動的決定するため回避ロジックは脆く入れない）。
- 失敗した手法（再試行しないこと）：①優先の動的出し分け（getter 内で編集判定）→フリーズ。②編集中に矢印だけ動的に登録解除→フリーズ。③`pressesBegan` で矢印を受ける自前実装→ナビ破綻・別フリーズ。いずれも iPad で不安定。

**キー設計の方針**: J/Kでフォーカス移動後の「決定」操作は `Return`（`keyInputEnter`）に統一。ただし学習開始（大きなアクション）は `Space`、学習セッション内の表裏反転も `Space` のまま。選択モードの選択/解除も `Space` のまま。**横方向の切替は `,`（前）/ `.`（次）＝ `←`/`→` ＝ `H`/`L` の3系統を同義**にして「今の画面の横方向を切替」に統一する（学習＝カード送り、編集＝表裏メモ、検索＝フィールド、**フィルターを持つタブ画面（ホーム/学習/統計）＝フィルター/上部ブロック切替**）。**下タブ4画面の切替は `Tab`/`Shift+Tab` に一本化**（`,`/`.` はタブ切替に使わない）。フィルターを持たない設定タブでは `,`/`.`・`←`/`→`・`H`/`L` は割り当てない（タブ切替は `Tab` のみ）。矢印は上下＝K/J（フォーカス移動）・左右＝フィルター切替（登録する画面のみ）。**`?`（Shift+/）＝ショートカット一覧を開く（ShortcutsModal を持つ全画面共通）**。各画面のメインキー配列に「開く」を追加し、**閉じる/トグルは `ShortcutsModal` 本体の `useKeyCommands`（visible 時のみ `?`=onClose）に集約**。これにより一覧表示中は各画面のメインキーが gate で無効でも `?` で閉じられる。カードエディタは `BlockEditor` の `onShowShortcuts` prop 経由。

- **ホームキー（デッキ一覧）**: J/K（↑/↓）= フォーカス移動、Return = フォーカスデッキを開く、P = デッキ編集、Delete = デッキ削除、N = 新規デッキ、M = ソート切替、⌘L = 並べ替えロック切替（手動ソート時のみ）、U/D = フォーカスデッキを手動並べ替え（上へ/下へ・手動ソート＋未ロック時のみ）、`,`/`.`・`←`/`→`・H/L = フィルター切替（すべて/有効）、1/2 = フィルター直接選択、F = 検索、T = タグ管理、Tab/Shift+Tab = タブ切替
- **学習タブキー**: 1–4 = フィルター直接選択、`,`/`.`・`←`/`→`・H/L = フィルター切替（すべて/学習済み/復習/新規）、J/K（↑/↓）= フォーカス移動、Return = フォーカス項目で学習開始、S = シャッフル切替、E = 対象カードなし行の表示/非表示トグル（旧 H）、D = デッキ表示 / T = タグ表示（旧 M トグル）、Tab/Shift+Tab = タブ切替
- **統計タブキー**: 1–4 = 上部ブロック直接選択、`,`/`.`・`←`/`→`・H/L = 上部4ブロック切替（連続/学習済み/復習/新規）、J/K（↑/↓）= フォーカス移動、Return = フォーカスデッキのグラフ開閉（シート表示中は Return で閉じる）、6–9/0 = 評価別ランキング選択/解除（Pro・横移動の循環には含めない）、Tab/Shift+Tab = タブ切替
- **設定タブキー**: J/K（↑/↓）= フォーカス移動（Proカード＋各カテゴリ・青枠・自動スクロール）、Return = フォーカス項目を開く、Esc = フォーカス解除、Tab/Shift+Tab = タブ切替（フィルターが無いため `,`/`.`・`←`/`→` は不使用）。値の変更はタップ限定（誤操作防止）でキーはナビのみ
- **設定サブ画面キー**（display/study/notifications/sync/data/sync-merge/about/paywall）: Esc / B = 戻る（モーダルを開いていれば先に閉じる）。共通シェル `components/settings/SettingsDetail.tsx` に Esc/B＝戻るを集約し、モーダルを持つ画面は `onBack` prop で「先に閉じる」を渡す。SettingsDetail 非使用の about/paywall は各画面で `useKeyCommands` を直接持つ
- **アーカイブ一覧キー（042・通常モード）**: J/K（↑/↓）= フォーカス移動、Return = 開く（デッキ→カード一覧／カード→編集）、E = アーカイブ解除、Delete = 削除（確認あり）、S = 選択モード開始、1/2・`,`/`.`・H/L・←/→ = タブ切替（デッキ/カード）、B / Esc = 戻る
- **アーカイブ一覧キー（042・選択モード）**: J/K = フォーカス移動、Space = 選択/解除、A（⌘A）= 全選択、E = 一括解除、Delete = 一括削除（確認あり）、S = 選択モード終了
- **学習画面キー**: `,`/`.`・H/L（iPhoneは←/→も） = 前/次カード（iPad は矢印未登録のため H/L が左右ナビを担う）、Space = 表裏反転、1–4 = グレード、J/K = コードブロック次/前フォーカス、E / Return = フォーカス中のコードブロックを編集、U/D・PgUp/PgDn = 画面スクロール、Home/End・Shift+U/D = 最上部/最下部（Home/End 無しキーボード向け）、M = メモ開閉、F = 全画面、P = カード編集、W = リンク一覧（旧 L。H/L をカード送りに使うため移動）、Q = セッション終了（残カードをスキップして集計画面へ、確認ダイアログあり）
- **カード一覧キー（通常モード）**: Space = 学習開始、Return / P = フォーカスカード編集、1–4 = フィルター直接選択、`,`/`.`・`←`/`→`・H/L = フィルター切替（すべて/学習済み/復習/新規）、J/K（↑/↓）= カードフォーカス次/前、M = ソート切替（「すべて」のみ）、⌘L = 並べ替えロック切替（手動ソート時のみ）、U/D = フォーカスカードを手動並べ替え（上へ/下へ・手動ソート＋「すべて」＋未ロック時のみ）、N = 新規カード、S = 選択モード開始、Delete = フォーカス中のカードを削除、B = 戻る
- **カード一覧キー（選択モード）**: J/K = フォーカス移動、Space = 選択/解除、A = 全選択、M = 移動、Delete = 削除、C = 複製、E = アーカイブ切替、S = 選択モード終了
- **タグ管理キー（通常モード）**: J/K = フォーカス移動、Return = フォーカスタグのカード一覧を開く、P = タグ編集、Delete = タグ削除、N = 新規タグ、S = 選択モード開始、M = ソート切替、⌘L = 並べ替えロック切替（手動ソート時のみ）、U/D = フォーカスタグを手動並べ替え（上へ/下へ・手動ソート＋未ロック時のみ）、B = 戻る
- **タグ管理キー（選択モード）**: J/K = フォーカス移動、Space = 選択/解除、A = 全選択/全解除、C = 色変更モーダルを開く（選択タグ）、Delete = 削除（選択タグ）、S = 選択モード解除。**カラー変更モーダル表示中**は C = 色を順送り・Shift+C = 逆順・Return = 適用・Esc = 閉じる（タグ新規/編集の C/Shift+C と統一。表示中は他キーを抑止）
- **タグカード一覧キー（通常モード）**: J/K（↑/↓）= フォーカス移動、1/2・`,`/`.`・`←`/`→`・H/L = フィルター切替（すべて/有効）、Return / P = フォーカスカード編集、Delete = カード削除、N = 新規カード（デッキ選択）、S = 選択モード開始、B = 戻る
- **タグカード一覧キー（選択モード）**: J/K = フォーカス移動、Space = 選択/解除、A = 全選択、T = タグを外す、E = アーカイブ切替、S = 選択モード終了
- **カード編集・新規作成キー（編集モード）**: J/K = フォーカス移動（ヌルサイクル）、Return / E = フォーカスブロックを編集開始（TextInput にカーソル移動）、Delete = フォーカスブロックを削除（フォーカスなし時は編集画面のみカード削除）、M = モード切替（編集→並べ替え→プレビュー→編集）、`,`/`.`・H/L = タブ切替（表面/裏面/メモ）、1/2/3 = タブ直接選択（表/裏/メモ）、U/D・PgUp/PgDn = 画面スクロール、Home/End・Shift+U/D = 最上部/最下部（Home/End 無しキーボード向け）、A = ブロック追加メニュー開閉、R = フォーカスコードブロック実行（executable のみ）、T = タグ選択エリアへスクロール、C = カード複製（**カード編集時のみ**＝現在内容を保存してコピーを作成し A' の編集画面へ遷移。新規作成画面では無効。全モード共通で発火）、E（フォーカスなし時）/ ⇧E = アーカイブ切替（**カード編集時のみ**＝末尾のアーカイブトグルを反転）。E は Delete と同じ「フォーカスあり＝ブロック単位／なし＝カード単位」の流儀で、フォーカス中は「フォーカスブロック編集」・フォーカスなしでアーカイブ。⇧E はフォーカスの有無に関わらず常時アーカイブ（フォーカス中でも編集に邪魔されずアーカイブしたいとき用）。いずれもトグルが見える編集/並び替えモードのみ有効・プレビューと新規作成では無効。S = 保存/作成、X = キャンセル（未保存確認あり）。**モード切替は `M`（コード/ShortcutsModal とも一致。旧ドキュメントの `Q` は誤り）**
- **カード編集・新規作成キー（並び替えモード）**: J/K = フォーカス移動、U = フォーカスブロックを上に移動、D = フォーカスブロックを下に移動（※並べ替えモードのみ U/D は移動。編集/プレビューでは U/D はスクロール）、PgUp/PgDn・Home/End = 画面スクロール、M = モード切替（並べ替え→プレビュー→編集→並べ替え）
- **デッキ新規作成キー**: N = デッキ名にカーソル、M = 説明欄にカーソル（Memo/Message。N と隣接）、C = カラー順送り（青→プリセット→テーマ色→白黒の循環。Shift+C で逆順）、I = アイコン選択を開く、Q = SQL共通初期化を開く（Pro時）、H = HTML/CSS共通土台を開く（Pro時）、U/D・PgUp/PgDn = 画面スクロール（上/下・段階）、Home/End = 最上部/最下部、S = 保存、X = 閉じる、Esc = 編集中→カーソル解除／非編集→閉じる。デッキ名 Return で説明欄へ移動。Tab/矢印は不使用（iPad フォーカスエンジン対策＝文字キー＋住み分けで完結）
- **デッキ編集キー**: 新規作成と同じ（N/M/C/I/Q/H/U/D/PgUp/PgDn/Home/End/S/X/Esc）＋ **E = アーカイブ切替**・**Delete = デッキ削除**（確認あり）。アーカイブは全画面で `E`、説明欄は `M`（スクロールの `U/D` と衝突回避のため `D`→`M`）。削除は全画面共通の Delete キー
- **タグ新規作成キー**: N = タグ名にカーソル、C = カラー順送り（青→プリセット→テーマ色→白黒の循環。Shift+C で逆順）、U/D・PgUp/PgDn = スクロール、Home/End = 端へ、S = 保存、X = 閉じる、Esc = 編集解除/閉じる
- **タグ編集キー**: 新規作成と同じ（N/C/U/D/PgUp/PgDn/Home/End/S/X/Esc）＋ **Delete = タグ削除**（確認あり・全画面共通の Delete キー）。タグには説明/アイコン/SQL/アーカイブが無い
- **検索画面キー**（`app/search.tsx`・カーソル無し時）: D = デッキ選択、T = タグ選択、`,`/`.`（iPhoneは←/→）= フィールド切替（すべて/表面/裏面/メモ）、J/K（iPhoneは↑/↓）= 結果フォーカス移動、A = カード統計トグル（Pro・表示中の A/Esc で閉じる）、P/Return = フォーカスカード編集、Delete = 検索文字クリア＆入力欄へカーソル、B = 戻る（ホーム。`overlayOpen()`/編集中は無効。入力欄フォーカス中は TextInput が消費するため自然と「カーソル無し時のみ」発火）、Esc = 情報→閉じる/統計→閉じる/ピッカー表示中は委譲/編集中→カーソル解除/それ以外→戻る。検索欄は Return でもカーソル解除（onSubmitEditing で blur）
- **検索デッキ/タグピッカーキー**（`search.tsx` 内 `DeckMultiSelectPickerModal`/`MultiSelectPickerModal`）: J/K（iPhoneは↑/↓）= フォーカス移動（「すべて」行含む・自動スクロール）、Space = 選択/解除（「すべて」行は全解除）、Return/Esc = 閉じる。`visible` ガードで表示中のみ発火、親検索画面のキーは `overlayOpen()` で無効化
- **学習リンク一覧シートキー**（`components/study/LinksSheet.tsx`）: J/K（iPhoneは↑/↓）= フォーカス移動（自動スクロール・背景ハイライト）、Return/Space = フォーカス中のリンクを開く、Esc = 閉じる（学習画面側の常時 Esc が担当）。表示中は親（学習画面 main の useKeyCommands）を `active=!showLinksModal` で解除
- **デッキ選択モーダルキー**（`DeckPickerModal`・単一選択＋インライン新規作成。カード移動/タグカード新規で使用）: J/K（iPhoneは↑/↓）= フォーカス移動（「+新規作成」行含む・自動スクロール・背景ハイライト）、Space/Return = 実行（デッキ選択 or 新規作成開始）、Esc = 作成中はキャンセル/それ以外は閉じる。単一選択のためタップ追従は無し（タップ＝確定＝閉じる）。親（カード一覧・タグカード一覧）は `useKeyCommands` の `active` ゲートで表示中に解除
- **統計デッキ/期間ピッカーキー**（`stats.tsx` 内 `DeckPickerSheet`〈複数選択〉/`PeriodPickerSheet`〈単一選択〉）: J/K（iPhoneは↑/↓）= フォーカス移動、Space = 複数選択トグル（期間は確定）、Return = 完了/確定、Esc = 閉じる。親 stats は `active=!deckPickerVisible && !periodPickerVisible` で解除
- **アイコン選択モーダルキー**（`IconPickerModal`）: `,`/`.`（H/L・iPhoneのみ←→）= 左右、J/K（iPhoneのみ↑↓）= 下/上の行（実セル座標で真上・真下の最近接を選ぶ）、Return = 選択して閉じる、Esc = 閉じる。フォーカスは青枠＋自動スクロール。矢印は iPad 非登録（フォーカスエンジン予約＝動的登録でフリーズの恐れ）
- **SQL共通初期化モーダルキー**（`SqlInitModal`）: Esc = 閉じる（確定＝ライブ値保持）。全面テキストエディタのため他の文字キーは入力に消費される
- **モーダル内キーと親画面の住み分け**: `IconPickerModal`/`SqlInitModal`/`ConfirmModal` 等は RN `<Modal>`（別 VC）。キーコマンドは `AppDelegate` に付くためモーダル表示中も発火しうる。各モーダル内 `useKeyCommands` は `visible` でガードし、**親フォーム（deck/new・deck/[id]/edit）は表示中のサブモーダルがあれば全ショートカットを早期 return で無効化**する（`subModalOpen()`）
- **アラート（確認/削除/破棄）表示中の背景キー抑止**: 確認系モーダル（`ConfirmModal`/`ConfirmDeleteModal` やショートカット一覧）はキーを持たないため、**親画面側でナビ系 `useKeyCommands` を `active` ゲートで解除**し、**Esc は別フックで常時有効**にして閉じる（タグ管理・タグカード一覧・カード一覧・学習画面・ホーム・統計・検索・設定サブ画面で適用＝034 の対象全画面）。検索は `active` ゲートではなく各キー内の `overlayOpen()` 早期 return で背景抑止する方式。**削除/破棄の確認は確定操作なので `Return` は割り当てない（タップ/Esc のみ）**。`OK` のみのアラート（学習の終了確認・情報モーダル・ショートカット一覧・設定サブ画面の InfoModal など）は表示中だけ有効な専用フックで `Return`=OK（設定サブ画面では複数アクションの `ConfirmModal` を除き `kind === 'info'` のときのみ Return）。情報モーダルは閉じる瞬間にフェード中の中身が空にならないよう直前内容を ref で保持して渡す（カード一覧 `lastInfoModalRef`・統計 `lastSectionInfoRef` が実例。静的内容や条件マウントのモーダルは不要）。カードエディタは `BlockEditor` に `suspendKeys` prop を渡し、親モーダル（カード削除/破棄/ショートカット）表示中とブロック削除確認中はエディタのキー（main＋ESC）を解除する
- **カード編集キーのフォーカス管理**: ネイティブ UIKeyCommand 方式（隠し TextInput なし）。非入力モード（どのブロック入力欄もフォーカスしていない状態）では key command が発火し、ブロックの実 TextInput がフォーカスを得るとそのブロックがキーを消費してショートカットは自然と無効化される（住み分け）。タブ/モード切替・追加メニュー開時は編集中ブロックを解除して `Keyboard.dismiss()` するだけでよい（再フォーカス不要）。Return（`keyInputEnter`）は追加メニュー表示中なら項目決定、それ以外はフォーカス中ブロックの編集開始。
- **J/Kキーのコードブロックサイクル（学習画面）**: J = 次へ / K = 前へ。表面表示中は表面のコードブロックのみサイクル。裏面表示中は裏面＋メモのコードブロックを**通しで**サイクルする（裏面ブロック0→1→…→メモブロック0→1→…→裏面ブロック0）。サイクルの両端で `null`（フォーカスなし）を経由する**ヌルサイクル**方式。メモブロックに到達するとメモを自動展開する。combined index は `selectedCodeBlockSide`（`'back'` か `'memo'`）と `selectedCodeBlockIdx` の組み合わせで管理する。
- **J/Kキーのカードフォーカス（カード一覧）**: `hooks/useListNavigation.ts` のヌルサイクル方式。`focusedIndex` が `null` → 0 → 1 → … → last → `null` と循環（K は逆順）。`keyExtractor` を渡すと ID ベース追跡になり、並び替え後も正しいカードにフォーカスを維持する。フォーカス中のカードは `borderColor` で強調（通常モード: `theme.colors.primary`〈青〉、選択モードカーソル: `#F57C00`〈オレンジ〉、選択モード選択済み: `theme.colors.primary`〈青〉）。

#### BlockEditor

- **スクロール位置取得**: `NestableDraggableFlatList` のアイテムは絶対位置で管理されるため、上のブロックの高さが変わっても下ブロックの `onLayout` が発火しない。コードブロック実行後・テキスト/コード/画像ブロックの入力フォーカス時はキャッシュ位置でなく `measureLayout` を使ってリアルタイム位置を取得する。各ブロックの wrapper View の ref は `blockViewRefs`（`Map<string, View>`）で管理する。
- **`DraggableFlatList` の ref 型**: `react-native-gesture-handler` の `FlatList` 型と React Native の `FlatList` 型が異なるため型エラーが発生する。`ref={listRef as any}` でキャストして回避する（`scrollToIndex` などの呼び出しは実行時に正常動作する）。

#### 学習・設定機能

- **スケジューリングアルゴリズム**: `lib/fsrs.ts` が `ts-fsrs` ライブラリを使って FSRS アルゴリズムで次回復習日を計算する。`lib/sm2.ts` は `Grade` 型の定義のみ残存。`reviews` テーブルには FSRS 用カラム（`fsrsState`・`fsrsReps`・`fsrsLapses`・`fsrsScheduledDays`）がマイグレーション済み。
- **学習セッション終了**: `useStudySession.finishSession()` を呼ぶと残カードを何もせず即座に完了画面へ遷移する。学習画面ヘッダー右端の `checkmark-done-outline` ボタン、または `Q` キーから確認ダイアログ経由で呼び出す。
- **デッキソート**: `store/settings.ts` の `deckSortOrder`（`'manual' | 'name' | 'cardCount'`）で制御。`'manual'` 時のみ長押しドラッグが有効。他のソートは Zustand の `decks` 配列を `.sort()` するだけで DB 順序を変えない。
- **シャッフル学習**: `store/settings.ts` の `shuffleEnabled`（AsyncStorage永続化）で管理。学習タブ「学習一覧」行の右端にトグルボタン（ソートボタンと同形状）。ON 時は `useStudySession.loadSession` に `shuffle: true` を渡し、カード配列を Fisher-Yates でシャッフルする。セッション遷移時は `params: { shuffle: '1' | '0' }` で受け渡し。
- **通知リマインダー**: `lib/notifications.ts` の `scheduleDailyReminder(hour, minute)` が identifier `'daily-reminder'` 固定で毎日繰り返し通知をスケジュール（再呼び出し前に既存通知をキャンセル）。設定画面でオン/オフと時刻を管理。`useSettingsStore` に `notificationEnabled`・`notificationHour`・`notificationMinute` を AsyncStorage 永続化で保存。
- **アイコンバッジ**: `lib/notifications.ts` の `updateBadgeCount(db)` が `getTodayDueCount()` で全デッキ横断の due 枚数を取得し `setBadgeCountAsync()` でバッジに反映。`app/_layout.tsx` のフォアグラウンド復帰時と学習セッション完了時に呼ばれる。
- **iCloud 同期**: DB ファイル全体を iCloud Drive 経由で同期する。`sync_state` テーブルのトリガーがローカル変更で `localVersion`/`localChangedAt` を進め、LWW（Last-Write-Wins）でリモートと比較する。`store/sync.ts` の `dataRevision` が更新されると各画面が DB を再読込する。`archived` も DB 列なので追加対応なく同期される。端末時計のズレ対策は `docs/icloud-sync-overview.md` 参照。
- **デッキの色付きアイコン**: `decks.iconName`（Ionicons 名）・`colorHex`。表示は `components/DeckIcon.tsx` か `colorHex ?? theme.colors.primary`（背景は `colorHex + '20'`）。プリセット色は `DECK_PRESET_COLORS`（= `TAG_PRESET_COLORS`、`lib/theme`）。

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

**技術スタック:** React Native 0.81 / React 19 / Expo 54 / expo-router 6 / expo-sqlite / Zustand 5 / i18next / ts-fsrs。アニメーションに react-native-reanimated、ジェスチャー操作に react-native-gesture-handler が利用可能。

### 実装チケット

`docs/` 配下に機能チケット（000〜032）がある。各チケットにはフェーズ・依存関係・Todoチェックリストが記載されており、実装完了時に `- [ ]` → `- [x]` に更新する。`docs/000-ticket-overview.md` に全体の依存関係図がある（028 以降は overview 未反映のチケットもある）。

完了済み: 001〜013（プロジェクト基盤・デッキ/カード/タグCRUD・エディタ・SM-2/FSRS・学習画面・全画面+Bluetoothキーボード・JS/TS/Python コード実行・画像ブロック・統計画面・ダークモード）。その後エディタリファクタリング（`BlockItemHeader` 抽出）・ホーム画面フィルターブロック・コードブロックヘッダー色変更・バッジ表示・「新規」フィルター意味変更・エクスポート review_logs 追加・コードリファクタリング・フィルターキー統一・初期フィルター「保持」の全画面対応・統計画面ヒートマップ追加・ヌルサイクル（学習画面コードブロック + カード一覧カードフォーカス）・カード編集初期タブ指定・BlockEditor スクロール改善・カード一覧選択モード（複数選択・移動・削除・アイコンボタン）・学習セッションヘッダーにデッキ/タグ名表示・i18n フォールバック英語化・021（JSONエクスポート/インポート）・022（カード全文検索）・023（通知リマインダー）を実施。その後、学習完了サマリー改善（グレード分布・正答率・次回予定表示・枠なし横幅フル表示）・ホームデッキソート（手動/名前/枚数）・アプリアイコンバッジ（due 枚数）・カード複製（選択モードから一括複製）・シャッフル学習（学習タブのトグルボタン、Fisher-Yates）・統計画面改善（全体学習率セクション・デッキ別習熟度に新規枚数追加・草グラフ右端余白）・学習タブをカードスタイルに変更・学習タブの行アイコンを `play` に変更・TSV エクスポート/インポート・FSRS アルゴリズム移行・カスタムヘッダー統一（push 遷移全画面）・学習セッション終了ボタン（ヘッダー右端 + Q キー）を追加実装。さらに、タグ管理選択モード（一括削除・一括色変更・キーボードショートカット対応）・カード一覧/タグ管理の選択モード UX 統一（モード別ショートカット表示・ヘッダータイトル切替・フォーカス挙動修正）・ホーム画面カスタムヘッダー高さを `getDefaultHeaderHeight` で算出・Development Build 環境整備（`expo-dev-client` 導入）を実施。

さらに以降で次を実装: 014（iCloud同期、`sync_state` + LWW + `store/sync`）・018（SQL 実行＝`buildSqlSandboxHtml`／C++ 実行＝Wandbox API。ともに Pro 限定）・024（詳細な学習統計：月別グラフ・評価別ランキング・苦手カード・正答率・回答時間、Pro 機能）・025（FSRS カスタマイズ：`fsrsDesiredRetention`）・028-1（デッキの色付きアイコン）・028-2（カード表示テーマ `cardThemePreference`）・028-3（フォントサイズ設定 `fontSizePreference`）・030（検索のデッキ/タグ絞り込み）・言語設定（`languagePreference`）・**032（デッキ/カードのアーカイブ）**・一覧の左スワイプにアーカイブ追加・ホームヘッダー高さ算出の `useMemo` 化（タブヘッダーと位置一致）・デッキ編集カラー選択の並び調整・**034（キーボードショートカットのネイティブ化＝`UIKeyCommand`/`react-native-key-command`）の Phase 0〜3：全画面で隠し TextInput を撤去し `lib/useKeyCommands.ts` へ移行、`HiddenKeyboardInput`/`useKeyboardFocus` を削除。これによりショートカット ON 時のタップ食われ・復帰フリーズが構造的に解消**・**042（アーカイブ一覧画面＝設定タブから push・デッキ/カードの2タブ・一括解除/一括削除。あわせて `deleteDeck`/`deleteCard` の `grade_logs`・画像の削除漏れを修正）**。

未着手（または部分実装）: 015（Web版）・016（買い切り課金、`useProStore` で Pro ゲートのみ存在）・017（App Store申請）・019（マーケットプレイス）・020（AI生成）・026（デッキ共有リンク）・027（ウィジェット）・029（デッキ統合/復元）・031（高度な通知、`notification_schedules` テーブルは存在）

### UI パターン（実装済み画面の慣習）

- **統計ブロック**: 数字（`theme.fontSize.xxl`・色付き）→ラベル（`theme.fontSize.xs`・`textSecondary`）の縦並び。`theme.colors.surface` 背景・角丸・影付き。`deck/[id]/index.tsx` の `statItem` スタイルが基準。
- **バッジ色**: 「復習」（due）= 青（`#1976D2`）、それ以外のフィルター = グレー（ライト: `#8B949E`、ダーク: `#4B5563`）。`theme.dark` で分岐する。
- **セクションタイトル**: `theme.fontSize.lg, fontWeight: '700', color: theme.colors.textSecondary`。ホーム画面・カード一覧画面で使用。
- **コードブロック（学習画面）**: `components/study/SyntaxHighlightedCode.tsx` は `theme.fontSize.md` を使用。フォントサイズ設定に連動する。`wrap?: boolean`（既定 true）で折り返し制御。横スクロールさせる箇所（学習画面・編集プレビュー）は `wrap={false}` ＋ 横 `ScrollView` で表示する。
- **コード横スクロール**: コード表示・実行結果（`components/code/ExecutionOutput.tsx`）はいずれも横スクロール対応。SQL 結果テーブルは「列ごと縦積み」で列幅を揃え、ログ/エラーも折り返さず横 ScrollView に入れる。スクロールバーは `indicatorStyle="white"`。編集画面のドラッグ可能リスト内では `react-native-gesture-handler` の `ScrollView` を使う（標準 ScrollView だと横スクロールがジェスチャーに奪われる）。
- **アーカイブの見た目**: アーカイブ済み（デッキ・カード）は一覧で `opacity: 0.55` ＋ `archive` アイコンでグレー表示。カードは「カード自身 or 所属デッキがアーカイブ」を実効アーカイブとして判定する。
- **locales の改行**: ラベルに改行が必要な場合は `"カード\n総数"` のように `\n` を埋め込む（`Text` コンポーネントがそのまま改行として解釈する）。
- **ドーナツグラフ**: 定数・パス計算は `lib/donut.ts` からインポート。ドーナツの「穴」部分の fill は描画先の背景色（`theme.colors.surface` など）に合わせる。
