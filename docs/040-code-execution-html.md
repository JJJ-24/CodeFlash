# 040 コード実行（HTML/CSS プレビュー・Web 系）

**フェーズ:** 将来
**ステータス:** 未着手
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
| **css** | ✕（当面ハイライトのみ） | — | — | 将来：デッキ HTML 土台に当てて描画 |

- **html ブロック**：HTML/CSS だけでも実行してプレビュー可（JS 不要）。`<script>` を入れれば JS も動く。
- **js/ts ブロック**：本文は JS。デッキ＋ブロックの HTML/CSS 土台を操作する（暗記カードの「一文書いて答え合わせ」用）。土台が無い js/ts は**従来どおりコンソール実行のみ**。
- すべて **Pro 限定・一度描画のみ（v1）**。

### プレビュー／ソース切り替え

- ブロック下に可視プレビュー窓。上部に **`[プレビュー | ソース]` トグル**。
- **プレビュー**＝描画結果（js/ts は実行前＝土台の初期状態／実行後＝JS 適用後。html は実行で本文を描画）。
- **ソース（案a で確定）**＝**土台の HTML/CSS をテキスト表示**（シンタックスハイライト）。JS が操作する対象を確認する用途。html ブロックは本文＝ソースなのでトグルは主に js/ts 向け（html は「デッキ土台＋本文」を表示）。
- 実行前・実行後とも切り替え可。**console.log は従来の出力パネルに別枠**で表示（プレビューとは別）。
- **案b（実行後の結果 HTML 表示）は将来拡張**。

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
- [x] **実行前プレビュー（自動表示）**：js/ts で土台があれば未実行でも土台の初期状態を自動描画。`buildStaticPreviewHtml()`（表示専用・postMessage しない）を新設し、`ExecutionOutput` が未実行時は静的プレビュー・実行後は実行結果を表示（`activeHtml` で出し分け・key で再マウント）。土台編集の毎キーストローク再読込は 400ms デバウンス。html は対象外（本文＝内容のため実行で描画）

### Phase 4: デッキ土台入力（デッキ編集／新規）
- [x] 「HTML/CSS 共通土台」入力欄（任意・**Pro 時のみ表示**）＝デッキ編集・新規の両画面
- [x] `SqlInitModal` を汎用化（`title`/`hint`/`placeholder` を任意 props 化）して再利用＝HTML 土台編集も同モーダル。i18n `deck.htmlInit*`（ja/en）
- [x] ショートカットキー割当＝`H`（SQL の `Q` と別キー・両画面・ShortcutsModal 一覧にも追加。`shortcut.htmlInit`）

### Phase 5: 学習画面（CodeRunnerView）
- [x] `CodeRunnerView` に `deckHtmlInit` prop を追加、`htmlInits` を `useMemo` 算出
- [x] 実行時に `htmlInits` を `run` に渡す（両実行経路）＋ `ExecutionOutput` に `previewMode`/`previewSource`/`runNonce` を伝達（学習側でも再実行スピナー対策を適用）
- [x] `BlocksView` に `deckHtmlInit` をスレッド、`session.tsx` は `currentDeckHtmlInit`（現在カードのデッキから取得）を全 `BlocksView` に渡す
- [x] プレビュー領域タッチで `suppress()`（フリップ 300ms 抑制）を呼び、プレビュー/ソースをタップしてもカードが裏返らないようにした（`ExecutionOutput.onInteract`＝コードブロック他ボタンと同方式）
- [ ] 実機確認：学習カードのスクロール内でプレビュー＋トグルが表示され、タップでフリップしないこと

### Phase 6: 仕上げ
- [ ] `locales/ja.json` / `locales/en.json` に文言追加（土台欄ラベル・ヒント・トグル）
- [ ] Pro ゲート確認（html＝`PRO_LANGUAGES` の実行ゲート／js・ts＝土台入力欄が Pro 限定＝非 Pro は従来コンソールのまま）
- [ ] `lib/settings-keys.ts` への影響確認（新設定キーは無い想定だが確認）
- [ ] エラー表示（土台の記述ミス・JS 例外＝`window.onerror`）の見え方確認

---

## データ／実装方針

- **型**：`Deck.htmlInit: string | null`、`CodeBlock.htmlInit?: string`（js/ts のブロック土台）。
- **DB**：`decks` に `htmlInit TEXT`（nullable）を追加。ブロック土台は `card_contents` の JSON に含まれる（マイグレーション不要）。→ `docs/db-migration-checklist.md` に沿う。
- **言語**：既存の `html` を `EXECUTABLE_LANGUAGES`＋`PRO_LANGUAGES` に昇格。`css` は当面据え置き（将来デッキ HTML 土台に当てる形で実行対応）。
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
- **セキュリティ**：ネットワーク API は無効化。ただし土台/本文の `<img src>`/`<link>`/`<iframe>` は取得しうる。v1 は許容し、必要なら CSP メタで制限（後続検討）。
- **合成順**：デッキ土台 → ブロック土台 →（js/ts は）本文 script。html は デッキ土台 → 本文。
- **オフライン**：CDN 依存なし（HTML/CSS/JS はローカル完結）。

---

## 将来拡張（v1 では対象外）

- **css の実行**：css ブロックをデッキの HTML 土台に当てて描画（`css` を `EXECUTABLE`＋`PRO` に昇格）。
- **ソース＝案b**：実行後の結果 HTML（JS 適用後の DOM）を表示するモード。
- **インタラクティブ**：可視 WebView を操作可能にし、ボタンの `onclick` 等を動かす（ScrollView とのジェスチャー競合対策が必要）。
- **プレビュー高さ自動調整**：`document.body.scrollHeight` を postMessage で受けて高さを合わせる。
