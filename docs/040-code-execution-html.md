# 040 コード実行（HTML/CSS プレビュー・Web 系）

**フェーズ:** 将来
**ステータス:** 実装完了（Phase 1〜6＋実行前プレビュー）。実機確認のみ残
**依存:** 009（コード実行基盤）・018（初期化の加算型ハイブリッド設計を流用）
**被依存:** なし

---

## 概要

コードブロックの実行で **HTML/CSS を描画し、JS で操作**できるようにする。暗記カード
として「土台の HTML に対して JS を一文書いて実行し、プレビューで答え合わせ」する使い方や、
「HTML/CSS だけを書いて表示を確認する」使い方を想定する。

出力パネル（console）とは別に、ブロック下に **可視のプレビュー窓**を描画し、
**`[プレビュー | ソース]` 切り替え**で描画結果と土台ソースを見比べられる。

SQL 共通初期化（018）の「加算型ハイブリッド」土台を HTML/CSS に当てはめたもの。

---

## 確定仕様（設計合意）

### 実行できる言語と役割

| 言語 | 実行 | 本文に書くもの | HTML/CSS 土台 | プレビュー内容 |
|---|---|---|---|---|
| **html** | ○（今回追加） | HTML/CSS（＋任意で `<script>`） | デッキ土台（共通・任意） | 本文をそのまま描画 |
| **javascript / typescript** | ○（土台がある時） | JS | デッキ土台 ＋ ブロック土台 | 土台を描画 → 実行で JS が変化 |
| **css** | ○（2026-07-29 追加） | CSS（セレクタとプロパティ） | デッキ土台 ＋ ブロック土台 | 土台を描画 → 実行で装飾が当たる |

- **html ブロック**：HTML/CSS だけでも実行してプレビュー可（JS 不要）。`<script>` を入れれば JS も動く。
- **js/ts ブロック**：本文は JS。デッキ＋ブロックの HTML/CSS 土台を操作する（暗記カードの「一文書いて答え合わせ」用）。土台が無い js/ts は**従来どおりコンソール実行のみ**。
- **css ブロック**：本文は CSS。土台の DOM を装飾する。**土台が無くても実行可能**（装飾対象が無ければ空白＝html と同じ扱い）。
- すべて **Pro 限定・一度描画のみ（v1）**。

### プレビュー／ソース切り替え

- ブロック下に可視プレビュー窓。上部に **`[プレビュー | ソース]` トグル**。
- **プレビュー**＝描画結果（js/ts は実行前＝土台の初期状態／実行後＝JS 適用後。html は実行で本文を描画）。
- **ソース**＝実行前は**土台の HTML/CSS をテキスト表示**（案a・JS が操作する対象を確認する用途）、実行後は**実行後の DOM**（案b・2026-07-29 追加。下記「ソースに実行後の DOM を出す」）。html ブロックでも表示されるのは**土台だけ**（本文はすぐ上のコードブロックで見えるため）。土台も結果も無いときは**ソースタブ自体を出さない**。
- 実行前・実行後とも切り替え可。**console.log は従来の出力パネルに別枠**で表示（プレビューとは別）。

### 一度描画のみ（v1）

- ボタンの `onclick` 等の継続的インタラクションは対象外。可視 WebView は `pointerEvents="none"` の**表示専用**にできるので、学習画面の ScrollView とタッチが競合しない。

---

## モデル：HTML/CSS 土台の加算型ハイブリッド（SQL 初期化と同型）

土台を 2 階層で持つ（018 の `sqlInit` と同じ構造）。

1. **デッキ共通の土台**（`Deck.htmlInit`）— そのデッキの全カードで共有する HTML/CSS。
2. **ブロック固有の土台**（`CodeBlock.htmlInit`）— その js/ts ブロックだけで使う追加分。

### 実行時の合成（言語別）

**html ブロック**（本文が主役）:
```html
<body>
  [Deck.htmlInit]      ← 共通土台（あれば・空ならスキップ）
  [ブロック本文]        ← HTML/CSS（＋任意 <script>）
</body>
```

**js/ts ブロック**（本文＝JS が土台を操作）:
```html
<body>
  [Deck.htmlInit]         ← 共通土台（あれば）
  [CodeBlock.htmlInit]    ← ブロック土台（あれば）
  <script>[ブロック本文=JS]</script>   ← 上の DOM を操作
</body>
```

- **リセット型**：実行のたびにまっさらな WebView を作り直す（反復学習の冪等性）。
- **加算であって上書きではない**：ブロック土台があってもデッキ土台は無視されず積まれる。
- **両方とも任意（空可）**：デッキのみ／ブロックのみ／両方／両方空（js/ts は土台空ならコンソールのみ）。

---

## Todo

### Phase 1: データ基盤
- [x] `types/index.ts`：`Deck.htmlInit: string | null`、`CodeBlock.htmlInit?: string` を追加
- [x] `lib/database/schema.ts`：`decks` に `htmlInit TEXT`（nullable）を `ALTER TABLE` で追加（`sqlInit` と同型）。ブロック土台は `card_contents` の JSON に含まれる＝マイグレーション不要
- [x] `lib/database/decks.ts`：`createDeck`/`updateDeck` に `htmlInit` を通す（`toDeck` は `SELECT *` のため自動）
- [x] `store/decks.ts`：`htmlInit` を保持（型追従のみ・コード変更不要）
- [x] `lib/code-execution/constants.ts`：`html` を `EXECUTABLE_LANGUAGES` と `PRO_LANGUAGES` に追加（`LANGUAGES`/`LANG_LABELS` は既存の html を流用）
- [x] `lib/import.ts`：`decks` の明示列 INSERT に `htmlInit` を追加（`export.ts` は `SELECT *` で自動・TSV は対象外）＝DB マイグレーションチェックリスト対応

### Phase 2: 実行系（サンドボックス）
- [x] `lib/code-execution/sandbox.ts`：`buildWebSandboxHtml(mode, body, htmlInits)` を新設
  - [x] `<head>` に**ネットワーク遮断**（fetch/XHR/WebSocket/window.open）＋ **console キャプチャ** ＋ **完了判定機構**（保留タイマー追跡・マクロタスク境界での finish・現行 JS サンドボックス踏襲）＋ **`window.onerror`**（インライン script の未捕捉例外を error として拾う）を設置
  - [x] html は `<body>{deck土台}{本文}</body>`、js/ts は `<body>{deck土台}{ブロック土台}<script>{本文}</script></body>` を合成（ts は `useCodeExecution` 側で sucrase 済み・本文中の `</script>` は無害化）
  - [x] 完了判定は `DOMContentLoaded` 後に `_settled=true` → `scheduleFinishCheck`（後出しログ対応・全体 5 秒上限）
  - [x] `buildSandboxHtml` に web 系分岐を追加（html は常に／js・ts は土台がある時のみ）
- [x] `hooks/useCodeExecution.ts`：
  - [x] `run(content, language, sqlInits?, htmlInits?)` に `htmlInits`（`[deck, block]`）を追加
  - [x] **可視モード**（`previewMode`）：web 系は結果受信後も `htmlSource` を残して可視 WebView を保持（`clear`/`reset`/再実行で破棄）。console は出力パネルへ。`handleMessage` は `previewModeRef` で stale closure を回避
- [x] `components/code/ExecutionOutput.tsx`：
  - [x] 可視プレビュー領域を追加（固定高 220・`pointerEvents="none"`）。WebView は `htmlSource` がある時だけマウント（乱立回避）＝フォーカス連動の本格化は Phase 3/5
  - [x] **`[プレビュー | ソース]` トグル**（ソース＝土台の HTML/CSS を `SyntaxHighlightedCode language="html"` で表示。案a）。ソースタブでも WebView は `display:none` で残し再実行を防ぐ
  - [x] 既存 hidden WebView は console 専用言語のためそのまま。web 系のみ可視に切替
  - [x] i18n：`code.preview` / `code.source`（ja/en）

### Phase 3: エディタ UI（CodeBlockItem）
- [x] html ブロックの実行ボタンを有効化（Pro 時・sql/cpp と同じ実行ゲート＝Phase 1 の constants ＋本 Phase の htmlInits 配線で完了）
- [x] js/ts ブロックに「HTML/CSS 土台」折りたたみ入力欄（ブロック土台 `htmlInit`・Pro 時のみ・SQL 初期化欄の踏襲）＋ i18n `editor.htmlInit*`（ja/en）
- [x] デッキの `htmlInit` を `CodeBlockItem` までスレッド（`BlockEditor` に `deckHtmlInit` prop 追加、`card/new`・`card/[cardId]/edit` から `currentDeck?.htmlInit` を渡す）
- [x] 実行時に `htmlInits = [deckHtmlInit ?? '', block.htmlInit ?? '']`（html はデッキ土台のみ）を `run` に渡す
- [x] `ExecutionOutput` に `previewMode` / `previewSource`（土台テキスト）を渡す＝実行後にプレビュー＋ソースが出る
- [x] **実行前プレビュー（自動表示）**：js/ts で土台があれば未実行でも土台の初期状態を自動描画。`buildStaticPreviewHtml()`（表示専用・postMessage しない）を新設し、`ExecutionOutput` が未実行時は静的プレビュー・実行後は実行結果を表示（`activeHtml` で出し分け・key で再マウント）。土台編集の毎キーストローク再読込は 400ms デバウンス。~~html は対象外（本文＝内容のため実行で描画）~~ → **2026-07-29 に html も対象へ変更**（下記「実行前プレビューを html にも出す」）

### Phase 4: デッキ土台入力（デッキ編集／新規）
- [x] 「HTML/CSS 共通土台」入力欄（任意・**Pro 時のみ表示**）＝デッキ編集・新規の両画面
- [x] `SqlInitModal` を汎用化（`title`/`hint`/`placeholder` を任意 props 化）して再利用＝HTML 土台編集も同モーダル。i18n `deck.htmlInit*`（ja/en）
- [x] ショートカットキー割当＝`H`（SQL の `Q` と別キー・両画面・ShortcutsModal 一覧にも追加。`shortcut.htmlInit`）

### Phase 5: 学習画面（CodeRunnerView）
- [x] `CodeRunnerView` に `deckHtmlInit` prop を追加、`htmlInits` を `useMemo` 算出
- [x] 実行時に `htmlInits` を `run` に渡す（両実行経路）＋ `ExecutionOutput` に `previewMode`/`previewSource`/`runNonce` を伝達（学習側でも再実行スピナー対策を適用）
- [x] `BlocksView` に `deckHtmlInit` をスレッド、`session.tsx` は `currentDeckHtmlInit`（現在カードのデッキから取得）を全 `BlocksView` に渡す
- [x] プレビュー領域タッチで `suppress()`（フリップ 300ms 抑制）を呼び、プレビュー/ソースをタップしてもカードが裏返らないようにした（`ExecutionOutput.onInteract`＝コードブロック他ボタンと同方式）
- [x] 実機確認：学習カードのスクロール内でプレビュー＋トグルが表示され、タップでフリップしないこと

### Phase 6: 仕上げ
- [x] `locales/ja.json` / `locales/en.json` に文言追加（`code.preview`/`source`・`editor.htmlInit*`・`deck.htmlInit*`・`shortcut.htmlInit`。ja/en 揃い確認済み）
- [x] Pro ゲート確認（html＝`PRO_LANGUAGES` の実行ゲート／js・ts＝土台入力欄＋**静的プレビューも `isPro` で出し分け**＝非 Pro は従来コンソールのまま）
- [x] `lib/settings-keys.ts` への影響確認＝新設定キーなし（`htmlInit` は DB カラムのみ・export は `SELECT *` で自動／import は列追加済み）
- [x] エラー表示：土台/JS のインライン例外は `window.onerror` → error 表示（`ExecutionOutput` の error パネル）
- [x] `CLAUDE.md` に本機能（web プレビュー実行・土台・実行前プレビュー・runNonce・Pro ゲート方式）とデッキ `H` キーを追記

---

## データ／実装方針

- **型**：`Deck.htmlInit: string | null`、`CodeBlock.htmlInit?: string`（js/ts のブロック土台）。
- **DB**：`decks` に `htmlInit TEXT`（nullable）を追加。ブロック土台は `card_contents` の JSON に含まれる（マイグレーション不要）。→ `docs/db-migration-checklist.md` に沿う。
- **言語**：既存の `html` を `EXECUTABLE_LANGUAGES`＋`PRO_LANGUAGES` に昇格。**`css` も 2026-07-29 に昇格**（下記「css の実行」）。
- **可視 WebView**：web 系では実行用 WebView をそのまま**表示**して DOM を見せる（headless の使い捨てではなく結果受信後も残す）。v1 は `pointerEvents="none"` の表示専用＝タッチ競合なし。重い WebView の乱立を避けるため**遅延マウント**（表示中／操作中ブロックのみ）。
- **Pro ゲート（言語で方式が異なる点に注意）**：
  - **html**：`PRO_LANGUAGES` により**実行ボタンが Pro 限定**（非 Pro は従来どおりハイライトのみ）。
  - **js/ts**：コンソール実行は従来どおり無料。**プレビューは「HTML/CSS 土台がある時だけ」出る**が、土台の入力欄（デッキ編集・ブロック）を **Pro 限定**にすることで、非 Pro は土台を作れず＝プレビューも出ない＝従来コンソールのまま。
  - 買い切りで失効しないためデータは DB に保持される（018 と同じ）。

---

## 技術メモ

- **インライン script が走る点が JS サンドボックスと異なる**：現行 JS サンドボックスは `new Function`/`AsyncFunction` でユーザーコードを1つの script に包むが、web 系では本文（html）や土台に**任意の `<script>` が含まれ、HTML パース時に実行される**。そのため：
  - console 上書き・ネットワーク遮断・完了判定機構は**必ず `<head>`（本文より先）に置く**。
  - ユーザー script を try/catch で包めないので、未捕捉例外は **`window.onerror`** で拾って error 表示する。
  - 完了トリガは **`DOMContentLoaded`**（画像等の subresource を待たない）後に起動し、以後は後出しログ用の「保留タイマー追跡＋マクロタスク境界 finish」を流用する。
- **セキュリティ**：ネットワーク API（fetch/XHR/WebSocket）は無効化。ただし土台/本文の `<img src>`/`<link>`/`<iframe>` は**実測で取得できることを確認済み**（下記「サンドボックスの実測制約」）。v1 は許容し、必要なら CSP メタで制限（後続検討）。
- **合成順**：デッキ土台 → ブロック土台 →（js/ts は）本文 script。html は デッキ土台 → 本文。
- **オフライン**：CDN 依存なし（HTML/CSS/JS はローカル完結）。

---

## サンドボックスの実測制約（2026-07-28 確認・041 と共通）

**「HTML はどこまで書けるのか」の結論。** 041 全画面プレビューでも土台/合成/オリジンは同じなので共通（041 固有の差分は `docs/041` 参照）。

### 構造：ユーザーの HTML は必ず `<body>` 直下

`buildWebSandboxHtml` / `buildInteractiveWebSandboxHtml` / `buildStaticPreviewHtml` はいずれも **土台（`${stages}`）とブロック本文（`${markup}`）を `<body>` 直下に文字列連結**し、`<head>` は固定（charset・viewport・遮断スクリプト）。**ユーザーが `<head>` に足す手段は無い**。head 系タグは「無視される」のではなく「置き場所が悪くて効果がない」。

| 書いたもの | 結果 |
|---|---|
| `<meta charset>` | 無効果（エンコーディング確定済み＋head で宣言済み） |
| `<meta name="description">`・`og:*`・`keywords`・`robots`・`theme-color` | 無効果（クローラ/ブラウザ UI 向け） |
| `<title>` | **041 の全画面ヘッダーに表示される**（2026-07-29 追加）。body に落ちても `document.title` が拾うことを実測確認済み。インラインのプレビュー枠には出さない（ブラウザもページ内に描画しないため） |
| `<link rel="icon"/"manifest"/"canonical"/"preconnect">` | 無効果 |
| `<!DOCTYPE>`・`<head>` 開始タグ | 本文中では無視される（外側で宣言済みなので標準モードで動作） |
| `<meta name="viewport">` | head で指定済み。後勝ちで効く可能性があるので**書かない** |
| **`<html lang>` / `<body style>` の属性** | ⚠️ **既存要素にマージされて実際に効く**（HTML 仕様の挙動） |

→ **フル HTML ドキュメントを丸ごと貼っても「head の中身が body に落ちるだけ」でだいたい動く。**

### 画像

- **`<img src="data:...">`・インライン `<svg>`・CSS `url(data:...)` は通信もオリジンも不要で確実に使える**（教材ではこれを推奨）。
- 相対パス・ローカルファイル・**アプリ内の画像ブロックの画像は不可**（`baseUrl='about:blank'`＋`allowFileAccess` 未設定）。
  - → **端末内の写真を使いたいときは 043 の画像ライブラリ**（デッキに登録して `<img src="img://名前">`）。実行の直前に data URI へ置換されるため、この制約に触れずにローカル画像を表示できる。詳細は `docs/043`。
- **外部 https の `<img>` は実測で表示された**（CSP 無し・`originWhitelist={['*']}`）＝`<script src>`/`<link rel=stylesheet>`/`<iframe src>` も同経路で通る。ただし**オフラインで無音で壊れる**ため非推奨。`@font-face` の Web フォントのみ CORS 必須（オリジンが opaque ＝ `Origin: null` を許す CDN のみ通る）。

### オリジン起因（`about:blank` ＝ opaque origin・`isSecureContext === false`）

- Storage 系（`localStorage`/`sessionStorage`/`indexedDB`）は SecurityError、`document.cookie` は例外なしで保存されない。
- **セキュアコンテキスト限定 API は一律不可**：`navigator.clipboard`・`crypto.subtle`・`crypto.randomUUID`（`undefined`）・Service Worker 登録・`Notification`・`getUserMedia`・Geolocation。**乱数は `crypto.getRandomValues()` が使える**（限定対象外）。
- **`history.pushState` はハッシュ変更（`'#x'`）なら通る**（実測 OK）。相対パス解決ができないためパス変更は落ちる想定＝SPA ルーティングのデモは不可。

### 両プレビューで等しく無意味なもの

`:hover`/`:focus-visible`（指にホバーが無い）・**`title` 属性のツールチップ**（下記）・`<noscript>`（JS 常時有効）・`target="_blank"`（`window.open` 無効で別窓を開けない）・`<base target>`・`<video>`/`<audio>`（`allowsInlineMediaPlayback={false}` ＋要ユーザー操作 ＋ ソースが無い＝実質使えない）。

#### `title` 属性のツールチップは出ない（2026-08-08 追記）

`<abbr title="HyperText Markup Language">HTML</abbr>` をホバー/タップしても何も出ない。原因は
**iOS/iPadOS の WebKit がツールチップ UI 自体を実装していない**こと（ホバー前提の macOS 専用機能）で、
**041 全画面でも同じ**。サンドボックスは `markup = body` を素通しするだけで属性を落としておらず、
`document.querySelector('abbr').title` で値は取れる＝**原因を DOM 側や合成処理に探さないこと**。

教材で見せたいときは **`content: attr(title)` で自作する**。トリガは `:hover` の代わりに
`:active`/`:focus`（**全画面ならタップで効く**）を使う。`abbr` は既定でフォーカスを受けないので
`tabindex="0"` が要る。常時見せるだけなら `abbr[title]::after { content: " (" attr(title) ")" }` で足りる。
このスタイルをブロック固有土台に置けば「本文には `<abbr>` のマークアップだけ書かせる」出題になる。

### 040 インライン特有（041 では解消）

`scrollEnabled={false}`・`pointerEvents="none"` のため**操作不可**、`100vh` はプレビュー箱の高さ基準になる。
**縦は中身の高さに自動追従する**（下記「高さ自動調整」）ので「はみ出して切れる」は解消済み。
ただし**横方向は切れたまま**（横スクロールにはタッチが要るため。全画面か「ソース」で見る）。

### 高さ自動調整（2026-07-29 実装）

**なぜ「内側をスクロールさせる」ではなく「箱を伸ばす」なのか**：インラインの可視 WebView を
スクロール可能にするにはタッチを受け付ける必要があり、学習カードの ScrollView/FlipCard・編集の
`NestableDraggableFlatList` とジェスチャーを奪い合う。**それを避けるために 041 を全画面モーダル
（別 VC）にした**のだから、インラインでタッチを取り戻すのは本末転倒になる。箱の高さを中身に
合わせれば、はみ出した分は**外側のカードの ScrollView**で読めるので、新しいジェスチャーを
1つも足さずに「全部見える」が成立する。

- サンドボックス側：`HEIGHT_REPORT_SCRIPT`（`sandbox.ts`）が
  `{ type: 'previewHeight', height }` を postMessage する。`buildWebSandboxHtml` と
  `buildStaticPreviewHtml` の両方に入れる（**静的プレビューが postMessage する唯一の例外**）。
- **harness より前に置く**：`buildWebSandboxHtml` の harness は `window.setTimeout` をラップして
  「保留タイマー」として数えるため、後ろに置くと 300ms の追い撃ちが**完了判定を遅らせる**。
  先に置いて生の `setTimeout` を捕まえておけば完了判定にも5秒上限にも影響しない。
- **連続追従（ResizeObserver）はしない**。送るのは `DOMContentLoaded` / `load` / `load+300ms` の
  3回だけ。編集画面のドラッグリストで高さが動き続けると下ブロックの `onLayout` がずれるため。
- RN 側：`ExecutionOutput` が `previewHeight` を**実行結果ハンドラに渡す前に横取り**する
  （`useCodeExecution.handleMessage` は `type` を `ExecStatus` として扱うので、渡すと状態が壊れる）。
- 範囲は `MIN_PREVIEW_HEIGHT`(220) 〜 画面高の `MAX_PREVIEW_HEIGHT_RATIO`(0.6)。
  `100vh` 等のビューポート基準コンテンツは「箱が伸びる→再計測でさらに伸びる」形になりうるが、
  **通知が1ドキュメントにつき3回きり＋上限クランプ**で必ず収束する（無限ループにならない）。
- 「ソース」タブの高さ上限も同じ値にして、タブ切替で箱が飛び跳ねないようにしている。また `confirm()`/`prompt()` は同期ブロックのため 5 秒タイムアウトに掛かりうる（`alert()` はネイティブダイアログで動作）。**土台の `<script>` 内の `console.log` は静的プレビュー（未実行時）では console キャプチャが無いのでどこにも出ない**（実行後は出る）。

### 検証に使ったカード

```html
<img src="https://placehold.co/60" onerror="document.body.append('img:NG')" onload="document.body.append('img:OK')">
<script>
  try { history.pushState({}, '', '#x'); console.log('pushState:OK'); } catch(e) { console.log('pushState:NG ' + e.name); }
  console.log('secure:' + window.isSecureContext, 'clipboard:' + !!navigator.clipboard, 'randomUUID:' + !!crypto.randomUUID);
</script>
```

結果：`img:OK` ／ `pushState:OK secure:false clipboard:false randomUUID:false`

---

## 実行前プレビューを html にも出す（2026-07-29 方針変更）

当初は「html は本文＝内容だから実行で描画すればよい」として実行前プレビューの対象外にしていた。
その後、**土台に追記して完成させる出題**（土台の初期状態を見る → 本文に HTML を書き足す →
実行して答え合わせ）という用途が出てきたため、html も対象に含めた。

### 第1段：土台を実行前に見せる

- `staticPreview` の条件に html を追加（`CodeRunnerView` / `CodeBlockItem` の `canStaticPreview`）。
- **副次的な改善**：これまで html ブロックで ⟲（リセット）を押すとプレビュー枠ごと消えていた
  （静的プレビューが無いため）。実行前プレビューが入ったことで「土台の初期状態に戻る」という
  本来の意味になった。
- **デッキ土台が無い html カードは見た目が変わらない**（描くものが無ければ枠自体が出ない）。

### 第2段：本文も実行前に描く（`CodeBlock.previewInit` トグル）

「土台が無く、**表面に部分HTMLを書いておいて**、それを見ながら完成させる」出題も作りたい、という
要望への対応。ただし**常時ONにはできない**：

| 出題パターン | 実行前プレビュー |
|---|---|
| A：部分HTMLを見ながら完成させる | 欲しい |
| B：**この HTML はどう表示される？** と予想させる | **困る**（答えが最初から見える） |

A と B はどちらも html カードとして自然なので、**ブロック単位のスイッチ**にした。
`CodeBlock` は `card_contents` の JSON に入っているため **`previewInit?: boolean` の追加は
マイグレーション不要**。既定 false ＝ B のカードは無傷。

- ON のとき `ExecutionOutput` に `staticBody`（＝`block.content`）を渡し、
  `buildStaticPreviewHtml([土台, 本文])` で描く。ルールは **「実行前プレビュー ＝ 土台 ＋ 本文」**
  （＝カードに書かれている初期状態）の1本になる。
- **js/ts には `staticBody` を渡さない**：本文が JS なので実行前に走らせてはいけない。
- **学習画面は `block.content`（保存値）を使い、学習者がその場で編集した内容は反映しない**。
  これにより「実行前プレビュー＝問題の初期状態／実行＝自分の書き足しを反映」という区別が保たれ、
  実行ボタンが無意味にならない。
- **編集画面では打鍵に追従する**（`block.content` がライブ値・400msデバウンス）。作者自身が書いて
  いる場面ではネタバレの概念が無く、オーサリング支援として有用なので許容。
- TSV：`previewInit` は往復しない（`sqlInit`/`htmlInit` と同じ）。既定 OFF に戻るだけの表示設定なので
  **エクスポート前の内訳表示（`inspectTsvExport`）には加えない**と判断した。JSON エクスポートは
  `card_contents` を丸ごと出すので保持される。

---

## ソースに実行後の DOM を出す（2026-07-29・案b を追加）

当初「ソース＝土台テキスト（案a）」に確定し、案b（実行後の DOM）は将来拡張としていた。
**タブを3つに増やさず、既存の ⟲（リセット）に実行前/実行後の軸を担わせる**形で両立させた。

```
[実行前 / 実行後]  ×  [プレビュー / ソース]      ← ⟲ が左の軸を戻す
実行前：プレビュー＝土台の描画      ソース＝土台のテキスト
実行後：プレビュー＝実行結果        ソース＝実行後の DOM
```

プレビュータブは元から「実行前＝土台／実行後＝結果」で切り替わっていたので、ソースを同じ軸に
乗せると**2つのタブが常に同じ瞬間の姿（描画 / テキスト）を映す**ことになり、一貫する。
3タブ案は、狭いプレビューバーに ⛶・コピー・⟲ も同居しているため見送った。

- サンドボックス側：`buildWebSandboxHtml` の `finish()` で `{ type:'resultSource', html }` を postMessage。
  - **`document.body.outerHTML`** を送る。`innerHTML` ではなく `outerHTML` なのは、
    `document.body.style.background = ...` のような **body 属性への変更**（JS 演習でよくある）を
    拾うため。head のサンドボックス harness は含まれない。
  - **base64 は中身を省略**（`data:image/jpeg;base64,…`）。043 の画像は data URI に置換済みで、
    そのまま送ると数MBがブリッジに乗り、ハイライト描画も潰れる。構造は読めて量だけ消える。
  - 全体長 100KB で打ち切り。
- RN 側：`ExecutionOutput` が `previewHeight` と同じ要領で**横取り**するので **`useCodeExecution` は無改造**。
  `execActive` が false になる（⟲）か `runNonce` が進む（再実行）と捨てて土台テキストに戻る。
- あわせて**表示するソースが無いときはソースタブを隠す**ようにした（土台の無い html カードで
  空の箱が出ていた）。コピーボタンも「いま表示しているソース」を対象にする。

**踏んだ落とし穴（再発防止）**

1. **生成コードの文字列に改行を入れるときは `\\n` と書く**。`sandbox.ts` は TS のテンプレートリテラルで
   JS を組み立てるため、`'\n'` と書くと**生の改行**が入り、生成された JS が
   `'…（改行）…'` となって **SyntaxError で harness の script 全体が死ぬ**。症状は
   「スピナーが止まらない・console が出ない」だが、本文の `<script>` は別タグなので**プレビューだけは
   正常に動く**ため、原因から最も遠いところに症状が出る。Python サンドボックスの `'…\\n' +` が正しい書き方。
2. **ソースタブ表示中の WebView を `display:'none'` にしてはいけない**。WKWebView がビュー階層から
   外れて JS が走らず、**ソースを開いたまま実行するとスピナーが止まらない**。console 専用言語の
   hidden WebView と同じ「画面外へ逃がす」（`position:absolute; top:-10000; opacity:0`）方式にする。
   040 当時から `display:'none'` だったが、ソースタブに実行結果を出すようになって初めて表面化した。
3. **折り返さない表示（`wrap={false}`）に長大な1行を渡すと領域ごと真っ白になる**。
   `text.textContent += ...` を1000回まわすようなカードでは改行を含まない約8,900文字の1行ができ、
   幅 約89,000pt のレイアウトになって iOS が描画に失敗する。**データは届いているのに「消えた」ように
   見える**ので原因を見誤りやすい。対策として結果 DOM は**行単位でも 500 文字で省略**する
   （`… (+N chars)` を付けて切られたことを明示）。省略は3段構え＝base64 の中身／1行500文字／全体100KB。

---

## css の実行（2026-07-29 追加）

将来拡張だった「css をデッキの HTML 土台に当てて描画」を実装した。**構造は js/ts と同じ**で、
合成先が `<script>` から `<style>` に変わるだけ。

```html
<body>
  [Deck.htmlInit]         ← デッキ共通の土台
  [CodeBlock.htmlInit]    ← ブロック固有の土台
  <style>[本文=CSS]</style>   ← 上の DOM を装飾する
</body>
```

実行前プレビュー（素の土台）→ 実行（装飾後）の対比がそのまま答え合わせになるため、
**3言語のなかで土台モデルに最も素直に嵌まる**。

### js/ts と意味が変わる点（設計判断）

- **土台の有無で分岐しない（案A・常に実行可能）**：js/ts は土台が無ければ「コンソール実行」に
  落ちるが、**css にはその落とし先が無い**（`console.log` が無い）。土台が無ければ空白が出るだけ
  ＝ html と同じ扱いにした。`useCodeExecution` の `isWeb` と `buildSandboxHtml` の両方で
  `html` と並べて分岐する。
- **Pro ゲートは `PRO_LANGUAGES` 方式**：上と同じ理由で「非 Pro はコンソールのみ」に落とせないため、
  html/sql/cpp と同じく**実行ボタンごと Pro 限定**にした（js/ts の「土台入力欄だけ Pro」方式ではない）。
- **エラーが出ない**：CSS の構文ミスはブラウザが黙って無視する。`background: crimsom` と打ち間違えても
  無反応で、出力パネル（console）も常に空。**「実行したのに何も起きない＝どこか間違っている」**という
  読み方になる。仕様として受け入れる。
- **ソースタブ（案b＝実行後の DOM）の価値は薄い**：CSS は DOM を変えないので実行前後で差がほぼ出ない。
  学習価値があるのは computed style だが、それは別機能。CSS では「ソース＝土台」で足りる。
- **`:hover` はインライン・全画面とも効かない**（指にホバーが無い）。`:active`/`:focus`/`:checked` は
  **全画面（⛶）でならタップで効く**ので、擬似クラス教材は全画面前提になる。
- 043 の画像ライブラリは効く（`background-image: url(img://logo)`）。置換は合成後の最終 HTML に
  掛かるため言語を問わない。

### 土台を書くときの指針（重要）

**土台では `style` 属性を使わず `<style>` にまとめる。**

```html
<!-- NG：css ブロックから background を上書きできない -->
<div id="light" style="width:80px;height:80px;border-radius:50%;background:#333"></div>

<!-- OK：同じ詳細度なので css ブロックが自然に勝つ -->
<style>
  #light { width:80px; height:80px; border-radius:50%; background:#333 }
</style>
<div id="light"></div>
```

`style` 属性は詳細度 1,0,0,0 で **`#id` セレクタより強い**ため、そのプロパティは css ブロックから
`!important` なしでは上書きできない。しかも **CSS はエラーを出さない**ので、学習者には
「実行しても何も起きない」としか見えず原因に辿り着けない（実際に踏んだ）。

js/ts ブロックは `element.style.x = ...` がインラインを直接書き換えるため影響を受けない＝
**css ブロック特有の注意点**。

### 変更点

`constants.ts`（`EXECUTABLE_LANGUAGES`＋`PRO_LANGUAGES` に追加）・`sandbox.ts`（`mode:'css'` を
`buildWebSandboxHtml`/`buildInteractiveWebSandboxHtml` に追加・本文中の `</style>` は無害化）・
`useCodeExecution`（`isWeb`）・`CodeRunnerView`/`CodeBlockItem`（`htmlInits`・`canExpand`・
`canStaticPreview`・ブロック土台入力欄の言語条件）。i18n の追加は不要（土台欄の文言は
「HTML/CSS 土台」で共通）。

---

## ブロック単位でデッキ土台を切る（`CodeBlock.noDeckHtmlInit`・2026-07-30 追加）

デッキに共通土台があると、**そのデッキの js/ts ブロックは必ず Web プレビュー実行になる**
（`useCodeExecution` の `hasStage` 判定）。そのため「このカードは `console.log` を見るだけ」という
出題でも、実行前プレビューの枠と実行結果のプレビュー枠が出る（ログ自体は下に併記されるので
壊れてはいないが、土台と無関係なカードには邪魔）。これをブロック単位で切れるようにした。

### 仕様

- `CodeBlock.noDeckHtmlInit?: boolean`（JSON の任意フラグ・**マイグレーション不要**・既定 false＝積む）。
  否定形で持つので**既存カードは無変更**。`previewInit` と同じ流儀。
- 対象は **web 系4言語すべて**（html / css / js / ts）。html・css も「このブロックはデッキ土台を
  混ぜずに単独で描きたい」という要求があり得るため、js/ts に絞らず対称にした。
- ON にするとそのブロックでは `Deck.htmlInit` を積まない（**ブロック固有の `htmlInit` は残る**）。
  - **js/ts**：土台が全部空になると `hasStage` が false ＝ **コンソール実行に戻る**。
    実行前プレビューも ⛶（全画面）も出なくなる＝狙いどおり。
  - **html/css**：Web 実行のまま、ブロック固有土台（＋本文）だけで描画する。
- **カード単位ではなくブロック単位**にした理由：①保存先が `CodeBlock` の JSON に既にあり
  `cards` の列追加が不要 ②1枚のカードに「コンソールだけのブロック」と「DOM 操作ブロック」を
  混在させられる ③土台を消費しているのはブロックなので概念が一致する。

### UI

`CodeBlockItem` に `previewInit` と同型のトグル行（`layers`/`layers-outline` アイコン＋Switch＋説明）。
ラベルは肯定形「デッキ共通の土台を使う」＝**既定 ON**（保存値は否定形）。
表示条件は **web 系ブロック かつ Pro かつデッキに共通土台がある**とき（土台が無ければ切る対象が無い）。
ブロック固有土台の欄は折りたたみ既定で見つけにくいため、**この行は独立セクションとして常時表示**する
（4言語で同じ位置に出る）。

### 変更点

`types/index.ts`（フラグ1つ）・`CodeRunnerView`/`CodeBlockItem` の `htmlInits` 組み立て2箇所
（`deckStage` を挟むだけ）・`CodeBlockItem` の UI ＋ i18n（`editor.useDeckHtmlInit*`）。
`previewSource`・`stages`・`canExpand`・`canStaticPreview`・`run()`・`ExecutionOutput`・041 モーダルは
すべて `htmlInits` から派生しているので**自動で追従**（サンドボックス側は無改造）。
なお **TSV 往復ではこのフラグは落ちる**（`previewInit` と同じ・JSON エクスポートは保持する）。

---

## html ブロックにもブロック固有土台を許す（2026-08-08 追加）

当初 html は「**本文が主役**だからブロック土台は要らない（土台に書きたいことは本文に書けばいい）」
として `htmlInits = [deckStage]` にしていた。これを **web 系4言語で対称**（`[deckStage, blockStage]`）に
変更した。

### 理由：html だけ「カード単位の出題の前提」を置けなかった

土台と本文の違いは「HTML かどうか」ではなく、

- **土台 ＝ 実行前から見えている出題の前提**（学習者が書くものではない）
- **本文 ＝ 実行して初めて出る学習者の答え**

という軸にある。この軸で見ると html だけ、前提を**デッキ全体でしか**設定できなかった。
`previewInit` は「本文（＝答え）を実行前に見せる」機能なので代替にならない。結果、

- 土台に `<style>` を置き、本文はマークアップだけ書かせる（答えが CSS で汚れない）
- 土台の DOM を見せておき、本文で追記して変化を見る

といった、カードごとに前提が違う出題が html では作れなかった。js/ts・css と同じモデルなので
**新しい概念は増えない**。

### 「追記」か「差し替え」か（採用：追記のまま）

デッキ土台・ブロック土台・本文にそれぞれ `<style>` があると、`<style>` 要素が**3つ並び**、
CSS のカスケードで**後勝ち**（本文 > ブロック土台 > デッキ土台）になる。これを「上書きされた分は
アプリ側が消して 1 つに見せる」案（差し替え型）は**不採用**。

1. **置き換えの単位を一般には定義できない**。土台は CSS だけでなく DOM も `<script>` も入る任意の
   HTML 断片で、セレクタ単位のマージは**カスケードの再実装**になる。
2. **置き換えたいときの手段は既にある**＝`noDeckHtmlInit`（ブロック単位・明示的・宣言的）。
   つまり追記と置き換えが**両方揃う**。
3. **カスケードそのものが教材**。`<style>` が 3 つ並んで後勝ちするのは実際のブラウザの姿で、
   アプリが 1 つに畳むと実物と違う挙動を教えることになり、下記の詳細度の罠に当たったときに
   何が起きているのか分からなくなる。

### 追記型で踏みやすい罠（文言で誘導する）

- **「後勝ち」は詳細度が同じときだけ**。デッキ土台が `<body style="background:black">`（詳細度
  1,0,0,0）や `!important` で書いていると、下に何個 `<style>` を積んでも勝てない。しかも CSS は
  エラーを出さないので「実行しても何も起きない」という最もデバッグしづらい形で出る
  （CLAUDE.md の css ブロックの注意点と同根）。
- **DOM は追記だと重複する**。デッキ土台とブロック土台の両方に `<div id="box">` があると要素が 2 つ
  並び、`document.getElementById` は**先頭（デッキ側）**を返す。**DOM を差し替えたい場面では
  追記で頑張らず `noDeckHtmlInit` を切る**のが正解。→ `editor.htmlInitHint` にこの使い分けを明記した。

### 変更点（実質3箇所・型/DB/サンドボックスは無改造）

- `CodeRunnerView`/`CodeBlockItem` の `htmlInits` 組み立て＝web 系4言語すべて `[deckStage, blockStage]`
- `CodeBlockItem` の土台入力欄の表示条件を `isWebLang && isPro` に（html を追加）
- i18n `editor.htmlInitHint` を 4 言語共通の表現に（旧文は「このブロックの **JS が操作する**土台」で
  css でも既にズレていた）

`previewSource`・`stages`・`canExpand`・`canStaticPreview`・ソースタブ・⛶ 全画面・`img://` 解決
（043）は**すべて `htmlInits` 派生なので自動追従**。TSV エクスポート前の内訳（`inspectTsvExport`）は
言語を見ずに `htmlInit` を数えているのでこちらも変更不要。

**実行前プレビューの中身**は `[deckStage, blockStage]`（＋`previewInit` ON なら本文）になる。
「実行前はブロック土台の見た目 → 実行すると本文が効いて変わる」という対比がそのまま答え合わせになる。

---

## 将来拡張（v1 では対象外）

- **インタラクティブ**：可視 WebView を操作可能にし、ボタンの `onclick` 等を動かす（ScrollView とのジェスチャー競合対策が必要）。→ **041 で実装済み**（全画面モーダル＝別 VC に隔離してジェスチャー競合を回避・ライブ console 付き）。
